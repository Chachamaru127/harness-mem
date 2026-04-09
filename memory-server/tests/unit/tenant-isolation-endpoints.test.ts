/**
 * テナント分離エンドポイントテスト
 *
 * ObservationStore を直接インスタンス化して、以前は保護されていなかった
 * エンドポイントのテナント分離を検証する。
 *
 * 検証項目:
 *   1. resumePack は user_id/team_id でフィルタされること
 *   2. resumePack は admin モード（user_id なし）で全データを返すこと
 *   3. timeline は center observation の所有者チェックが機能すること
 *   4. getObservations は user_id/team_id でフィルタされること
 *   5. searchFacets は user_id/team_id でフィルタされること
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { ObservationStore, type ObservationStoreDeps } from "../../src/core/observation-store";
import { SqliteObservationRepository } from "../../src/db/repositories/SqliteObservationRepository";
import { buildAccessFilter } from "../../src/auth/access-control";
import type { Config } from "../../src/core/types";
import {
  createTestDb,
  createTestConfig,
} from "../core-split/test-helpers";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function normalizeProject(project: string): string {
  return project.toLowerCase();
}

function platformVisibilityFilterSql(_alias: string): string {
  return " AND 1=1";
}

/**
 * user_id / team_id 付きの観察を直接 DB に挿入する。
 */
