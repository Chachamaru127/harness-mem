import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const dirs: string[] = [];
const oldTtl = process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS;

function makeCore(label: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-repeat-cache-${label}-`));
  dirs.push(dir);
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
    backgroundWorkersEnabled: false,
  };
  return { core: new HarnessMemCore(config), dir };
}

function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    platform: "codex",
    project: "proj-cache",
    session_id: "session-cache",
    event_type: "user_prompt",
    ts: new Date().toISOString(),
    payload: { content: "Recall Runtime projection cache sentinel alpha" },
    tags: ["recall-runtime"],
    privacy_tags: [],
    ...overrides,
  };
}

afterEach(() => {
  if (oldTtl === undefined) {
    delete process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS;
  } else {
    process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS = oldTtl;
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("repeat recall query cache", () => {
  test("scoped repeat search hits cache and data watermark invalidates it", async () => {
    process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS = "60000";
    const { core } = makeCore("hit");
    try {
      core.recordEvent(event({ event_id: "evt-a" }));

      const first = await core.searchPrepared({
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      });
      expect(first.ok).toBe(true);
      expect(first.meta.recall_cache_hit).toBe(false);
      expect(JSON.stringify(first.meta.recall_cache)).not.toContain("projection cache sentinel alpha");
      expect(first.meta.search_phase_timing).toMatchObject({
        watermark_cache_lookup_ms: expect.any(Number),
        retrieval_total_ms: expect.any(Number),
        spool_append_commit_ms: null,
        total_ms: expect.any(Number),
      });

      const second = await core.searchPrepared({
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      });
      expect(second.ok).toBe(true);
      expect(second.meta.recall_cache_hit).toBe(true);
      expect(second.meta.search_phase_timing).toMatchObject({
        watermark_cache_lookup_ms: expect.any(Number),
        retrieval_total_ms: null,
        spool_append_commit_ms: null,
        worker_total_ms: null,
        total_ms: expect.any(Number),
      });

      core.recordEvent(event({
        event_id: "evt-b",
        payload: { content: "Recall Runtime projection cache sentinel beta" },
      }));
      const third = await core.searchPrepared({
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      });
      expect(third.ok).toBe(true);
      expect(third.meta.recall_cache_hit).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("TTL 0 disables repeat recall cache", async () => {
    process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS = "0";
    const { core } = makeCore("disabled");
    try {
      core.recordEvent(event({ event_id: "evt-disabled" }));
      const first = await core.searchPrepared({
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      });
      const second = await core.searchPrepared({
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      });
      expect(first.meta.recall_cache_hit).toBeUndefined();
      expect(second.meta.recall_cache_hit).toBeUndefined();
    } finally {
      core.shutdown("test");
    }
  });

  test("retrieval auxiliary mutation invalidates a cached scoped search", async () => {
    const { core, dir } = makeCore("aux-invalidation");
    try {
      core.recordEvent(event({ event_id: "evt-aux-invalidation" }));
      const request = {
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      } as const;
      expect((await core.searchPrepared(request)).meta.recall_cache_hit).toBe(false);
      expect((await core.searchPrepared(request)).meta.recall_cache_hit).toBe(true);

      const db = new Database(join(dir, "harness-mem.db"));
      try {
        const observation = db.query("SELECT id FROM mem_observations WHERE project = ? LIMIT 1")
          .get("proj-cache") as { id: string };
        db.query(`INSERT INTO mem_tags(observation_id, tag, tag_type, created_at)
          VALUES (?, 'phase5-aux', 'topic', '2026-08-20T00:00:00.000Z')`).run(observation.id);
      } finally {
        db.close();
      }

      expect((await core.searchPrepared(request)).meta.recall_cache_hit).toBe(false);
    } finally {
      await core.shutdown("test");
    }
  });

  test("local cache miss attributes a synchronous spool stall without identifiers", async () => {
    const previousWorkerMarker = process.env.HARNESS_MEM_SEARCH_WORKER_PROCESS;
    const previousDelay = process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS;
    process.env.HARNESS_MEM_SEARCH_WORKER_PROCESS = "1";
    const { core, dir } = makeCore("phase-local");
    try {
      core.recordEvent(event({
        event_id: "evt-phase-local",
        project: dir,
        session_id: "private-phase-session",
        payload: { content: "private local phase target" },
      }));
      process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS = "100";
      const response = await core.searchPrepared({
        query: "private local phase target",
        project: dir,
        limit: 1,
        vector_search: false,
        strict_project: true,
      });
      const timing = response.meta.search_phase_timing as Record<string, unknown>;
      const retrievalBreakdownKeys = [
        "scope_resolution_ms",
        "latest_interaction_ms",
        "lexical_candidate_ms",
        "vector_ms",
        "load_hydrate_ms",
        "facts_tags_ms",
        "route_ms",
        "ranking_rerank_ms",
        "privacy_boundary_ms",
        "audit_intent_build_ms",
      ] as const;
      for (const key of retrievalBreakdownKeys) {
        expect(timing[key]).toEqual(expect.any(Number));
        expect(timing[key]).toBeGreaterThanOrEqual(0);
      }
      for (const key of [
        "latest_interaction_sql_ms",
        "latest_interaction_materialize_ms",
        "search_tokenize_ms",
        "fact_load_ms",
        "tag_fact_scoring_ms",
      ]) {
        expect(timing[key]).toEqual(expect.any(Number));
        expect(timing[key]).toBeGreaterThanOrEqual(0);
      }
      expect(Number(timing.latest_interaction_sql_ms) + Number(timing.latest_interaction_materialize_ms))
        .toBeLessThanOrEqual(Number(timing.latest_interaction_ms) + 0.1);
      expect(Number(timing.latest_interaction_sql_ms) + Number(timing.latest_interaction_materialize_ms))
        .toBeGreaterThanOrEqual(Number(timing.latest_interaction_ms) - 0.1);
      expect(Number(timing.search_tokenize_ms) + Number(timing.fact_load_ms) + Number(timing.tag_fact_scoring_ms))
        .toBeLessThanOrEqual(Number(timing.facts_tags_ms) + 0.1);
      expect(Number(timing.search_tokenize_ms) + Number(timing.fact_load_ms) + Number(timing.tag_fact_scoring_ms))
        .toBeGreaterThanOrEqual(Number(timing.facts_tags_ms) - 0.1);
      expect(timing.vector_executed).toBe(false);
      expect(timing.lexical_strategy).toBe("bounded_recent");
      expect(timing.lexical_tokenize_ms).toEqual(expect.any(Number));
      expect(timing.lexical_sql_primary_ms).toEqual(expect.any(Number));
      expect(timing.lexical_sql_fallback_ms).toBe(0);
      expect(timing.lexical_score_ms).toEqual(expect.any(Number));
      expect(timing.lexical_rows_examined).toEqual(expect.any(Number));
      expect(timing.lexical_fallback_executed).toBe(false);
      const retrievalBreakdownTotal = retrievalBreakdownKeys.reduce(
        (sum, key) => sum + Number(timing[key]),
        0,
      );
      expect(retrievalBreakdownTotal).toBeLessThanOrEqual(Number(timing.retrieval_total_ms) + 0.1);
      expect(timing.retrieval_unattributed_ms).toEqual(expect.any(Number));
      expect(retrievalBreakdownTotal + Number(timing.retrieval_unattributed_ms))
        .toBeGreaterThanOrEqual(Number(timing.retrieval_total_ms) - 0.1);
      expect(timing.spool_append_commit_ms).toBeGreaterThanOrEqual(80);
      expect(timing.retrieval_total_ms).toBeLessThan(100);
      expect(timing.worker_total_ms).toBeNull();
      expect(timing.total_ms).toBeGreaterThanOrEqual(timing.spool_append_commit_ms as number);
      expect(JSON.stringify(timing)).not.toContain("private local phase target");
      expect(JSON.stringify(timing)).not.toContain(dir);
      expect(JSON.stringify(timing)).not.toContain("private-phase-session");
      expect(Object.keys(timing).some((key) =>
        /(query|project|path|session|hash|correlation)/i.test(key)
      )).toBe(false);
    } finally {
      await core.shutdown("test");
      if (previousWorkerMarker === undefined) delete process.env.HARNESS_MEM_SEARCH_WORKER_PROCESS;
      else process.env.HARNESS_MEM_SEARCH_WORKER_PROCESS = previousWorkerMarker;
      if (previousDelay === undefined) delete process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS;
      else process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS = previousDelay;
    }
  });

  test("FTS no-match reports bounded primary and fallback work without request identifiers", async () => {
    const { core } = makeCore("phase-fts");
    try {
      core.recordEvent(event({ event_id: "evt-phase-fts" }));
      const response = await core.searchPrepared({
        query: "zirconium platypus nebula unmatched",
        project: "proj-cache",
        limit: 20,
        vector_search: false,
        strict_project: true,
      });
      const timing = response.meta.search_phase_timing as Record<string, unknown>;
      expect(timing.lexical_strategy).toBe("fts");
      expect(timing.lexical_fallback_executed).toBe(true);
      expect(timing.lexical_rows_examined).toBe(0);
      expect(timing.lexical_tokenize_ms).toEqual(expect.any(Number));
      expect(timing.lexical_sql_primary_ms).toEqual(expect.any(Number));
      expect(timing.lexical_sql_fallback_ms).toEqual(expect.any(Number));
      expect(timing.lexical_score_ms).toEqual(expect.any(Number));
      expect(JSON.stringify(timing)).not.toContain("zirconium platypus nebula unmatched");
      expect(JSON.stringify(timing)).not.toContain("proj-cache");
    } finally {
      await core.shutdown("test");
    }
  });
});
