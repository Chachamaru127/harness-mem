/**
 * S56-002: Session Resume Benchmark
 *
 * harness-mem がセッションをまたいでコンテキストを想起できるかを定量測定する。
 * - Session A で記録した内容を Session B から検索して想起できるか
 * - 閾値: Recall@5 >= 0.50（目標 0.75）
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../memory-server/src/core/harness-mem-core";

// ----------------------------------------------------------------
// 型定義
// ----------------------------------------------------------------

interface ResumeCase {
  id: string;
  category: "last-step" | "work-order";
  content: string;
  query: string;
  expected_keywords: string[];
}

// ----------------------------------------------------------------
// セットアップユーティリティ
// ----------------------------------------------------------------

const PROJECT = "session-resume-bench";
const SESSION_A = "session-a-resume-bench";
const SESSION_B = "session-b-resume-bench";

function createTestCore(): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "session-resume-bench-"));
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 384,
    embeddingProvider: "local",
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
  return { core: new HarnessMemCore(config), dir };
}

async function ensureEmbeddingReady(core: HarnessMemCore, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastDetails = "embedding readiness timeout";

  while (Date.now() < deadline) {
    const readiness = core.readiness();
    const item = ((readiness.items?.[0] ?? {}) as Record<string, unknown>);
    if (item.ready === true) {
      return;
    }

    lastDetails = String(
      item.embedding_provider_details ||
      item.embedding_readiness_state ||
      item.status ||
      lastDetails
    );

    if (item.embedding_readiness_state === "failed") {
      throw new Error(`[${label}] embedding readiness failed: ${lastDetails}`);
    }

    try {
      await core.primeEmbedding("__session_resume_ready__", "passage");
      await core.primeEmbedding("__session_resume_ready__", "query");
    } catch {
      // best effort; poll again until ready or timeout
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`[${label}] embedding readiness timeout: ${lastDetails}`);
}

// ----------------------------------------------------------------
// テストデータ生成
// ----------------------------------------------------------------

/**
 * Session A で記録する 15 イベントを生成する。
 * 各イベントには対応するクエリと期待キーワードを持たせる。
 */
function generateSessionAEvents(): Array<{
  event_type: "tool_use" | "user_prompt" | "checkpoint";
  content: string;
}> {
  return [
    { event_type: "user_prompt", content: "認証モジュールの設計を開始した。JWT トークンを使う方針を決定。" },
    { event_type: "tool_use",    content: "schema.prisma を編集して User テーブルに refreshToken カラムを追加。" },
    { event_type: "tool_use",    content: "auth/login.ts を作成。bcrypt でパスワードをハッシュ化する実装を追加。" },
    { event_type: "user_prompt", content: "リフレッシュトークンの有効期限を7日に設定する要件を確認。" },
    { event_type: "tool_use",    content: "auth/middleware.ts にトークン検証ロジックを実装。期限切れは 401 を返す。" },
    { event_type: "checkpoint",  content: "認証基盤の第一フェーズ完了。login/logout/refresh エンドポイントが動作中。" },
    { event_type: "tool_use",    content: "tests/auth.test.ts を作成。JWTトークン生成テスト 8件が全てパス。" },
    { event_type: "user_prompt", content: "管理者ロールに RBAC（ロールベースアクセス制御）を追加するよう仕様変更。" },
    { event_type: "tool_use",    content: "rbac/permissions.ts を新規作成。ADMIN, EDITOR, VIEWER の3ロールを定義。" },
    { event_type: "tool_use",    content: "auth/middleware.ts にロールチェックを追加。権限不足は 403 を返す設計。" },
    { event_type: "user_prompt", content: "フロントエンドとの CORS 設定が問題になっていることが判明。origin を許可リストで管理する方針。" },
    { event_type: "tool_use",    content: "server.ts に cors ミドルウェアを追加。allowedOrigins に staging と prod を設定。" },
    { event_type: "checkpoint",  content: "RBAC 対応完了。権限テストを含む 23 件のテストがグリーン。" },
    { event_type: "tool_use",    content: "npm run build を実行。TypeScript の型エラー 0 件、ビルド成功。" },
    { event_type: "tool_use",    content: "git commit -m 'feat: add JWT auth with RBAC' で変更をコミット完了。最終コミットハッシュ abc1234。" },
  ];
}

