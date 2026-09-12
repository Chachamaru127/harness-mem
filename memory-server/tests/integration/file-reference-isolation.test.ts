import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";
import type { SourceReaderOptions } from "../../src/core/source-reader-client";

function configFor(root: string): Config {
  return {
    dbPath: join(root, "memory.db"), bindHost: "127.0.0.1", bindPort: 0,
    vectorDimension: 64, embeddingProvider: "fallback", captureEnabled: true,
    retrievalEnabled: true, injectionEnabled: true, codexHistoryEnabled: false,
    codexProjectRoot: join(root, "unavailable-workspace"),
    codexSessionsRoot: join(root, "unavailable-logs"), codexIngestIntervalMs: 5000,
    codexBackfillHours: 24, opencodeIngestEnabled: false, cursorIngestEnabled: false,
    antigravityIngestEnabled: false, geminiIngestEnabled: false,
    claudeCodeIngestEnabled: false, backgroundWorkersEnabled: false,
    consolidationEnabled: false,
  };
}

function stalledResolver(root: string) {
  const scriptPath = join(root, "stalled-resolver.ts");
  const marker = join(root, "resolver-started");
  // Block synchronously, so the child cannot service timers or handle a graceful signal.
  writeFileSync(scriptPath, `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(marker)}, "started\\n");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
`);
  return { marker, options: { scriptPath, timeoutMs: 100, maxChildren: 1, maxQueue: 8 } };
}

async function json(baseUrl: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ ok: boolean; items: Array<Record<string, unknown>>; meta: Record<string, unknown> }>;
}

function event(project: string, id: string, text: string): { event: EventEnvelope } {
  return { event: { event_id: id, platform: "codex", project, session_id: id,
    event_type: "user_prompt", ts: new Date().toISOString(), payload: { content: text },
    tags: [], privacy_tags: [] } };
}

async function assertSearch(baseUrl: string, project: string, token: string) {
  const result = await json(baseUrl, "/v1/search", {
    query: token, project, strict_project: true, include_private: true,
    vector_search: false, limit: 100,
  });
  expect(result.ok).toBe(true);
  expect(result.items.length).toBeGreaterThan(0);
  expect(result.items.every(item => item.project === project)).toBe(true);
  expect(JSON.stringify(result.items)).toContain(token);
  expect(JSON.stringify(result.items)).not.toContain("NEVER_PERSIST_PRIVATE");
  return result;
}

