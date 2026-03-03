/**
 * analytics.test.ts — V5-006 Analytics API テスト
 *
 * AnalyticsService を直接インスタンス化して単体テストする。
 * bun:test で実行する。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../src/db/schema";
import { AnalyticsService } from "../src/core/analytics";
import type { AnalyticsDeps } from "../src/core/analytics";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return db;
}

function createDeps(db: Database): AnalyticsDeps {
  return {
    db: {
      query: (sql: string, params?: unknown[]) => ({
        all: () => db.query(sql).all(...(params ?? [])),
      }),
    },
  };
}

const openDbs: Database[] = [];

afterEach(() => {
  while (openDbs.length > 0) {
    const db = openDbs.pop();
    db?.close();
  }
});

function makeService(): { svc: AnalyticsService; db: Database } {
  const db = createTestDb();
  openDbs.push(db);
  const svc = new AnalyticsService(createDeps(db));
  return { svc, db };
}

/** セッション・イベント・観察を直接挿入する */
function insertObservation(
  db: Database,
  opts: {
    id?: string;
    project?: string;
    session_id?: string;
    observation_type?: string;
    memory_type?: string;
    created_at?: string;
  } = {}
): string {
  const id = opts.id ?? `obs_${Math.random().toString(36).slice(2, 10)}`;
  const project = opts.project ?? "test-project";
  const sessionId = opts.session_id ?? "sess-001";
  const observationType = opts.observation_type ?? "context";
  const memoryType = opts.memory_type ?? "semantic";
  const createdAt = opts.created_at ?? new Date().toISOString();

  db.query(
    `INSERT OR IGNORE INTO mem_sessions (session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, 'claude', ?, ?, ?, ?)`
  ).run(sessionId, project, createdAt, createdAt, createdAt);

  const eventId = `evt_${id}`;
  db.query(
    `INSERT OR IGNORE INTO mem_events (event_id, platform, project, session_id, event_type, ts, payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, created_at)
     VALUES (?, 'claude', ?, ?, 'user_prompt', ?, '{}', '[]', '[]', ?, ?, ?)`
  ).run(eventId, project, sessionId, createdAt, `hash_${eventId}`, id, createdAt);

  db.query(
    `INSERT OR IGNORE INTO mem_observations (id, event_id, platform, project, session_id, title, content, content_redacted, observation_type, memory_type, tags_json, privacy_tags_json, signal_score, created_at, updated_at)
     VALUES (?, ?, 'claude', ?, ?, 'Test', 'Test content', 'Test content', ?, ?, '[]', '[]', 0, ?, ?)`
  ).run(id, eventId, project, sessionId, observationType, memoryType, createdAt, createdAt);

  return id;
}

/** エンティティを挿入して observation_id に紐付ける */
function insertEntity(
  db: Database,
  observationId: string,
  name: string,
  entityType = "person"
): void {
  const createdAt = new Date().toISOString();
  db.query(
    `INSERT OR IGNORE INTO mem_entities (name, entity_type, created_at) VALUES (?, ?, ?)`
  ).run(name, entityType, createdAt);

  const row = db.query(
    `SELECT id FROM mem_entities WHERE name = ? AND entity_type = ?`
  ).get(name, entityType) as { id: number } | undefined;
  if (!row) return;

  db.query(
    `INSERT OR IGNORE INTO mem_observation_entities (observation_id, entity_id, created_at) VALUES (?, ?, ?)`
  ).run(observationId, row.id, createdAt);
}

// ---------------------------------------------------------------------------
// 1. getUsageStats — 日付範囲で正しく集計
// ---------------------------------------------------------------------------

