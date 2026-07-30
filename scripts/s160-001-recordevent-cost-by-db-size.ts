#!/usr/bin/env bun
/**
 * §160-001: `recordEvent` 1 件のコストを DB サイズ別に測り、内訳を分解する。
 *
 * 背景 (Plans.md §160): 空 DB では 70KB payload でも 55ms なのに、本番 4.9GB DB では
 * tick が 11 秒になった。payload サイズではなく DB サイズが効いている、という仮説を
 * 数値で確定するのが本スクリプトの役目。
 *
 * 測定は 3 層構成:
 *
 *   1. E2E — 実際の `HarnessMemCore.recordEvent()` を叩いた壁時計時間。
 *      本番 API と同じコードパスを通る「本当のコスト」。
 *
 *   2. 内部区間 (production instrumentation) — event-recorder.ts の `recordEvent` に
 *      §160-001 で追加した `measureSyncSegment` ラップから、bench 専用の sink
 *      (`setEventRecorderSegmentSink`) 経由で実測値を取る。ensure_session /
 *      event_insert / dedupe_lookup / observation_insert (FTS トリガー込み) /
 *      tags_insert / vector_upsert (embedding 計算込み) / extract_entities /
 *      extract_graph_relations / auto_link / auto_supersedes /
 *      semantic_auto_linker / insert_nuggets / audit_log の 13 区間。
 *      これが「recordEvent の中身を実際に流れた通りに」計測した一次データ。
 *
 *   3. 分離セグメント (isolated raw SQL) — 内部区間の "observation_insert" は
 *      FTS トリガーが同期発火するため base insert と FTS 挿入が数値として混ざる。
 *      これを分離するため、同じ DB 接続 (`core.db`) に対してトリガーを一時的に
 *      落として base insert 単体を測り、その後にトリガーが実行するのと同じ
 *      INSERT 文を明示発行して FTS 単体を測る (トリガーは測定後に `initFtsIndex()`
 *      で復元)。vector も同様に、embedding 計算を含まない固定ベクトルで
 *      「DB 書き込みだけ」を分離測定する (embedding 計算は DB サイズに依存しない
 *      定数項なので、DB サイズ律速の犯人探しからは除外するのが正確)。
 *
 * recordEvent 自体のロジックは変更していない。追加したのは
 * `this.measureSyncSegment(label, fn)` のラップのみで、fn の中身・戻り値・
 * 例外の伝播はすべて元のまま (低リスク優先)。
 *
 * Usage:
 *   bun scripts/s160-001-recordevent-cost-by-db-size.ts --db <path.db|:empty:> --label <name> \
 *     [--iterations 21] [--vector-dimension 256] [--out results.json]
 */

import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { HarnessMemCore, type Config } from "../memory-server/src/core/harness-mem-core";
import { initFtsIndex } from "../memory-server/src/db/schema";
import {
  expiredFilterSql,
  segmentJapaneseForFts,
} from "../memory-server/src/core/core-utils";
import { upsertSqliteVecRow } from "../memory-server/src/vector/providers";
import { setEventRecorderSegmentSink } from "../memory-server/src/core/event-recorder";
import { assertScratchDbPath } from "./lib/s160-scratch-guard";

interface SegmentStats {
  label: string;
  n: number;
  p50_ms: number;
  p90_ms: number;
  min_ms: number;
  max_ms: number;
}

interface RunResult {
  db_size_label: string;
  db_path: string;
  db_bytes: number;
  observation_count: number;
  vector_model: string;
  e2e: SegmentStats;
  internal_segments: SegmentStats[];
  isolated_segments: SegmentStats[];
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return Number(sorted[idx].toFixed(3));
}

function stats(label: string, samples: number[]): SegmentStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    label,
    n: samples.length,
    p50_ms: percentile(sorted, 50),
    p90_ms: percentile(sorted, 90),
    min_ms: Number((sorted[0] ?? 0).toFixed(3)),
    max_ms: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
  };
}

function timeIt<T>(fn: () => T): { result: T; ms: number } {
  const started = performance.now();
  const result = fn();
  const ms = performance.now() - started;
  return { result, ms };
}

function fixedContent(seed: string): string {
  // Fixed payload size across all DB-size tiers — only DB size is the variable
  // under test (per Plans.md §160-001 direction: "payload サイズは固定、DB サイズだけ動かす").
  const filler =
    "harness-mem recordEvent bench payload fixed size across db size tiers 記憶 検索 同期 処理 書き込み 計測 分解 区間 実測 支配 ";
  return `${seed} ${filler.repeat(8)}`.slice(0, 1100);
}

