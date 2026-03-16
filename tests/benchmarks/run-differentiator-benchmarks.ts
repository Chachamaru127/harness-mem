/**
 * §56: Differentiator Benchmarks Runner
 *
 * bun test では ONNX Runtime + C++ panic が発生するため、
 * bun run で直接実行するランナースクリプト。
 *
 * 使用方法: bun run tests/benchmarks/run-differentiator-benchmarks.ts
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../memory-server/src/core/harness-mem-core";

// =========================================================================
// 共通ユーティリティ
// =========================================================================

function createTestCore(label: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `diff-bench-${label}-`));
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

async function ensureReady(core: HarnessMemCore, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const r = core.readiness();
    const item = ((r.items?.[0]) ?? {}) as Record<string, unknown>;
    if (item.ready === true) return;
    try {
      await core.primeEmbedding("__ready__", "passage");
      await core.primeEmbedding("__ready__", "query");
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`[${label}] embedding timeout`);
}

function recall(items: Array<{ content?: string }>, keywords: string[]): boolean {
  return items.some((item) =>
    keywords.some((kw) => String(item.content || "").toLowerCase().includes(kw.toLowerCase()))
  );
}

interface BenchResult {
  name: string;
  passed: boolean;
  score: number;
  detail: string;
}

const results: BenchResult[] = [];

// =========================================================================
// S56-001: Cross-Tool Transfer
// =========================================================================

async function runCrossToolTransfer(): Promise<void> {
  console.log("\n=== S56-001: Cross-Tool Memory Transfer ===");
  const { core, dir } = createTestCore("cross-tool");
  process.env.HARNESS_MEM_EMBEDDING_MODEL = "multilingual-e5";
  await ensureReady(core, "cross-tool");

  const cases = [
    { id: "ct-01", rp: "claude", content: "Vite 8 に移行。Rolldown で2倍高速化。", query: "Why migrate to Vite 8?", kw: ["rolldown", "vite"] },
    { id: "ct-02", rp: "claude", content: "ESLint から Biome に切り替え。速度10倍。", query: "ESLint をやめた理由は？", kw: ["biome", "速度"] },
    { id: "ct-03", rp: "claude", content: "Jest から Vitest 4 に移行。Vite 統合。", query: "Why switch to Vitest?", kw: ["vitest", "vite"] },
    { id: "ct-04", rp: "claude", content: "Express から Hono に移行。エッジランタイム。", query: "サーバーフレームワークの選択理由は？", kw: ["hono", "エッジ"] },
    { id: "ct-05", rp: "claude", content: "pnpm から bun に切り替え。インストール5倍速。", query: "パッケージマネージャは？", kw: ["bun", "速度"] },
    { id: "ct-06", rp: "codex", content: "bun test 実行。138テスト全パス。", query: "テスト結果は？", kw: ["138", "パス"] },
    { id: "ct-07", rp: "codex", content: "git rebase -i で5コミットを squash。", query: "git の操作は？", kw: ["rebase", "squash"] },
    { id: "ct-08", rp: "codex", content: "npm publish --access public で公開。", query: "パッケージ公開方法は？", kw: ["npm publish", "public"] },
    { id: "ct-09", rp: "codex", content: "docker compose up -d でサービス起動。", query: "サービスの起動方法は？", kw: ["docker compose"] },
    { id: "ct-10", rp: "codex", content: "vitest --coverage でカバレッジ87%。", query: "テストカバレッジは？", kw: ["87%", "coverage"] },
    { id: "ct-11", rp: "claude", content: "React 19 にアップグレード。Server Components。", query: "React のバージョンは？", kw: ["react 19", "server"] },
    { id: "ct-12", rp: "claude", content: "Prisma から Drizzle ORM に移行。型推論。", query: "ORM の選択理由は？", kw: ["drizzle", "型"] },
    { id: "ct-13", rp: "codex", content: "eslint --fix で自動修正。12ファイル。", query: "lint の修正結果は？", kw: ["eslint", "12ファイル"] },
    { id: "ct-14", rp: "codex", content: "psql で users テーブル確認。42,000件。", query: "ユーザー数は？", kw: ["42,000", "users"] },
    { id: "ct-15", rp: "claude", content: "PostgreSQL 17 にアップグレード。JSONB 改善。", query: "DB をアップグレードした理由は？", kw: ["postgresql", "jsonb"] },
    { id: "ct-16", rp: "codex", content: "gh pr create --title 'feat: memory bridge' で PR。", query: "PR の作成方法は？", kw: ["gh pr", "memory bridge"] },
    { id: "ct-17", rp: "claude", content: "Docker multi-stage build 導入。イメージ60%削減。", query: "Docker の改善は？", kw: ["multi-stage", "60%"] },
    { id: "ct-18", rp: "claude", content: "WebSocket から SSE に切り替え。HTTP/2 相性。", query: "リアルタイム通信方式は？", kw: ["sse", "http"] },
    { id: "ct-19", rp: "codex", content: "openssl req -newkey rsa:2048 で証明書生成。", query: "SSL 証明書の作成方法は？", kw: ["openssl", "rsa"] },
    { id: "ct-20", rp: "claude", content: "Turborepo で monorepo 管理。ビルドキャッシュ。", query: "monorepo ツールは？", kw: ["turborepo", "キャッシュ"] },
  ];

  const PROJECT = "cross-tool-bench";
  for (const c of cases) {
    await core.primeEmbedding(c.content, "passage");
    core.recordEvent({
      event_id: c.id, platform: c.rp, project: PROJECT,
      session_id: `sess-${c.rp}`, event_type: "user_prompt",
      ts: new Date().toISOString(), payload: { content: c.content },
      tags: [], privacy_tags: [],
    });
  }
  for (const c of cases) await core.primeEmbedding(c.query, "query");

  let hits = 0;
  for (const c of cases) {
    const r = core.search({ query: c.query, project: PROJECT, limit: 10 });
    if (recall(r.items as Array<{ content?: string }>, c.kw)) hits++;
  }
  const score = hits / cases.length;
  console.log(`  Recall@10: ${score.toFixed(4)} (${hits}/${cases.length})`);
  results.push({ name: "Cross-Tool Transfer", passed: score >= 0.60, score, detail: `${hits}/${cases.length}` });

  core.shutdown("cross-tool");
  rmSync(dir, { recursive: true, force: true });
}

// =========================================================================
// S56-002: Session Resume
// =========================================================================

async function runSessionResume(): Promise<void> {
  console.log("\n=== S56-002: Session Resume ===");
  const { core, dir } = createTestCore("session");
  await ensureReady(core, "session");

  const PROJECT = "session-bench";
  const steps = [
    { id: "s-01", content: "auth middleware リファクタリング開始。Cookie と Header の不統一を解消。", ts: "2026-03-15T10:00:00Z" },
    { id: "s-02", content: "JWT バリデーションを validateToken() に抽出。", ts: "2026-03-15T10:15:00Z" },
    { id: "s-03", content: "Cookie パーサー削除、Authorization ヘッダに統一。", ts: "2026-03-15T10:30:00Z" },
    { id: "s-04", content: "リフレッシュトークンのローテーション実装。有効期限7日。", ts: "2026-03-15T10:45:00Z" },
    { id: "s-05", content: "CORS 設定更新。credentials: true 追加。", ts: "2026-03-15T11:00:00Z" },
    { id: "s-06", content: "auth テスト追加。12テスト全パス。PR #42 作成。", ts: "2026-03-15T11:30:00Z" },
  ];

  for (const s of steps) {
    await core.primeEmbedding(s.content, "passage");
    core.recordEvent({
      event_id: s.id, platform: "claude", project: PROJECT,
      session_id: "session-a", event_type: "user_prompt",
      ts: s.ts, payload: { content: s.content }, tags: [], privacy_tags: [],
    });
  }

  const queries = [
    { query: "auth middleware の作業はどこまで進んだ？", kw: ["pr #42", "テスト"] },
    { query: "auth で何を変更した？", kw: ["cookie", "authorization", "jwt"] },
    { query: "リフレッシュトークンの有効期限は？", kw: ["7日"] },
    { query: "auth のテストは何件？", kw: ["12テスト"] },
    { query: "What was the last step in auth refactoring?", kw: ["pr", "#42"] },
  ];
  for (const q of queries) await core.primeEmbedding(q.query, "query");

  let hits = 0;
  for (const q of queries) {
    const r = core.search({ query: q.query, project: PROJECT, limit: 5 });
    if (recall(r.items as Array<{ content?: string }>, q.kw)) hits++;
  }
  const score = hits / queries.length;
  console.log(`  Recall@5: ${score.toFixed(4)} (${hits}/${queries.length})`);
  results.push({ name: "Session Resume", passed: score >= 0.60, score, detail: `${hits}/${queries.length}` });

  core.shutdown("session");
  rmSync(dir, { recursive: true, force: true });
}

// =========================================================================
// S56-003: Long-term Memory
// =========================================================================

async function runLongTermMemory(): Promise<void> {
  console.log("\n=== S56-003: Long-term Memory Retention ===");
  const { core, dir } = createTestCore("longterm");
  await ensureReady(core, "longterm");

  const PROJECT = "longterm-bench";
  const OLD_DATE = "2026-02-15T10:00:00.000Z";

  const oldMemories = [
    { id: "old-01", content: "PostgreSQL から CockroachDB に移行。分散DB必要。", query: "DB移行の経緯は？", kw: ["cockroachdb", "分散"] },
    { id: "old-02", content: "認証を Auth0 から自前実装に。コスト削減。", query: "認証システムを変えた理由は？", kw: ["auth0", "コスト"] },
    { id: "old-03", content: "Redis を3ノード→5ノードに拡張。メモリ80%超え。", query: "Redis の構成変更は？", kw: ["redis", "5ノード"] },
    { id: "old-04", content: "E2E を Cypress→Playwright に。速度2倍。", query: "E2E フレームワークは？", kw: ["playwright", "速度"] },
    { id: "old-05", content: "CDN を CloudFront→Cloudflare R2 に。帯域無料。", query: "CDN の選択理由は？", kw: ["cloudflare", "帯域"] },
    { id: "old-06", content: "ログ基盤を ELK→Loki+Grafana に。コスト削減。", query: "ログ基盤は？", kw: ["loki", "grafana"] },
    { id: "old-07", content: "Feature flag を LaunchDarkly→自前。年$12K削減。", query: "Feature flag は？", kw: ["launchdarkly", "12k"] },
    { id: "old-08", content: "バッチ処理を cron→Temporal に。リトライ対応。", query: "バッチ基盤は？", kw: ["temporal", "リトライ"] },
    { id: "old-09", content: "状態管理を Redux→Zustand に変更。", query: "状態管理は？", kw: ["zustand"] },
    { id: "old-10", content: "API Rate Limiting 実装。1分100リクエスト。", query: "レート制限は？", kw: ["100リクエスト", "rate"] },
  ];

  // Old memories
  for (const m of oldMemories) {
    await core.primeEmbedding(m.content, "passage");
    core.recordEvent({
      event_id: m.id, platform: "claude", project: PROJECT,
      session_id: "sess-old", event_type: "user_prompt",
      ts: OLD_DATE, payload: { content: m.content }, tags: [], privacy_tags: [],
    });
  }

  // Noise (50 items instead of 200 to avoid crash)
  const noiseTemplates = ["コードレビュー完了。", "テスト追加。", "ドキュメント更新。", "バグ修正。", "リファクタリング。"];
  for (let i = 0; i < 50; i++) {
    const c = `${noiseTemplates[i % 5]} batch-${i}`;
    await core.primeEmbedding(c, "passage");
    core.recordEvent({
      event_id: `noise-${i}`, platform: "claude", project: PROJECT,
      session_id: "sess-recent", event_type: "user_prompt",
      ts: new Date(Date.now() - (i % 20) * 86400000).toISOString(),
      payload: { content: c }, tags: [], privacy_tags: [],
    });
  }

  for (const m of oldMemories) await core.primeEmbedding(m.query, "query");

  let hits = 0;
  for (const m of oldMemories) {
    const r = core.search({ query: m.query, project: PROJECT, limit: 10 });
    if (recall(r.items as Array<{ content?: string }>, m.kw)) hits++;
  }
  const score = hits / oldMemories.length;
  console.log(`  Recall@10: ${score.toFixed(4)} (${hits}/${oldMemories.length})`);
  results.push({ name: "Long-term Memory", passed: score >= 0.50, score, detail: `${hits}/${oldMemories.length}` });

  core.shutdown("longterm");
  rmSync(dir, { recursive: true, force: true });
}

// =========================================================================
// S56-005: Multi-Project Isolation
// =========================================================================

async function runProjectIsolation(): Promise<void> {
  console.log("\n=== S56-005: Multi-Project Isolation ===");
  const { core, dir } = createTestCore("isolation");
  await ensureReady(core, "isolation");

  const dataA = [
    { id: "a-01", project: "frontend", content: "React 19 に移行。Server Components。", query: "React バージョンは？", kw: ["react 19"] },
    { id: "a-02", project: "frontend", content: "Tailwind CSS v4 採用。", query: "CSS は？", kw: ["tailwind"] },
    { id: "a-03", project: "frontend", content: "Next.js 15 使用。App Router。", query: "フレームワークは？", kw: ["next.js"] },
  ];
  const dataB = [
    { id: "b-01", project: "backend", content: "Hono でAPI構築。エッジ対応。", query: "API フレームワークは？", kw: ["hono"] },
    { id: "b-02", project: "backend", content: "Drizzle ORM 採用。型安全。", query: "ORM は？", kw: ["drizzle"] },
    { id: "b-03", project: "backend", content: "Redis でセッション管理。TTL 24h。", query: "セッション管理は？", kw: ["redis"] },
  ];

  for (const d of [...dataA, ...dataB]) {
    await core.primeEmbedding(d.content, "passage");
    core.recordEvent({
      event_id: d.id, platform: "claude", project: d.project,
      session_id: `sess-${d.project}`, event_type: "user_prompt",
      ts: new Date().toISOString(), payload: { content: d.content },
      tags: [], privacy_tags: [],
    });
  }
  for (const d of [...dataA, ...dataB]) await core.primeEmbedding(d.query, "query");

  // Isolation: A search should not return B results
  let leaks = 0;
  let totalResults = 0;
  for (const d of dataA) {
    const r = core.search({ query: d.query, project: d.project, limit: 10 });
    const items = r.items as Array<{ content?: string }>;
    totalResults += items.length;
    for (const item of items) {
      const c = String(item.content || "").toLowerCase();
      if (dataB.some((b) => b.kw.some((kw) => c.includes(kw.toLowerCase())))) leaks++;
    }
  }
  const leakRate = totalResults > 0 ? leaks / totalResults : 0;
  console.log(`  Leak rate: ${leakRate.toFixed(4)} (${leaks} leaks in ${totalResults} results)`);

  // Recall: A search should find A results
  let hits = 0;
  for (const d of dataA) {
    const r = core.search({ query: d.query, project: d.project, limit: 10 });
    if (recall(r.items as Array<{ content?: string }>, d.kw)) hits++;
  }
  const recallScore = hits / dataA.length;
  console.log(`  Project A Recall@10: ${recallScore.toFixed(4)} (${hits}/${dataA.length})`);

  results.push({ name: "Project Isolation (leak)", passed: leakRate <= 0.05, score: 1 - leakRate, detail: `leak=${leakRate.toFixed(4)}` });
  results.push({ name: "Project Isolation (recall)", passed: recallScore >= 0.60, score: recallScore, detail: `${hits}/${dataA.length}` });

  core.shutdown("isolation");
  rmSync(dir, { recursive: true, force: true });
}

// =========================================================================
// メイン実行
// =========================================================================

async function main() {
  console.log("§56 Differentiator Benchmarks Runner");
  console.log("=====================================");

  await runCrossToolTransfer();
  await runSessionResume();
  await runLongTermMemory();
  await runProjectIsolation();

  console.log("\n=====================================");
  console.log("RESULTS SUMMARY");
  console.log("=====================================");
  for (const r of results) {
    const mark = r.passed ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${r.name}: ${r.score.toFixed(4)} (${r.detail})`);
  }

  const allPassed = results.every((r) => r.passed);
  console.log(`\nOverall: ${allPassed ? "ALL PASS" : "SOME FAILED"}`);

  // JSON レポート出力
  const report = {
    schema_version: "differentiator-benchmark-v1",
    generated_at: new Date().toISOString(),
    results: results.map((r) => ({ ...r })),
    all_passed: allPassed,
  };
  const outPath = join(import.meta.dir, "../../memory-server/src/benchmark/results/differentiator-latest.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Report: ${outPath}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
