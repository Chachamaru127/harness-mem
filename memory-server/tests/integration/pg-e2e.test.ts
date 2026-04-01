/**
 * pg-e2e.test.ts
 *
 * Pg*Repository 3クラスの E2E 統合テスト。
 * 実際の PostgreSQL + pgvector サーバーが必要。
 *
 * 実行条件:
 *   POSTGRES_URL 環境変数が設定されている場合のみ実行。
 *   未設定の場合は全テストを skip して 0 fail で完了する。
 *
 * CI: .github/workflows/pgvector-integration.yml 参照
 *     POSTGRES_URL=postgres://harness:test@localhost:5433/harness_test
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { POSTGRES_INIT_SQL } from "../../src/db/postgres-schema.js";
import { PostgresStorageAdapter } from "../../src/db/postgres-adapter.js";
import { PgObservationRepository } from "../../src/db/repositories/PgObservationRepository.js";
import { PgSessionRepository } from "../../src/db/repositories/PgSessionRepository.js";
import { PgVectorRepository } from "../../src/db/repositories/PgVectorRepository.js";

// ---------------------------------------------------------------------------
// 接続可否の判定
// ---------------------------------------------------------------------------

const HAS_POSTGRES = !!process.env.POSTGRES_URL;

// ---------------------------------------------------------------------------
// ヘルパー: pg クライアントの接続/切断
// ---------------------------------------------------------------------------

async function connect(): Promise<import("pg").Client> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.POSTGRES_URL });
  await client.connect();
  return client;
}

/** テーブルの全行を削除してクリーンな状態にする（依存順序に注意）*/
async function cleanupTables(pgClient: import("pg").Client): Promise<void> {
  // FK 依存順（参照される側から最後に削除）
  await pgClient.query("DELETE FROM mem_vectors");
  await pgClient.query("DELETE FROM mem_observations");
  await pgClient.query("DELETE FROM mem_events");
  await pgClient.query("DELETE FROM mem_sessions");
}

// ---------------------------------------------------------------------------
// テスト用ファクスデータ生成
// ---------------------------------------------------------------------------

function makeSessionId(suffix: string): string {
  return `e2e-session-${suffix}-${Date.now()}`;
}

