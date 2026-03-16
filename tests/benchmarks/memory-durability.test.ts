import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../memory-server/src/core/harness-mem-core";

function createTestCore(): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "durability-bench-"));
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
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("embedding timeout");
}

// ---------------------------------------------------------------------------
// S56-003: Long-term Memory Retention
// ---------------------------------------------------------------------------

describe("S56-003: Long-term Memory Retention", () => {
  let core: HarnessMemCore;
  let tempDir: string;

  const OLD_DATE = "2026-02-15T10:00:00.000Z"; // 約30日前
  const PROJECT = "long-term-bench";

  const oldMemories = [
    { id: "old-001", content: "PostgreSQL から CockroachDB に移行完了。分散DBが必要になったため。", query: "DB移行の経緯は？", kw: ["cockroachdb", "分散"] },
    { id: "old-002", content: "認証を Auth0 から自前実装に切り替え。コスト削減が目的。", query: "認証システムを変えた理由は？", kw: ["auth0", "コスト"] },
    { id: "old-003", content: "API バージョニングを URL パスから Accept ヘッダに変更。", query: "API バージョニング方式は？", kw: ["accept", "ヘッダ"] },
    { id: "old-004", content: "Redis Cluster を3ノードから5ノードに拡張。メモリ使用率80%超え。", query: "Redis の構成変更は？", kw: ["redis", "5ノード"] },
    { id: "old-005", content: "GraphQL スキーマを code-first に移行。Pothos を採用。", query: "GraphQL の設計方針は？", kw: ["pothos", "code-first"] },
    { id: "old-006", content: "E2E テストを Cypress から Playwright に移行。速度2倍。", query: "E2E テストフレームワークは？", kw: ["playwright", "速度"] },
    { id: "old-007", content: "CDN を CloudFront から Cloudflare R2 に切り替え。帯域無料。", query: "CDN の選択理由は？", kw: ["cloudflare", "帯域"] },
    { id: "old-008", content: "メール配信を SendGrid から Amazon SES に移行。月額60%削減。", query: "メール配信サービスは？", kw: ["ses", "60%"] },
    { id: "old-009", content: "ログ基盤を ELK から Loki + Grafana に変更。運用コスト削減。", query: "ログ基盤の構成は？", kw: ["loki", "grafana"] },
    { id: "old-010", content: "CI/CD パイプラインに Dagger を導入。ローカルとCIの一貫性確保。", query: "CI/CD ツールの選択理由は？", kw: ["dagger", "一貫性"] },
    { id: "old-011", content: "Feature flag を LaunchDarkly から自前実装に。年間$12K削減。", query: "Feature flag の実装方針は？", kw: ["launchdarkly", "12k"] },
    { id: "old-012", content: "静的解析に SonarQube を導入。セキュリティスキャン必須化。", query: "コード品質ツールは？", kw: ["sonarqube", "セキュリティ"] },
    { id: "old-013", content: "バッチ処理を cron から Temporal に移行。リトライと可観測性。", query: "バッチ処理基盤は？", kw: ["temporal", "リトライ"] },
    { id: "old-014", content: "フロントエンドの状態管理を Redux から Zustand に変更。", query: "状態管理ライブラリは？", kw: ["zustand", "redux"] },
    { id: "old-015", content: "画像最適化に Sharp を導入。WebP/AVIF 自動変換。", query: "画像処理の仕組みは？", kw: ["sharp", "webp"] },
    { id: "old-016", content: "API Rate Limiting を実装。1分あたり100リクエスト制限。", query: "レート制限の設定は？", kw: ["100リクエスト", "rate"] },
    { id: "old-017", content: "マイクロサービス間通信を REST から gRPC に移行。レイテンシ40%削減。", query: "サービス間通信方式は？", kw: ["grpc", "40%"] },
    { id: "old-018", content: "データベースマイグレーションツールを Knex から Drizzle Kit に変更。", query: "マイグレーションツールは？", kw: ["drizzle kit", "knex"] },
    { id: "old-019", content: "OpenTelemetry を導入。分散トレーシング対応。", query: "可観測性の仕組みは？", kw: ["opentelemetry", "トレーシング"] },
    { id: "old-020", content: "Kubernetes のノードプールを Spot インスタンスに変更。コスト70%削減。", query: "インフラコスト削減の方法は？", kw: ["spot", "70%"] },
  ];

  function generateNoise(count: number): Array<{ id: string; content: string; ts: string }> {
    const noiseTemplates = [
      "コードレビュー完了。minor な修正のみ。",
      "テスト追加。カバレッジ向上。",
      "ドキュメント更新。API 仕様を最新化。",
      "バグ修正。null チェックを追加。",
      "リファクタリング。関数を分割。",
      "依存関係更新。セキュリティパッチ適用。",
      "ミーティングメモ。スプリント計画。",
      "デプロイ完了。ステージング環境。",
      "パフォーマンス計測。レスポンスタイム確認。",
      "設定ファイル更新。環境変数追加。",
    ];
    const items = [];
    for (let i = 0; i < count; i++) {
      const template = noiseTemplates[i % noiseTemplates.length];
      const dayOffset = Math.floor(i / 10); // 0-19日前
      const ts = new Date(Date.now() - dayOffset * 86400000).toISOString();
      items.push({ id: `noise-${String(i).padStart(4, "0")}`, content: `${template} (batch ${i})`, ts });
    }
    return items;
  }

  beforeAll(async () => {
    process.env.HARNESS_MEM_EMBEDDING_MODEL = "multilingual-e5";
    const result = createTestCore();
    core = result.core;
    tempDir = result.dir;
    await ensureEmbeddingReady(core);

    // 1. 古い記憶を投入
    for (const m of oldMemories) {
      await core.primeEmbedding(m.content, "passage");
      core.recordEvent({
        event_id: m.id,
        platform: "claude",
        project: PROJECT,
        session_id: "session-old",
        event_type: "user_prompt",
        ts: OLD_DATE,
        payload: { content: m.content },
        tags: [],
        privacy_tags: [],
      });
    }

    // 2. ノイズを投入
    const noise = generateNoise(200);
    for (const n of noise) {
      await core.primeEmbedding(n.content, "passage");
      core.recordEvent({
        event_id: n.id,
        platform: "claude",
        project: PROJECT,
        session_id: "session-recent",
        event_type: "user_prompt",
        ts: n.ts,
        payload: { content: n.content },
        tags: [],
        privacy_tags: [],
      });
    }

    // query prime
    for (const m of oldMemories) {
      await core.primeEmbedding(m.query, "query");
    }
  }, 120_000);

  afterAll(() => {
    core.shutdown("long-term-bench");
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("Long-term Recall@10", () => {
    let hits = 0;
    for (const m of oldMemories) {
      const result = core.search({ query: m.query, project: PROJECT, limit: 10 });
      const items = result.items as Array<{ content?: string }>;
      const found = items.some((item) =>
        m.kw.some((kw) => String(item.content || "").toLowerCase().includes(kw.toLowerCase()))
      );
      if (found) hits++;
    }
    const recall = hits / oldMemories.length;
    console.log(`[long-term] Recall@10: ${recall.toFixed(4)} (${hits}/${oldMemories.length})`);
    expect(recall).toBeGreaterThanOrEqual(0.50);
  });
});

// ---------------------------------------------------------------------------
// S56-005: Multi-Project Isolation
// ---------------------------------------------------------------------------

describe("S56-005: Multi-Project Isolation", () => {
  let core: HarnessMemCore;
  let tempDir: string;

  const PROJECT_A = "project-frontend";
  const PROJECT_B = "project-backend";

  const dataA = [
    { id: "a-001", content: "React 19 に移行。Server Components 対応。", query: "React のバージョンは？", kw: ["react 19"] },
    { id: "a-002", content: "Tailwind CSS v4 を採用。", query: "CSS フレームワークは？", kw: ["tailwind"] },
    { id: "a-003", content: "Next.js 15 を使用。App Router 対応。", query: "フレームワークは何？", kw: ["next.js 15"] },
    { id: "a-004", content: "Storybook 8 でコンポーネントカタログを管理。", query: "UIカタログは？", kw: ["storybook"] },
    { id: "a-005", content: "Framer Motion でアニメーション実装。", query: "アニメーションライブラリは？", kw: ["framer"] },
  ];

  const dataB = [
    { id: "b-001", content: "Express から Hono に移行。エッジランタイム対応。", query: "サーバーフレームワークは？", kw: ["hono"] },
    { id: "b-002", content: "Drizzle ORM を採用。型安全な DB アクセス。", query: "ORM は何？", kw: ["drizzle"] },
    { id: "b-003", content: "Redis で セッション管理。TTL 24時間。", query: "セッション管理は？", kw: ["redis"] },
    { id: "b-004", content: "Zod でバリデーション。API 入力の型安全性。", query: "バリデーションは？", kw: ["zod"] },
    { id: "b-005", content: "Bull MQ でジョブキュー管理。", query: "キューシステムは？", kw: ["bull"] },
  ];

  beforeAll(async () => {
    process.env.HARNESS_MEM_EMBEDDING_MODEL = "multilingual-e5";
    const result = createTestCore();
    core = result.core;
    tempDir = result.dir;
    await ensureEmbeddingReady(core);

    for (const d of dataA) {
      await core.primeEmbedding(d.content, "passage");
      core.recordEvent({
        event_id: d.id,
        platform: "claude",
        project: PROJECT_A,
        session_id: "sess-a",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: d.content },
        tags: [],
        privacy_tags: [],
      });
    }
    for (const d of dataB) {
      await core.primeEmbedding(d.content, "passage");
      core.recordEvent({
        event_id: d.id,
        platform: "claude",
        project: PROJECT_B,
        session_id: "sess-b",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: d.content },
        tags: [],
        privacy_tags: [],
      });
    }
    for (const d of [...dataA, ...dataB]) {
      await core.primeEmbedding(d.query, "query");
    }
  }, 120_000);

  afterAll(() => {
    core.shutdown("isolation-bench");
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("Project A の検索で Project B の結果が漏れないこと", () => {
    let leaks = 0;
    for (const d of dataA) {
      const result = core.search({ query: d.query, project: PROJECT_A, limit: 10 });
      const items = result.items as Array<{ content?: string }>;
      for (const item of items) {
        const c = String(item.content || "").toLowerCase();
        for (const bItem of dataB) {
          if (bItem.kw.some((kw) => c.includes(kw.toLowerCase()))) {
            leaks++;
            break;
          }
        }
      }
    }
    const leakRate = leaks / (dataA.length * 10);
    console.log(`[isolation] A→B leak rate: ${leakRate.toFixed(4)} (${leaks} leaks in ${dataA.length * 10} results)`);
    expect(leakRate).toBeLessThanOrEqual(0.05);
  });

  test("Project B の検索で Project A の結果が漏れないこと", () => {
    let leaks = 0;
    for (const d of dataB) {
      const result = core.search({ query: d.query, project: PROJECT_B, limit: 10 });
      const items = result.items as Array<{ content?: string }>;
      for (const item of items) {
        const c = String(item.content || "").toLowerCase();
        for (const aItem of dataA) {
          if (aItem.kw.some((kw) => c.includes(kw.toLowerCase()))) {
            leaks++;
            break;
          }
        }
      }
    }
    const leakRate = leaks / (dataB.length * 10);
    console.log(`[isolation] B→A leak rate: ${leakRate.toFixed(4)}`);
    expect(leakRate).toBeLessThanOrEqual(0.05);
  });

  test("Project A の記憶が Project A 検索で見つかること", () => {
    let hits = 0;
    for (const d of dataA) {
      const result = core.search({ query: d.query, project: PROJECT_A, limit: 10 });
      const items = result.items as Array<{ content?: string }>;
      if (items.some((item) => d.kw.some((kw) => String(item.content || "").toLowerCase().includes(kw.toLowerCase())))) hits++;
    }
    console.log(`[isolation] A recall: ${(hits / dataA.length).toFixed(4)}`);
    expect(hits / dataA.length).toBeGreaterThanOrEqual(0.60);
  });
});
