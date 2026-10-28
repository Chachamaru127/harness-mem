import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestConfig, createTestDb, insertTestObservation } from "./test-helpers";
import { runSummaryBatch, type SummaryDeps } from "../../src/core/summary-runner";
import type { ClairicFacts } from "../../src/core/clairic-client";

const MODEL = "glm-5.3-flash:cloud";

function config(overrides: Parameters<typeof createTestConfig>[0] = {}) {
  return createTestConfig({
    summaryEnabled: true,
    summaryModel: MODEL,
    summaryMaxSessions: 5,
    summaryMaxSources: 50,
    clairicEnabled: true,
    cloudLlmEnabled: true,
    ...overrides,
  });
}

function decide(
  db: ReturnType<typeof createTestDb>,
  observationId: string,
  opts: { decision?: "keep" | "compact"; durable?: number | null; project?: string } = {},
): void {
  db.query(
    `INSERT INTO mem_triage_decisions
       (observation_id, project, model, threshold, score, durable, decision, fallback, batch_id, created_at)
     VALUES (?, ?, 'typesafe/jev-1.14.0', 0.3, 0.1, ?, ?, 0, 'test', ?)`,
  ).run(
    observationId,
    opts.project ?? "test-project",
    opts.durable === undefined ? 0.1 : opts.durable,
    opts.decision ?? "compact",
    new Date().toISOString(),
  );
}

const facts: ClairicFacts = { decision: "BLOB で持つ", reason: "容量", date: null, version: "v1", files: [] };
const okDeps: SummaryDeps = {
  clairic: { extract: async () => facts },
  summary: { summarize: async () => ({ ok: true, summary: "決定: BLOB で持つ。理由: 容量。" }) },
};

function summaryRows(db: ReturnType<typeof createTestDb>) {
  return db
    .query<{ id: string; observation_type: string; memory_type: string; content: string }, []>(
      "SELECT id, observation_type, memory_type, content FROM mem_observations WHERE observation_type = 'summary'",
    )
    .all();
}

function jobs(db: ReturnType<typeof createTestDb>) {
  return db
    .query<{ status: string; summary_observation_id: string | null; error: string | null }, []>(
      "SELECT status, summary_observation_id, error FROM mem_summary_jobs",
    )
    .all();
}

function insertJob(
  db: ReturnType<typeof createTestDb>,
  input: { sessionId: string; status: string; updatedAt: string; error?: string | null },
): void {
  db.query(
    `INSERT INTO mem_summary_jobs(session_id, project, model, status, error, created_at, updated_at)
     VALUES (?, 'test-project', ?, ?, ?, ?, ?)`,
  ).run(input.sessionId, MODEL, input.status, input.error ?? null, input.updatedAt, input.updatedAt);
}