test("permanently stalled project resolver preserves HTTP recording, strict search, and cold restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-reference-http-"));
  const fixture = stalledResolver(root);
  const alpha = join(root, "client-a/app");
  const beta = join(root, "client-b/app");
  try {
    for (let round = 0; round < 2; round++) {
      const core = new HarnessMemCore(configFor(root), { projectResolver: fixture.options });
      const server = startHarnessMemServer(core, configFor(root));
      const baseUrl = `http://127.0.0.1:${server.port}`;
      try {
        const probe = core.prepareProject(join(root, `never-returns-${round}`));
        for (let i = 0; i < 5; i++) {
          expect((await json(baseUrl, "/health")).ok).toBe(true);
          await Bun.sleep(10);
        }
        await probe;
        expect(existsSync(fixture.marker)).toBe(true);
        expect(core.getProjectResolution(join(root, `never-returns-${round}`)).state).toBe("unresolved");
        if (round === 0) {
          for (const [project, id, token] of [[alpha, "alpha", "retainedalpha"], [beta, "beta", "retainedbeta"]]) {
            const result = await json(baseUrl, "/v1/events/record", event(project, id,
              `${token} searchable memory <private>NEVER_PERSIST_PRIVATE</private>`));
            expect(result.ok).toBe(true);
            expect(result.items.length).toBeGreaterThan(0);
          }
        }
        await assertSearch(baseUrl, alpha, "retainedalpha");
        await assertSearch(baseUrl, beta, "retainedbeta");
        const fresh = await json(baseUrl, "/v1/events/record", event(alpha, `round-${round}`, `newlyrecorded${round}`));
        expect(fresh.ok).toBe(true);
        await assertSearch(baseUrl, alpha, `newlyrecorded${round}`);
      } finally {
        server.stop(true);
        await core.shutdown("test");
      }
    }
    const db = new Database(join(root, "memory.db"), { readonly: true });
    try {
      expect(db.query("SELECT COUNT(*) AS n FROM mem_events").get()).toEqual({ n: 4 });
      expect(db.query("SELECT COUNT(*) AS n FROM mem_observations WHERE content LIKE '%NEVER_PERSIST_PRIVATE%' OR raw_text LIKE '%NEVER_PERSIST_PRIVATE%'").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 20000);

test("confirmed symlink mapping survives restart with an unavailable resolver", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-reference-mapping-"));
  const project = join(root, "canonical");
  const alias = join(root, "linked");
  mkdirSync(project);
  symlinkSync(project, alias);
  const config = configFor(root);
  let core: HarnessMemCore | undefined;
  try {
    core = new HarnessMemCore(config);
    await core.prepareProject(alias);
    const resolved = core.getProjectResolution(alias);
    expect(resolved.state).toBe("confirmed");
    const saved = await core.recordEventQueued(event(alias, "alias-event", "persistedaliasmemory").event);
    expect(saved).not.toBe("queue_full");
    if (saved === "queue_full") throw new Error("unexpected write backpressure");
    expect(saved.ok).toBe(true);
    await core.shutdown("test");
    const fixture = stalledResolver(root);
    core = new HarnessMemCore(config, { projectResolver: fixture.options });
    const server = startHarnessMemServer(core, config);
    try {
      await core.prepareProject(join(root, "unavailable-probe"));
      expect(existsSync(fixture.marker)).toBe(true);
      expect(core.getProjectResolution(alias).project).toBe(resolved.project);
      expect(core.getProjectResolution(alias).state).toBe("confirmed");
      const result = await json(`http://127.0.0.1:${server.port}`, "/v1/search", {
        project: alias, query: "persistedaliasmemory", strict_project: true,
        include_private: true, vector_search: false,
      });
      expect(result.ok).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every(item => item.project === resolved.project)).toBe(true);
    } finally { server.stop(true); }
  } finally {
    if (core) await core.shutdown("test");
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);

test("1000 resolution requests stay bounded while direct HTTP writes remain available", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-reference-pressure-"));
  const fixture = stalledResolver(root);
  const config = configFor(root);
  const core = new HarnessMemCore(config, { projectResolver: fixture.options });
  const server = startHarnessMemServer(core, config);
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    const pending = Array.from({ length: 1000 }, (_, index) => core.prepareProject(join(root, `pending-${index}`)));
    const status = core.getProjectResolverStatus();
    expect(status.active).toBeLessThanOrEqual(1);
    expect(status.stopping).toBeLessThanOrEqual(status.active);
    expect(status.queued).toBeLessThanOrEqual(8);
    const saved = await json(baseUrl, "/v1/events/record", event("available-project", "pressure-save", "availableunderpressure"));
    expect(saved.ok).toBe(true);
    await assertSearch(baseUrl, "available-project", "availableunderpressure");
    await Promise.all(pending);
    // Requests return independently of the background queue. The killable fixture
    // must still drain its finite admitted work within nine operation deadlines.
    const drainDeadline = Date.now() + 3000;
    while (core.getProjectResolverStatus().queued > 0 && Date.now() < drainDeadline) await Bun.sleep(20);
    expect(core.getProjectResolverStatus().queued).toBe(0);
    expect(core.getProjectResolverStatus().active).toBeLessThanOrEqual(1);
    expect(readFileSync(fixture.marker, "utf8").split("started").length - 1).toBeLessThanOrEqual(9);
  } finally {
    server.stop(true);
    await core.shutdown("test");
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);


test("a stalled source cannot block another source or HTTP direct recording", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-source-http-"));
  const sessions = join(root, "sessions"); mkdirSync(sessions);
  const bad = join(sessions, "rollout-000.jsonl");
  writeFileSync(bad, JSON.stringify({ timestamp: new Date().toISOString(), type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "pending source" }] } }) + "\n");
  const gemini = join(root, "gemini.jsonl");
  writeFileSync(gemini, JSON.stringify({ project: "healthy-source", platform: "gemini", session_id: "healthy-source-session",
    event_type: "user_prompt", payload: { content: "healthyreaderresult" }, ts: new Date().toISOString() }) + "\n");
  const config = { ...configFor(root), codexHistoryEnabled: true, codexSessionsRoot: sessions,
    geminiIngestEnabled: true, geminiEventsPath: gemini };
  const core = new HarnessMemCore(config, { sourceReader: {
    scriptPath: join(import.meta.dir, "../fixtures/source-reader-fault-worker.ts"), ioTimeoutMs: 100,
    env: { READER_FAULT_OPERATION: "readSync", READER_FAULT_PATH: bad },
  } });
  const server = startHarnessMemServer(core, config);
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    const [stalled, healthy] = await Promise.all([
      core.runPeriodicIngestTickLocal("codex"), core.runPeriodicIngestTickLocal("gemini"),
    ]);
    expect(stalled.ok).toBe(false);
    expect(healthy.ok).toBe(true);
    expect((await json(baseUrl, "/health")).ok).toBe(true);
    await assertSearch(baseUrl, "healthy-source", "healthyreaderresult");
    expect((await json(baseUrl, "/v1/events/record", event("direct-source", "direct-during-source-stall", "recordedduringsourcestall"))).ok).toBe(true);
    await assertSearch(baseUrl, "direct-source", "recordedduringsourcestall");
    const db = new Database(config.dbPath, { readonly: true });
    try { expect(db.query("SELECT offset FROM mem_ingest_offsets WHERE source_key=?").get(`codex_rollout:${bad}`)).toBeNull(); }
    finally { db.close(); }
  } finally {
    server.stop(true); await core.shutdown("test");
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);

