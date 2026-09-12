import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, symlinkSync, linkSync } from "node:fs";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IngestCoordinator } from "../../src/core/ingest-coordinator";
import { SourceReaderPool, type SourceReaderOptions } from "../../src/core/source-reader-client";
import { stopOwnedSearchWorkerProcess } from "../../src/core/search-worker-lifecycle";
import { encodeReaderPacket, readerPrivateBlocks, sanitizeReaderEvent, sanitizeReaderContext, SOURCE_READER_MAX_PACKET_BYTES } from "../../src/core/source-reader-protocol";
import type { ApiResponse, EventEnvelope } from "../../src/core/types";
import { createTestDb, createTestConfig } from "./test-helpers";

const fixture = join(import.meta.dir, "../fixtures/source-reader-fault-worker.ts");
const ok = { ok: true, source: "core", items: [], meta: { count: 0, latency_ms: 0, sla_latency_ms: 200, filters: {}, ranking: "none" } } as ApiResponse;
function setup(options: SourceReaderOptions = {}, record?: (event: EventEnvelope) => Promise<ApiResponse>) {
  const dir = mkdtempSync(join(tmpdir(), "reader-isolation-"));
  const db = createTestDb();
  const sessions = join(dir, "sessions");
  mkdirSync(sessions);
  const gemini = join(dir, "gemini.jsonl");
  writeFileSync(gemini, JSON.stringify({ platform: "gemini", project: dir, session_id: "healthy", event_type: "user_prompt", payload: { content: "healthy source" }, ts: new Date().toISOString() }) + "\n");
  const events: EventEnvelope[] = [];
  const config = createTestConfig({ dbPath: join(dir, "memory.db"), codexProjectRoot: dir, codexSessionsRoot: sessions,
    codexHistoryEnabled: true, geminiEventsPath: gemini, geminiIngestEnabled: true,
    opencodeIngestEnabled: false, cursorIngestEnabled: false, antigravityIngestEnabled: false, claudeCodeIngestEnabled: false });
  const coordinator = new IngestCoordinator({ db, config, recordEvent: () => ok,
    recordEventQueued: record ?? (async (event) => { events.push(event); return ok; }),
    upsertSessionSummary: () => {}, heartbeatPath: "", isShuttingDown: () => false, processRetryQueue: () => {} }, options);
  return { dir, db, sessions, gemini, events, config, coordinator, close() { coordinator.stopTimers(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function rollout(path: string, text: string) {
  writeFileSync(path, JSON.stringify({ timestamp: new Date().toISOString(), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } }) + "\n");
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("condition deadline"); await Bun.sleep(5); }
}

for (const operation of ["statSync", "openSync", "readSync"] as const) {
  test(`permanent ${operation} is isolated; healthy source and another file progress`, async () => {
    const options: SourceReaderOptions = { scriptPath: fixture, ioTimeoutMs: 50, env: { READER_FAULT_OPERATION: operation } };
    const f = setup(options);
    const bad = join(f.sessions, "rollout-000.jsonl");
    const good = join(f.sessions, "rollout-111.jsonl");
    rollout(bad, "pending"); rollout(good, "available");
    options.env!.READER_FAULT_PATH = bad;
    try {
      const started = Date.now();
      const badResult = await f.coordinator.runPeriodicIngestTickLocal("codex");
      expect(badResult.ok).toBe(false);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(f.db.query("SELECT offset FROM mem_ingest_offsets WHERE source_key=?").get(`codex_rollout:${bad}`)).toBeNull();
      expect(await f.coordinator.runPeriodicIngestTickLocal("gemini")).toEqual({ ok: true });
      // The next discovery excludes only the stalled path and reports pending.
      expect((await f.coordinator.ingestCodexHistory()).ok).toBe(false);
      expect(f.events.some((event) => event.platform === "gemini")).toBe(true);
      expect(f.db.query<{ offset: number }, [string]>("SELECT offset FROM mem_ingest_offsets WHERE source_key=?").get(`codex_rollout:${good}`)?.offset).toBe(statSync(good).size);
      expect(f.db.query("SELECT offset FROM mem_ingest_offsets WHERE source_key=?").get(`codex_rollout:${bad}`)).toBeNull();
    } finally { f.close(); }
  });
}

test("a permanently blocked directory leaves discovery pending and another source available", async () => {
  const options: SourceReaderOptions = { scriptPath: fixture, ioTimeoutMs: 50, env: { READER_FAULT_OPERATION: "opendirSync" } };
  const f = setup(options); options.env!.READER_FAULT_PATH = f.sessions;
  try {
    expect((await f.coordinator.runPeriodicIngestTickLocal("codex")).ok).toBe(false);
    expect(await f.coordinator.runPeriodicIngestTickLocal("gemini")).toEqual({ ok: true });
    expect((await f.coordinator.runPeriodicIngestTickLocal("codex")).ok).toBe(false);
    expect(f.db.query("SELECT * FROM mem_ingest_offsets WHERE source_key LIKE 'codex_rollout:%'").all()).toEqual([]);
  } finally { f.close(); }
});

test("a blocked secondary workspace log cannot be converted into a fallback project", async () => {
  const options: SourceReaderOptions = { scriptPath: fixture, ioTimeoutMs: 50, env: { READER_FAULT_OPERATION: "readFileSync" } };
  const f = setup(options);
  const logs = join(f.dir, "logs");
  const exthost = join(logs, "window", "google.antigravity", "1", "exthost1");
  mkdirSync(join(exthost, "output_logging_x"), { recursive: true });
  const secondary = join(exthost, "exthost.log");
  const primary = join(exthost, "output_logging_x", "Antigravity.log");
  writeFileSync(secondary, "workspaceStorage/abcdef1234567890");
  writeFileSync(primary, `${new Date().toISOString()} [info] Requesting planner with 3 chat messages\n`);
  options.env!.READER_FAULT_PATH = secondary;
  Object.assign(f.config, { antigravityIngestEnabled: true, antigravityLogsRoot: logs, antigravityWorkspaceStorageRoot: join(f.dir, "absent-storage"), antigravityWorkspaceRoots: [f.dir] });
  try {
    expect((await f.coordinator.runPeriodicIngestTickLocal("antigravity")).ok).toBe(false);
    expect((await f.coordinator.runPeriodicIngestTickLocal("antigravity")).ok).toBe(false);
    expect(f.events).toEqual([]);
    expect(f.db.query("SELECT * FROM mem_ingest_offsets WHERE source_key=?").get(`antigravity_log:${primary}`)).toBeNull();
    expect(await f.coordinator.runPeriodicIngestTickLocal("gemini")).toEqual({ ok: true });
  } finally { f.close(); }
});

test("owner save ACK has no source I/O deadline, and offset remains unchanged until success", async () => {
  let release!: () => void;
  let entered = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const f = setup({ ioTimeoutMs: 20 }, async () => { entered = true; await gate; return ok; });
  try {
    let done = false;
    const pending = f.coordinator.runPeriodicIngestTickLocal("gemini").then((result) => { done = true; return result; });
    await until(() => entered);
    await Bun.sleep(100);
    expect(done).toBe(false);
    expect(f.db.query("SELECT * FROM mem_ingest_offsets").all()).toEqual([]);
    release();
    expect(await pending).toEqual({ ok: true });
    expect(f.db.query<{ offset: number }, [string]>("SELECT offset FROM mem_ingest_offsets WHERE source_key=?").get(`gemini_events:${f.gemini}`)?.offset).toBe(statSync(f.gemini).size);
  } finally { release(); f.close(); }
});

test("a lost save ACK retains offset and replay uses the same dedupe identity", async () => {
  let drop = true;
  const stored = new Set<string>();
  let attempts = 0;
  const f = setup({ spawnReader(args) {
    const proc = Bun.spawn(args);
    const stdin = proc.stdin!;
    return { pid: proc.pid, stdout: proc.stdout, stderr: proc.stderr, exited: proc.exited, kill: proc.kill.bind(proc),
      stdin: { write(bytes: Uint8Array) {
        const packet = JSON.parse(Buffer.from(bytes).toString());
        if (drop && packet.callId && packet.result?.ok) { drop = false; throw new Error("injected lost ACK"); }
        return stdin.write(bytes);
      }, flush: () => stdin.flush() } } as never;
  } }, async (event) => {
    attempts++;
    const key = event.dedupe_hash!;
    const duplicate = stored.has(key);
    stored.add(key);
    return { ...ok, meta: { ...ok.meta, deduped: duplicate } };
  });
  try {
    expect((await f.coordinator.runPeriodicIngestTickLocal("gemini")).ok).toBe(false);
    expect(stored.size).toBe(1);
    expect(f.db.query("SELECT * FROM mem_ingest_offsets").all()).toEqual([]);
    expect(await f.coordinator.runPeriodicIngestTickLocal("gemini")).toEqual({ ok: true });
    expect(attempts).toBe(2);
    expect(stored.size).toBe(1);
  } finally { f.close(); }
});

test("oversized source content is pending and never advances its offset", async () => {
  const f = setup();
  writeFileSync(f.gemini, JSON.stringify({ project: f.dir, session_id: "large", event_type: "user_prompt", payload: { content: "x".repeat(SOURCE_READER_MAX_PACKET_BYTES) } }) + "\n");
  try {
    expect((await f.coordinator.ingestGeminiHistory()).ok).toBe(false);
    expect(f.events).toEqual([]);
    expect(f.db.query("SELECT * FROM mem_ingest_offsets").all()).toEqual([]);
  } finally { f.close(); }
});

test("all unconfirmed reader exits consume the finite slots across 1000 requests", async () => {
  let spawned = 0;
  const never = new Promise<number>(() => {});
  const pool = new SourceReaderPool(createTestConfig(), async () => null, { slots: 2, maxQueued: 4, startupTimeoutMs: 10,
    spawnReader: () => {
      spawned++;
      return { pid: 123456 + spawned, stdin: { write: () => 1 }, stdout: new ReadableStream(), stderr: new ReadableStream(), exited: never, kill() {} } as never;
    }, stopOwnedProcess: async () => ({ status: "still_running", forced: true }) });
  const requests = Array.from({ length: 1000 }, (_, i) => pool.run(i % 2 ? "gemini" : "codex", "periodic"));
  expect((await Promise.all(requests)).every((result: any) => !result.ok)).toBe(true);
  expect(spawned).toBe(2);
  expect(pool.snapshot()).toMatchObject({ live: 2, queued: 0, stopping: 2 });
  await pool.stop();
});

test("an unkillable reader leaves the spare slot available to a healthy file in the same source", async () => {
  let launches = 0;
  let bad = "";
  const f = setup({ slots: 2, ioTimeoutMs: 20,
    spawnReader(args) {
      if (++launches > 1) return Bun.spawn(args);
      let output!: ReadableStreamDefaultController<Uint8Array>;
      return { pid: 1234567, stdout: new ReadableStream<Uint8Array>({ start(controller) { output = controller; } }), stderr: new ReadableStream(),
        stdin: { write(bytes: Uint8Array) { const initial = JSON.parse(Buffer.from(bytes).toString()); output.enqueue(encodeReaderPacket({ id: initial.id, kind: "fs_begin", path: bad })); return bytes.length; } },
        exited: new Promise<number>(() => {}), kill() {} } as never;
    },
    stopOwnedProcess: async (options) => options.proc.pid === 1234567 ? { status: "still_running", forced: true } : stopOwnedSearchWorkerProcess(options),
  });
  bad = join(f.sessions, "rollout-bad.jsonl");
  const good = join(f.sessions, "rollout-good.jsonl");
  rollout(bad, "pending"); rollout(good, "healthy file");
  try {
    expect((await f.coordinator.runPeriodicIngestTickLocal("codex")).ok).toBe(false);
    expect((await f.coordinator.ingestCodexHistory()).ok).toBe(false);
    expect(launches).toBe(2);
    expect(f.db.query<{ offset: number }, [string]>("SELECT offset FROM mem_ingest_offsets WHERE source_key=?").get(`codex_rollout:${good}`)?.offset).toBe(statSync(good).size);
    expect(f.db.query("SELECT offset FROM mem_ingest_offsets WHERE source_key=?").get(`codex_rollout:${bad}`)).toBeNull();
  } finally { f.close(); }
});

test("private blocks, redact policy and IPC maximum apply before transmission", () => {
  const safe = readerPrivateBlocks({ payload: { content: "visible<private>secret phrase</private> a@example.com" } }, ["redact"]);
  const encoded = Buffer.from(encodeReaderPacket(safe)).toString();
  expect(encoded).not.toContain("secret phrase");
  expect(encoded).not.toContain("a@example.com");
  expect(encoded).toContain("REDACTED_EMAIL");
  expect(() => encodeReaderPacket({ text: "x".repeat(SOURCE_READER_MAX_PACKET_BYTES) })).toThrow("source_reader_packet_limit");
});


test("redaction preserves dedupe and control identities across the IPC boundary", () => {
  const hash = "abcdef1234567890".repeat(4);
  const event = { platform: "codex", event_type: "user_prompt", project: `/projects/${hash}`, session_id: hash, event_id: hash, dedupe_hash: hash,
    privacy_tags: ["redact"], payload: { content: "a@example.com<private>hidden</private>" } };
  const safe = sanitizeReaderEvent(event);
  expect(safe.dedupe_hash).toBe(hash);
  expect(safe.session_id).toBe(hash);
  expect(safe.event_id).toBe(hash);
  expect(safe.project).toBe(event.project);
  expect(safe.payload?.content).toBe("[REDACTED_EMAIL]");
  expect(sanitizeReaderContext({ project: event.project, session_id: hash, last_user_prompt: "a@example.com<private>hidden</private>" }, ["redact"]))
    .toEqual({ project: event.project, session_id: hash, last_user_prompt: "[REDACTED_EMAIL]" });
});

for (const alias of ["same", "symlink", "hardlink"] as const) {
  test(`the actual memory DB cannot be opened as an OpenCode ${alias} source`, async () => {
    const f = setup();
    const actualPath = join(f.dir, "actual-memory.db");
    writeFileSync(actualPath, f.db.serialize());
    const owner = new Database(actualPath);
    owner.exec("CREATE TABLE message(id TEXT, session_id TEXT, time_created INTEGER, data TEXT); CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE part(message_id TEXT,data TEXT)");
    owner.query("INSERT INTO session VALUES(?,?)").run("s", f.dir);
    owner.query("INSERT INTO message VALUES(?,?,?,?)").run("m", "s", Date.now(), JSON.stringify({ role: "user" }));
    owner.query("INSERT INTO part VALUES(?,?)").run("m", JSON.stringify({ type: "text", text: "must not ingest memory DB" }));
    if (alias === "hardlink") {
      owner.close();
      const identity = statSync(actualPath, { bigint: true });
      const aliasPath = join(f.dir, "hardlink.db");
      linkSync(actualPath, aliasPath);
      const pool = new SourceReaderPool({ ...f.config, opencodeIngestEnabled: true, opencodeDbPath: aliasPath, opencodeStorageRoot: join(f.dir, "missing") }, async (operation) => {
        if (operation.op === "meta_get") return { value: operation.key === "dedupe_claims.readiness" ? "ready" : operation.key === "dedupe_claims.schema_version" ? "1" : "0" };
        if (operation.op === "offset_get") return null;
        if (operation.op === "record") f.events.push(operation.event);
        return true;
      }, {}, { device: String(identity.dev), inode: String(identity.ino) });
      try {
        expect((await pool.run("opencode", "explicit") as { ok: boolean }).ok).toBe(false);
        expect(f.events).toEqual([]);
      } finally { await pool.stop(); f.close(); }
      return;
    }
    const aliasPath = alias === "same" ? actualPath : join(f.dir, `${alias}.db`);
    if (alias === "symlink") symlinkSync(actualPath, aliasPath);
    // Deliberately inaccurate config path: the open DB's identity is authoritative.
    const coordinator = new IngestCoordinator({ db: owner, config: { ...f.config, dbPath: join(f.dir, "old-config.db"), opencodeIngestEnabled: true, opencodeDbPath: aliasPath, opencodeStorageRoot: join(f.dir, "missing") },
      recordEvent: () => ok, recordEventQueued: async (event) => { f.events.push(event); return ok; }, upsertSessionSummary: () => {}, heartbeatPath: "", isShuttingDown: () => false, processRetryQueue: () => {} });
    try {
      expect((await coordinator.runPeriodicIngestTickLocal("opencode")).ok).toBe(false);
      expect(f.events).toEqual([]);
      expect(owner.query("SELECT * FROM mem_ingest_offsets").all()).toEqual([]);
    } finally { coordinator.stopTimers(); owner.close(); f.close(); }
  });
}