function makeObsId(suffix: string): string {
  return `e2e-obs-${suffix}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// テスト本体
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_POSTGRES)("PG E2E: Pg*Repository 統合テスト", () => {
  let pgClient: import("pg").Client;
  let adapter: PostgresStorageAdapter;
  let obsRepo: PgObservationRepository;
  let sessionRepo: PgSessionRepository;
  let vectorRepo: PgVectorRepository;

  const VECTOR_DIM = 3;
  const now = new Date().toISOString();

  // -------------------------------------------------------------------------
  // Setup / Teardown
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    pgClient = await connect();
    // スキーマ初期化
    await pgClient.query(POSTGRES_INIT_SQL);

    adapter = new PostgresStorageAdapter(pgClient);
    obsRepo = new PgObservationRepository(adapter);
    sessionRepo = new PgSessionRepository(adapter);
    vectorRepo = new PgVectorRepository(pgClient, VECTOR_DIM);

    // テスト前にクリーンアップ
    await cleanupTables(pgClient);
  });

  afterAll(async () => {
    // テスト後にクリーンアップしてから切断
    await cleanupTables(pgClient);
    await pgClient.end();
  });

  // =========================================================================
  // テスト 1: POSTGRES_INIT_SQL でスキーマ初期化が正常に完了する
  // =========================================================================

  test("テスト1: POSTGRES_INIT_SQL でスキーマ初期化が正常に完了する", async () => {
    // べき等であることも確認（2回実行してもエラーなし）
    await expect(pgClient.query(POSTGRES_INIT_SQL)).resolves.toBeDefined();

    // 主要テーブルが存在することを確認
    const result = await pgClient.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename IN ('mem_sessions','mem_observations','mem_vectors','mem_events')
       ORDER BY tablename`
    );
    const tableNames = result.rows.map((r) => r.tablename).sort();
    expect(tableNames).toContain("mem_observations");
    expect(tableNames).toContain("mem_sessions");
    expect(tableNames).toContain("mem_vectors");
    expect(tableNames).toContain("mem_events");

    // vector 拡張が有効であることを確認
    const extResult = await pgClient.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'"
    );
    expect(extResult.rows).toHaveLength(1);
    expect(extResult.rows[0]!.extname).toBe("vector");
  });

  // =========================================================================
  // テスト 2: Observation の記録→検索の往復テスト
  // =========================================================================

  test("テスト2: Observation の記録→検索の往復テスト", async () => {
    // 事前にセッションを作成（obs は session_id FK あり）
    const sessionId = makeSessionId("obs");
    await sessionRepo.upsert({
      session_id: sessionId,
      platform: "claude",
      project: "e2e-test",
      started_at: now,
      created_at: now,
      updated_at: now,
    });

    const obsId = makeObsId("basic");
    // 記録
    const returnedId = await obsRepo.insert({
      id: obsId,
      event_id: null,
      platform: "claude",
      project: "e2e-test",
      session_id: sessionId,
      title: "E2E テスト観察",
      content: "これは E2E テスト用の観察データです",
      content_redacted: "これは E2E テスト用の観察データです",
      observation_type: "context",
      memory_type: "semantic",
      tags_json: '["e2e","test"]',
      privacy_tags_json: "[]",
      signal_score: 0.8,
      user_id: "test-user",
      created_at: now,
      updated_at: now,
    });
    expect(returnedId).toBe(obsId);

    // findById で取得
    const found = await obsRepo.findById(obsId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(obsId);
    expect(found!.title).toBe("E2E テスト観察");
    expect(found!.project).toBe("e2e-test");
    expect(found!.platform).toBe("claude");
    expect(found!.content).toBe("これは E2E テスト用の観察データです");
    expect(found!.signal_score).toBeCloseTo(0.8, 3);
    expect(found!.user_id).toBe("test-user");

    // findMany でフィルタ検索
    const list = await obsRepo.findMany({ project: "e2e-test" });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const match = list.find((o) => o.id === obsId);
    expect(match).toBeDefined();
    expect(match!.title).toBe("E2E テスト観察");

    // count で件数確認
    const cnt = await obsRepo.count({ project: "e2e-test" });
    expect(cnt).toBeGreaterThanOrEqual(1);

    // delete して findById が null を返すことを確認
    await obsRepo.delete(obsId);
    const afterDelete = await obsRepo.findById(obsId);
    expect(afterDelete).toBeNull();
  });

  // =========================================================================
  // テスト 3: セッション作成→一覧→ファイナライズの往復テスト
  // =========================================================================

  test("テスト3: セッション作成→一覧→ファイナライズの往復テスト", async () => {
    const sessionId = makeSessionId("session-crud");
    const correlationId = `corr-${Date.now()}`;

    // upsert でセッションを作成
    await sessionRepo.upsert({
      session_id: sessionId,
      platform: "claude",
      project: "e2e-session-project",
      started_at: now,
      correlation_id: correlationId,
      user_id: "session-test-user",
      created_at: now,
      updated_at: now,
    });

    // findById で取得
    const found = await sessionRepo.findById(sessionId);
    expect(found).not.toBeNull();
    expect(found!.session_id).toBe(sessionId);
    expect(found!.platform).toBe("claude");
    expect(found!.project).toBe("e2e-session-project");
    expect(found!.ended_at).toBeNull();
    expect(found!.summary).toBeNull();
    expect(found!.correlation_id).toBe(correlationId);

    // findMany でプロジェクト絞り込み一覧
    const list = await sessionRepo.findMany({ project: "e2e-session-project" });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const match = list.find((s) => s.session_id === sessionId);
    expect(match).toBeDefined();

    // findByCorrelationId で確認
    const byCorrId = await sessionRepo.findByCorrelationId(correlationId, "e2e-session-project");
    expect(byCorrId.length).toBeGreaterThanOrEqual(1);
    expect(byCorrId[0]!.session_id).toBe(sessionId);

    // count で件数確認
    const cnt = await sessionRepo.count();
    expect(cnt).toBeGreaterThanOrEqual(1);

    // ファイナライズ
    const endedAt = new Date().toISOString();
    await sessionRepo.finalize({
      session_id: sessionId,
      ended_at: endedAt,
      summary: "E2E テストセッションのサマリー",
      summary_mode: "auto",
      updated_at: endedAt,
    });

    // ファイナライズ後に ended_at / summary が設定される
    const finalized = await sessionRepo.findById(sessionId);
    expect(finalized).not.toBeNull();
    expect(finalized!.ended_at).not.toBeNull();
    expect(finalized!.summary).toBe("E2E テストセッションのサマリー");
    expect(finalized!.summary_mode).toBe("auto");
  });

  // =========================================================================
  // テスト 4: ベクトル upsert→検索の往復テスト
  // =========================================================================

  test("テスト4: ベクトル upsert→検索の往復テスト", async () => {
    // セッション + 観察を先に作成（mem_vectors は observation_id FK がないが、
    // 実運用での一貫性確認のため観察も挿入する）
    const sessionId = makeSessionId("vec");
    await sessionRepo.upsert({
      session_id: sessionId,
      platform: "claude",
      project: "e2e-vec-project",
      started_at: now,
      created_at: now,
      updated_at: now,
    });

    const obs1Id = makeObsId("vec1");
    const obs2Id = makeObsId("vec2");

    await obsRepo.insert({
      id: obs1Id,
      event_id: null,
      platform: "claude",
      project: "e2e-vec-project",
      session_id: sessionId,
      title: null,
      content: "ベクトル観察1",
      content_redacted: "ベクトル観察1",
      observation_type: "context",
      memory_type: "semantic",
      tags_json: "[]",
      privacy_tags_json: "[]",
      created_at: now,
      updated_at: now,
    });

    await obsRepo.insert({
      id: obs2Id,
      event_id: null,
      platform: "claude",
      project: "e2e-vec-project",
      session_id: sessionId,
      title: null,
      content: "ベクトル観察2",
      content_redacted: "ベクトル観察2",
      observation_type: "context",
      memory_type: "semantic",
      tags_json: "[]",
      privacy_tags_json: "[]",
      created_at: now,
      updated_at: now,
    });

    // ベクトル1: [1, 0, 0]
    await vectorRepo.upsert({
      observation_id: obs1Id,
      model: "text-embedding-3",
      dimension: VECTOR_DIM,
      vector_json: "[1,0,0]",
      created_at: now,
      updated_at: now,
    });

    // ベクトル2: [0, 1, 0]（クエリベクトルとほぼ直交）
    await vectorRepo.upsert({
      observation_id: obs2Id,
      model: "text-embedding-3",
      dimension: VECTOR_DIM,
      vector_json: "[0,1,0]",
      created_at: now,
      updated_at: now,
    });

    // findByObservationId / findAllByObservationId で確認
    const vec1 = await vectorRepo.findByObservationId(obs1Id);
    expect(vec1).not.toBeNull();
    expect(vec1!.observation_id).toBe(obs1Id);
    expect(vec1!.model).toBe("text-embedding-3");
    expect(vec1!.dimension).toBe(VECTOR_DIM);

    const vec1All = await vectorRepo.findAllByObservationId(obs1Id);
    expect(vec1All).toHaveLength(1);
    expect(vec1All[0]!.model).toBe("text-embedding-3");

    // findByObservationIds で複数取得
    const vecs = await vectorRepo.findByObservationIds([obs1Id, obs2Id]);
    expect(vecs.length).toBe(2);

    const vecByModel = await vectorRepo.findByObservationIdAndModel(obs1Id, "text-embedding-3");
    expect(vecByModel).not.toBeNull();
    expect(vecByModel!.observation_id).toBe(obs1Id);

    // pgvectorSearchAsync: [1,0,0] に最も近いのは obs1Id
    const searchResults = await vectorRepo.pgvectorSearchAsync([1, 0, 0], 10, "text-embedding-3");
    expect(searchResults.length).toBeGreaterThanOrEqual(2);
    const nearestId = searchResults[0]!.observationId;
    expect(nearestId).toBe(obs1Id);
    // コサイン距離 ≈ 0（完全一致）
    expect(searchResults[0]!.distance).toBeCloseTo(0, 3);

    // coverage でカバレッジ確認
    const cov = await vectorRepo.coverage("text-embedding-3");
    expect(cov.total).toBeGreaterThanOrEqual(2);
    expect(cov.current_model_count).toBeGreaterThanOrEqual(2);

    // upsert（更新）: obs1 のベクトルを [0.9, 0.1, 0] に更新
    await vectorRepo.upsert({
      observation_id: obs1Id,
      model: "text-embedding-3",
      dimension: VECTOR_DIM,
      vector_json: "[0.9,0.1,0]",
      created_at: now,
      updated_at: new Date().toISOString(),
    });
    const updated = await vectorRepo.findByObservationId(obs1Id);
    expect(updated).not.toBeNull();
    // 更新後のベクトルが格納されている（pgvector は "[0.9,0.1,0]" 形式で返す）
    expect(updated!.vector_json).toContain("0.9");

    // delete でベクトル削除
    await vectorRepo.delete(obs1Id);
    const afterDelete = await vectorRepo.findByObservationId(obs1Id);
    expect(afterDelete).toBeNull();
  });

  // =========================================================================
  // テスト 5: 全操作を通した E2E フロー（記録→検索→セッション→チェックポイント）
  // =========================================================================

  test("テスト5: 全操作を通した E2E フロー（記録→検索→セッション→チェックポイント）", async () => {
    const sessionId = makeSessionId("full-e2e");
    const obs1Id = makeObsId("full-e2e-a");
    const obs2Id = makeObsId("full-e2e-b");
    const obs3Id = makeObsId("full-e2e-c");

    // Step 1: セッション作成
    await sessionRepo.upsert({
      session_id: sessionId,
      platform: "claude",
      project: "e2e-full-project",
      started_at: now,
      correlation_id: "corr-full-e2e",
      user_id: "e2e-user",
      created_at: now,
      updated_at: now,
    });

    const session = await sessionRepo.findById(sessionId);
    expect(session).not.toBeNull();
    expect(session!.session_id).toBe(sessionId);

    // Step 2: 複数の Observation を記録
    const observations = [
      {
        id: obs1Id,
        content: "TypeScript は型安全な言語です",
        signal_score: 0.9,
        vector: [1, 0, 0],
      },
      {
        id: obs2Id,
        content: "Bun はJavaScript ランタイムです",
        signal_score: 0.7,
        vector: [0, 1, 0],
      },
      {
        id: obs3Id,
        content: "PostgreSQL はリレーショナルデータベースです",
        signal_score: 0.8,
        vector: [0, 0, 1],
      },
    ];

    for (const obs of observations) {
      await obsRepo.insert({
        id: obs.id,
        event_id: null,
        platform: "claude",
        project: "e2e-full-project",
        session_id: sessionId,
        title: null,
        content: obs.content,
        content_redacted: obs.content,
        observation_type: "context",
        memory_type: "semantic",
        tags_json: '["e2e","full"]',
        privacy_tags_json: "[]",
        signal_score: obs.signal_score,
        user_id: "e2e-user",
        created_at: now,
        updated_at: now,
      });

      // Step 3: 各 Observation のベクトルを upsert
      await vectorRepo.upsert({
        observation_id: obs.id,
        model: "text-embedding-3",
        dimension: VECTOR_DIM,
        vector_json: JSON.stringify(obs.vector),
        created_at: now,
        updated_at: now,
      });
    }

    // Step 4: Observation 検索（プロジェクト絞り込み）
    const allObs = await obsRepo.findMany({ project: "e2e-full-project" });
    expect(allObs.length).toBeGreaterThanOrEqual(3);
    const obsIds = allObs.map((o) => o.id);
    expect(obsIds).toContain(obs1Id);
    expect(obsIds).toContain(obs2Id);
    expect(obsIds).toContain(obs3Id);

    // findByIds で複数取得
    const byIds = await obsRepo.findByIds([obs1Id, obs2Id]);
    expect(byIds.length).toBe(2);

    // Step 5: ベクトル検索（クエリ [1,0,0] に最も近いのは obs1）
    const searchResults = await vectorRepo.pgvectorSearchAsync([1, 0, 0], 5, "text-embedding-3");
    expect(searchResults.length).toBeGreaterThanOrEqual(3);
    const topResult = searchResults.find((r) => r.observationId === obs1Id);
    expect(topResult).toBeDefined();
    expect(topResult!.distance).toBeCloseTo(0, 3);

    // Step 6: セッションファイナライズ（チェックポイント）
    const endedAt = new Date().toISOString();
    await sessionRepo.finalize({
      session_id: sessionId,
      ended_at: endedAt,
      summary: "E2E フルテストの完了サマリー: TypeScript/Bun/PostgreSQL に関する観察を記録",
      summary_mode: "auto",
      updated_at: endedAt,
    });

    // ファイナライズ後の検証
    const finalizedSession = await sessionRepo.findById(sessionId);
    expect(finalizedSession).not.toBeNull();
    expect(finalizedSession!.ended_at).not.toBeNull();
    expect(finalizedSession!.summary).toContain("TypeScript");

    // Step 7: coverage でベクトルカバレッジを確認
    const cov = await vectorRepo.coverage("text-embedding-3");
    expect(cov.total).toBeGreaterThanOrEqual(3);
    expect(cov.current_model_count).toBeGreaterThanOrEqual(3);

    // Step 8: count で全体集計確認
    const obsCnt = await obsRepo.count({ project: "e2e-full-project" });
    expect(obsCnt).toBeGreaterThanOrEqual(3);

    const sessionCnt = await sessionRepo.count();
    expect(sessionCnt).toBeGreaterThanOrEqual(1);
  });
});
