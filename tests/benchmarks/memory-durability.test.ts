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
    embeddingModel: "multilingual-e5",
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

function assertSemanticBenchmarkModel(core: HarnessMemCore, benchmarkName: string): void {
  const runtime = core.getEmbeddingRuntimeInfo();
  const providerName = runtime.provider.name;
  const modelName = runtime.provider.model;

  if (providerName !== "local" || modelName !== "multilingual-e5" || runtime.readiness.ready !== true) {
    throw new Error(
      `${benchmarkName} requires local multilingual-e5 embeddings. ` +
      `Current runtime=${providerName}:${modelName}, ready=${runtime.readiness.ready ? "yes" : "no"}. ` +
      `Install the model with: bash scripts/harness-mem model pull multilingual-e5 --yes`
    );
  }
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

  const OLD_DATE = "2026-02-18T10:00:00.000Z"; // 約30日前
  const PROJECT = "long-term-bench";

  // 10 design-decision memories (30 days old)
  const designDecisions = [
    { id: "old-d01", content: "GraphQL スキーマを code-first に移行。Pothos を採用。型安全性とコード共有が理由。", query: "GraphQL の設計方針を変えた経緯は？", kw: ["pothos", "code-first"] },
    { id: "old-d02", content: "認証を Auth0 から自前 JWT 実装に切り替え。年間コスト削減が目的。", query: "認証基盤を独自実装にした理由は？", kw: ["auth0", "jwt"] },
    { id: "old-d03", content: "API バージョニングを URL パスから Accept ヘッダ方式に変更。URL 汚染を避けるため。", query: "API のバージョン管理戦略は？", kw: ["accept", "バージョニング"] },
    { id: "old-d04", content: "フロントエンドの状態管理を Redux から Zustand に変更。ボイラープレート削減。", query: "状態管理ライブラリを変えた理由は？", kw: ["zustand", "redux"] },
    { id: "old-d05", content: "マイクロサービス間通信を REST から gRPC に移行。レイテンシ40%削減のため。", query: "サービス間の通信方式はどう決めた？", kw: ["grpc", "レイテンシ"] },
    { id: "old-d06", content: "バッチ処理を cron から Temporal に移行。リトライと可観測性が改善。", query: "バッチジョブのオーケストレーションは？", kw: ["temporal", "リトライ"] },
    { id: "old-d07", content: "Feature flag を LaunchDarkly から自前実装に。年間$12K の費用対効果。", query: "フィーチャーフラグの管理方針は？", kw: ["launchdarkly", "12k"] },
    { id: "old-d08", content: "静的解析に SonarQube を導入。セキュリティスキャンを CI 必須プロセスに。", query: "コード品質ゲートの仕組みは？", kw: ["sonarqube", "セキュリティスキャン"] },
    { id: "old-d09", content: "画像最適化に Sharp を導入。WebP/AVIF 自動変換でページ速度改善。", query: "画像配信の最適化はどう実装した？", kw: ["sharp", "webp"] },
    { id: "old-d10", content: "API レート制限を実装。1分あたり100リクエスト。Redis バックエンド。", query: "レート制限の設計と上限値は？", kw: ["100リクエスト", "redis"] },
  ];

  // 10 migration-record memories (30 days old)
  const migrationRecords = [
    { id: "old-m01", content: "PostgreSQL から CockroachDB への移行完了。分散 DB が必要になったため実施。", query: "データベースを分散型に移行した経緯は？", kw: ["cockroachdb", "分散"] },
    { id: "old-m02", content: "Redis Cluster を3ノードから5ノードに拡張。メモリ使用率80%超えがトリガー。", query: "Redis のクラスター構成を変更した理由は？", kw: ["redis", "5ノード"] },
    { id: "old-m03", content: "E2E テストを Cypress から Playwright に移行完了。テスト速度が2倍になった。", query: "E2E テストフレームワークの移行内容は？", kw: ["playwright", "cypress"] },
    { id: "old-m04", content: "CDN を CloudFront から Cloudflare R2 に切り替え完了。帯域コスト無料化。", query: "CDN プロバイダーを移行した詳細は？", kw: ["cloudflare", "r2"] },
    { id: "old-m05", content: "メール配信を SendGrid から Amazon SES に移行。月額60%のコスト削減達成。", query: "メール配信インフラの移行結果は？", kw: ["ses", "sendgrid"] },
    { id: "old-m06", content: "ログ基盤を ELK スタックから Loki + Grafana に移行。運用負荷が軽減。", query: "ログ収集と可視化基盤の移行は？", kw: ["loki", "elk"] },
    { id: "old-m07", content: "CI/CD に Dagger を導入。ローカルと CI 環境の一貫性を確保。", query: "CI/CD パイプラインのツール移行は？", kw: ["dagger", "ci/cd"] },
    { id: "old-m08", content: "データベースマイグレーションツールを Knex から Drizzle Kit に変更完了。", query: "スキーママイグレーションツールの変更内容は？", kw: ["drizzle kit", "knex"] },
    { id: "old-m09", content: "OpenTelemetry を全サービスに導入。分散トレーシングが稼働開始。", query: "分散トレーシングの導入状況は？", kw: ["opentelemetry", "トレーシング"] },
    { id: "old-m10", content: "Kubernetes ノードプールを Spot インスタンスに移行完了。インフラコスト70%削減。", query: "インフラのコスト最適化移行の結果は？", kw: ["spot", "70%"] },
  ];

  const allOldMemories = [
    ...designDecisions.map((m) => ({ ...m, tags: ["important", "design-decision"] as string[] })),
    ...migrationRecords.map((m) => ({ ...m, tags: ["migration"] as string[] })),
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
      "PR マージ。コンフリクト解消済み。",
      "ユニットテスト修正。テストデータ更新。",
      "インポート整理。未使用変数削除。",
      "型定義追加。strict モード対応。",
      "ログ出力調整。verbose レベル変更。",
      "コメント追加。複雑なロジックを説明。",
      "スタイル修正。lint エラー解消。",
      "環境変数追加。新機能フラグ設定。",
      "モック更新。外部 API の変更に追従。",
      "スナップショット更新。UI 変更反映。",
    ];
    const items = [];
    for (let i = 0; i < count; i++) {
      const template = noiseTemplates[i % noiseTemplates.length];
      // 直近20日間にばらつかせる
      const dayOffset = Math.floor(i / 50); // 0-19日前
      const ts = new Date(Date.now() - dayOffset * 86400000 - (i % 3600) * 1000).toISOString();
      items.push({ id: `noise-${String(i).padStart(4, "0")}`, content: `${template} (#${i})`, ts });
    }
    return items;
  }

  beforeAll(async () => {
    process.env.HARNESS_MEM_EMBEDDING_MODEL = "multilingual-e5";
    const result = createTestCore();
    core = result.core;
    tempDir = result.dir;
    await ensureEmbeddingReady(core);
    assertSemanticBenchmarkModel(core, "S56-003 Long-term Memory Retention");

    // 1. 古い記憶を投入（design-decision + migration）
    for (const m of allOldMemories) {
      await core.primeEmbedding(m.content, "passage");
      core.recordEvent({
        event_id: m.id,
        platform: "claude",
        project: PROJECT,
        session_id: "session-old",
        event_type: "user_prompt",
        ts: OLD_DATE,
        payload: { content: m.content },
        tags: m.tags,
        privacy_tags: [],
      });
    }

    // 2. ノイズ1000件を投入（embedding は recordEvent 内で同期計算）
    const noise = generateNoise(1000);
    for (const n of noise) {
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

    // 3. クエリを事前ウォームアップ
    for (const m of allOldMemories) {
      await core.primeEmbedding(m.query, "query");
    }
  }, 600_000);

  afterAll(() => {
    core.shutdown("long-term-bench");
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("Long-term Recall@10: 全体（design + migration）", () => {
    let hits = 0;
    for (const m of allOldMemories) {
      const result = core.search({ query: m.query, project: PROJECT, limit: 10 });
      const items = result.items as Array<{ content?: string }>;
      const found = items.some((item) =>
        m.kw.some((kw) => String(item.content || "").toLowerCase().includes(kw.toLowerCase()))
      );
      if (found) hits++;
    }
    const recall = hits / allOldMemories.length;
    console.log(`[long-term] Overall Recall@10: ${recall.toFixed(4)} (${hits}/${allOldMemories.length})`);
    expect(recall).toBeGreaterThanOrEqual(0.50);
  });

  test("Long-term Recall@10: design-decision カテゴリ", () => {
    let hits = 0;
    for (const m of designDecisions) {
      const result = core.search({ query: m.query, project: PROJECT, limit: 10 });
      const items = result.items as Array<{ content?: string }>;
      const found = items.some((item) =>
        m.kw.some((kw) => String(item.content || "").toLowerCase().includes(kw.toLowerCase()))
      );
      if (found) hits++;
    }
    const recall = hits / designDecisions.length;
    console.log(`[long-term] Design-Decision Recall@10: ${recall.toFixed(4)} (${hits}/${designDecisions.length})`);
    expect(recall).toBeGreaterThanOrEqual(0.50);
  });

  test("Long-term Recall@10: migration カテゴリ", () => {
    let hits = 0;
    for (const m of migrationRecords) {
      const result = core.search({ query: m.query, project: PROJECT, limit: 10 });
      const items = result.items as Array<{ content?: string }>;
      const found = items.some((item) =>
        m.kw.some((kw) => String(item.content || "").toLowerCase().includes(kw.toLowerCase()))
      );
      if (found) hits++;
    }
    const recall = hits / migrationRecords.length;
    console.log(`[long-term] Migration Recall@10: ${recall.toFixed(4)} (${hits}/${migrationRecords.length})`);
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
