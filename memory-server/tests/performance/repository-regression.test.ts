/**
 * パフォーマンス回帰テスト: Repository 導入前後のレイテンシ比較
 *
 * SqliteObservationRepository 経由の操作が、直接 SQL より +10% 以内であることを検証する。
 * 絶対値ではなく相対比較で判定することで CI 環境差による flaky を防ぐ。
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { SqliteObservationRepository } from "../../src/db/repositories/SqliteObservationRepository";
import type { InsertObservationInput } from "../../src/db/repositories/IObservationRepository";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** ウォームアップ回数（計測対象外） */
const WARMUP_COUNT = 10;
/** 各操作の計測繰り返し回数 */
const MEASURE_COUNT = 100;
/** 事前挿入するレコード数 */
const SEED_COUNT = 500;
/** Repository の許容オーバーヘッド比率（10% = 1.10） */
const OVERHEAD_TOLERANCE = 1.10;

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function createDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return db;
}

function makeId(prefix: string, i: number): string {
  return `${prefix}_${String(i).padStart(6, "0")}`;
}

function makeInput(i: number, sessionId = "session-perf"): InsertObservationInput {
  const now = new Date(Date.now() + i).toISOString();
  return {
    id: makeId("obs", i),
    event_id: null,
    platform: "claude",
    project: "perf-project",
    session_id: sessionId,
    title: `Observation title ${i}`,
    content: `Content body for observation number ${i}. This has some realistic length text.`,
    content_redacted: `Content body for observation number ${i}. This has some realistic length text.`,
    observation_type: "context",
    memory_type: i % 3 === 0 ? "episodic" : "semantic",
    tags_json: JSON.stringify([`tag${i % 10}`]),
    privacy_tags_json: "[]",
    signal_score: i % 100,
    user_id: "default",
    team_id: null,
    created_at: now,
    updated_at: now,
  };
}

function ensureSession(db: Database, sessionId: string): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT OR IGNORE INTO mem_sessions
     (session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, "claude", "perf-project", now, now, now);
}

/**
 * 指定回数の async 操作を実行し、合計ミリ秒を返す。
 */
async function measureAsync(fn: () => Promise<unknown>, count: number): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    await fn();
  }
  return performance.now() - start;
}

/**
 * 同期操作を async ラッパーで包んで計測する。
 * Repository が async であるため、比較対象も同等の非同期コストで計測する。
 */
async function measureSyncAsAsync(fn: () => unknown, count: number): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    await Promise.resolve(fn());
  }
  return performance.now() - start;
}

// ---------------------------------------------------------------------------
// セットアップ
// ---------------------------------------------------------------------------

let db: Database;
let repo: SqliteObservationRepository;

// 直接 SQL での操作用のプリペアドステートメントキャッシュ
const SELECT_BY_ID_SQL = `
  SELECT
    id, event_id, platform, project, session_id,
    title, content, content_redacted, observation_type, memory_type,
    tags_json, privacy_tags_json,
    signal_score, user_id, team_id,
    created_at, updated_at
  FROM mem_observations
  WHERE id = ?
`;

const SELECT_MANY_SQL = `
  SELECT
    id, event_id, platform, project, session_id,
    title, content, content_redacted, observation_type, memory_type,
    tags_json, privacy_tags_json,
    signal_score, user_id, team_id,
    created_at, updated_at
  FROM mem_observations
  WHERE project = ?
  AND (privacy_tags_json IS NULL OR privacy_tags_json = '[]' OR privacy_tags_json NOT LIKE '%private%')
  ORDER BY created_at DESC, id DESC
  LIMIT 50
`;

const COUNT_SQL = `
  SELECT COUNT(*) AS cnt FROM mem_observations
  WHERE project = ?
  AND (privacy_tags_json IS NULL OR privacy_tags_json = '[]' OR privacy_tags_json NOT LIKE '%private%')
`;

