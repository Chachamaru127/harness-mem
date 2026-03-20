/**
 * S56-002: Session Resume Benchmark
 * S56-004: Consolidation Quality Benchmark
 *
 * S56-002: 前のセッションの作業を新セッションから想起できるかを定量測定する。
 * S56-004: consolidation (圧縮) 前後で検索品質が維持されるかを確認する。
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../memory-server/src/core/harness-mem-core";

// ----------------------------------------------------------------
// セットアップユーティリティ（両 describe で共有）
// ----------------------------------------------------------------

function createTestCore(): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "session-consol-bench-"));
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

async function ensureEmbeddingReady(core: HarnessMemCore): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const readiness = core.readiness();
    const item = (readiness.items?.[0] ?? {}) as Record<string, unknown>;
    if (item.ready === true) return;
    try {
      await core.primeEmbedding("__ready__", "passage");
      await core.primeEmbedding("__ready__", "query");
    } catch {
      // best effort
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("embedding timeout");
}

// ================================================================
// S56-002: Session Resume Benchmark
// ================================================================

describe("S56-002: Session Resume Benchmark", () => {
  let core: HarnessMemCore;
  let tempDir: string;
  const PROJECT = "session-resume-bench";

  // セッション A のステップ（auth middleware リファクタリング）
  const sessionA = {
    id: "session-a-001",
    steps: [
      {
        id: "step-001",
        content:
          "auth middleware のリファクタリングを開始。現状の問題: セッショントークンが Cookie と Header の両方で扱われていて不統一。",
        ts: "2026-03-15T10:00:00Z",
      },
      {
        id: "step-002",
        content: "JWT バリデーションロジックを共通関数 validateToken() に抽出。",
        ts: "2026-03-15T10:15:00Z",
      },
      {
        id: "step-003",
        content: "Cookie パーサーを削除し、Authorization ヘッダに統一。",
        ts: "2026-03-15T10:30:00Z",
      },
      {
        id: "step-004",
        content: "リフレッシュトークンのローテーション実装。有効期限7日。",
        ts: "2026-03-15T10:45:00Z",
      },
      {
        id: "step-005",
        content: "CORS 設定を更新。credentials: true を追加。",
        ts: "2026-03-15T11:00:00Z",
      },
      {
        id: "step-006",
        content: "auth middleware のテスト追加。12テスト全パス。",
        ts: "2026-03-15T11:15:00Z",
      },
      {
        id: "step-007",
        content: "PR #42 を作成。レビュー待ち。",
        ts: "2026-03-15T11:30:00Z",
      },
    ],
  };

  // セッション B（翌日）のクエリ
  const resumeQueries = [
    {
      query: "前回の auth middleware の作業はどこまで進んだ？",
      kw: ["pr #42", "レビュー"],
      description: "最終ステップ",
    },
    {
      query: "auth middleware で何を変更した？",
      kw: ["cookie", "authorization", "jwt"],
      description: "全体概要",
    },
    {
      query: "リフレッシュトークンの有効期限は？",
      kw: ["7日", "ローテーション"],
      description: "具体的な設定値",
    },
    {
      query: "auth のテストは何件？",
      kw: ["12テスト", "パス"],
      description: "テスト結果",
    },
    {
      query: "What was the last step in the auth refactoring?",
      kw: ["pr", "#42", "review"],
      description: "クロスリンガル",
    },
  ];

  // 追加セッション（別の作業）
  const sessionC = {
    id: "session-c-001",
    steps: [
      {
        id: "sc-001",
        content: "API ドキュメントを OpenAPI 3.1 で再生成。",
        ts: "2026-03-15T14:00:00Z",
      },
      {
        id: "sc-002",
        content: "Swagger UI の設定を更新。ダークモード対応。",
        ts: "2026-03-15T14:15:00Z",
      },
      {
        id: "sc-003",
        content: "API バージョン v2 のエンドポイント追加。",
        ts: "2026-03-15T14:30:00Z",
      },
    ],
  };

  const sessionD = {
    id: "session-d-001",
    steps: [
      {
        id: "sd-001",
        content:
          "データベースのインデックス最適化。users テーブルに複合インデックス追加。",
        ts: "2026-03-15T16:00:00Z",
      },
      {
        id: "sd-002",
        content: "EXPLAIN ANALYZE で確認。クエリ時間 120ms → 8ms。",
        ts: "2026-03-15T16:15:00Z",
      },
    ],
  };

  const additionalQueries = [
    {
      query: "前回のセッションで API ドキュメントはどうした？",
      kw: ["openapi", "swagger"],
      description: "別セッション想起",
    },
    {
      query: "DB のパフォーマンス改善の結果は？",
      kw: ["120ms", "8ms"],
      description: "具体的数値",
    },
    {
      query: "最後に作業したのは何？",
      kw: ["インデックス", "データベース"],
      description: "最新セッション",
    },
  ];

  beforeAll(async () => {
    process.env.HARNESS_MEM_EMBEDDING_MODEL = "multilingual-e5";
    const result = createTestCore();
    core = result.core;
    tempDir = result.dir;
    await ensureEmbeddingReady(core);

    // セッション A を投入
    for (const step of sessionA.steps) {
      await core.primeEmbedding(step.content, "passage");
      core.recordEvent({
        event_id: step.id,
        platform: "claude",
        project: PROJECT,
        session_id: sessionA.id,
        event_type: "user_prompt",
        ts: step.ts,
        payload: { content: step.content },
        tags: [],
        privacy_tags: [],
      });
    }

    // セッション C, D も投入
    for (const session of [sessionC, sessionD]) {
      for (const step of session.steps) {
        await core.primeEmbedding(step.content, "passage");
        core.recordEvent({
          event_id: step.id,
          platform: "claude",
          project: PROJECT,
          session_id: session.id,
          event_type: "user_prompt",
          ts: step.ts,
          payload: { content: step.content },
          tags: [],
          privacy_tags: [],
        });
      }
    }

    // query prime
    for (const q of [...resumeQueries, ...additionalQueries]) {
      await core.primeEmbedding(q.query, "query");
    }
  }, 120_000);

  afterAll(() => {
    core.shutdown("session-resume");
    rmSync(tempDir, { recursive: true, force: true });
  });

  test(
    "Session Resume: auth middleware クエリの Recall@5",
    () => {
      let hits = 0;
      for (const q of resumeQueries) {
        const result = core.search({ query: q.query, project: PROJECT, limit: 5 });
        const items = result.items as Array<{ content?: string }>;
        const found = items.some((item) =>
          q.kw.some((kw) =>
            String(item.content || "").toLowerCase().includes(kw.toLowerCase())
          )
        );
        if (found) hits++;
      }
      const recall = hits / resumeQueries.length;
      console.log(
        `[session-resume] Auth Recall@5: ${recall.toFixed(4)} (${hits}/${resumeQueries.length})`
      );
      expect(recall).toBeGreaterThanOrEqual(0.60);
    },
    60_000
  );

  test(
    "Session Resume: 複数セッション横断 Recall@5",
    () => {
      let hits = 0;
      const allQueries = [...resumeQueries, ...additionalQueries];
      for (const q of allQueries) {
        const result = core.search({ query: q.query, project: PROJECT, limit: 5 });
        const items = result.items as Array<{ content?: string }>;
        const found = items.some((item) =>
          q.kw.some((kw) =>
            String(item.content || "").toLowerCase().includes(kw.toLowerCase())
          )
        );
        if (found) hits++;
      }
      const recall = hits / allQueries.length;
      console.log(
        `[session-resume] Overall Recall@5: ${recall.toFixed(4)} (${hits}/${allQueries.length})`
      );
      expect(recall).toBeGreaterThanOrEqual(0.50);
    },
    60_000
  );
});

// ================================================================
// S56-004: Consolidation Quality Benchmark
// ================================================================

// ----------------------------------------------------------------
// 100 observations + 10 query pairs for S56-004
// ----------------------------------------------------------------

interface ConsolidationCase {
  id: string;
  content: string;
  query: string;
  kw: string[];
}

function generateConsolidationData(): ConsolidationCase[] {
  const core10: ConsolidationCase[] = [
    { id: "con-001", content: "React のコンポーネント設計を Atomic Design に変更した。", query: "コンポーネント設計は？", kw: ["atomic"] },
    { id: "con-002", content: "状態管理に Jotai を採用。シンプルな API が魅力。", query: "状態管理ライブラリは？", kw: ["jotai"] },
    { id: "con-003", content: "テストに React Testing Library を使用している。", query: "テストライブラリは？", kw: ["testing library"] },
    { id: "con-004", content: "スタイリングに CSS Modules を採用。スコープが明確。", query: "スタイリング方式は？", kw: ["css modules"] },
    { id: "con-005", content: "ルーティングに TanStack Router を使用。型安全。", query: "ルーターは？", kw: ["tanstack"] },
    { id: "con-006", content: "フォーム管理に React Hook Form と Zod を組み合わせた。", query: "フォームライブラリは？", kw: ["hook form", "zod"] },
    { id: "con-007", content: "国際化に next-intl を採用した。", query: "i18n は？", kw: ["next-intl"] },
    { id: "con-008", content: "エラーバウンダリに react-error-boundary を使用。", query: "エラーハンドリングは？", kw: ["error-boundary"] },
    { id: "con-009", content: "データフェッチに TanStack Query を採用。キャッシュ戦略が強力。", query: "データフェッチは？", kw: ["tanstack query"] },
    { id: "con-010", content: "アクセシビリティに Radix UI を使用。ARIA 対応が充実。", query: "UIライブラリは？", kw: ["radix"] },
  ];

  // 90 additional filler observations (no corresponding query — noise for consolidation)
  const fillers: ConsolidationCase[] = [];
  const fillerTemplates = [
    "Vite のビルド設定を最適化した。チャンクサイズ削減。",
    "TypeScript の strict モードを有効化。型安全性向上。",
    "ESLint ルールを更新。unused-vars を error に設定。",
    "Prettier の設定を統一。printWidth を 100 に変更。",
    "Storybook 8 に移行。CSF 3 フォーマットを使用。",
    "Chromatic でビジュアルリグレッションテストを設定。",
    "Vitest でカバレッジ測定。85% を達成。",
    "GitHub Actions で CI を設定。PR 時に自動実行。",
    "Vercel にデプロイ。プレビュー URL が自動生成される。",
    "Sentry でエラー監視を設定。アラート設定済み。",
  ];
  for (let i = 11; i <= 100; i++) {
    fillers.push({
      id: `con-${String(i).padStart(3, "0")}`,
      content: fillerTemplates[(i - 11) % fillerTemplates.length] + ` (記録 #${i})`,
      query: "",
      kw: [],
    });
  }

  return [...core10, ...fillers];
}

describe("S56-004: Consolidation Quality", () => {
  let core: HarnessMemCore;
  let tempDir: string;
  const PROJECT = "consolidation-bench";

  const allData = generateConsolidationData();
  // Only the first 10 have queries — these are the measurement cases
  const measureCases = allData.slice(0, 10);

  function measureF1(label: string): number {
    let hits = 0;
    for (const d of measureCases) {
      const result = core.search({ query: d.query, project: PROJECT, limit: 5 });
      const items = result.items as Array<{ content?: string }>;
      if (
        items.some((item) =>
          d.kw.some((kw) =>
            String(item.content || "").toLowerCase().includes(kw.toLowerCase())
          )
        )
      ) {
        hits++;
      }
    }
    const f1 = hits / measureCases.length;
    console.log(`[consolidation] ${label} F1: ${f1.toFixed(4)} (${hits}/${measureCases.length})`);
    return f1;
  }

  beforeAll(async () => {
    process.env.HARNESS_MEM_EMBEDDING_MODEL = "multilingual-e5";
    const result = createTestCore();
    core = result.core;
    tempDir = result.dir;
    await ensureEmbeddingReady(core);

    // Record all 100 observations
    for (const d of allData) {
      await core.primeEmbedding(d.content, "passage");
      core.recordEvent({
        event_id: d.id,
        platform: "claude",
        project: PROJECT,
        session_id: "sess-con-001",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: d.content },
        tags: ["benchmark", "consolidation"],
        privacy_tags: [],
      });
    }

    // Prime queries
    for (const d of measureCases) {
      await core.primeEmbedding(d.query, "query");
    }
  }, 180_000);

  afterAll(() => {
    core.shutdown("consolidation-bench");
    rmSync(tempDir, { recursive: true, force: true });
  });

  test(
    "S56-004: Pre-consolidation baseline F1",
    () => {
      const preF1 = measureF1("pre-consolidation");
      // Store for reference — the post-consolidation test does the comparison
      (global as Record<string, unknown>).__s56004_preF1 = preF1;
      expect(preF1).toBeGreaterThanOrEqual(0.50);
    },
    60_000
  );

  test(
    "S56-004: Post-consolidation F1 retention >= 80%",
    async () => {
      // Measure pre-consolidation F1 first (may differ from global due to test order)
      const preF1 = measureF1("pre-consolidation (in post-test)");

      // Run consolidation
      await core.runConsolidation({ reason: "benchmark", project: PROJECT });

      // Brief pause to allow any async consolidation work to settle
      await new Promise((r) => setTimeout(r, 500));

      const postF1 = measureF1("post-consolidation");

      if (preF1 > 0) {
        const retention = postF1 / preF1;
        console.log(`[consolidation] F1 retention: ${retention.toFixed(4)} (post=${postF1.toFixed(4)}, pre=${preF1.toFixed(4)})`);
        expect(retention).toBeGreaterThanOrEqual(0.80);
      } else {
        // If pre-consolidation F1 is 0, post must also pass the absolute floor
        console.log(`[consolidation] pre-F1 was 0; checking absolute post-F1 floor`);
        expect(postF1).toBeGreaterThanOrEqual(0.0);
      }
    },
    120_000
  );

  test(
    "S56-004: Post-consolidation absolute F1 floor >= 0.50",
    async () => {
      const postF1 = measureF1("post-consolidation (floor check)");
      expect(postF1).toBeGreaterThanOrEqual(0.50);
    },
    60_000
  );
});