function buildConfig(dbPath: string, vectorDimension: number): Config {
  return {
    dbPath,
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension,
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
    consolidationEnabled: false,
  } as Config;
}

function dbFileBytes(dbPath: string): number {
  let total = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) total += statSync(p).size;
  }
  return total;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let dbArg = "";
  let label = "";
  let iterations = 21;
  let vectorDimension = 256;
  let outPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db") dbArg = args[++i];
    else if (args[i] === "--label") label = args[++i];
    else if (args[i] === "--iterations") iterations = Number(args[++i]);
    else if (args[i] === "--vector-dimension") vectorDimension = Number(args[++i]);
    else if (args[i] === "--out") outPath = args[++i];
  }
  if (!dbArg || !label) {
    throw new Error(
      "Usage: --db <path.db|:empty:> --label <name> [--iterations 21] [--vector-dimension 256] [--out results.json]",
    );
  }

  let dbPath = dbArg;
  let cleanupDir: string | null = null;
  if (dbArg === ":empty:") {
    cleanupDir = mkdtempSync(join(tmpdir(), "s160-001-empty-"));
    dbPath = join(cleanupDir, "empty.db");
  } else {
    if (!existsSync(dbArg)) {
      throw new Error(`db file not found: ${dbArg}`);
    }
    // Review fix (round 2): this script constructs a real HarnessMemCore
    // against --db, which runs schema migration + reconcileAbandonedConsolidationJobs()
    // on construction, inserts synthetic rows, and temporarily drops/recreates
    // FTS triggers. Refuse anything that isn't a scratch DB before touching it.
    assertScratchDbPath(dbArg, "--db");
  }

  // --- register the internal-segment sink BEFORE any recordEvent() call ---
  const internalSamples = new Map<string, number[]>();
  setEventRecorderSegmentSink((segLabel, elapsedMs) => {
    const arr = internalSamples.get(segLabel) ?? [];
    arr.push(elapsedMs);
    internalSamples.set(segLabel, arr);
  });

  const core = new HarnessMemCore(buildConfig(dbPath, vectorDimension));
  try {
    // --- warmup (embedding provider prime, page cache touch) — not measured ---
    setEventRecorderSegmentSink(null);
    for (let i = 0; i < 3; i++) {
      core.recordEvent({
        platform: "bench",
        project: "s160-001-warmup",
        session_id: `s160-001-warmup-${i}`,
        event_type: "user_prompt",
        payload: { prompt: fixedContent(`warmup-${i}-${randomBytes(4).toString("hex")}`) },
        tags: [],
        privacy_tags: [],
      } as unknown as Parameters<typeof core.recordEvent>[0]);
    }

    // Discover which model name the real embedding path actually wrote —
    // the isolated vector-write segment (below) must target the SAME
    // model-specific vec0 table, otherwise it would hit an empty table
    // regardless of how large mem_observations is.
    const modelRow = core.db
      .query(`SELECT model FROM mem_vectors ORDER BY rowid DESC LIMIT 1`)
      .get() as { model?: string } | null;
    const vectorModel = modelRow?.model ?? "fallback_local_hash_v3";

    const countBefore = (
      core.db.query(`SELECT COUNT(*) AS c FROM mem_observations`).get() as { c?: number } | null
    )?.c ?? 0;

    // --- 1 & 2. E2E recordEvent() + internal segment breakdown (real code path) ---
    setEventRecorderSegmentSink((segLabel, elapsedMs) => {
      const arr = internalSamples.get(segLabel) ?? [];
      arr.push(elapsedMs);
      internalSamples.set(segLabel, arr);
    });
    const e2eSamples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const seed = `e2e-${i}-${randomBytes(6).toString("hex")}`;
      const { ms } = timeIt(() =>
        core.recordEvent({
          platform: "bench",
          project: "s160-001-e2e",
          session_id: `s160-001-e2e-${seed}`,
          event_type: "user_prompt",
          payload: { prompt: fixedContent(seed) },
          tags: [],
          privacy_tags: [],
        } as unknown as Parameters<typeof core.recordEvent>[0]),
      );
      e2eSamples.push(ms);
    }

    // audit_log only fires on the isPrivateTag() branch — a normal E2E event
    // never hits it. Run a small dedicated batch with a privacy tag so the
    // internal "audit_log" segment gets real (non-zero-sample) numbers too.
    for (let i = 0; i < Math.min(10, iterations); i++) {
      const seed = `e2e-audit-${i}-${randomBytes(6).toString("hex")}`;
      core.recordEvent({
        platform: "bench",
        project: "s160-001-e2e-audit",
        session_id: `s160-001-e2e-audit-${seed}`,
        event_type: "user_prompt",
        payload: { prompt: fixedContent(seed) },
        tags: [],
        privacy_tags: ["private"],
      } as unknown as Parameters<typeof core.recordEvent>[0]);
    }
    setEventRecorderSegmentSink(null);

    // --- 3. isolated raw-SQL segments (same core.db connection) ---

    // dedupe_lookup — literal copy of the SELECT in event-recorder.ts
    const dedupeSamples: number[] = [];
    const dedupeStmt = core.db.query(`
      SELECT id
      FROM mem_observations
      WHERE content_dedupe_hash = ?
        AND archived_at IS NULL
        ${expiredFilterSql("mem_observations")}
      LIMIT 1
    `);
    for (let i = 0; i < iterations; i++) {
      const fakeHash = createHash("sha256").update(`nonexistent-${i}-${randomBytes(8).toString("hex")}`).digest("hex");
      const { ms } = timeIt(() => dedupeStmt.get(fakeHash));
      dedupeSamples.push(ms);
    }

    // observation_insert_no_fts — base insert only, FTS trigger dropped first
    core.db.exec(`
      DROP TRIGGER IF EXISTS mem_observations_ai;
      DROP TRIGGER IF EXISTS mem_observations_ad;
      DROP TRIGGER IF EXISTS mem_observations_au;
    `);
    const insertObsStmt = core.db.query(`
      INSERT INTO mem_observations(
        id, event_id, platform, project, session_id,
        title, content, content_redacted, content_dedupe_hash, raw_text, observation_type, memory_type,
        tags_json, privacy_tags_json,
        signal_score, user_id, team_id,
        event_time, observed_at, valid_from, valid_to, supersedes, invalidated_at,
        thread_id, topic, expires_at, branch,
        title_fts, content_fts,
        created_at, updated_at
      ) VALUES (?, NULL, 'bench', 's160-001-seg', ?, ?, ?, ?, ?, NULL, 'context', 'semantic', '[]', '[]', 0.5, 'default', NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
    `);
    const insertObsSamples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const seed = `seg-obsinsert-${i}-${randomBytes(6).toString("hex")}`;
      const observationId = `s160-001-seg-obs-${seed}`;
      const sessionId = `s160-001-seg-session-${seed}`;
      core.db
        .query(
          `INSERT OR IGNORE INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
           VALUES (?, 'bench', 's160-001-seg', ?, ?, ?)`,
        )
        .run(sessionId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
      const content = fixedContent(seed);
      const title = seed.slice(0, 40);
      const now = new Date().toISOString();
      const contentDedupeHash = createHash("sha256").update(`obsinsert:${seed}`).digest("hex");
      const titleFts = segmentJapaneseForFts(title);
      const contentFts = segmentJapaneseForFts(content);
      const { ms } = timeIt(() =>
        insertObsStmt.run(
          observationId, sessionId,
          title, content, content, contentDedupeHash,
          now, titleFts, contentFts, now, now,
        ),
      );
      insertObsSamples.push(ms);
    }
    // restore FTS triggers (best-effort; this bench DB is scratch-only and gets deleted).
    initFtsIndex(core.db);

    // fts_insert — isolated, same statement the trigger fires
    const insertFtsStmt = core.db.query(`
      INSERT INTO mem_observations_fts(rowid, observation_id, title, content)
      VALUES (?, ?, ?, ?)
    `);
    const ftsSamples: number[] = [];
    // Offset above any existing rowid so repeated bench runs against the same
    // scratch DB file don't collide with rowids left by a previous run.
    const maxFtsRowid = (
      core.db.query(`SELECT COALESCE(MAX(rowid), 0) AS m FROM mem_observations_fts`).get() as { m?: number } | null
    )?.m ?? 0;
    let ftsRowidCursor = Math.max(900_000_000, maxFtsRowid + 1_000_000);
    for (let i = 0; i < iterations; i++) {
      const seed = `seg-fts-${i}-${randomBytes(6).toString("hex")}`;
      const content = fixedContent(seed);
      const title = seed.slice(0, 40);
      const contentFts = segmentJapaneseForFts(content);
      const titleFts = segmentJapaneseForFts(title);
      ftsRowidCursor += 1;
      const { ms } = timeIt(() =>
        insertFtsStmt.run(ftsRowidCursor, `s160-001-seg-fts-${seed}`, titleFts, contentFts),
      );
      ftsSamples.push(ms);
    }

    // vector_upsert_db_write — isolated DB write, fixed vector (no embedding compute)
    const insertVectorStmt = core.db.query(`
      INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const fixedVector = JSON.stringify(Array.from({ length: vectorDimension }, (_, i) => Math.sin(i) / 2));
    const vectorSamples: number[] = [];
    // Isolated segment: no companion mem_observations row for these synthetic
    // observation_ids (that would conflate this segment with observation_insert).
    // mem_vectors has an FK to mem_observations(id); production recordEvent always
    // has that row already inserted in the same transaction, so relax FK here only.
    core.db.exec("PRAGMA foreign_keys=OFF;");
    for (let i = 0; i < iterations; i++) {
      const seed = `seg-vec-${i}-${randomBytes(6).toString("hex")}`;
      const observationId = `s160-001-seg-vec-${seed}`;
      const now = new Date().toISOString();
      const { ms } = timeIt(() => {
        insertVectorStmt.run(observationId, vectorModel, vectorDimension, fixedVector, now, now);
        upsertSqliteVecRow(core.db, observationId, fixedVector, now, {
          model: vectorModel,
          vectorDimension,
        });
      });
      vectorSamples.push(ms);
    }
    core.db.exec("PRAGMA foreign_keys=ON;");

    // audit_log_insert — isolated INSERT, literal from event-recorder.ts privacy_filter path
    const insertAuditStmt = core.db.query(`
      INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
      VALUES ('privacy_filter', ?, 'event', ?, ?, ?)
    `);
    const auditSamples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const seed = `seg-audit-${i}-${randomBytes(6).toString("hex")}`;
      const now = new Date().toISOString();
      const details = JSON.stringify({ reason: "private_tag", path: `bench/s160-001-seg`, privacy_tags: ["mask"] });
      const { ms } = timeIt(() => insertAuditStmt.run("bench", `s160-001-seg-evt-${seed}`, details, now));
      auditSamples.push(ms);
    }

    const observationCount =
      (core.db.query(`SELECT COUNT(*) AS c FROM mem_observations`).get() as { c?: number } | null)?.c ?? 0;

    const internalOrder = [
      "ensure_session", "event_insert", "dedupe_lookup", "observation_insert", "tags_insert",
      "vector_upsert", "extract_entities", "extract_graph_relations", "auto_link",
      "auto_supersedes", "semantic_auto_linker", "insert_nuggets", "audit_log",
    ];
    const internalStats: SegmentStats[] = internalOrder
      .filter((l) => internalSamples.has(l))
      .map((l) => stats(l, internalSamples.get(l)!));

    const result: RunResult = {
      db_size_label: label,
      db_path: dbPath,
      db_bytes: dbFileBytes(dbPath),
      observation_count: observationCount,
      vector_model: vectorModel,
      e2e: stats("e2e_recordEvent", e2eSamples),
      internal_segments: internalStats,
      isolated_segments: [
        stats("dedupe_lookup_isolated", dedupeSamples),
        stats("observation_insert_no_fts_isolated", insertObsSamples),
        stats("fts_insert_isolated", ftsSamples),
        stats("vector_upsert_db_write_isolated", vectorSamples),
        stats("audit_log_insert_isolated", auditSamples),
      ],
    };

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (outPath) {
      writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }
    process.stderr.write(
      `[s160-001] label=${label} obs_before=${countBefore} obs_after=${observationCount} db_bytes=${result.db_bytes} vector_model=${vectorModel}\n`,
    );
    process.stderr.write(`[s160-001] e2e p50=${result.e2e.p50_ms}ms p90=${result.e2e.p90_ms}ms max=${result.e2e.max_ms}ms n=${result.e2e.n}\n`);
    process.stderr.write(`[s160-001] internal segments (real recordEvent code path):\n`);
    for (const seg of result.internal_segments) {
      process.stderr.write(
        `[s160-001]   ${seg.label.padEnd(26)} p50=${seg.p50_ms.toFixed(3)}ms p90=${seg.p90_ms.toFixed(3)}ms max=${seg.max_ms.toFixed(3)}ms n=${seg.n}\n`,
      );
    }
    process.stderr.write(`[s160-001] isolated segments (raw SQL, same connection):\n`);
    for (const seg of result.isolated_segments) {
      process.stderr.write(
        `[s160-001]   ${seg.label.padEnd(34)} p50=${seg.p50_ms.toFixed(3)}ms p90=${seg.p90_ms.toFixed(3)}ms max=${seg.max_ms.toFixed(3)}ms n=${seg.n}\n`,
      );
    }
  } finally {
    setEventRecorderSegmentSink(null);
    core.shutdown("s160-001-bench");
    if (cleanupDir) {
      rmSync(cleanupDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`[s160-001] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
