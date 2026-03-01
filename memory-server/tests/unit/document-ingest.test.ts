/**
 * COMP-007: PDF/Markdown ドキュメント取り込み テスト
 *
 * テストケース:
 * 1. 正常: Markdown（見出し分割）でチャンク抽出
 * 2. 正常: HTML（タグ除去）でテキスト抽出
 * 3. 正常: プレーンテキストで単一チャンク抽出
 * 4. 正常: Markdown の H1/H2 見出しでチャンク分割される
 * 5. 境界: 空のコンテンツは空配列を返す
 * 6. 境界: 非常に長いコンテンツは適切に切り詰められる
 * 7. 正常: HTML エンティティが適切にデコードされる
 * 8. 正常: ingestDocument で観察として記録できる
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseMarkdownChunks,
  parseHtmlText,
  ingestDocument,
  type DocumentChunk,
} from "../../src/ingest/document-parser";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-docingest-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
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
    localModelsEnabled: false,
    antigravityEnabled: false,
  };
}

describe("COMP-007: ドキュメント取り込み", () => {
  test("正常: Markdown の見出しでチャンク分割される", () => {
    const md = `# プロジェクト概要

これはプロジェクトの説明です。

## 技術スタック

Bun と TypeScript を使用します。

## セットアップ

npm install を実行してください。
`;
    const chunks = parseMarkdownChunks(md);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // 少なくとも1つのチャンクがある
    expect(chunks[0].title).toBeTruthy();
    expect(chunks[0].content).toBeTruthy();
  });

  test("正常: H1/H2 見出しが独立したチャンクになる", () => {
    const md = `# 第1章

第1章の内容です。

## 1.1 セクション

セクションの内容です。

# 第2章

第2章の内容です。
`;
    const chunks = parseMarkdownChunks(md);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const titles = chunks.map((c) => c.title);
    expect(titles.some((t) => t.includes("第1章") || t.includes("1.1"))).toBe(true);
  });

  test("正常: HTML タグが除去されてテキストが抽出される", () => {
    const html = `<html>
<head><title>テストページ</title></head>
<body>
  <h1>メインタイトル</h1>
  <p>本文のテキストです。<strong>重要</strong>な部分があります。</p>
  <ul>
    <li>項目1</li>
    <li>項目2</li>
  </ul>
</body>
</html>`;
    const text = parseHtmlText(html);
    expect(text).toContain("メインタイトル");
    expect(text).toContain("本文のテキストです");
    expect(text).toContain("重要");
    // タグが除去されている
    expect(text).not.toContain("<h1>");
    expect(text).not.toContain("<p>");
  });

  test("正常: HTML エンティティがデコードされる", () => {
    const html = `<p>&amp; &lt;example&gt; &quot;quoted&quot; &#39;apos&#39;</p>`;
    const text = parseHtmlText(html);
    expect(text).toContain("&");
    expect(text).toContain("<example>");
  });

  test("境界: 空のコンテンツは空配列を返す", () => {
    const chunks = parseMarkdownChunks("");
    expect(chunks).toEqual([]);
  });

  test("境界: 非常に長いコンテンツは 5000 文字以内に切り詰められる", () => {
    const longContent = "a".repeat(20000);
    const chunks = parseMarkdownChunks(`# Long\n\n${longContent}`);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(5000);
    }
  });

  test("正常: プレーンテキストは単一チャンクとして返される", () => {
    const plain = "これはプレーンテキストのコンテンツです。見出しがなく、段落のみです。";
    const chunks = parseMarkdownChunks(plain);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toContain("プレーンテキスト");
  });

  test("正常: ingestDocument で観察として記録できる", async () => {
    const core = new HarnessMemCore(createConfig("ingest-doc"));
    const md = `# 技術決定

TypeScript を採用する。Bun でビルドする。
`;
    const result = await ingestDocument({
      core,
      content: md,
      format: "markdown",
      project: "test-proj",
      session_id: "sess-doc",
      source_title: "技術決定ドキュメント",
    });

    expect(result.ok).toBe(true);
    expect(result.chunks_processed).toBeGreaterThanOrEqual(1);
    expect(result.observations_created).toBeGreaterThanOrEqual(1);
  });
});
