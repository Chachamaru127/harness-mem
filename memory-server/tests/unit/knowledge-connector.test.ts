/**
 * IMP-010: 外部ナレッジコネクタテスト
 *
 * テストケース:
 *
 * [github-issues.ts ユニット]
 * 1. 正常: parseGitHubIssues - 正常な JSON から観測を生成
 * 2. 正常: parseGitHubIssues - ラベル/ステートがタグに反映される
 * 3. 正常: buildGhIssueListCommand - gh コマンド文字列を生成
 * 4. 境界: parseGitHubIssues - 不正 JSON はエラーを返す
 * 5. 境界: parseGitHubIssues - 空配列は observations を返さない
 *
 * [adr-decisions.ts ユニット]
 * 6. 正常: parseDecisionsMd - ## セクションから複数決定を抽出
 * 7. 正常: parseDecisionsMd - 日付プレフィックスが created_at に反映
 * 8. 正常: parseAdrFile - ADR ファイルからタイトル/ステータスを抽出
 * 9. 境界: parseAdrFile - H1 なし → error を返す
 *
 * [HarnessMemCore 統合]
 * 10. 正常: ingestGitHubIssues - 新規 issue が observations に登録される
 * 11. 正常: ingestGitHubIssues - 同一 issue の再取り込みは deduped (skipped)
 * 12. 正常: ingestKnowledgeFile (decisions_md) - 決定事項が observations に登録
 * 13. 正常: ingestKnowledgeFile (adr) - ADR が observations に登録
 * 14. 境界: ingestGitHubIssues - repo/json 未指定はエラー応答
 * 15. 境界: ingestKnowledgeFile - file_path/content 未指定はエラー応答
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { parseGitHubIssues, buildGhIssueListCommand } from "../../src/connectors/github-issues";
import { parseDecisionsMd, parseAdrFile } from "../../src/connectors/adr-decisions";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-connector-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 37888,
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
    antigravityIngestEnabled: false,
  };
}

// ----------------------------------------------------------------
// サンプルデータ
// ----------------------------------------------------------------

const SAMPLE_ISSUES_JSON = JSON.stringify([
  {
    number: 42,
    title: "Add TypeScript support",
    body: "We should add TypeScript support to the project.",
    state: "open",
    labels: [{ name: "enhancement" }, { name: "typescript" }],
    url: "https://github.com/owner/repo/issues/42",
    createdAt: "2026-01-10T10:00:00Z",
    updatedAt: "2026-01-15T12:00:00Z",
    author: { login: "alice" },
  },
  {
    number: 43,
    title: "Fix memory leak",
    body: "There is a memory leak in the event handler.",
    state: "closed",
    labels: [{ name: "bug" }],
    url: "https://github.com/owner/repo/issues/43",
    createdAt: "2026-01-11T09:00:00Z",
    updatedAt: "2026-01-16T08:00:00Z",
    author: { login: "bob" },
  },
]);

const SAMPLE_DECISIONS_MD = `# Decisions

## 2026-01-10: Use SQLite for storage
SQLite is lightweight and sufficient for single-machine use.
We will use bun:sqlite for zero-dependency access.

## 2026-01-15: Adopt TypeScript strict mode
All new code must pass TypeScript strict mode to catch type errors early.

## No-date decision
This decision has no date prefix.
`;

const SAMPLE_ADR_MD = `# ADR-0001: Use ONNX for embedding inference

## Status
Accepted

## Context
We need an embedding model that works offline without network calls.

## Decision
Use ONNX Runtime with a quantized model.

## Consequences
Inference is fast but requires a model file to be bundled.
`;

// ----------------------------------------------------------------
// github-issues.ts ユニットテスト
// ----------------------------------------------------------------

describe("IMP-010: github-issues コネクタ (ユニット)", () => {
  test("正常: parseGitHubIssues - 正常な JSON から観測を生成", () => {
    const { observations, errors } = parseGitHubIssues({
      repo: "owner/repo",
      json: SAMPLE_ISSUES_JSON,
    });

    expect(errors).toHaveLength(0);
    expect(observations).toHaveLength(2);

    const first = observations[0];
    expect(first.title).toBe("[owner/repo] #42: Add TypeScript support");
    expect(first.source).toBe("github:owner/repo");
    expect(first.dedupeHash).toBeTruthy();
    expect(first.content).toContain("Issue #42");
    expect(first.content).toContain("We should add TypeScript support");
  });

  test("正常: parseGitHubIssues - ラベル/ステートがタグに反映される", () => {
    const { observations } = parseGitHubIssues({
      repo: "owner/repo",
      json: SAMPLE_ISSUES_JSON,
    });

    const issue42 = observations[0];
    expect(issue42.tags).toContain("github-issue");
    expect(issue42.tags).toContain("label:enhancement");
    expect(issue42.tags).toContain("label:typescript");
    expect(issue42.tags).toContain("state:open");

    const issue43 = observations[1];
    expect(issue43.tags).toContain("label:bug");
    expect(issue43.tags).toContain("state:closed");
  });

  test("正常: buildGhIssueListCommand - gh コマンド文字列を生成", () => {
    const cmd = buildGhIssueListCommand({
      repo: "owner/repo",
      state: "open",
      limit: 50,
    });
    expect(cmd).toContain("gh issue list");
    expect(cmd).toContain("--repo owner/repo");
    expect(cmd).toContain("--state open");
    expect(cmd).toContain("--limit 50");
    expect(cmd).toContain("--json");
  });

  test("境界: parseGitHubIssues - 不正 JSON はエラーを返す", () => {
    const { observations, errors } = parseGitHubIssues({
      repo: "owner/repo",
      json: "not valid json {{{",
    });
    expect(observations).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].index).toBe(-1);
  });

  test("境界: parseGitHubIssues - 空配列は observations を返さない", () => {
    const { observations, errors } = parseGitHubIssues({
      repo: "owner/repo",
      json: "[]",
    });
    expect(observations).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// ----------------------------------------------------------------
// adr-decisions.ts ユニットテスト
// ----------------------------------------------------------------

describe("IMP-010: adr-decisions コネクタ (ユニット)", () => {
  test("正常: parseDecisionsMd - ## セクションから複数決定を抽出", () => {
    const { observations, errors } = parseDecisionsMd({
      filePath: "docs/decisions.md",
      content: SAMPLE_DECISIONS_MD,
    });
    expect(errors).toHaveLength(0);
    expect(observations).toHaveLength(3);

    expect(observations[0].title).toContain("Use SQLite for storage");
    expect(observations[0].tags).toContain("decision");
    expect(observations[0].tags).toContain("adr");
    expect(observations[0].source).toBe("file:docs/decisions.md");
  });

  test("正常: parseDecisionsMd - 日付プレフィックスが created_at に反映", () => {
    const { observations } = parseDecisionsMd({
      filePath: "docs/decisions.md",
      content: SAMPLE_DECISIONS_MD,
    });
    // 最初の2件は日付プレフィックスあり
    expect(observations[0].created_at).toMatch(/^2026-01-10/);
    expect(observations[1].created_at).toMatch(/^2026-01-15/);
    // 3件目は日付なし → フォールバック日時 (ISO形式であること)
    expect(observations[2].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("正常: parseAdrFile - ADR ファイルからタイトル/ステータスを抽出", () => {
    const { observation, error } = parseAdrFile({
      filePath: "docs/adr/0001-use-onnx.md",
      content: SAMPLE_ADR_MD,
    });
    expect(error).toBeUndefined();
    expect(observation).not.toBeNull();
    expect(observation?.title).toContain("ADR-0001");
    expect(observation?.title).toContain("Use ONNX for embedding inference");
    expect(observation?.tags).toContain("adr");
    expect(observation?.tags).toContain("adr-status:accepted");
    expect(observation?.tags).toContain("adr-number:0001");
    expect(observation?.dedupeHash).toBeTruthy();
  });

  test("境界: parseAdrFile - H1 なし → error を返す", () => {
    const { observation, error } = parseAdrFile({
      filePath: "docs/adr/empty.md",
      content: "## Status\nDraft\n\n## Context\nno title here",
    });
    expect(observation).toBeNull();
    expect(error).toContain("No H1 title");
  });
});

// ----------------------------------------------------------------
// HarnessMemCore 統合テスト
// ----------------------------------------------------------------

describe("IMP-010: HarnessMemCore 統合 (ingestGitHubIssues / ingestKnowledgeFile)", () => {
  test("正常: ingestGitHubIssues - 新規 issue が observations に登録される", () => {
    const core = new HarnessMemCore(createConfig("gh-import"));
    try {
      const result = core.ingestGitHubIssues({
        repo: "owner/repo",
        json: SAMPLE_ISSUES_JSON,
        project: "test-project",
      });
      expect(result.ok).toBe(true);
      const stats = result.items[0] as Record<string, unknown>;
      expect(stats.issues_imported).toBe(2);
      expect(stats.issues_skipped).toBe(0);
      expect(stats.parse_errors).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: ingestGitHubIssues - 同一 issue の再取り込みは deduped (skipped)", () => {
    const core = new HarnessMemCore(createConfig("gh-dedup"));
    try {
      // 1回目
      core.ingestGitHubIssues({
        repo: "owner/repo",
        json: SAMPLE_ISSUES_JSON,
        project: "test-project",
      });
      // 2回目 (同一 JSON)
      const result = core.ingestGitHubIssues({
        repo: "owner/repo",
        json: SAMPLE_ISSUES_JSON,
        project: "test-project",
      });
      expect(result.ok).toBe(true);
      const stats = result.items[0] as Record<string, unknown>;
      // 2回目は全て deduped
      expect(stats.issues_imported).toBe(0);
      expect(stats.issues_skipped).toBe(2);
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: ingestKnowledgeFile (decisions_md) - 決定事項が observations に登録", () => {
    const core = new HarnessMemCore(createConfig("decisions-import"));
    try {
      const result = core.ingestKnowledgeFile({
        file_path: "docs/decisions.md",
        content: SAMPLE_DECISIONS_MD,
        kind: "decisions_md",
        project: "test-project",
      });
      expect(result.ok).toBe(true);
      const stats = result.items[0] as Record<string, unknown>;
      expect(stats.entries_imported).toBe(3);
      expect(stats.entries_skipped).toBe(0);
      expect(stats.kind).toBe("decisions_md");
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: ingestKnowledgeFile (adr) - ADR が observations に登録", () => {
    const core = new HarnessMemCore(createConfig("adr-import"));
    try {
      const result = core.ingestKnowledgeFile({
        file_path: "docs/adr/0001-use-onnx.md",
        content: SAMPLE_ADR_MD,
        kind: "adr",
        project: "test-project",
      });
      expect(result.ok).toBe(true);
      const stats = result.items[0] as Record<string, unknown>;
      expect(stats.entries_imported).toBe(1);
      expect(stats.entries_skipped).toBe(0);
      expect(stats.kind).toBe("adr");
    } finally {
      core.shutdown("test");
    }
  });

  test("境界: ingestGitHubIssues - repo/json 未指定はエラー応答", () => {
    const core = new HarnessMemCore(createConfig("gh-missing-params"));
    try {
      const result = core.ingestGitHubIssues({ repo: "", json: "" });
      expect(result.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("境界: ingestKnowledgeFile - file_path/content 未指定はエラー応答", () => {
    const core = new HarnessMemCore(createConfig("kf-missing-params"));
    try {
      const result = core.ingestKnowledgeFile({ file_path: "", content: "" });
      expect(result.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });
});