describe("runSummaryBatch", () => {
  test("summary loop reports setup errors without leaking exception text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "summary-setup-failure-"));
    const path = join(dir, "memory.db");
    const seed = createTestDb();
    seed.query(`INSERT INTO mem_summary_jobs(session_id,project,model,status,created_at,updated_at)
      VALUES ('stale','test','gpt-6-luna','running','2000-01-01','2000-01-01')`).run();
    seed.exec("CREATE TRIGGER reject_stale_update BEFORE UPDATE ON mem_summary_jobs BEGIN SELECT RAISE(ABORT, 'private setup exception'); END");
    writeFileSync(path, seed.serialize());
    seed.close();
    try {
      const proc = Bun.spawn([process.execPath, new URL("../../../scripts/summary-loop.ts", import.meta.url).pathname, "1"], {
        env: { ...process.env, HARNESS_MEM_DB_PATH: path, HARNESS_MEM_CLOUD_LLM: "1",
          HARNESS_MEM_SUMMARY_ENABLED: "true", HARNESS_MEM_SUMMARY_BACKEND: "codex-app-server",
          HARNESS_MEM_SUMMARY_MODEL: "gpt-6-luna" }, stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([proc.exited,
        new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      expect(code).toBe(1);
      const result = JSON.parse(stderr.trim());
      expect(result.failed).toBe(1);
      expect(result.failureReasons[0]).toMatch(/^SQLITE_[A-Z_]+$/);
      expect(stdout + stderr).not.toContain("private setup exception");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("summary CLI waits through a writer lock longer than ten seconds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "summary-writer-wait-"));
    const path = join(dir, "memory.db");
    const seed = createTestDb();
    seed.query(`INSERT INTO mem_summary_jobs(session_id,project,model,status,created_at,updated_at)
      VALUES ('stale','test','gpt-6-luna','running','2000-01-01','2000-01-01')`).run();
    writeFileSync(path, seed.serialize());
    seed.close();
    const writer = new Database(path);
    writer.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE");
    const release = Bun.sleep(11_000).then(() => writer.exec("ROLLBACK"));
    try {
      const proc = Bun.spawn([process.execPath, new URL("../../../scripts/summary-loop.ts", import.meta.url).pathname, "1"], {
        env: { ...process.env, HARNESS_MEM_DB_PATH: path, HARNESS_MEM_CLOUD_LLM: "1",
          HARNESS_MEM_SUMMARY_ENABLED: "true", HARNESS_MEM_SUMMARY_BACKEND: "codex-app-server",
          HARNESS_MEM_SUMMARY_MODEL: "gpt-6-luna" }, stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([proc.exited,
        new Response(proc.stdout).text(), new Response(proc.stderr).text(), release]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      const result = JSON.parse(stdout.trim());
      expect(result.skipped).toBe("no_sessions");
      expect(result.failed).toBe(0);
      expect(writer.query("SELECT status FROM mem_summary_jobs WHERE session_id='stale'").get())
        .toEqual({ status: "failed" });
    } finally {
      await release;
      writer.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
  test("does not acquire a write lock when no stale jobs or sessions exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "summary-readonly-start-"));
    const path = join(dir, "memory.db");
    const seed = createTestDb();
    writeFileSync(path, seed.serialize());
    seed.close();
    const db = new Database(path);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10;");
    const writer = new Database(path);
    writer.exec("BEGIN IMMEDIATE");
    try {
      const result = await runSummaryBatch(db, config(), okDeps);
      expect(result.skipped).toBe("no_sessions");
      expect(result.failed).toBe(0);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("reports a storage failure even when the job cannot be claimed", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-claim-failure", session_id: "claim-failure" });
    decide(db, "obs-claim-failure");
    db.exec("CREATE TRIGGER reject_summary_claim BEFORE INSERT ON mem_summary_jobs BEGIN SELECT RAISE(ABORT, 'private exception text'); END");
    const result = await runSummaryBatch(db, config(), okDeps);
    expect(result.failed).toBe(1);
    expect(result.failureReasons).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private exception text");
    expect(result.failureReasons![0]).toMatch(/^(SQLITE_[A-Z_]+|summary_storage_error)$/);
    expect(jobs(db)).toHaveLength(0);
    expect(summaryRows(db)).toHaveLength(0);
    db.close();
  });
  test("disabled does nothing", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-1", session_id: "s1" });
    const result = await runSummaryBatch(db, config({ summaryEnabled: false }), okDeps);
    expect(result.skipped).toBe("disabled");
    expect(jobs(db)).toHaveLength(0);
  });

  test("no compact sessions returns no_sessions", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-1", session_id: "s1" });
    const result = await runSummaryBatch(db, config(), okDeps);
    expect(result.skipped).toBe("no_sessions");
  });

  test("summarizes a session and links every source", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-a", session_id: "s1", content: "決定: BLOB で持つ。" });
    insertTestObservation(db, { id: "obs-b", session_id: "s1", content: "理由: 容量。" });
    decide(db, "obs-a");
    decide(db, "obs-b");

    const result = await runSummaryBatch(db, config(), okDeps);
    expect(result).toMatchObject({ scanned: 1, summarized: 1, blocked: 0, failed: 0 });
    const summaries = summaryRows(db);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      observation_type: "summary",
      memory_type: "semantic",
      content: "決定: BLOB で持つ。理由: 容量。",
    });
    const links = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mem_links WHERE relation = 'summarizes'")
      .get();
    expect(links?.n).toBe(2);
    expect(jobs(db)).toEqual([
      { status: "completed", summary_observation_id: summaries[0]!.id, error: null },
    ]);
  });

  test("only rows that fit in the prompt are linked as summarized", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-fit", session_id: "s1", content: "決定: 小さな行。 ".repeat(300), created_at: "2026-01-01T00:00:00.000Z" });
    insertTestObservation(db, { id: "obs-cut", session_id: "s1", content: "理由: 長い行。 ".repeat(400), created_at: "2026-01-01T00:00:01.000Z" });
    decide(db, "obs-fit");
    decide(db, "obs-cut");
    const result = await runSummaryBatch(db, config(), okDeps);
    expect(result.summarized).toBe(1);
    const linked = db.query<{ to_observation_id: string }, []>(
      "SELECT to_observation_id FROM mem_links WHERE relation = 'summarizes'").all().map((r) => r.to_observation_id);
    expect(linked).toEqual(["obs-fit"]);
  });

  test("cloud models and Clairic stay off without HARNESS_MEM_CLOUD_LLM", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-a", session_id: "s1", content: "決定: BLOB で持つ。" });
    decide(db, "obs-a");
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => { fetches += 1; throw new Error("network must not be used"); }) as unknown as typeof fetch;
    try {
      const cloudModel = await runSummaryBatch(db, config({ cloudLlmEnabled: false }));
      expect(cloudModel.skipped).toBe("disabled");
      let extracted = 0;
      const local = await runSummaryBatch(db, config({ cloudLlmEnabled: false, summaryModel: "qwen3:8b" }), {
        summary: { summarize: async ({ facts }) => { extracted += facts.decision ? 1 : 0; return { ok: true, summary: "決定: ローカル要約。" }; } },
      });
      expect(local.summarized).toBe(1);
      expect(extracted).toBe(0);
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a scanner-blocked session is marked blocked and writes no summary", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-secret", session_id: "s2", content: "password = supersecret123" });
    decide(db, "obs-secret");
    const result = await runSummaryBatch(db, config(), okDeps);
    expect(result.blocked).toBe(1);
    expect(summaryRows(db)).toHaveLength(0);
    expect(jobs(db)[0]).toMatchObject({ status: "blocked", summary_observation_id: null });
    const second = await runSummaryBatch(db, config(), okDeps);
    expect(second.skipped).toBe("no_sessions");
  });

  test("a summary failure marks the job failed and writes no S row", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-fail", session_id: "s3", content: "決定: 何か。" });
    decide(db, "obs-fail");
    const deps: SummaryDeps = {
      clairic: okDeps.clairic,
      summary: { summarize: async () => ({ ok: false, reason: "timeout" }) },
    };
    const result = await runSummaryBatch(db, config(), deps);
    expect(result.failed).toBe(1);
    expect(summaryRows(db)).toHaveLength(0);
    expect(jobs(db)[0]).toMatchObject({ status: "failed", error: "timeout" });
  });

  test("a pending job left by a crash is started and completed", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-pending", session_id: "s7", content: "決定: 何か。" });
    decide(db, "obs-pending");
    insertJob(db, { sessionId: "s7", status: "pending", updatedAt: new Date().toISOString() });
    const result = await runSummaryBatch(db, config(), okDeps);
    expect(result.summarized).toBe(1);
    expect(jobs(db)[0]).toMatchObject({ status: "completed", error: null });
  });

  test("a stale running job is recovered and completed", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-stale", session_id: "s8", content: "決定: 何か。" });
    decide(db, "obs-stale");
    insertJob(db, {
      sessionId: "s8",
      status: "running",
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const result = await runSummaryBatch(db, config(), okDeps);
    expect(result.summarized).toBe(1);
    expect(jobs(db)[0]).toMatchObject({ status: "completed", error: null });
  });

  test("a failed job is retried and completed", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-retry", session_id: "s9", content: "決定: 何か。" });
    decide(db, "obs-retry");
    insertJob(db, {
      sessionId: "s9",
      status: "failed",
      error: "timeout",
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const result = await runSummaryBatch(db, config(), okDeps);
    expect(result.summarized).toBe(1);
    expect(jobs(db)[0]).toMatchObject({ status: "completed", error: null });
  });

  test("a summary that repeats a credential is blocked", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-leak", session_id: "s6", content: "ログイン手順を確認した。" });
    decide(db, "obs-leak");
    const deps: SummaryDeps = {
      clairic: okDeps.clairic,
      summary: {
        summarize: async () => ({
          ok: true,
          summary: "ログイン: operator@example.com / hokujob-demo-pass",
        }),
      },
    };
    const result = await runSummaryBatch(db, config(), deps);
    expect(result.blocked).toBe(1);
    expect(summaryRows(db)).toHaveLength(0);
    expect(jobs(db)[0]).toMatchObject({ status: "blocked", summary_observation_id: null });
  });

  test("a second run skips the completed session", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-once", session_id: "s4", content: "決定: 何か。" });
    decide(db, "obs-once");
    await runSummaryBatch(db, config(), okDeps);
    const second = await runSummaryBatch(db, config(), okDeps);
    expect(second.skipped).toBe("no_sessions");
    expect(summaryRows(db)).toHaveLength(1);
  });

  test("durable rows are not summarized", async () => {
    const db = createTestDb();
    insertTestObservation(db, { id: "obs-durable", session_id: "s5", content: "決定: 重要。" });
    decide(db, "obs-durable", { durable: 0.9 });
    const result = await runSummaryBatch(db, config(), okDeps);
    expect(result.skipped).toBe("no_sessions");
    expect(summaryRows(db)).toHaveLength(0);
  });
});

test("switching backend does not repeat completed or unblock blocked sessions", async () => {
  const db = createTestDb();
  for (const [id,status] of [["a","completed"],["b","blocked"],["c","running"]]) {
    insertTestObservation(db, { id, session_id: id }); decide(db,id);
    insertJob(db,{sessionId:id,status,updatedAt:new Date().toISOString()});
  }
  const r=await runSummaryBatch(db,config({summaryBackend:"claude-code",summaryModel:"claude-haiku-5-5",cloudLlmEnabled:true}),okDeps);
  expect(r.skipped).toBe("no_sessions");
  expect(jobs(db)).toHaveLength(3);
});

test("Codex summary requires the cloud egress gate", async () => {
  const db=createTestDb();
  insertTestObservation(db,{id:"gate",session_id:"gate"});decide(db,"gate");
  const result=await runSummaryBatch(db,config({summaryBackend:"codex-app-server",cloudLlmEnabled:false}),okDeps);
  expect(result.skipped).toBe("disabled");expect(jobs(db)).toHaveLength(0);
});

test("Claude summary requires the cloud egress gate", async () => {
  const db=createTestDb();
  insertTestObservation(db,{id:"haiku-gate",session_id:"haiku-gate"});decide(db,"haiku-gate");
  const result=await runSummaryBatch(db,config({summaryBackend:"claude-code",summaryModel:"claude-haiku-5-5",cloudLlmEnabled:false}),okDeps);
  expect(result.skipped).toBe("disabled");expect(jobs(db)).toHaveLength(0);
});

test("Haiku batches run four sessions concurrently and preserve scanned source links", async () => {
  const db=createTestDb();
  for (let i=0;i<4;i++) { insertTestObservation(db,{id:`haiku-${i}`,session_id:`haiku-${i}`,content:"決定: 上限を4件にする。理由: 待ち時間を短くするため。"});decide(db,`haiku-${i}`); }
  let active=0, peak=0;
  const result=await runSummaryBatch(db,config({summaryBackend:"claude-code",summaryModel:"claude-haiku-5-5",cloudLlmEnabled:true,summaryConcurrency:4,summaryMaxSessions:4}),{
    clairic:okDeps.clairic,
    summary:{summarize:async()=>{active++;peak=Math.max(peak,active);await Bun.sleep(15);active--;return {ok:true,summary:"決定: 上限4件。理由: 待ち時間の短縮。"};}},
  });
  expect(peak).toBe(4);expect(result.summarized).toBe(4);expect(result.failed).toBe(0);
  expect(db.query("SELECT COUNT(*) AS n FROM mem_summary_jobs WHERE model='claude-haiku-5-5' AND status='completed'").get()).toEqual({n:4});
  expect(summaryRows(db)).toHaveLength(4);
});
