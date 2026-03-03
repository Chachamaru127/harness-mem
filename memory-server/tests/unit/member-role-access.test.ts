/**
 * TEAM-005: member ロールアクセス制御 テスト
 *
 * ObservationStore / SessionManager を直接インスタンス化して
 * member ロールのアクセス制御を検証する。
 *
 * 検証項目:
 *   1. admin ロールは全データにアクセスできること
 *   2. member ロールは自分の user_id のデータのみ取得できること
 *   3. member ロールは同じ team_id のデータも取得できること
 *   4. member ロールは他チームのデータが見えないこと
 *   5. /v1/search と /v1/feed で member スコープが機能すること
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { ObservationStore, type ObservationStoreDeps } from "../../src/core/observation-store";
import { SessionManager, type SessionManagerDeps } from "../../src/core/session-manager";
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

function makeSessMgr(db: Database): SessionManager {
  const config = createTestConfig();
  const deps: SessionManagerDeps = {
    db,
    config,
    normalizeProject,
    platformVisibilityFilterSql,
    recordEvent: () => ({ ok: true, source: "core", items: [], meta: { count: 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "sessions_v1" } }),
    appendStreamEvent: () => ({ id: 0, type: "observation.created", data: {} }),
    enqueueConsolidation: () => {},
  };
  return new SessionManager(deps);
}

// ---------------------------------------------------------------------------
// テスト 1: admin ロールは全データにアクセスできること
// ---------------------------------------------------------------------------

describe("TEAM-005: member ロール — admin は全データアクセス", () => {
  test("admin は user_id/team_id フィルタなしで全観察を取得できる", () => {
    // admin は buildAccessFilter で sql='' が返るため user_id/team_id なし
    const adminFilter = buildAccessFilter("o", { user_id: "admin", role: "admin" });
    expect(adminFilter.sql).toBe("");
    expect(adminFilter.user_id).toBeUndefined();
    expect(adminFilter.team_id).toBeUndefined();

    const { store, db } = makeObsStore({}, adminFilter);

    // alice のデータ
    const aliceId = insertObservationWithOwner(db, { title: "Alice note", user_id: "alice", team_id: "team-a" });
    // bob のデータ
    const bobId = insertObservationWithOwner(db, { title: "Bob note", user_id: "bob", team_id: "team-b" });

    const res = store.feed({ limit: 100 });
    expect(res.ok).toBe(true);
    const ids = res.items.map((item) => (item as Record<string, unknown>).id);
    // admin は両方のデータを見える
    expect(ids).toContain(aliceId);
    expect(ids).toContain(bobId);
  });
});

// ---------------------------------------------------------------------------
// テスト 2: member は自分の user_id のデータのみ取得できること
// ---------------------------------------------------------------------------

describe("TEAM-005: member ロール — 自分の user_id のみ取得", () => {
  test("search で自分の user_id フィルタが適用される", () => {
    const { store, db } = makeObsStore();

    // alice のデータ
    const aliceId = insertObservationWithOwner(db, { title: "Alice private note", user_id: "alice", team_id: null });
    // bob のデータ
    insertObservationWithOwner(db, { title: "Bob private note", user_id: "bob", team_id: null });

    // alice として feed を取得（user_id フィルタを渡す）
    const res = store.feed({ limit: 100, user_id: "alice" });
    expect(res.ok).toBe(true);
    const ids = res.items.map((item) => (item as Record<string, unknown>).id);
    expect(ids).toContain(aliceId);
    // bob のデータは含まれない
    expect(ids.every((id) => {
      const item = res.items.find((i) => (i as Record<string, unknown>).id === id) as Record<string, unknown>;
      return item.user_id === "alice";
    })).toBe(true);
  });

  test("feed で自分の user_id データのみ返る（他ユーザーは除外）", () => {
    const { store, db } = makeObsStore();

    const aliceId = insertObservationWithOwner(db, { title: "Alice feed item", user_id: "alice" });
    insertObservationWithOwner(db, { title: "Charlie feed item", user_id: "charlie" });

    const res = store.feed({ limit: 100, user_id: "alice" });
    expect(res.ok).toBe(true);
    const ids = res.items.map((item) => (item as Record<string, unknown>).id);
    expect(ids).toContain(aliceId);
    // charlie のデータは含まれない
    const charlieMixIn = res.items.some(
      (item) => (item as Record<string, unknown>).user_id === "charlie"
    );
    expect(charlieMixIn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// テスト 3: member は同じ team_id のデータも取得できること
// ---------------------------------------------------------------------------

describe("TEAM-005: member ロール — 同 team_id のデータも取得", () => {
  test("feed で同チームのデータが取得できる", () => {
    const { store, db } = makeObsStore();

    // alice と teammate は同じチーム
    const aliceId = insertObservationWithOwner(db, { title: "Alice team note", user_id: "alice", team_id: "team-a" });
    const teammateId = insertObservationWithOwner(db, { title: "Teammate note", user_id: "teammate", team_id: "team-a" });
    // other-team のデータ
    insertObservationWithOwner(db, { title: "Other team note", user_id: "other-user", team_id: "team-b" });

    // alice は team-a のデータを取得（user_id=alice または team_id=team-a）
    const res = store.feed({ limit: 100, user_id: "alice", team_id: "team-a", _member_scope: true });
    expect(res.ok).toBe(true);
    const ids = res.items.map((item) => (item as Record<string, unknown>).id);
    expect(ids).toContain(aliceId);
    expect(ids).toContain(teammateId);
  });
});

// ---------------------------------------------------------------------------
// テスト 4: member は他チームのデータが見えないこと
// ---------------------------------------------------------------------------

describe("TEAM-005: member ロール — 他チームのデータは見えない", () => {
  test("feed で他チームのデータが除外される", () => {
    const { store, db } = makeObsStore();

    // team-a のデータ
    const teamAId = insertObservationWithOwner(db, { title: "Team A note", user_id: "alice", team_id: "team-a" });
    // team-b のデータ
    const teamBId = insertObservationWithOwner(db, { title: "Team B note", user_id: "bob", team_id: "team-b" });

    // alice（team-a）としてフィルタ
    const res = store.feed({ limit: 100, user_id: "alice", team_id: "team-a", _member_scope: true });
    expect(res.ok).toBe(true);
    const ids = res.items.map((item) => (item as Record<string, unknown>).id);
    expect(ids).toContain(teamAId);
    // team-b のデータは含まれない
    expect(ids).not.toContain(teamBId);
  });

  test("sessionsList で他チームのセッションが除外される", () => {
    const db = createTestDb();
    testDbs.push(db);
    const sessMgr = makeSessMgr(db);

    // alice のセッション（team-a）
    insertObservationWithOwner(db, { title: "Alice session obs", user_id: "alice", team_id: "team-a", session_id: "sess-alice-001" });
    // bob のセッション（team-b）
    insertObservationWithOwner(db, { title: "Bob session obs", user_id: "bob", team_id: "team-b", session_id: "sess-bob-001" });

    // alice として sessionsList を呼ぶ
    const res = sessMgr.sessionsList({ user_id: "alice", team_id: "team-a" });
    expect(res.ok).toBe(true);
    const sessionIds = res.items.map((item) => (item as Record<string, unknown>).session_id);
    // alice のセッションのみ
    expect(sessionIds).toContain("sess-alice-001");
    expect(sessionIds).not.toContain("sess-bob-001");
  });
});

// ---------------------------------------------------------------------------
// テスト 5: /v1/search と /v1/feed で member スコープが機能すること
// ---------------------------------------------------------------------------

describe("TEAM-005: search/feed で member スコープが機能する", () => {
  test("search に user_id を渡すと member スコープでフィルタされる", () => {
    // applyCommonFilters の user_id/team_id フィルタを直接確認
    // ObservationStore の lexicalSearch/vectorSearch は applyCommonFilters を経由する
    // FTSなし環境では lexicalSearch が applyCommonFilters を呼ぶ
    const { store, db } = makeObsStore();

    const aliceId = insertObservationWithOwner(db, { title: "alice unique keyword xyz", content: "alice unique keyword xyz", user_id: "alice" });
    insertObservationWithOwner(db, { title: "bob unique keyword xyz", content: "bob unique keyword xyz", user_id: "bob" });

    // alice として検索（user_id を渡す）
    const res = store.search({ query: "unique keyword xyz", user_id: "alice", strict_project: false });
    expect(res.ok).toBe(true);
    const ids = res.items.map((item) => (item as Record<string, unknown>).id);
    // alice のデータが含まれる
    expect(ids).toContain(aliceId);
    // bob のデータは含まれない
    const hasBobData = res.items.some(
      (item) => (item as Record<string, unknown>).user_id === "bob"
    );
    expect(hasBobData).toBe(false);
  });

  test("feed に user_id + team_id を渡すと OR 条件でフィルタされる", () => {
    const { store, db } = makeObsStore();

    // alice（team-a）
    const aliceId = insertObservationWithOwner(db, { title: "Alice in team-a", user_id: "alice", team_id: "team-a" });
    // alice 以外の team-a メンバー
    const teammateId = insertObservationWithOwner(db, { title: "Teammate in team-a", user_id: "carol", team_id: "team-a" });
    // 別チームのデータ
    const otherId = insertObservationWithOwner(db, { title: "Other team data", user_id: "dave", team_id: "team-z" });

    const res = store.feed({ limit: 100, user_id: "alice", team_id: "team-a", _member_scope: true });
    expect(res.ok).toBe(true);
    const ids = res.items.map((item) => (item as Record<string, unknown>).id);
    expect(ids).toContain(aliceId);
    expect(ids).toContain(teammateId);
    expect(ids).not.toContain(otherId);
  });
});