test("unconfirmed source children survive owner restart without multiplication or loss of direct writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-source-restart-"));
  const fixture = stalledResolver(root);
  const config = { ...configFor(root), cursorIngestEnabled: true, geminiIngestEnabled: true };
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const sourceReader: SourceReaderOptions = {
    scriptPath: fixture.options.scriptPath, startupTimeoutMs: 100, slots: 2,
    spawnReader(args) { const child = Bun.spawn(args); children.push(child); return child; },
    // Simulate an OS that cannot confirm termination. The real child remains alive
    // across DB-owner shutdown and is killed explicitly only in test cleanup.
    stopOwnedProcess: async () => ({ status: "still_running", forced: true }),
  };
  try {
    for (let round = 0; round < 2; round++) {
      const core = new HarnessMemCore(config, { sourceReader });
      const server = startHarnessMemServer(core, config);
      const baseUrl = `http://127.0.0.1:${server.port}`;
      try {
        const results = await Promise.all([core.ingestCursorHistory(), core.ingestGeminiHistory()]);
        expect(results.every(result => !result.ok)).toBe(true);
        expect(children.length).toBe(2);
        expect(core.getSourceReaderStatus()?.reserved).toBe(2);
        expect((await json(baseUrl, "/health")).ok).toBe(true);
        const saved = await json(baseUrl, "/v1/events/record", event("restart-direct", `restart-direct-${round}`, `restartavailable${round}`));
        expect(saved.ok).toBe(true);
        await assertSearch(baseUrl, "restart-direct", `restartavailable${round}`);
        if (round === 1) await assertSearch(baseUrl, "restart-direct", "restartavailable0");
      } finally { server.stop(true); await core.shutdown("test"); }
    }
    for (const child of children) child.kill("SIGKILL");
    await Promise.all(children.map(child => child.exited));
    const recovered = new HarnessMemCore(config);
    try { expect(recovered.getSourceReaderStatus()?.reserved).toBe(0); }
    finally { await recovered.shutdown("test"); }
  } finally {
    for (const child of children) { try { child.kill("SIGKILL"); } catch {} }
    await Promise.all(children.map(child => child.exited));
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