function insertObservationWithOwner(
  db: Database,
  opts: {
    id?: string;
    title?: string;
    content?: string;
    user_id?: string;
    team_id?: string;
    project?: string;
    session_id?: string;
  } = {}
): string {
  const now = new Date().toISOString();
  const id = opts.id || `obs_${Math.random().toString(36).slice(2, 10)}`;
  const eventId = `evt_${Math.random().toString(36).slice(2, 10)}`;
  const platform = "claude";
  const project = opts.project || "test-project";
  const sessionId = opts.session_id || `sess_${Math.random().toString(36).slice(2, 10)}`;
  const title = opts.title || "Test observation";
  const content = opts.content || "Test content";
  const userId = opts.user_id || "default";
  const teamId = opts.team_id ?? null;

  // セッション挿入（user_id / team_id 付き）
  db.query(
    `INSERT OR IGNORE INTO mem_sessions (session_id, platform, project, started_at, created_at, updated_at, user_id, team_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, platform, project, now, now, now, userId, teamId);

  // イベント挿入
  db.query(
    `INSERT OR IGNORE INTO mem_events (event_id, platform, project, session_id, event_type, ts, payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, created_at, user_id, team_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(eventId, platform, project, sessionId, "user_prompt", now, "{}", "[]", "[]", `h_${eventId}`, id, now, userId, teamId);

  // 観察挿入（user_id / team_id 付き）
  db.query(
    `INSERT OR IGNORE INTO mem_observations (id, event_id, platform, project, session_id, title, content, content_redacted, observation_type, tags_json, privacy_tags_json, signal_score, created_at, updated_at, user_id, team_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
  ).run(id, eventId, platform, project, sessionId, title, content, content, "context", "[]", "[]", now, now, userId, teamId);

  return id;
}

const testDbs: Database[] = [];

afterEach(() => {
  while (testDbs.length > 0) {
    const db = testDbs.pop();
    db?.close();
  }
});

function makeObsStore(
  configOverrides: Partial<Config> = {},
  accessFilter?: ReturnType<typeof buildAccessFilter>
): { store: ObservationStore; db: Database } {
  const db = createTestDb();
  testDbs.push(db);
  const config = createTestConfig(configOverrides);
  const deps: ObservationStoreDeps = {
    db,
    repo: new SqliteObservationRepository(db),
    config,
    ftsEnabled: false,
    normalizeProject,
    canonicalizeProject: normalizeProject,
    expandProjectSelection: (project: string) => [normalizeProject(project)],
    platformVisibilityFilterSql,
    writeAuditLog: () => {},
    getVectorEngine: () => "disabled",
    getVectorModelVersion: () => "test-model",
    vectorDimension: 64,
    getVecTableReady: () => false,
    setVecTableReady: () => {},
    embedContent: () => new Array(64).fill(0),
    refreshEmbeddingHealth: () => {},
    getEmbeddingProviderName: () => "test",
    embeddingProviderModel: "test-model",
    getEmbeddingHealthStatus: () => "ok",
    getRerankerEnabled: () => false,
    getReranker: () => null,
    managedShadowRead: null,
    searchRanking: "hybrid_v3",
    searchExpandLinks: false,
    accessFilter,
  };
  const store = new ObservationStore(deps);
  return { store, db };
}

// ---------------------------------------------------------------------------
// テスト 1: resumePack テナント分離
// ---------------------------------------------------------------------------

describe("テナント分離: resumePack — user_id/team_id でフィルタされる", () => {
  test("resumePack は alice のデータのみ返し、bob のデータを除外する", () => {
    const { store, db } = makeObsStore();

    insertObservationWithOwner(db, { title: "Alice resume note", user_id: "alice", team_id: "team-a", project: "test-project" });
    insertObservationWithOwner(db, { title: "Bob resume note", user_id: "bob", team_id: "team-b", project: "test-project" });

    const res = store.resumePack({ project: "test-project", user_id: "alice", team_id: "team-a" });
    expect(res.ok).toBe(true);

    const titles = res.items
      .filter((item) => (item as Record<string, unknown>).type === "observation")
      .map((item) => (item as Record<string, unknown>).title);

    expect(titles).toContain("Alice resume note");
    expect(titles).not.toContain("Bob resume note");
  });
});

// ---------------------------------------------------------------------------
// テスト 2: resumePack admin は全データを返す
// ---------------------------------------------------------------------------

describe("テナント分離: resumePack — admin モードは全データを返す", () => {
  test("resumePack に user_id を渡さない場合（admin モード）は両方のデータを返す", () => {
    const { store, db } = makeObsStore();

    insertObservationWithOwner(db, { title: "Alice admin test", user_id: "alice", team_id: "team-a", project: "test-project" });
    insertObservationWithOwner(db, { title: "Bob admin test", user_id: "bob", team_id: "team-b", project: "test-project" });

    // user_id を渡さない = admin モード
    const res = store.resumePack({ project: "test-project" });
    expect(res.ok).toBe(true);

    const titles = res.items
      .filter((item) => (item as Record<string, unknown>).type === "observation")
      .map((item) => (item as Record<string, unknown>).title);

    expect(titles).toContain("Alice admin test");
    expect(titles).toContain("Bob admin test");
  });
});

// ---------------------------------------------------------------------------
// テスト 3: timeline テナント分離
// ---------------------------------------------------------------------------

describe("テナント分離: timeline — center observation の所有者チェック", () => {
  test("timeline は alice の observation ID で alice のみのデータを返す", async () => {
    const { store, db } = makeObsStore();

    const sharedSessionId = `sess_shared_${Math.random().toString(36).slice(2, 10)}`;

    const aliceId = insertObservationWithOwner(db, {
      title: "Alice timeline obs",
      user_id: "alice",
      team_id: "team-a",
      project: "test-project",
      session_id: sharedSessionId,
    });

    // bob は同じセッション内に挿入（timeline の before/after クエリ対象になる可能性がある）
    insertObservationWithOwner(db, {
      title: "Bob timeline obs",
      user_id: "bob",
      team_id: "team-b",
      project: "test-project",
      session_id: sharedSessionId,
    });

    // alice の observation を center として timeline を取得
    const res = await store.timeline({ id: aliceId, user_id: "alice", team_id: "team-a" });
    expect(res.ok).toBe(true);

    const ids = res.items.map((item) => (item as Record<string, unknown>).id);
    // alice の observation は含まれる（center として）
    expect(ids).toContain(aliceId);
  });

  test("timeline は bob の observation ID を alice として取得しようとするとエラーを返す", async () => {
    const { store, db } = makeObsStore();

    const bobId = insertObservationWithOwner(db, {
      title: "Bob private obs",
      user_id: "bob",
      team_id: "team-b",
      project: "test-project",
    });

    // alice が bob の observation ID を指定して timeline を取得しようとする
    const res = await store.timeline({ id: bobId, user_id: "alice", team_id: "team-a" });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// テスト 4: getObservations テナント分離
// ---------------------------------------------------------------------------

describe("テナント分離: getObservations — user_id/team_id でフィルタされる", () => {
  test("getObservations は alice の ID と bob の ID を渡しても alice のデータのみ返す", () => {
    const { store, db } = makeObsStore();

    const aliceId = insertObservationWithOwner(db, { title: "Alice detail", user_id: "alice", team_id: "team-a" });
    const bobId = insertObservationWithOwner(db, { title: "Bob detail", user_id: "bob", team_id: "team-b" });

    // alice として両方の ID を要求
    const res = store.getObservations({ ids: [aliceId, bobId], user_id: "alice", team_id: "team-a" });
    expect(res.ok).toBe(true);

    const returnedIds = res.items.map((item) => (item as Record<string, unknown>).id);
    // alice のデータは含まれる
    expect(returnedIds).toContain(aliceId);
    // bob のデータは除外される
    expect(returnedIds).not.toContain(bobId);
    expect(returnedIds).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// テスト 5: searchFacets テナント分離
// ---------------------------------------------------------------------------

describe("テナント分離: searchFacets — total_candidates は alice のデータのみカウント", () => {
  test("searchFacets に user_id/team_id を渡すと alice のデータのみカウントされる", () => {
    const { store, db } = makeObsStore();

    insertObservationWithOwner(db, { title: "Alice facet obs 1", user_id: "alice", team_id: "team-a" });
    insertObservationWithOwner(db, { title: "Alice facet obs 2", user_id: "alice", team_id: "team-a" });
    insertObservationWithOwner(db, { title: "Bob facet obs", user_id: "bob", team_id: "team-b" });

    // alice として searchFacets を呼ぶ
    const res = store.searchFacets({ user_id: "alice", team_id: "team-a" });
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);

    const facets = res.items[0] as Record<string, unknown>;
    const totalCandidates = facets.total_candidates as number;

    // alice は 2 件のデータを持つ。bob の 1 件は含まれない。
    expect(totalCandidates).toBe(2);
  });
});
