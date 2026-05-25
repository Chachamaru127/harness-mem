import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import {
  HarnessMemCore,
  getConfig,
  parseVectorBackfillChildResponse,
  shouldRunEventOutOfProcess,
  shouldRunRetryQueueOutOfProcess,
  shouldRunSearchOutOfProcess,
  shouldUsePersistentSearchWorker,
  type Config,
  type EventEnvelope,
} from "../../src/core/harness-mem-core";
import { removeDirWithRetry } from "../fs-cleanup";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    removeDirWithRetry(dir);
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-${name}-`));
  cleanupPaths.push(dir);
  return {
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
  };
}

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "test-project",
    session_id: "session-1",
    event_type: "user_prompt",
    ts: "2026-02-14T00:00:00.000Z",
    payload: { prompt: "alpha task" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

function createFakeRepo(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-repo-`));
  cleanupPaths.push(root);
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

describe("HarnessMemCore unit", () => {
  test("vector backfill child parser accepts startup logs before JSON", () => {
    const result = parseVectorBackfillChildResponse(
      [
        "[harness-mem] normalized legacy project aliases (aliases=1, rows=1)",
        '{"ok":true,"source":"core","items":[{"repaired":25}],"meta":{"count":1}}',
      ].join("\n"),
      'dtype not specified for "model"',
    );

    expect(result.ok).toBe(true);
    expect((result.items[0] as { repaired?: number }).repaired).toBe(25);
  });

  test("scheduled consolidation is skipped while vector backfill is running", async () => {
    const core = new HarnessMemCore(createConfig("vector-backfill-consolidation-guard"));
    try {
      const started = core.startVectorBackfillWorker({
        compact_batch_size: 1,
        reindex_batch_size: 1,
        interval_ms: 1000,
        target_coverage: 0.95,
      });
      expect(started.ok).toBe(true);

      const response = await core.runConsolidation({ reason: "scheduler", limit: 1 });
      expect(response.ok).toBe(true);
      expect(response.meta.skipped).toBe("vector_backfill_running");
    } finally {
      core.shutdown("test");
    }
  });

  test("vector provider falls back when sqlite-vec extension is unavailable", () => {
    const previous = process.env.HARNESS_MEM_SQLITE_VEC_PATH;
    process.env.HARNESS_MEM_SQLITE_VEC_PATH = "/non/existent/sqlite-vec";

    const core = new HarnessMemCore(createConfig("vector-fallback"));
    try {
      const health = core.health();
      const item = health.items[0] as { vector_engine: string };
      expect(item.vector_engine).toBe("js-fallback");
    } finally {
      core.shutdown("test");
      if (previous === undefined) {
        delete process.env.HARNESS_MEM_SQLITE_VEC_PATH;
      } else {
        process.env.HARNESS_MEM_SQLITE_VEC_PATH = previous;
      }
    }
  });

  test("disk-backed js-fallback search offloads by default outside tests", () => {
    const request = { query: "main thread readiness", limit: 1 };
    const options = {
      vectorEngine: "js-fallback" as const,
      dbPath: "/tmp/harness-mem.db",
      env: {},
    };

    expect(shouldRunSearchOutOfProcess(request, options)).toBe(true);
    expect(shouldUsePersistentSearchWorker(options)).toBe(true);
    expect(shouldRunSearchOutOfProcess({ ...request, safe_mode: true }, options)).toBe(true);
    expect(shouldRunSearchOutOfProcess(request, { ...options, dbPath: ":memory:" })).toBe(false);
    expect(shouldRunSearchOutOfProcess(request, { ...options, vectorEngine: "disabled" })).toBe(false);
    expect(shouldRunSearchOutOfProcess(request, { ...options, env: { NODE_ENV: "test" } })).toBe(false);
    expect(shouldRunSearchOutOfProcess(request, {
      ...options,
      env: { HARNESS_MEM_SEARCH_OFFLOAD: "0" },
    })).toBe(false);
  });

  test("disk-backed event writes offload by default outside tests", () => {
    const options = {
      dbPath: "/tmp/harness-mem.db",
      env: {},
    };

    expect(shouldRunEventOutOfProcess(options)).toBe(true);
    expect(shouldRunEventOutOfProcess({ ...options, dbPath: ":memory:" })).toBe(false);
    expect(shouldRunEventOutOfProcess({ ...options, env: { NODE_ENV: "test" } })).toBe(false);
    expect(shouldRunEventOutOfProcess({
      ...options,
      env: { HARNESS_MEM_EVENT_OFFLOAD: "0" },
    })).toBe(false);
    expect(shouldRunEventOutOfProcess({
      ...options,
      env: { HARNESS_MEM_EVENT_CHILD_PROCESS: "1" },
    })).toBe(false);
    expect(shouldRunEventOutOfProcess({
      ...options,
      env: { HARNESS_MEM_CHECKPOINT_CHILD_PROCESS: "1" },
    })).toBe(false);
  });

  test("disk-backed retry queue ticks offload by default outside tests", () => {
    const options = {
      dbPath: "/tmp/harness-mem.db",
      env: {},
    };

    expect(shouldRunRetryQueueOutOfProcess(options)).toBe(true);
    expect(shouldRunRetryQueueOutOfProcess({ ...options, dbPath: ":memory:" })).toBe(false);
    expect(shouldRunRetryQueueOutOfProcess({ ...options, env: { NODE_ENV: "test" } })).toBe(false);
    expect(shouldRunRetryQueueOutOfProcess({
      ...options,
      env: { HARNESS_MEM_RETRY_OFFLOAD: "0" },
    })).toBe(false);
    expect(shouldRunRetryQueueOutOfProcess({
      ...options,
      env: { HARNESS_MEM_RETRY_CHILD_PROCESS: "1" },
    })).toBe(false);
  });

  test("search can skip vector and nugget paths for MCP safe mode", () => {
    const core = new HarnessMemCore(createConfig("search-vector-off"));
    try {
      core.recordEvent(
        baseEvent({
          event_id: "vector-off-1",
          payload: { content: "hermes safe mode unique latency guard" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "vector-off-2",
          payload: { content: "hermes safe mode secondary memory" },
        })
      );

      const result = core.search({
        query: "hermes safe mode",
        limit: 2,
        include_private: true,
        vector_search: false,
      });
      expect(result.ok).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
      const meta = result.meta as Record<string, unknown>;
      expect(meta.vector_search_enabled).toBe(false);
      const candidateCounts = meta.candidate_counts as Record<string, unknown>;
      expect(Number(candidateCounts.lexical || 0)).toBeGreaterThan(0);
      expect(Number(candidateCounts.vector || 0)).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("searchPrepared safe mode skips query embedding preparation", async () => {
    const core = new HarnessMemCore(createConfig("search-prepared-safe-mode"));
    let primeQueryCalls = 0;
    try {
      (core as unknown as {
        embeddingProvider: {
          name: "fallback";
          model: string;
          dimension: number;
          embed: (text: string) => number[];
          primeQuery: (text: string) => Promise<number[]>;
          health: () => { status: "healthy"; details: string };
        };
      }).embeddingProvider = {
        name: "fallback",
        model: "test-embedding",
        dimension: 64,
        embed: (text: string) => {
          const seed = text.length || 1;
          return Array.from({ length: 64 }, (_, index) => ((seed + index) % 17) / 17);
        },
        primeQuery: async () => {
          primeQueryCalls += 1;
          throw new Error("primeQuery should not run for safe search");
        },
        health: () => ({ status: "healthy", details: "test" }),
      };

      core.recordEvent(
        baseEvent({
          event_id: "safe-prepared-1",
          payload: { content: "safe prepared search must remain lexical only" },
        })
      );

      const result = await core.searchPrepared({
        query: "safe prepared search",
        limit: 1,
        include_private: true,
        safe_mode: true,
      });

      expect(result.ok).toBe(true);
      expect(primeQueryCalls).toBe(0);
      const meta = result.meta as Record<string, unknown>;
      expect(meta.vector_search_enabled).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("searchPrepared batches query embedding prime before sync vector search", async () => {
    const core = new HarnessMemCore(createConfig("search-prepared-prime-batch"));
    let primeBatchCalls = 0;
    let primeQueryCalls = 0;
    let primeBatchMode: string | undefined;
    let primeBatchTexts: string[] = [];
    try {
      (core as unknown as {
        embeddingProvider: {
          name: "fallback";
          model: string;
          dimension: number;
          embed: (text: string) => number[];
          embedQuery: (text: string) => number[];
          primeBatch: (texts: string[], mode?: "passage" | "query") => Promise<number[][]>;
          primeQuery: (text: string) => Promise<number[]>;
          health: () => { status: "healthy"; details: string };
        };
      }).embeddingProvider = {
        name: "fallback",
        model: "test-embedding",
        dimension: 64,
        embed: (text: string) => {
          const seed = text.length || 1;
          return Array.from({ length: 64 }, (_, index) => ((seed + index) % 17) / 17);
        },
        embedQuery: (text: string) => {
          const seed = text.length || 1;
          return Array.from({ length: 64 }, (_, index) => ((seed + index + 3) % 19) / 19);
        },
        primeBatch: async (texts, mode) => {
          primeBatchCalls += 1;
          primeBatchMode = mode;
          primeBatchTexts = [...texts];
          return texts.map((text) =>
            Array.from({ length: 64 }, (_, index) => (((text.length || 1) + index) % 23) / 23)
          );
        },
        primeQuery: async () => {
          primeQueryCalls += 1;
          throw new Error("primeQuery should not run when primeBatch is available");
        },
        health: () => ({ status: "healthy", details: "test" }),
      };

      core.recordEvent(
        baseEvent({
          event_id: "prepared-prime-batch-1",
          payload: { content: "prepared vector search should batch async prime" },
        })
      );

      const result = await core.searchPrepared({
        query: "prepared vector search",
        limit: 1,
        include_private: true,
        vector_search: true,
      });

      expect(result.ok).toBe(true);
      expect(primeBatchCalls).toBe(1);
      expect(primeBatchMode).toBe("query");
      expect(primeBatchTexts).toEqual(["prepared vector search"]);
      expect(primeQueryCalls).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("safe mode forces vector off for direct core search callers", () => {
    const core = new HarnessMemCore(createConfig("safe-mode-vector-off"));
    try {
      core.recordEvent(
        baseEvent({
          event_id: "safe-direct-1",
          payload: { content: "direct safe mode should not use vector search" },
        })
      );

      const result = core.search({
        query: "direct safe mode",
        limit: 1,
        include_private: true,
        safe_mode: true,
      });

      expect(result.ok).toBe(true);
      const meta = result.meta as Record<string, unknown>;
      expect(meta.vector_search_enabled).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("scoped vector search reranks bounded lexical candidates before global vector scan", () => {
    const core = new HarnessMemCore(createConfig("vector-prefilter-rerank"));
    try {
      const high = core.recordEvent(
        baseEvent({
          event_id: "vector-prefilter-high",
          payload: { content: "prefilter sentinel shared phrase high" },
        })
      );
      const low = core.recordEvent(
        baseEvent({
          event_id: "vector-prefilter-low",
          payload: { content: "prefilter sentinel shared phrase low" },
        })
      );
      const highId = (high.items[0] as { id: string }).id;
      const lowId = (low.items[0] as { id: string }).id;
      const db = core.getRawDb();
      const modelRow = db.query(`SELECT model FROM mem_vectors WHERE observation_id = ? LIMIT 1`).get(highId) as { model: string };
      const queryVector = Array.from({ length: 64 }, (_, index) => index === 0 ? 1 : 0);
      const oppositeVector = Array.from({ length: 64 }, (_, index) => index === 1 ? 1 : 0);

      (core as unknown as {
        embeddingProvider: {
          name: "fallback";
          model: string;
          dimension: number;
          embed: () => number[];
          embedQuery: () => number[];
          health: () => { status: "healthy"; details: string };
        };
      }).embeddingProvider = {
        name: "fallback",
        model: modelRow.model,
        dimension: 64,
        embed: () => queryVector,
        embedQuery: () => queryVector,
        health: () => ({ status: "healthy", details: "test" }),
      };
      db.query(`UPDATE mem_vectors SET vector_json = ? WHERE observation_id = ?`).run(JSON.stringify(queryVector), highId);
      db.query(`UPDATE mem_vectors SET vector_json = ? WHERE observation_id = ?`).run(JSON.stringify(oppositeVector), lowId);

      const result = core.search({
        query: "prefilter sentinel shared phrase",
        project: "test-project",
        include_private: true,
        vector_search: true,
        strict_project: true,
        limit: 2,
      });
      expect(result.ok).toBe(true);
      const meta = result.meta as Record<string, unknown>;
      const prefilter = meta.vector_prefilter as Record<string, unknown>;
      expect(prefilter.mode).toBe("lexical_candidate_rerank");
      expect(Number(prefilter.candidates)).toBeGreaterThanOrEqual(2);
      expect(Number(prefilter.matched_rows)).toBeGreaterThanOrEqual(2);
      expect((result.items[0] as { id: string }).id).toBe(highId);
      const topScores = (result.items[0] as { scores: Record<string, number> }).scores;
      expect(topScores.vector).toBeGreaterThan(0.9);
    } finally {
      core.shutdown("test");
    }
  });

  test("safe mode stays bounded when FTS is unavailable", () => {
    const core = new HarnessMemCore(createConfig("safe-mode-fts-unavailable"));
    try {
      core.recordEvent(
        baseEvent({
          event_id: "safe-bounded-1",
          payload: { content: "bounded safe recent scan can answer without fts" },
        })
      );

      const db = (core as unknown as {
        db: { query: (sql: string) => { run: () => unknown } };
      }).db;
      db.query("DROP TABLE mem_observations_fts").run();

      const result = core.search({
        query: "bounded safe recent",
        limit: 1,
        include_private: true,
        safe_mode: true,
      });

      expect(result.ok).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
      const meta = result.meta as Record<string, unknown>;
      expect(meta.vector_search_enabled).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("dedupe hash uniqueness is enforced", () => {
    const core = new HarnessMemCore(createConfig("dedupe"));
    try {
      const first = core.recordEvent(baseEvent());
      const second = core.recordEvent(baseEvent());

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect((second.meta as Record<string, unknown>).deduped).toBe(true);

      const health = core.health({ includeCounts: true });
      const counts = (health.items[0] as { counts: { events: number } }).counts;
      expect(counts.events).toBe(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("privacy tags block/private/redact behave correctly", () => {
    const core = new HarnessMemCore(createConfig("privacy"));
    try {
      const blocked = core.recordEvent(
        baseEvent({
          payload: { content: "should not persist" },
          privacy_tags: ["block"],
        })
      );
      expect((blocked.meta as Record<string, unknown>).skipped).toBe(true);

      const privateEvent = core.recordEvent(
        baseEvent({
          event_id: "event-private",
          payload: { content: "private secret phrase" },
          privacy_tags: ["private"],
        })
      );
      expect(privateEvent.ok).toBe(true);

      const secretEvent = core.recordEvent(
        baseEvent({
          event_id: "event-secret",
          payload: { content: "classified lifecycle phrase" },
          privacy_tags: ["secret"],
        })
      );
      const secretObsId = (secretEvent.items[0] as { id: string }).id;

      const redacted = core.recordEvent(
        baseEvent({
          event_id: "event-redact",
          payload: { content: "mail me at alice@example.com api_key=sk_abcdefghijklmnop" },
          privacy_tags: ["redact"],
        })
      );
      const redactedObsId = (redacted.items[0] as { id: string }).id;

      const hiddenSearch = core.search({ query: "private secret phrase", include_private: false });
      for (const item of hiddenSearch.items as Array<{ privacy_tags?: string[] }>) {
        expect((item.privacy_tags || []).includes("private")).toBe(false);
      }

      const visibleSearch = core.search({ query: "private secret phrase", include_private: true });
      expect(visibleSearch.items.length).toBeGreaterThan(0);

      const hiddenSecret = core.search({ query: "classified lifecycle phrase", include_private: false });
      expect((hiddenSecret.items as Array<{ id: string }>).some((item) => item.id === secretObsId)).toBe(false);
      const visibleSecret = core.search({ query: "classified lifecycle phrase", include_private: true });
      expect((visibleSecret.items as Array<{ id: string }>).some((item) => item.id === secretObsId)).toBe(true);

      const details = core.getObservations({ ids: [redactedObsId], include_private: true, compact: false });
      const content = (details.items[0] as { content: string }).content;
      expect(content.includes("[REDACTED_EMAIL]")).toBe(true);
      expect(content.includes("[REDACTED_SECRET]")).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("bulk delete archives observations and hides them from normal reads", () => {
    const core = new HarnessMemCore(createConfig("delete-archive"));
    try {
      const inserted = core.recordEvent(
        baseEvent({
          event_id: "event-delete-target",
          payload: { content: "delete target lifecycle phrase" },
        })
      );
      const obsId = (inserted.items[0] as { id: string }).id;

      const deleted = core.bulkDeleteObservations({ ids: [obsId] });
      expect(deleted.ok).toBe(true);
      expect((deleted.meta as { deleted_count?: number }).deleted_count).toBe(1);

      const row = core.getRawDb()
        .query(`SELECT archived_at, privacy_tags_json FROM mem_observations WHERE id = ?`)
        .get(obsId) as { archived_at: string | null; privacy_tags_json: string };
      expect(row.archived_at).toBeTruthy();
      expect(JSON.parse(row.privacy_tags_json)).toContain("deleted");

      const search = core.search({ query: "delete target lifecycle phrase", include_private: true });
      expect((search.items as Array<{ id: string }>).some((item) => item.id === obsId)).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("admin forget plan is dry-run and reports cross-store impact", () => {
    const core = new HarnessMemCore(createConfig("forget-plan"));
    try {
      const first = core.recordEvent(
        baseEvent({
          event_id: "event-forget-plan-old",
          payload: { content: "old low value lifecycle phrase" },
        })
      );
      const firstId = (first.items[0] as { id: string }).id;
      const second = core.recordEvent(
        baseEvent({
          event_id: "event-forget-plan-neighbor",
          payload: { content: "fresh neighboring lifecycle phrase" },
        })
      );
      const secondId = (second.items[0] as { id: string }).id;

      const db = core.getRawDb();
      db.query(`UPDATE mem_observations SET created_at = ?, updated_at = ?, signal_score = 0, access_count = 0 WHERE id = ?`)
        .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", firstId);
      db.query(`INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
                VALUES (?, ?, 'updates', 1, ?)`)
        .run(secondId, firstId, "2026-02-14T00:00:00.000Z");

      const plan = core.adminForgetPlan({ limit: 10 });
      expect(plan.ok).toBe(true);
      const item = plan.items[0] as {
        dry_run: boolean;
        evicted: number;
        candidates: Array<{ observation_id: string }>;
        cross_store_impact: { observations: number; mem_links_touching: number };
      };
      expect(item.dry_run).toBe(true);
      expect(item.evicted).toBe(0);
      expect(item.candidates.map((candidate) => candidate.observation_id)).toContain(firstId);
      expect(item.cross_store_impact.observations).toBeGreaterThanOrEqual(1);
      expect(item.cross_store_impact.mem_links_touching).toBeGreaterThanOrEqual(1);

      const row = db.query(`SELECT archived_at FROM mem_observations WHERE id = ?`).get(firstId) as { archived_at: string | null };
      expect(row.archived_at).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("forget maintenance skips when no schedule or threshold trigger fires", () => {
    const config = createConfig("forget-maintenance-skip");
    config.forgetMaintenanceMode = "dry-run";
    config.forgetMaintenanceActiveObservationsThreshold = 100;
    const core = new HarnessMemCore(config);
    try {
      core.recordEvent(
        baseEvent({
          event_id: "event-forget-maintenance-skip",
          payload: { content: "maintenance skip candidate phrase" },
        })
      );

      const result = core.adminForgetMaintenance({ reason: "scheduler" });
      expect(result.ok).toBe(true);
      expect(result.meta.skipped).toBe("thresholds_not_exceeded");
      expect((result.items[0] as { mode: string }).mode).toBe("forget_maintenance_skipped");
    } finally {
      core.shutdown("test");
    }
  });

  test("forget maintenance dry-run reports threshold candidates without archiving", () => {
    const config = createConfig("forget-maintenance-dry-run");
    config.forgetMaintenanceMode = "dry-run";
    config.forgetMaintenanceActiveObservationsThreshold = 0;
    config.forgetMaintenanceLimit = 10;
    const core = new HarnessMemCore(config);
    try {
      const inserted = core.recordEvent(
        baseEvent({
          event_id: "event-forget-maintenance-dry-run",
          payload: { content: "maintenance dry run low value phrase" },
        })
      );
      const obsId = (inserted.items[0] as { id: string }).id;
      const db = core.getRawDb();
      db.query(`UPDATE mem_observations SET created_at = ?, updated_at = ?, signal_score = 0, access_count = 0 WHERE id = ?`)
        .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", obsId);

      const result = core.adminForgetMaintenance({ reason: "scheduler" });
      expect(result.ok).toBe(true);
      const item = result.items[0] as {
        mode: string;
        execute: boolean;
        triggers: string[];
        archive_plan: { candidate_count: number; candidate_ids: string[] };
      };
      expect(item.mode).toBe("forget_maintenance_plan");
      expect(item.execute).toBe(false);
      expect(item.triggers).toContain("threshold:active_observations");
      expect(item.archive_plan.candidate_count).toBe(1);
      expect(item.archive_plan.candidate_ids).toContain(obsId);

      const row = db.query(`SELECT archived_at FROM mem_observations WHERE id = ?`).get(obsId) as { archived_at: string | null };
      expect(row.archived_at).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("forget maintenance archive mode creates restore-capable archive and leaves purge manual", () => {
    const config = createConfig("forget-maintenance-archive");
    config.forgetMaintenanceMode = "archive";
    config.forgetMaintenanceScheduleEnabled = true;
    config.forgetMaintenanceLimit = 10;
    const core = new HarnessMemCore(config);
    try {
      const inserted = core.recordEvent(
        baseEvent({
          event_id: "event-forget-maintenance-archive",
          payload: { content: "maintenance archive low value phrase" },
        })
      );
      const obsId = (inserted.items[0] as { id: string }).id;
      const db = core.getRawDb();
      db.query(`UPDATE mem_observations SET created_at = ?, updated_at = ?, signal_score = 0, access_count = 0 WHERE id = ?`)
        .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", obsId);

      const result = core.adminForgetMaintenance({ reason: "scheduler" });
      expect(result.ok).toBe(true);
      const item = result.items[0] as {
        mode: string;
        execute: boolean;
        automatic_hard_purge: boolean;
        automatic_compact: boolean;
        archive: { archived_count: number; archived_ids: string[] };
      };
      expect(item.mode).toBe("forget_maintenance_archive");
      expect(item.execute).toBe(true);
      expect(item.automatic_hard_purge).toBe(false);
      expect(item.automatic_compact).toBe(false);
      expect(item.archive.archived_count).toBe(1);
      expect(item.archive.archived_ids).toContain(obsId);

      const row = db.query(`SELECT archived_at FROM mem_observations WHERE id = ?`).get(obsId) as { archived_at: string | null };
      expect(row.archived_at).toBeTruthy();
      const archiveRow = db
        .query<{ stub_count: number; full_count: number }, [string]>(`
          SELECT
            (SELECT COUNT(*) FROM mem_archive_stubs WHERE observation_id = ? AND archive_state = 'archived') AS stub_count,
            (SELECT COUNT(*)
             FROM mem_archive_full f
             JOIN mem_archive_stubs s ON s.archive_id = f.archive_id
             WHERE s.observation_id = ?) AS full_count
        `)
        .get(obsId, obsId);
      expect(archiveRow?.stub_count).toBe(1);
      expect(archiveRow?.full_count).toBe(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("forget maintenance can trigger real-db vector prune dry-run without mutation", () => {
    const config = createConfig("forget-maintenance-vector-prune");
    config.forgetMaintenanceMode = "dry-run";
    config.forgetMaintenanceArchivedObservationsThreshold = 0;
    config.forgetMaintenanceStaleVectorRowsThreshold = 0;
    config.forgetMaintenanceLimit = 10;
    const core = new HarnessMemCore(config);
    try {
      const inserted = core.recordEvent(
        baseEvent({
          event_id: "event-forget-vector-prune",
          payload: { content: "archived vector prune dry run phrase" },
        })
      );
      const obsId = (inserted.items[0] as { id: string }).id;
      const db = core.getRawDb();
      db.query(`UPDATE mem_observations SET archived_at = ? WHERE id = ?`).run("2026-02-15T00:00:00.000Z", obsId);

      const result = core.adminForgetMaintenance({ reason: "scheduler", vector_prune: { limit: 10 } });
      expect(result.ok).toBe(true);
      const item = result.items[0] as {
        mode: string;
        vector_prune_plan: {
          mode: string;
          dry_run: boolean;
          candidate_count: number;
          samples: Array<{ observation_id: string }>;
        };
      };
      expect(item.mode).toBe("forget_maintenance_plan");
      expect(item.vector_prune_plan.mode).toBe("archived_vector_prune_plan");
      expect(item.vector_prune_plan.dry_run).toBe(true);
      expect(item.vector_prune_plan.candidate_count).toBeGreaterThanOrEqual(1);
      expect(item.vector_prune_plan.samples.map((sample) => sample.observation_id)).toContain(obsId);
      const vectorCount = db
        .query(`SELECT COUNT(*) AS count FROM mem_vectors WHERE observation_id = ?`)
        .get(obsId) as { count: number };
      expect(vectorCount.count).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("ingest TTL policy applies by observation_type only when expires_at is absent", () => {
    const config = createConfig("ttl-policy-by-observation-type");
    config.ttlPolicyByObservationType = {
      action: { days: 30 },
      decision: null,
    };
    const core = new HarnessMemCore(config);
    try {
      const action = core.recordEvent(
        baseEvent({
          event_id: "ttl-policy-action",
          event_type: "tool_use",
          payload: { command: "bun test ttl policy action" },
        })
      );
      const decision = core.recordEvent(
        baseEvent({
          event_id: "ttl-policy-decision",
          payload: { content: "decided to keep durable decisions without default ttl" },
        })
      );
      const explicit = core.recordEvent(
        baseEvent({
          event_id: "ttl-policy-explicit",
          event_type: "tool_use",
          expires_at: "2030-01-01T00:00:00.000Z",
          payload: { command: "explicit ttl wins" },
        })
      );
      const db = core.getRawDb();
      const actionRow = db
        .query(`SELECT observation_type, expires_at FROM mem_observations WHERE id = ?`)
        .get((action.items[0] as { id: string }).id) as { observation_type: string; expires_at: string | null };
      const decisionRow = db
        .query(`SELECT observation_type, expires_at FROM mem_observations WHERE id = ?`)
        .get((decision.items[0] as { id: string }).id) as { observation_type: string; expires_at: string | null };
      const explicitRow = db
        .query(`SELECT expires_at FROM mem_observations WHERE id = ?`)
        .get((explicit.items[0] as { id: string }).id) as { expires_at: string | null };

      expect(actionRow.observation_type).toBe("action");
      expect(actionRow.expires_at).toBeTruthy();
      expect(new Date(actionRow.expires_at!).getTime()).toBeGreaterThan(Date.now());
      expect(decisionRow.observation_type).toBe("decision");
      expect(decisionRow.expires_at).toBeNull();
      expect(explicitRow.expires_at).toBe("2030-01-01T00:00:00.000Z");
    } finally {
      core.shutdown("test");
    }
  });

  test("hybrid ranking includes recency influence", () => {
    const core = new HarnessMemCore(createConfig("ranking"));
    try {
      core.recordEvent(
        baseEvent({
          event_id: "old-event",
          ts: "2025-01-01T00:00:00.000Z",
          payload: { content: "alpha old note" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "new-event",
          ts: "2026-02-14T00:00:00.000Z",
          payload: { content: "alpha new note" },
        })
      );

      const search = core.search({ query: "alpha note", limit: 2, include_private: true });
      const firstId = (search.items[0] as { id: string }).id;
      expect(firstId).toContain("new-event");
    } finally {
      core.shutdown("test");
    }
  });

  test("feed cursor returns stable non-overlapping pages", () => {
    const core = new HarnessMemCore(createConfig("feed-cursor"));
    try {
      for (let i = 0; i < 3; i += 1) {
        core.recordEvent(
          baseEvent({
            event_id: `feed-${i}`,
            ts: `2026-02-14T00:00:0${i}.000Z`,
            payload: { content: `feed item ${i}` },
          })
        );
      }

      const first = core.feed({ project: "test-project", limit: 2, include_private: true });
      expect(first.ok).toBe(true);
      expect(first.items.length).toBe(2);
      const firstIds = new Set((first.items as Array<{ id: string }>).map((item) => item.id));
      const nextCursor = String((first.meta as Record<string, unknown>).next_cursor || "");
      expect(nextCursor.length).toBeGreaterThan(0);

      const second = core.feed({ project: "test-project", limit: 2, cursor: nextCursor, include_private: true });
      expect(second.ok).toBe(true);
      expect(second.items.length).toBeGreaterThanOrEqual(1);
      for (const item of second.items as Array<{ id: string }>) {
        expect(firstIds.has(item.id)).toBe(false);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("project stats respect include_private filter", () => {
    const core = new HarnessMemCore(createConfig("project-stats-privacy"));
    try {
      core.recordEvent(
        baseEvent({
          event_id: "stats-public",
          payload: { content: "public stats event" },
          privacy_tags: [],
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "stats-private",
          payload: { content: "private stats event" },
          privacy_tags: ["private"],
        })
      );

      const hidden = core.projectsStats({ include_private: false });
      const visible = core.projectsStats({ include_private: true });
      const hiddenProject = (hidden.items as Array<{ project: string; observations: number }>).find(
        (item) => item.project === "test-project"
      );
      const visibleProject = (visible.items as Array<{ project: string; observations: number }>).find(
        (item) => item.project === "test-project"
      );

      expect(hiddenProject?.observations).toBe(1);
      expect(visibleProject?.observations).toBe(2);
    } finally {
      core.shutdown("test");
    }
  });

  test("project stats hide synthetic and hidden-directory projects", () => {
    const core = new HarnessMemCore(createConfig("project-stats-noise"));
    const hiddenRoot = mkdtempSync(join(tmpdir(), "harness-mem-hidden-project-"));
    cleanupPaths.push(hiddenRoot);
    const hiddenProject = join(hiddenRoot, ".codex");
    mkdirSync(hiddenProject, { recursive: true });
    try {
      core.recordEvent(
        baseEvent({
          event_id: "stats-visible",
          project: "visible-project",
          payload: { content: "visible stats event" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "stats-shadow",
          project: `/shadow-perf-${Date.now()}`,
          payload: { content: "shadow stats event" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "stats-hidden-dir",
          project: hiddenProject,
          payload: { content: "hidden directory stats event" },
        })
      );

      const stats = core.projectsStats({ include_private: true });
      const projects = (stats.items as Array<{ project: string }>).map((item) => item.project);

      expect(projects).toContain("visible-project");
      expect(projects.some((project) => project.includes("shadow-"))).toBe(false);
      expect(projects).not.toContain(hiddenProject);
    } finally {
      core.shutdown("test");
    }
  });

  test("project stats group repo path and scoped projects under canonical repo name", () => {
    const core = new HarnessMemCore(createConfig("project-stats-canonical"));
    const repoRoot = createFakeRepo("grouped-project");
    const repoName = basename(repoRoot) || "grouped-project";
    try {
      core.recordEvent(
        baseEvent({
          event_id: "grouped-repo-path",
          session_id: "grouped-session-path",
          project: repoRoot,
          payload: { content: "repo rooted event" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "grouped-repo-scope",
          session_id: "grouped-session-scope",
          project: `${repoName}::line`,
          payload: { content: "repo scoped event" },
        })
      );

      const stats = core.projectsStats({ include_private: true });
      const grouped = (stats.items as Array<{
        project: string;
        observations: number;
        sessions: number;
        member_projects?: string[];
      }>).find((item) => item.project === repoName);

      expect(grouped).toBeDefined();
      expect(grouped?.observations).toBe(2);
      expect(grouped?.sessions).toBe(2);
      expect((grouped?.member_projects || []).some((project) => project.endsWith(`/${repoName}`))).toBe(true);
      expect(grouped?.member_projects).toContain(`${repoName}::line`);
    } finally {
      core.shutdown("test");
    }
  });

  test("canonical project filter fans out to repo members in feed and search", () => {
    const core = new HarnessMemCore(createConfig("project-filter-canonical"));
    const repoRoot = createFakeRepo("filter-project");
    const repoName = basename(repoRoot) || "filter-project";
    try {
      core.recordEvent(
        baseEvent({
          event_id: "filter-repo-path",
          session_id: "filter-session-path",
          project: repoRoot,
          payload: { content: "shared alpha repo path" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "filter-repo-scope",
          session_id: "filter-session-scope",
          project: `${repoName}::line`,
          payload: { content: "shared alpha repo scope" },
        })
      );

      const feed = core.feed({ project: repoName, limit: 10, include_private: true });
      expect(feed.ok).toBe(true);
      expect(feed.items.length).toBe(2);
      for (const item of feed.items as Array<{ canonical_project?: string }>) {
        expect(item.canonical_project).toBe(repoName);
      }

      const search = core.search({ query: "shared alpha", project: repoName, strict_project: true, include_private: true });
      expect(search.ok).toBe(true);
      const candidateCounts = (search.meta as Record<string, unknown>).candidate_counts as Record<string, unknown>;
      expect(Number(candidateCounts.lexical || 0)).toBe(2);
      expect(Number(candidateCounts.vector || 0)).toBe(2);
    } finally {
      core.shutdown("test");
    }
  });

  test("non-repo absolute paths stay grouped by folder name even when an ancestor has .git", () => {
    const core = new HarnessMemCore(createConfig("non-repo-folder-fallback"));
    const ancestorRoot = mkdtempSync(join(tmpdir(), "ancestor-git-root-"));
    cleanupPaths.push(ancestorRoot);
    mkdirSync(join(ancestorRoot, ".git"), { recursive: true });
    const workspaceOne = join(ancestorRoot, "workspace-one");
    const workspaceTwo = join(ancestorRoot, "workspace-two");
    mkdirSync(workspaceOne, { recursive: true });
    mkdirSync(workspaceTwo, { recursive: true });
    try {
      core.recordEvent(
        baseEvent({
          event_id: "folder-fallback-1",
          project: workspaceOne,
          session_id: "folder-session-1",
          payload: { content: "workspace one note" },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "folder-fallback-2",
          project: workspaceTwo,
          session_id: "folder-session-2",
          payload: { content: "workspace two note" },
        })
      );

      const stats = core.projectsStats({ include_private: true });
      const items = stats.items as Array<{ project: string; member_projects?: string[] }>;
      const workspaceOneStats = items.find((item) => item.project === "workspace-one");
      const workspaceTwoStats = items.find((item) => item.project === "workspace-two");
      const ancestorStats = items.find((item) => item.project === basename(ancestorRoot));
      const workspaceOneFeed = core.feed({ project: workspaceOne, limit: 10, include_private: true });

      expect(workspaceOneStats?.member_projects).toHaveLength(1);
      expect(workspaceTwoStats?.member_projects).toHaveLength(1);
      expect((workspaceOneStats?.member_projects || [])[0]?.endsWith("/workspace-one")).toBe(true);
      expect((workspaceTwoStats?.member_projects || [])[0]?.endsWith("/workspace-two")).toBe(true);
      expect(ancestorStats).toBeUndefined();
      expect(workspaceOneFeed.items).toHaveLength(1);
      expect(((workspaceOneFeed.items[0] as { project: string }).project || "").endsWith("/workspace-one")).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("HARNESS_MEM_VECTOR_DIM supports 1536 and caps at 4096", () => {
    const previous = process.env.HARNESS_MEM_VECTOR_DIM;
    try {
      process.env.HARNESS_MEM_VECTOR_DIM = "1536";
      expect(getConfig().vectorDimension).toBe(1536);

      process.env.HARNESS_MEM_VECTOR_DIM = "99999";
      expect(getConfig().vectorDimension).toBe(4096);
    } finally {
      if (previous === undefined) {
        delete process.env.HARNESS_MEM_VECTOR_DIM;
      } else {
        process.env.HARNESS_MEM_VECTOR_DIM = previous;
      }
    }
  });

  test("workspace boundary: different projects do not mix", () => {
    const core = new HarnessMemCore(createConfig("boundary"));
    try {
      core.recordEvent(baseEvent({ project: "project-a", payload: { prompt: "alpha secret" } }));
      core.recordEvent(baseEvent({ project: "project-b", payload: { prompt: "beta secret" } }));

      const searchA = core.search({ query: "secret", project: "project-a", strict_project: true });
      const searchB = core.search({ query: "secret", project: "project-b", strict_project: true });

      // project-a の検索結果に project-b のデータが混入しないこと
      for (const item of searchA.items as any[]) {
        expect(item.project).toBe("project-a");
      }
      for (const item of searchB.items as any[]) {
        expect(item.project).toBe("project-b");
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("workspace boundary: empty project name is rejected", () => {
    const core = new HarnessMemCore(createConfig("empty-project"));
    try {
      const result = core.recordEvent(baseEvent({ project: "" }));
      expect(result.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });
});