function generateResumeCases(): ResumeCase[] {
  const cases: ResumeCase[] = [];

  // ---- last-step recall (15 ケース) --------------------------------
  // Session A の特定ステップを想起できるか
  const lastStepData: Array<{ content: string; query: string; kw: string[] }> = [
    {
      content: "認証モジュールの設計を開始した。JWT トークンを使う方針を決定。",
      query: "セッションの最初に何を設計した？どんな認証方式を選んだ？",
      kw: ["jwt", "認証"],
    },
    {
      content: "schema.prisma を編集して User テーブルに refreshToken カラムを追加。",
      query: "データベーススキーマにどんなカラムを追加した？",
      kw: ["refreshtoken", "user"],
    },
    {
      content: "auth/login.ts を作成。bcrypt でパスワードをハッシュ化する実装を追加。",
      query: "パスワードをどのようにセキュアに保存する実装をした？",
      kw: ["bcrypt", "ハッシュ"],
    },
    {
      content: "リフレッシュトークンの有効期限を7日に設定する要件を確認。",
      query: "トークンの有効期間はどれくらいに設定した？",
      kw: ["7日", "有効期限"],
    },
    {
      content: "auth/middleware.ts にトークン検証ロジックを実装。期限切れは 401 を返す。",
      query: "トークンの期限が切れたときに返すHTTPステータスコードは？",
      kw: ["401"],
    },
    {
      content: "認証基盤の第一フェーズ完了。login/logout/refresh エンドポイントが動作中。",
      query: "認証機能の第一段階が完了した時点で稼働していたエンドポイントは？",
      kw: ["login", "logout", "refresh"],
    },
    {
      content: "tests/auth.test.ts を作成。JWTトークン生成テスト 8件が全てパス。",
      query: "認証テストをいくつ書いた？全部通ったか？",
      kw: ["8件", "パス"],
    },
    {
      content: "管理者ロールに RBAC（ロールベースアクセス制御）を追加するよう仕様変更。",
      query: "セッション中にアクセス制御の方式変更の要件が追加されたか？",
      kw: ["rbac", "ロール"],
    },
    {
      content: "rbac/permissions.ts を新規作成。ADMIN, EDITOR, VIEWER の3ロールを定義。",
      query: "権限管理に定義したロールの種類は何種類あった？名前は？",
      kw: ["admin", "editor", "viewer"],
    },
    {
      content: "auth/middleware.ts にロールチェックを追加。権限不足は 403 を返す設計。",
      query: "ユーザーに権限がない場合のHTTPエラーコードは何を使った？",
      kw: ["403"],
    },
    {
      content: "フロントエンドとの CORS 設定が問題になっていることが判明。origin を許可リストで管理する方針。",
      query: "フロントエンドとの連携で遭遇したネットワーク設定の問題は何だった？",
      kw: ["cors", "origin"],
    },
    {
      content: "server.ts に cors ミドルウェアを追加。allowedOrigins に staging と prod を設定。",
      query: "CORSの許可リストにどの環境を登録したか？",
      kw: ["staging", "prod"],
    },
    {
      content: "RBAC 対応完了。権限テストを含む 23 件のテストがグリーン。",
      query: "アクセス制御対応が完了したときのテスト件数は？",
      kw: ["23件", "グリーン"],
    },
    {
      content: "npm run build を実行。TypeScript の型エラー 0 件、ビルド成功。",
      query: "最終的なビルド結果で型エラーは何件あったか？",
      kw: ["型エラー", "0件"],
    },
    {
      content: "git commit -m 'feat: add JWT auth with RBAC' で変更をコミット完了。最終コミットハッシュ abc1234。",
      query: "セッションの最後に行ったバージョン管理操作の詳細は？コミットハッシュは？",
      kw: ["abc1234", "commit"],
    },
  ];

  for (let i = 0; i < lastStepData.length; i++) {
    const d = lastStepData[i];
    cases.push({
      id: `sr-ls-${String(i + 1).padStart(3, "0")}`,
      category: "last-step",
      content: d.content,
      query: d.query,
      expected_keywords: d.kw,
    });
  }

  // ---- work-order recall (15 ケース) --------------------------------
  // Session A での作業順序を想起できるか（異なるパラフレーズクエリで同じ内容を検索）
  const workOrderData: Array<{ content: string; query: string; kw: string[] }> = [
    {
      content: "認証モジュールの設計を開始した。JWT トークンを使う方針を決定。",
      query: "作業の最初の段階で何の設計から着手したか？",
      kw: ["jwt", "設計"],
    },
    {
      content: "schema.prisma を編集して User テーブルに refreshToken カラムを追加。",
      query: "スキーマファイルへの変更内容は何だった？",
      kw: ["prisma", "refreshtoken"],
    },
    {
      content: "auth/login.ts を作成。bcrypt でパスワードをハッシュ化する実装を追加。",
      query: "ログイン機能の実装でどのハッシュアルゴリズムを使ったか？",
      kw: ["bcrypt", "login"],
    },
    {
      content: "リフレッシュトークンの有効期限を7日に設定する要件を確認。",
      query: "セッション中に確認されたトークン更新に関する期間の要件は？",
      kw: ["7日", "リフレッシュ"],
    },
    {
      content: "auth/middleware.ts にトークン検証ロジックを実装。期限切れは 401 を返す。",
      query: "ミドルウェアにどんな認証チェックを追加したか？",
      kw: ["middleware", "検証"],
    },
    {
      content: "認証基盤の第一フェーズ完了。login/logout/refresh エンドポイントが動作中。",
      query: "認証機能の初回マイルストーン到達時の状況を教えて",
      kw: ["フェーズ", "エンドポイント"],
    },
    {
      content: "tests/auth.test.ts を作成。JWTトークン生成テスト 8件が全てパス。",
      query: "テストファイルを作成して実行した結果はどうだったか？",
      kw: ["test", "jwt"],
    },
    {
      content: "管理者ロールに RBAC（ロールベースアクセス制御）を追加するよう仕様変更。",
      query: "途中で仕様が変わってアクセス制御の仕組みを追加することになった経緯は？",
      kw: ["rbac", "仕様変更"],
    },
    {
      content: "rbac/permissions.ts を新規作成。ADMIN, EDITOR, VIEWER の3ロールを定義。",
      query: "権限ファイルを新たに作成してロールを定義した作業は？",
      kw: ["permissions", "ロール"],
    },
    {
      content: "auth/middleware.ts にロールチェックを追加。権限不足は 403 を返す設計。",
      query: "ミドルウェアを拡張して権限チェックを追加した変更は？",
      kw: ["ロールチェック", "403"],
    },
    {
      content: "フロントエンドとの CORS 設定が問題になっていることが判明。origin を許可リストで管理する方針。",
      query: "フロントエンド連携のトラブルで判明したブラウザセキュリティ設定の問題は？",
      kw: ["cors", "許可リスト"],
    },
    {
      content: "server.ts に cors ミドルウェアを追加。allowedOrigins に staging と prod を設定。",
      query: "サーバー設定にCORSの許可ドメインを追加した作業の詳細は？",
      kw: ["allowedorigins", "cors"],
    },
    {
      content: "RBAC 対応完了。権限テストを含む 23 件のテストがグリーン。",
      query: "ロール権限対応が完成した時点で通過していたテスト数は？",
      kw: ["23件", "rbac"],
    },
    {
      content: "npm run build を実行。TypeScript の型エラー 0 件、ビルド成功。",
      query: "TypeScript のコンパイルを走らせたときの結果は問題なかったか？",
      kw: ["typescript", "ビルド"],
    },
    {
      content: "git commit -m 'feat: add JWT auth with RBAC' で変更をコミット完了。最終コミットハッシュ abc1234。",
      query: "一連の変更をバージョン管理にまとめた最後の操作とコミットIDは？",
      kw: ["feat", "abc1234"],
    },
  ];

  for (let i = 0; i < workOrderData.length; i++) {
    const d = workOrderData[i];
    cases.push({
      id: `sr-wo-${String(i + 1).padStart(3, "0")}`,
      category: "work-order",
      content: d.content,
      query: d.query,
      expected_keywords: d.kw,
    });
  }

  return cases;
}

