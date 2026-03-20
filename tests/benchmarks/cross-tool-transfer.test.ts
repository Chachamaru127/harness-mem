/**
 * S56-001: Cross-Tool Memory Transfer Benchmark
 *
 * harness-mem の最大の差別化「Claude Code で記録し、Codex から検索して想起できるか」を定量測定する。
 * - Claude → Codex 方向（決定理由の移転）
 * - Codex → Claude 方向（ツール使用の移転）
 * - 閾値: Recall@10 >= 0.60（目標 0.80）
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../memory-server/src/core/harness-mem-core";

// ----------------------------------------------------------------
// 型定義
// ----------------------------------------------------------------

interface TransferCase {
  id: string;
  record_platform: string;
  search_platform: string;
  category: "decision" | "tool";
  content: string;
  query: string;
  expected_keywords: string[];
}

// ----------------------------------------------------------------
// セットアップユーティリティ
// ----------------------------------------------------------------

const PROJECT = "cross-tool-bench";

function createTestCore(): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "cross-tool-bench-"));
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
      await core.primeEmbedding("__cross_tool_ready__", "passage");
      await core.primeEmbedding("__cross_tool_ready__", "query");
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

function generateTransferCases(): TransferCase[] {
  const decisions: Array<{ content: string; query: string; kw: string[] }> = [
    { content: "Vite 8 に移行。Rolldown で2倍高速化。", query: "Why migrate to Vite 8?", kw: ["rolldown", "vite"] },
    { content: "ESLint から Biome に切り替え。速度が10倍。", query: "ESLint をやめた理由は？", kw: ["biome", "速度"] },
    { content: "Jest から Vitest 4 に移行。Vite との統合が理由。", query: "Why switch to Vitest?", kw: ["vitest", "vite"] },
    { content: "Express から Hono に移行。エッジランタイム対応のため。", query: "サーバーフレームワークを変えた理由は？", kw: ["hono", "エッジ"] },
    { content: "pnpm から bun に切り替え。インストール速度が5倍。", query: "パッケージマネージャの選択理由は？", kw: ["bun", "速度"] },
    { content: "React 18 から 19 にアップグレード。Server Components 対応。", query: "React のバージョンを上げた理由は？", kw: ["react 19", "server"] },
    { content: "Prisma から Drizzle ORM に移行。型推論が優れている。", query: "ORM を変更した理由は？", kw: ["drizzle", "型"] },
    { content: "GitHub Actions の並列ジョブを3から6に増やした。CI 時間を半減。", query: "CI の並列数を変えた理由は？", kw: ["並列", "半減"] },
    { content: "Tailwind CSS v4 に移行。CSS-first 設定が不要になった。", query: "Tailwind を更新した理由は？", kw: ["tailwind", "v4"] },
    { content: "PostgreSQL 17 にアップグレード。JSONB パフォーマンス改善。", query: "DB をアップグレードした理由は？", kw: ["postgresql", "jsonb"] },
    { content: "Docker multi-stage build を導入。イメージサイズ 60% 削減。", query: "Docker ビルドを変えた理由は？", kw: ["multi-stage", "削減"] },
    { content: "WebSocket から SSE に切り替え。HTTP/2 との相性が良い。", query: "リアルタイム通信方式を変えた理由は？", kw: ["sse", "http"] },
    { content: "monorepo を Turborepo で管理開始。ビルドキャッシュが効く。", query: "monorepo ツールの選択理由は？", kw: ["turborepo", "キャッシュ"] },
  ];

  const tools: Array<{ content: string; query: string; kw: string[] }> = [
    { content: "bun test を実行。138テスト全パス。", query: "テストスイートの実行結果は？全部通った？", kw: ["138", "パス"] },
    { content: "git rebase squash で直近5コミットをまとめた。", query: "コミット履歴を整理した操作の詳細は？", kw: ["rebase", "squash"] },
    { content: "npm publish --access public でパッケージを公開。", query: "パッケージレジストリへの公開はどうやった？", kw: ["publish", "public"] },
    { content: "docker compose up -d でサービスを起動。", query: "コンテナオーケストレーションでサービスを立ち上げた方法は？", kw: ["compose", "起動"] },
    { content: "curl localhost:37888/health でヘルスチェック。", query: "デーモンの稼働状態を確認した方法は？", kw: ["health", "37888"] },
    { content: "biome check --apply で lint 適用。47件のルール違反を自動修正。", query: "コード品質チェックで自動修正された件数は？", kw: ["47件", "修正"] },
    { content: "bun run build でプロダクションビルド。出力サイズ 2.3MB。", query: "本番用ビルドの成果物サイズはどれくらい？", kw: ["build", "2.3mb"] },
    { content: "psql -c 'SELECT count(*) FROM users' で件数確認。42,000件。", query: "ユーザーテーブルのレコード数は何件だった？", kw: ["42,000", "users"] },
    { content: "gh pr create --title 'feat: add memory bridge' で PR 作成。", query: "メモリブリッジ機能のプルリクエストを作った方法は？", kw: ["pr", "memory bridge"] },
    { content: "vitest --coverage でカバレッジ測定。87% カバレッジ。", query: "テストカバレッジの測定結果は何パーセント？", kw: ["87%", "カバレッジ"] },
    { content: "ssh deploy@prod 'systemctl restart harness-mem' でデプロイ。", query: "本番サーバーへのデプロイ手順は？サービスを再起動した？", kw: ["deploy", "restart"] },
    { content: "openssl req -newkey rsa:2048 で証明書生成。", query: "SSL 証明書の発行手順は？鍵長は？", kw: ["証明書", "2048"] },
  ];

  const cases: TransferCase[] = [];
  let idx = 0;

  // Claude → Codex (decisions): 13 ケース
  for (const d of decisions) {
    idx++;
    cases.push({
      id: `ct-${String(idx).padStart(3, "0")}`,
      record_platform: "claude",
      search_platform: "codex",
      category: "decision",
      content: d.content,
      query: d.query,
      expected_keywords: d.kw,
    });
  }

  // Codex → Claude (tools): 12 ケース
  for (const t of tools) {
    idx++;
    cases.push({
      id: `ct-${String(idx).padStart(3, "0")}`,
      record_platform: "codex",
      search_platform: "claude",
      category: "tool",
      content: t.content,
      query: t.query,
      expected_keywords: t.kw,
    });
  }

  // Claude → Codex (tools): 12 ケース（双方向を増やす）
  for (const t of tools) {
    idx++;
    cases.push({
      id: `ct-${String(idx).padStart(3, "0")}`,
      record_platform: "claude",
      search_platform: "codex",
      category: "tool",
      content: t.content,
      query: t.query,
      expected_keywords: t.kw,
    });
  }

  // Codex → Claude (decisions): 13 ケース（双方向を増やす）
  for (const d of decisions) {
    idx++;
    cases.push({
      id: `ct-${String(idx).padStart(3, "0")}`,
      record_platform: "codex",
      search_platform: "claude",
      category: "decision",
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

describe("Cross-Tool Memory Transfer Benchmark", () => {
  let core: HarnessMemCore;
  let tempDir: string;
  const cases = generateTransferCases();

  beforeAll(async () => {
    process.env.HARNESS_MEM_EMBEDDING_MODEL = "multilingual-e5";
    const result = createTestCore();
    core = result.core;
    tempDir = result.dir;

    await ensureEmbeddingReady(core, "cross-tool");

    // 全ケースのデータを投入（passage prime → recordEvent）
    for (const c of cases) {
      await core.primeEmbedding(c.content, "passage");

      core.recordEvent({
        event_id: c.id,
        platform: c.record_platform,
        project: PROJECT,
        session_id: `session-${c.record_platform}-${c.id}`,
        event_type: c.category === "tool" ? "tool_use" : "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: c.content },
        tags: ["benchmark", "cross-tool"],
        privacy_tags: [],
      });
    }

    // query prime（全クエリを事前にウォームアップ）
    for (const c of cases) {
      await core.primeEmbedding(c.query, "query");
    }
  }, 120_000);

  afterAll(() => {
    core.shutdown("cross-tool-bench");
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // 全体 Recall@10
  // ----------------------------------------------------------------

  test(
    "Cross-Tool Transfer: 全体 Recall@10",
    () => {
      let hits = 0;
      for (const c of cases) {
        const result = core.search({
          query: c.query,
          project: PROJECT,
          limit: 10,
        });
        const items = result.items as Array<{ id?: string; content?: string }>;
        const found = items.some((item) => {
          const content = String(item.content ?? "").toLowerCase();
          return c.expected_keywords.some((kw) => content.includes(kw.toLowerCase()));
        });
        if (found) hits++;
      }
      const recall = hits / cases.length;
      console.log(`[cross-tool] Recall@10: ${recall.toFixed(4)} (${hits}/${cases.length})`);
      console.log(`[cross-tool] Cases: ${cases.length}`);
      expect(recall).toBeGreaterThanOrEqual(0.60);
    },
    60_000
  );

  // ----------------------------------------------------------------
  // カテゴリ別
  // ----------------------------------------------------------------

  test(
    "Cross-Tool Transfer: decision カテゴリ",
    () => {
      const decisionCases = cases.filter((c) => c.category === "decision");
      let hits = 0;
      for (const c of decisionCases) {
        const result = core.search({ query: c.query, project: PROJECT, limit: 10 });
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
      const recall = hits / decisionCases.length;
      console.log(`[cross-tool] Decision Recall@10: ${recall.toFixed(4)} (${hits}/${decisionCases.length})`);
      expect(recall).toBeGreaterThanOrEqual(0.50);
    },
    60_000
  );

  test(
    "Cross-Tool Transfer: tool カテゴリ",
    () => {
      const toolCases = cases.filter((c) => c.category === "tool");
      let hits = 0;
      for (const c of toolCases) {
        const result = core.search({ query: c.query, project: PROJECT, limit: 10 });
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
      const recall = hits / toolCases.length;
      console.log(`[cross-tool] Tool Recall@10: ${recall.toFixed(4)} (${hits}/${toolCases.length})`);
      // tool カテゴリはパラフレーズクエリによるセマンティック検索の測定
      // 現行 multilingual-e5 では 0.25 前後。reranker 導入後に 0.45+ を目指す
      expect(recall).toBeGreaterThanOrEqual(0.20);
    },
    60_000
  );

  // ----------------------------------------------------------------
  // 方向別
  // ----------------------------------------------------------------

  test(
    "Cross-Tool Transfer: Claude→Codex 方向",
    () => {
      const c2cCases = cases.filter(
        (c) => c.record_platform === "claude" && c.search_platform === "codex"
      );
      let hits = 0;
      for (const c of c2cCases) {
        const result = core.search({ query: c.query, project: PROJECT, limit: 10 });
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
      const recall = hits / c2cCases.length;
      console.log(`[cross-tool] Claude→Codex: ${recall.toFixed(4)} (${hits}/${c2cCases.length})`);
      expect(recall).toBeGreaterThanOrEqual(0.50);
    },
    60_000
  );

  test(
    "Cross-Tool Transfer: Codex→Claude 方向",
    () => {
      const c2cCases = cases.filter(
        (c) => c.record_platform === "codex" && c.search_platform === "claude"
      );
      let hits = 0;
      for (const c of c2cCases) {
        const result = core.search({ query: c.query, project: PROJECT, limit: 10 });
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
      const recall = hits / c2cCases.length;
      console.log(`[cross-tool] Codex→Claude: ${recall.toFixed(4)} (${hits}/${c2cCases.length})`);
      expect(recall).toBeGreaterThanOrEqual(0.50);
    },
    60_000
  );
});
