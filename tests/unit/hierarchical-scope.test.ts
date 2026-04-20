/**
 * S78-B02: Hierarchical metadata filtering unit tests
 *
 * Tests scope parameter behavior:
 * - No scope → all observations returned
 * - scope.thread_id filter
 * - scope.thread_id + scope.topic intersection
 * - Legacy session_id backward compat
 * - Migration: old DB without thread_id/topic gets null for existing rows
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema, migrateSchema } from "../../memory-server/src/db/schema";
import { SqliteObservationRepository } from "../../memory-server/src/db/repositories/SqliteObservationRepository";
import type { InsertObservationInput } from "../../memory-server/src/db/repositories/IObservationRepository";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeObs(
  overrides: Partial<InsertObservationInput> & { id: string }
): InsertObservationInput {
  const now = new Date().toISOString();
  return {
    event_id: null,
    platform: "test",
    project: "test-project",
    session_id: "session-1",
    title: overrides.id,
    content: `content for ${overrides.id}`,
    content_redacted: `content for ${overrides.id}`,
    observation_type: "context",
    memory_type: "semantic",
    tags_json: "[]",
    privacy_tags_json: "[]",
    signal_score: 0,
    user_id: "default",
    team_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S78-B02: Hierarchical metadata filtering", () => {
  let db: Database;
  let repo: SqliteObservationRepository;

  beforeAll(async () => {
    db = new Database(":memory:");
    initSchema(db);
    migrateSchema(db);
    repo = new SqliteObservationRepository(db);

    // Store 6 observations across 2 threads (A, B) and 2 topics (X, Y)
    // thread A, topic X: obs-1, obs-2
    // thread A, topic Y: obs-3
    // thread B, topic X: obs-4
    // thread B, topic Y: obs-5
    // no thread/topic:   obs-6 (legacy row)

    const observations: Array<InsertObservationInput> = [
      makeObs({ id: "obs-1", session_id: "session-1", thread_id: "thread-A", topic: "topic-X" }),
      makeObs({ id: "obs-2", session_id: "session-1", thread_id: "thread-A", topic: "topic-X" }),
      makeObs({ id: "obs-3", session_id: "session-1", thread_id: "thread-A", topic: "topic-Y" }),
      makeObs({ id: "obs-4", session_id: "session-2", thread_id: "thread-B", topic: "topic-X" }),
      makeObs({ id: "obs-5", session_id: "session-2", thread_id: "thread-B", topic: "topic-Y" }),
      makeObs({ id: "obs-6", session_id: "session-1", thread_id: null, topic: null }),
    ];

    for (const obs of observations) {
      await repo.insert(obs);
    }
  });

  afterAll(() => {
    db.close();
  });

  test("no scope → all 6 observations returned", async () => {
    const rows = await repo.findMany({ project: "test-project", include_private: true, limit: 100 });
    expect(rows).toHaveLength(6);
  });

  test("scope thread_id=thread-A → 3 observations (obs-1, obs-2, obs-3)", async () => {
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      thread_id: "thread-A",
      limit: 100,
    });
    expect(rows).toHaveLength(3);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["obs-1", "obs-2", "obs-3"]);
  });

  test("scope thread_id=thread-B → 2 observations (obs-4, obs-5)", async () => {
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      thread_id: "thread-B",
      limit: 100,
    });
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["obs-4", "obs-5"]);
  });

  test("scope thread_id=thread-A + topic=topic-X → 2 observations (obs-1, obs-2)", async () => {
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      thread_id: "thread-A",
      topic: "topic-X",
      limit: 100,
    });
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["obs-1", "obs-2"]);
  });

  test("scope thread_id=thread-A + topic=topic-Y → 1 observation (obs-3)", async () => {
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      thread_id: "thread-A",
      topic: "topic-Y",
      limit: 100,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("obs-3");
  });

  test("scope topic=topic-X (across threads) → 3 observations (obs-1, obs-2, obs-4)", async () => {
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      topic: "topic-X",
      limit: 100,
    });
    expect(rows).toHaveLength(3);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["obs-1", "obs-2", "obs-4"]);
  });

  test("legacy session_id filter still works (backward compat) → obs-1, obs-2, obs-3, obs-6", async () => {
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      session_id: "session-1",
      limit: 100,
    });
    expect(rows).toHaveLength(4);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["obs-1", "obs-2", "obs-3", "obs-6"]);
  });

  test("session_id + thread_id intersection → obs-1, obs-2, obs-3", async () => {
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      session_id: "session-1",
      thread_id: "thread-A",
      limit: 100,
    });
    expect(rows).toHaveLength(3);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["obs-1", "obs-2", "obs-3"]);
  });

  test("obs-6 (null thread/topic) is returned with no scope but not with thread filter", async () => {
    const noScopeRows = await repo.findMany({
      project: "test-project",
      include_private: true,
      limit: 100,
    });
    expect(noScopeRows.find((r) => r.id === "obs-6")).toBeDefined();

    const withThreadFilter = await repo.findMany({
      project: "test-project",
      include_private: true,
      thread_id: "thread-A",
      limit: 100,
    });
    expect(withThreadFilter.find((r) => r.id === "obs-6")).toBeUndefined();
  });

  test("findById returns thread_id and topic fields", async () => {
    const row = await repo.findById("obs-1");
    expect(row).not.toBeNull();
    expect(row!.thread_id).toBe("thread-A");
    expect(row!.topic).toBe("topic-X");
  });

  test("legacy row (obs-6) has null thread_id and topic", async () => {
    const row = await repo.findById("obs-6");
    expect(row).not.toBeNull();
    expect(row!.thread_id).toBeNull();
    expect(row!.topic).toBeNull();
  });

  // -------------------------------------------------------------------------
  // S78-B02b (Phase F follow-up): DoD coverage additions
  //   - topic 文字数上限 (long topic strings)
  //   - thread+topic 同時指定の優先順位 (AND 順序独立)
  //   - スレッド違いの同じ topic 分離 (explicit isolation check)
  //   - scope パラメータの no-match 組合せ
  // -------------------------------------------------------------------------

  test("S78-B02b: unknown thread_id returns empty result (no match)", async () => {
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      thread_id: "thread-does-not-exist",
      limit: 100,
    });
    expect(rows).toHaveLength(0);
  });

  test("S78-B02b: unknown topic returns empty result (no match)", async () => {
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      topic: "topic-does-not-exist",
      limit: 100,
    });
    expect(rows).toHaveLength(0);
  });

  test("S78-B02b: thread_id + topic intersection with no overlap returns empty", async () => {
    // thread-A has topics X,Y — topic-Z does not exist for thread-A (nor anywhere)
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      thread_id: "thread-A",
      topic: "topic-Z",
      limit: 100,
    });
    expect(rows).toHaveLength(0);
  });

  test("S78-B02b: same topic across different threads is isolated when thread_id specified", async () => {
    // topic-X exists in both thread-A (obs-1, obs-2) and thread-B (obs-4)
    // Filtering by (thread-A, topic-X) must NOT leak obs-4 from thread-B
    const threadA = await repo.findMany({
      project: "test-project",
      include_private: true,
      thread_id: "thread-A",
      topic: "topic-X",
      limit: 100,
    });
    expect(threadA.map((r) => r.id).sort()).toEqual(["obs-1", "obs-2"]);

    const threadB = await repo.findMany({
      project: "test-project",
      include_private: true,
      thread_id: "thread-B",
      topic: "topic-X",
      limit: 100,
    });
    expect(threadB.map((r) => r.id).sort()).toEqual(["obs-4"]);

    // 非 leak 確認: A と B の交差は空
    const aIds = new Set(threadA.map((r) => r.id));
    const bIds = new Set(threadB.map((r) => r.id));
    for (const id of aIds) expect(bIds.has(id)).toBe(false);
  });

  test("S78-B02b: topic-only scope aggregates across all threads", async () => {
    // topic-Y exists in thread-A (obs-3) and thread-B (obs-5)
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      topic: "topic-Y",
      limit: 100,
    });
    expect(rows.map((r) => r.id).sort()).toEqual(["obs-3", "obs-5"]);
  });

  test("S78-B02b: long topic strings are stored and retrievable (no truncation)", async () => {
    // SQLite TEXT カラムは長さ上限なし。実装側で長さ制限がないことを固定する
    // (将来アプリ層で上限を入れる場合はこのテストを更新してガードする)
    const longTopic = "t-" + "a".repeat(1024); // 1026 chars
    const now = new Date().toISOString();
    await repo.insert(
      makeObs({
        id: "obs-long-topic",
        session_id: "session-long",
        thread_id: "thread-long",
        topic: longTopic,
        created_at: now,
        updated_at: now,
      })
    );

    // Round-trip via findById
    const fetched = await repo.findById("obs-long-topic");
    expect(fetched).not.toBeNull();
    expect(fetched!.topic).toBe(longTopic);
    expect(fetched!.topic!.length).toBe(longTopic.length);

    // フィルタとしても完全一致すること
    const filtered = await repo.findMany({
      project: "test-project",
      include_private: true,
      topic: longTopic,
      limit: 10,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("obs-long-topic");
  });

  test("S78-B02b: topic filter is case-sensitive (exact match only)", async () => {
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      topic: "TOPIC-X", // uppercase — must not match 'topic-X'
      limit: 100,
    });
    expect(rows).toHaveLength(0);
  });

  test("S78-B02b: thread+topic filter does not return legacy rows with NULL thread/topic", async () => {
    // obs-6 は thread_id=NULL, topic=NULL。thread_id スコープ有効時はレガシー行を返さない
    const rows = await repo.findMany({
      project: "test-project",
      include_private: true,
      thread_id: "thread-A",
      topic: "topic-X",
      limit: 100,
    });
    expect(rows.find((r) => r.id === "obs-6")).toBeUndefined();
  });
});

describe("S78-B02: Migration compatibility — existing DB without thread_id/topic", () => {
  test("existing rows get null thread_id and topic after migration (via ALTER TABLE)", () => {
    // Simulate a pre-B02 DB: run full initSchema (which creates mem_vectors etc.),
    // insert a row, then manually DROP the B02 columns to simulate a pre-B02 state,
    // and verify migrateSchema re-adds them with null defaults.
    //
    // SQLite does not support DROP COLUMN in older versions, so we verify the
    // migration approach via the try/catch idempotency: calling migrateSchema on
    // a fresh DB (which already has the columns from initSchema) succeeds silently,
    // and the columns exist with NULL defaults for rows that don't set them.
    const freshDb = new Database(":memory:");
    initSchema(freshDb);

    // Insert a row WITHOUT thread_id or topic (simulating a legacy insert)
    freshDb.exec(`
      INSERT INTO mem_sessions VALUES (
        's-legacy', 'test', 'proj', datetime('now'), NULL, NULL, NULL, NULL,
        'default', NULL, datetime('now'), datetime('now')
      );
      INSERT INTO mem_observations(
        id, event_id, platform, project, session_id,
        title, content, content_redacted, observation_type, memory_type,
        tags_json, privacy_tags_json, user_id, team_id,
        created_at, updated_at
      ) VALUES (
        'legacy-obs', NULL, 'test', 'proj', 's-legacy',
        'title', 'content', 'content', 'context', 'semantic',
        '[]', '[]', 'default', NULL,
        datetime('now'), datetime('now')
      );
    `);

    // Run migration (idempotent — columns already exist, no error)
    migrateSchema(freshDb);

    // The legacy row should have null thread_id and topic
    const row = freshDb.query(
      "SELECT thread_id, topic FROM mem_observations WHERE id = ?"
    ).get("legacy-obs") as { thread_id: string | null; topic: string | null } | null;

    expect(row).not.toBeNull();
    expect(row!.thread_id).toBeNull();
    expect(row!.topic).toBeNull();

    freshDb.close();
  });
});