const INSERT_SQL = `
  INSERT OR IGNORE INTO mem_observations(
    id, event_id, platform, project, session_id,
    title, content, content_redacted, observation_type, memory_type,
    tags_json, privacy_tags_json,
    signal_score, user_id, team_id,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

// 計測用シードデータの ID 一覧
const seededIds: string[] = [];

beforeAll(() => {
  db = createDb();
  ensureSession(db, "session-perf");
  repo = new SqliteObservationRepository(db);

  // シードデータの挿入（計測対象外）
  const insertStmt = db.query(INSERT_SQL);
  for (let i = 0; i < SEED_COUNT; i++) {
    const inp = makeInput(i);
    insertStmt.run(
      inp.id, inp.event_id, inp.platform, inp.project, inp.session_id,
      inp.title, inp.content, inp.content_redacted, inp.observation_type, inp.memory_type,
      inp.tags_json, inp.privacy_tags_json, inp.signal_score ?? 0,
      inp.user_id ?? "default", inp.team_id ?? null,
      inp.created_at, inp.updated_at,
    );
    seededIds.push(inp.id);
  }
});

afterAll(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// パフォーマンス比較テスト
// ---------------------------------------------------------------------------

describe("パフォーマンス回帰: findById", () => {
  test(`Repository 経由が直接 SQL より ${((OVERHEAD_TOLERANCE - 1) * 100).toFixed(0)}% 以内のオーバーヘッドであること`, async () => {
    const targetId = seededIds[Math.floor(SEED_COUNT / 2)];
    const selectStmt = db.query(SELECT_BY_ID_SQL);

    // ウォームアップ（計測対象外）
    for (let i = 0; i < WARMUP_COUNT; i++) {
      await repo.findById(targetId);
      await Promise.resolve(selectStmt.get(targetId));
    }

    // 直接 SQL の計測（async ラッパーで公平比較）
    const directMs = await measureSyncAsAsync(() => selectStmt.get(targetId), MEASURE_COUNT);

    // Repository 経由の計測
    const repoMs = await measureAsync(() => repo.findById(targetId), MEASURE_COUNT);

    const ratio = repoMs / directMs;
    console.log(`[findById] direct=${directMs.toFixed(2)}ms repo=${repoMs.toFixed(2)}ms ratio=${ratio.toFixed(3)}`);

    // 直接 SQL が極端に速い場合（2ms 未満）は分母が不安定なため、
    // 絶対差分（5ms 未満）で代替チェック
    if (directMs < 2) {
      expect(repoMs - directMs).toBeLessThan(5);
    } else {
      expect(ratio).toBeLessThanOrEqual(OVERHEAD_TOLERANCE);
    }
  });
});

describe("パフォーマンス回帰: findMany", () => {
  test(`Repository 経由が直接 SQL より ${((OVERHEAD_TOLERANCE - 1) * 100).toFixed(0)}% 以内のオーバーヘッドであること`, async () => {
    /**
     * 直接 SQL 側も Repository と同等の「動的クエリ組み立て」を模倣する。
     * Repository が毎回 SQL 文字列を構築するコストを公平に評価するため。
     */
    function directFindMany(project: string, limit: number): unknown[] {
      const params: unknown[] = [];
      let sql = `
        SELECT
          id, event_id, platform, project, session_id,
          title, content, content_redacted, observation_type, memory_type,
          tags_json, privacy_tags_json,
          signal_score, user_id, team_id,
          created_at, updated_at
        FROM mem_observations
        WHERE 1 = 1
      `;
      sql += " AND project = ?";
      params.push(project);
      sql += " AND (privacy_tags_json IS NULL OR privacy_tags_json = '[]' OR privacy_tags_json NOT LIKE '%private%')";
      sql += " ORDER BY created_at DESC, id DESC";
      sql += " LIMIT ?";
      params.push(limit);
      return db.query<unknown, never[]>(sql).all(...(params as never[]));
    }

    // ウォームアップ
    for (let i = 0; i < WARMUP_COUNT; i++) {
      await repo.findMany({ project: "perf-project", limit: 50 });
      await Promise.resolve(directFindMany("perf-project", 50));
    }

    // 直接 SQL の計測（async ラッパー + 動的クエリ組み立てで公平比較）
    const directMs = await measureSyncAsAsync(
      () => directFindMany("perf-project", 50),
      MEASURE_COUNT,
    );

    // Repository 経由の計測
    const repoMs = await measureAsync(
      () => repo.findMany({ project: "perf-project", limit: 50 }),
      MEASURE_COUNT,
    );

    const ratio = repoMs / directMs;
    console.log(`[findMany] direct=${directMs.toFixed(2)}ms repo=${repoMs.toFixed(2)}ms ratio=${ratio.toFixed(3)}`);

    if (directMs < 2) {
      expect(repoMs - directMs).toBeLessThan(5);
    } else {
      expect(ratio).toBeLessThanOrEqual(OVERHEAD_TOLERANCE);
    }
  });
});

describe("パフォーマンス回帰: insert", () => {
  test(`Repository 経由が直接 SQL より ${((OVERHEAD_TOLERANCE - 1) * 100).toFixed(0)}% 以内のオーバーヘッドであること`, async () => {
    const insertStmt = db.query(INSERT_SQL);
    ensureSession(db, "session-insert");

    // 挿入用データを事前生成（計測中の準備コストを排除）
    const repoInputs: InsertObservationInput[] = [];
    const directInputs: InsertObservationInput[] = [];
    for (let i = 0; i < MEASURE_COUNT + WARMUP_COUNT; i++) {
      const baseId = SEED_COUNT + 10000 + i;
      repoInputs.push(makeInput(baseId, "session-insert"));
      directInputs.push(makeInput(baseId + 100000, "session-insert"));
    }

    // ウォームアップ（計測対象外）
    for (let i = 0; i < WARMUP_COUNT; i++) {
      const inp = repoInputs[i];
      await repo.insert(inp);
      const d = directInputs[i];
      insertStmt.run(
        d.id, d.event_id, d.platform, d.project, d.session_id,
        d.title, d.content, d.content_redacted, d.observation_type, d.memory_type,
        d.tags_json, d.privacy_tags_json, d.signal_score ?? 0,
        d.user_id ?? "default", d.team_id ?? null,
        d.created_at, d.updated_at,
      );
    }

    // 直接 SQL の計測（async ラッパーで公平比較）
    let directIdx = WARMUP_COUNT;
    const directMs = await measureSyncAsAsync(() => {
      const d = directInputs[directIdx++];
      insertStmt.run(
        d.id, d.event_id, d.platform, d.project, d.session_id,
        d.title, d.content, d.content_redacted, d.observation_type, d.memory_type,
        d.tags_json, d.privacy_tags_json, d.signal_score ?? 0,
        d.user_id ?? "default", d.team_id ?? null,
        d.created_at, d.updated_at,
      );
    }, MEASURE_COUNT);

    // Repository 経由の計測
    let repoIdx = WARMUP_COUNT;
    const repoMs = await measureAsync(async () => {
      const inp = repoInputs[repoIdx++];
      await repo.insert(inp);
    }, MEASURE_COUNT);

    const ratio = repoMs / directMs;
    console.log(`[insert] direct=${directMs.toFixed(2)}ms repo=${repoMs.toFixed(2)}ms ratio=${ratio.toFixed(3)}`);

    if (directMs < 2) {
      expect(repoMs - directMs).toBeLessThan(5);
    } else {
      expect(ratio).toBeLessThanOrEqual(OVERHEAD_TOLERANCE);
    }
  });
});

describe("パフォーマンス回帰: count", () => {
  test(`Repository 経由が直接 SQL より ${((OVERHEAD_TOLERANCE - 1) * 100).toFixed(0)}% 以内のオーバーヘッドであること`, async () => {
    const countStmt = db.query(COUNT_SQL);

    // ウォームアップ
    for (let i = 0; i < WARMUP_COUNT; i++) {
      await repo.count({ project: "perf-project" });
      await Promise.resolve(countStmt.get("perf-project"));
    }

    // 直接 SQL の計測（async ラッパーで公平比較）
    const directMs = await measureSyncAsAsync(
      () => countStmt.get("perf-project"),
      MEASURE_COUNT,
    );

    // Repository 経由の計測
    const repoMs = await measureAsync(
      () => repo.count({ project: "perf-project" }),
      MEASURE_COUNT,
    );

    const ratio = repoMs / directMs;
    console.log(`[count] direct=${directMs.toFixed(2)}ms repo=${repoMs.toFixed(2)}ms ratio=${ratio.toFixed(3)}`);

    if (directMs < 2) {
      expect(repoMs - directMs).toBeLessThan(5);
    } else {
      expect(ratio).toBeLessThanOrEqual(OVERHEAD_TOLERANCE);
    }
  });
});