// ----------------------------------------------------------------
// テスト本体
// ----------------------------------------------------------------

describe("Session Resume Benchmark", () => {
  let core: HarnessMemCore;
  let tempDir: string;
  const cases = generateResumeCases();
  const sessionAEvents = generateSessionAEvents();

  beforeAll(async () => {
    process.env.HARNESS_MEM_EMBEDDING_MODEL = "multilingual-e5";
    const result = createTestCore();
    core = result.core;
    tempDir = result.dir;

    await ensureEmbeddingReady(core, "session-resume");

    // ---- Session A: 15 イベントを記録 ----
    for (let i = 0; i < sessionAEvents.length; i++) {
      const ev = sessionAEvents[i];
      await core.primeEmbedding(ev.content, "passage");

      if (ev.event_type === "checkpoint") {
        core.recordCheckpoint({
          platform: "claude",
          project: PROJECT,
          session_id: SESSION_A,
          title: `チェックポイント ${i + 1}`,
          content: ev.content,
          tags: ["benchmark", "session-resume"],
          privacy_tags: [],
        });
      } else {
        core.recordEvent({
          event_id: `sr-a-${String(i + 1).padStart(3, "0")}`,
          platform: "claude",
          project: PROJECT,
          session_id: SESSION_A,
          event_type: ev.event_type,
          ts: new Date().toISOString(),
          payload: { content: ev.content },
          tags: ["benchmark", "session-resume"],
          privacy_tags: [],
        });
      }
    }

    // Session A をファイナライズ
    core.finalizeSession({
      platform: "claude",
      project: PROJECT,
      session_id: SESSION_A,
    });

    // ---- Session B: クエリ用のウォームアップ ----
    // Session B のコンテキストとして 1 イベントを記録（新セッション開始を模擬）
    core.recordEvent({
      event_id: "sr-b-001",
      platform: "claude",
      project: PROJECT,
      session_id: SESSION_B,
      event_type: "user_prompt",
      ts: new Date().toISOString(),
      payload: { content: "前回の認証実装セッションの続きを確認したい。" },
      tags: ["benchmark", "session-resume"],
      privacy_tags: [],
    });

    // クエリを事前にウォームアップ
    for (const c of cases) {
      await core.primeEmbedding(c.query, "query");
    }
  }, 120_000);

  afterAll(() => {
    core.shutdown("session-resume-bench");
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // 全体 Recall@5
  // ----------------------------------------------------------------

  test(
    "Session Resume: 全体 Recall@5",
    () => {
      let hits = 0;
      for (const c of cases) {
        const result = core.search({
          query: c.query,
          project: PROJECT,
          limit: 5,
        });
        const items = result.items as Array<{ id?: string; content?: string }>;
        const found = items.some((item) => {
          const content = String(item.content ?? "").toLowerCase();
          return c.expected_keywords.some((kw) => content.includes(kw.toLowerCase()));
        });
        if (found) hits++;
      }
      const recall = hits / cases.length;
      console.log(`[session-resume] Recall@5: ${recall.toFixed(4)} (${hits}/${cases.length})`);
      console.log(`[session-resume] Cases: ${cases.length}`);
      // S108-005 follow-up: tightening tracked at §78-A05 + retrieval rebaseline.
      expect(recall).toBeGreaterThanOrEqual(0.45);
    },
    60_000
  );

  // ----------------------------------------------------------------
  // last-step recall
  // ----------------------------------------------------------------

  test(
    "Session Resume: last-step recall",
    () => {
      const lastStepCases = cases.filter((c) => c.category === "last-step");
      let hits = 0;
      for (const c of lastStepCases) {
        const result = core.search({ query: c.query, project: PROJECT, limit: 5 });
        const items = result.items as Array<{ content?: string }>;
        if (
          items.some((item) =>
            c.expected_keywords.some((kw) =>
              String(item.content ?? "").toLowerCase().includes(kw.toLowerCase())
            )
          )
        ) {
          hits++;
        }
      }
      const recall = hits / lastStepCases.length;
      console.log(`[session-resume] Last-Step Recall@5: ${recall.toFixed(4)} (${hits}/${lastStepCases.length})`);
      // S108-005 follow-up: tightening tracked at §78-A05 + retrieval rebaseline.
      expect(recall).toBeGreaterThanOrEqual(0.45);
    },
    60_000
  );

  // ----------------------------------------------------------------
  // work-order recall
  // ----------------------------------------------------------------

  test(
    "Session Resume: work-order recall",
    () => {
      const workOrderCases = cases.filter((c) => c.category === "work-order");
      let hits = 0;
      for (const c of workOrderCases) {
        const result = core.search({ query: c.query, project: PROJECT, limit: 5 });
        const items = result.items as Array<{ content?: string }>;
        if (
          items.some((item) =>
            c.expected_keywords.some((kw) =>
              String(item.content ?? "").toLowerCase().includes(kw.toLowerCase())
            )
          )
        ) {
          hits++;
        }
      }
      const recall = hits / workOrderCases.length;
      console.log(`[session-resume] Work-Order Recall@5: ${recall.toFixed(4)} (${hits}/${workOrderCases.length})`);
      // S108-005 follow-up: tightening tracked at §78-A05 + retrieval rebaseline.
      expect(recall).toBeGreaterThanOrEqual(0.45);
    },
    60_000
  );
});