describe("getUsageStats", () => {
  test("日付範囲内の観察・イベント数を正しく集計する", async () => {
    const { svc, db } = makeService();

    insertObservation(db, { created_at: "2026-01-10T10:00:00.000Z" });
    insertObservation(db, { created_at: "2026-01-10T11:00:00.000Z" });
    insertObservation(db, { created_at: "2026-01-11T09:00:00.000Z" });

    const result = await svc.getUsageStats({
      period: "day",
      from: "2026-01-10T00:00:00.000Z",
      to: "2026-01-11T23:59:59.999Z",
    });

    expect(result.period).toBe("day");
    expect(result.rows.length).toBeGreaterThanOrEqual(2);

    const jan10 = result.rows.find((r) => r.date === "2026-01-10");
    expect(jan10).toBeDefined();
    expect(jan10!.observation_count).toBe(2);
    expect(jan10!.event_count).toBe(2);

    const jan11 = result.rows.find((r) => r.date === "2026-01-11");
    expect(jan11).toBeDefined();
    expect(jan11!.observation_count).toBe(1);
  });

  test("period=month で月単位に集計する", async () => {
    const { svc, db } = makeService();

    insertObservation(db, { created_at: "2026-01-05T00:00:00.000Z" });
    insertObservation(db, { created_at: "2026-02-15T00:00:00.000Z" });

    const result = await svc.getUsageStats({ period: "month" });

    const jan = result.rows.find((r) => r.date === "2026-01");
    const feb = result.rows.find((r) => r.date === "2026-02");
    expect(jan).toBeDefined();
    expect(feb).toBeDefined();
    expect(result.period).toBe("month");
  });

  test("project フィルタで特定プロジェクトのみ集計する", async () => {
    const { svc, db } = makeService();

    insertObservation(db, { project: "proj-a", session_id: "s1", created_at: "2026-03-01T00:00:00.000Z" });
    insertObservation(db, { project: "proj-b", session_id: "s2", created_at: "2026-03-01T00:00:00.000Z" });

    const result = await svc.getUsageStats({ project: "proj-a" });

    // proj-a の observations のみ
    const total = result.rows.reduce((s, r) => s + r.observation_count, 0);
    expect(total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. getEntityDistribution — エンティティ出現頻度順
// ---------------------------------------------------------------------------

describe("getEntityDistribution", () => {
  test("エンティティを出現回数の降順で返す", async () => {
    const { svc, db } = makeService();

    const obs1 = insertObservation(db, { id: "obs-e1" });
    const obs2 = insertObservation(db, { id: "obs-e2" });
    const obs3 = insertObservation(db, { id: "obs-e3" });

    // Alice が 3 回、Bob が 1 回
    insertEntity(db, obs1, "Alice", "person");
    insertEntity(db, obs2, "Alice", "person");
    insertEntity(db, obs3, "Alice", "person");
    insertEntity(db, obs1, "Bob", "person");

    const result = await svc.getEntityDistribution({ limit: 10 });

    expect(result[0].name).toBe("Alice");
    expect(result[0].occurrence_count).toBe(3);
    expect(result[1].name).toBe("Bob");
    expect(result[1].occurrence_count).toBe(1);
  });

  test("entity_type フィルタで指定タイプのみ返す", async () => {
    const { svc, db } = makeService();

    const obs1 = insertObservation(db, { id: "obs-et1" });
    const obs2 = insertObservation(db, { id: "obs-et2" });

    insertEntity(db, obs1, "Tokyo", "location");
    insertEntity(db, obs2, "Alice", "person");

    const result = await svc.getEntityDistribution({ entity_type: "location" });

    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Tokyo");
  });

  test("limit が機能する", async () => {
    const { svc, db } = makeService();

    for (let i = 0; i < 5; i++) {
      const obs = insertObservation(db, { id: `obs-lim${i}` });
      insertEntity(db, obs, `Entity${i}`, "thing");
    }

    const result = await svc.getEntityDistribution({ limit: 3 });
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 3. getTimelineStats — 時間帯分布
// ---------------------------------------------------------------------------

describe("getTimelineStats", () => {
  test("時間帯別のアクティビティ分布を返す", async () => {
    const { svc, db } = makeService();

    // 10時に2件、14時に1件
    insertObservation(db, { id: "obs-t1", created_at: "2026-03-01T10:00:00.000Z" });
    insertObservation(db, { id: "obs-t2", created_at: "2026-03-01T10:30:00.000Z" });
    insertObservation(db, { id: "obs-t3", created_at: "2026-03-01T14:00:00.000Z" });

    const result = await svc.getTimelineStats({});

    const bucket10 = result.buckets.find((b) => b.hour === 10);
    expect(bucket10).toBeDefined();
    expect(bucket10!.observation_count).toBe(2);

    const bucket14 = result.buckets.find((b) => b.hour === 14);
    expect(bucket14).toBeDefined();
    expect(bucket14!.observation_count).toBe(1);
  });

  test("from/to フィルタが機能する", async () => {
    const { svc, db } = makeService();

    insertObservation(db, { id: "obs-tf1", created_at: "2026-01-01T10:00:00.000Z" });
    insertObservation(db, { id: "obs-tf2", created_at: "2026-06-01T10:00:00.000Z" });

    const result = await svc.getTimelineStats({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-03-01T00:00:00.000Z",
    });

    // 期間内は1件のみ
    const total = result.buckets.reduce((s, b) => s + b.observation_count, 0);
    expect(total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. getOverview — 全体概要の正確性
// ---------------------------------------------------------------------------

describe("getOverview", () => {
  test("total_observations / total_sessions / total_entities を正しく返す", async () => {
    const { svc, db } = makeService();

    const obs1 = insertObservation(db, { id: "obs-ov1", session_id: "sess-ov-a" });
    const obs2 = insertObservation(db, { id: "obs-ov2", session_id: "sess-ov-b" });
    insertEntity(db, obs1, "Alice", "person");
    insertEntity(db, obs2, "Bob", "person");

    const result = await svc.getOverview({});

    expect(result.total_observations).toBeGreaterThanOrEqual(2);
    expect(result.total_sessions).toBeGreaterThanOrEqual(2);
    expect(result.total_entities).toBeGreaterThanOrEqual(2);
  });

  test("memory_type_distribution を返す", async () => {
    const { svc, db } = makeService();

    insertObservation(db, { memory_type: "episodic", id: "obs-mt1" });
    insertObservation(db, { memory_type: "semantic", id: "obs-mt2" });
    insertObservation(db, { memory_type: "semantic", id: "obs-mt3" });

    const result = await svc.getOverview({});

    const dist = result.memory_type_distribution;
    expect(dist.length).toBeGreaterThanOrEqual(1);

    const semantic = dist.find((d) => d.memory_type === "semantic");
    expect(semantic).toBeDefined();
    expect(semantic!.count).toBeGreaterThanOrEqual(2);
  });

  test("recent_activity に最大7件の日次データが含まれる", async () => {
    const { svc, db } = makeService();

    for (let i = 0; i < 10; i++) {
      const date = `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`;
      insertObservation(db, { id: `obs-ra${i}`, created_at: date });
    }

    const result = await svc.getOverview({});
    expect(result.recent_activity.length).toBeLessThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------
// 5. 空データのエッジケース
// ---------------------------------------------------------------------------

describe("空データのエッジケース", () => {
  test("getUsageStats: データがないとき空の rows を返す", async () => {
    const { svc } = makeService();
    const result = await svc.getUsageStats({});
    expect(result.rows).toEqual([]);
  });

  test("getEntityDistribution: データがないとき空配列を返す", async () => {
    const { svc } = makeService();
    const result = await svc.getEntityDistribution({});
    expect(result).toEqual([]);
  });

  test("getTimelineStats: データがないとき空の buckets を返す", async () => {
    const { svc } = makeService();
    const result = await svc.getTimelineStats({});
    expect(result.buckets).toEqual([]);
  });

  test("getOverview: データがないとき 0 を返す", async () => {
    const { svc } = makeService();
    const result = await svc.getOverview({});
    expect(result.total_observations).toBe(0);
    expect(result.total_sessions).toBe(0);
    expect(result.total_entities).toBe(0);
    expect(result.memory_type_distribution).toEqual([]);
    expect(result.observation_type_distribution).toEqual([]);
    expect(result.recent_activity).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. project フィルタ（cross-project 隔離確認）
// ---------------------------------------------------------------------------

describe("project フィルタ", () => {
  test("getOverview: project を指定すると他プロジェクトのデータを含まない", async () => {
    const { svc, db } = makeService();

    insertObservation(db, { project: "proj-x", session_id: "sx1", id: "obs-px1" });
    insertObservation(db, { project: "proj-y", session_id: "sy1", id: "obs-py1" });
    insertObservation(db, { project: "proj-y", session_id: "sy1", id: "obs-py2" });

    const result = await svc.getOverview({ project: "proj-x" });

    expect(result.total_observations).toBe(1);
  });

  test("getEntityDistribution: project フィルタで他プロジェクトのエンティティを除外する", async () => {
    const { svc, db } = makeService();

    const obsA = insertObservation(db, { project: "proj-a", session_id: "sa1", id: "obs-ea1" });
    const obsB = insertObservation(db, { project: "proj-b", session_id: "sb1", id: "obs-eb1" });

    insertEntity(db, obsA, "Alpha", "concept");
    insertEntity(db, obsB, "Beta", "concept");

    const result = await svc.getEntityDistribution({ project: "proj-a" });

    const names = result.map((r) => r.name);
    expect(names).toContain("Alpha");
    expect(names).not.toContain("Beta");
  });
});
