/**
 * IMP-010: 外部ナレッジコネクタ テスト
 *
 * GitHub Issues コネクタと ADR/decisions.md コネクタの動作を検証する。
 */

import { describe, it, expect } from "bun:test";
import {
  parseGitHubIssues,
  buildGhIssueListCommand,
} from "../../src/connectors/github-issues";
import {
  parseDecisionsMd,
  parseAdrFile,
} from "../../src/connectors/adr-decisions";

// ---------------------------------------------------------------------------
// GitHub Issues コネクタ
// ---------------------------------------------------------------------------

describe("parseGitHubIssues()", () => {
  const sampleIssues = [
    {
      number: 42,
      title: "Fix memory leak in embedding pipeline",
      body: "The embedding pipeline leaks memory when processing large batches.",
      state: "open",
      labels: [{ name: "bug" }, { name: "memory" }],
      url: "https://github.com/example/repo/issues/42",
      createdAt: "2026-01-10T10:00:00Z",
      updatedAt: "2026-01-12T15:00:00Z",
      author: { login: "alice" },
    },
    {
      number: 43,
      title: "Add TypeScript SDK",
      body: "We need a TypeScript SDK for external consumers.",
      state: "closed",
      labels: [{ name: "enhancement" }],
      url: "https://github.com/example/repo/issues/43",
      createdAt: "2026-01-11T09:00:00Z",
      updatedAt: "2026-01-20T12:00:00Z",
      author: { login: "bob" },
    },
  ];

  it("GitHub Issues を観測に変換する", () => {
    const { observations, errors } = parseGitHubIssues({
      repo: "example/repo",
      json: JSON.stringify(sampleIssues),
    });

    expect(errors).toHaveLength(0);
    expect(observations).toHaveLength(2);

    const first = observations[0];
    expect(first.title).toBe("[example/repo] #42: Fix memory leak in embedding pipeline");
    expect(first.content).toContain("Repository: example/repo");
    expect(first.content).toContain("Issue #42");
    expect(first.content).toContain("Labels: bug, memory");
    expect(first.tags).toContain("github-issue");
    expect(first.tags).toContain("label:bug");
    expect(first.tags).toContain("state:open");
    expect(first.source).toBe("github:example/repo");
    expect(first.created_at).toBe("2026-01-10T10:00:00Z");
  });

  it("重複排除ハッシュが repo + issue番号 で一意になる", () => {
    const { observations } = parseGitHubIssues({
      repo: "example/repo",
      json: JSON.stringify(sampleIssues),
    });

    // 同じ repo + issue番号 は同じハッシュを生成する
    const { observations: obs2 } = parseGitHubIssues({
      repo: "example/repo",
      json: JSON.stringify(sampleIssues),
    });

    expect(observations[0].dedupeHash).toBe(obs2[0].dedupeHash);
    expect(observations[1].dedupeHash).toBe(obs2[1].dedupeHash);

    // 異なる issue番号 は異なるハッシュ
    expect(observations[0].dedupeHash).not.toBe(observations[1].dedupeHash);
  });

  it("異なるリポジトリの同じ issue番号 は異なるハッシュ", () => {
    const { observations: obs1 } = parseGitHubIssues({
      repo: "org/repo-a",
      json: JSON.stringify([sampleIssues[0]]),
    });
    const { observations: obs2 } = parseGitHubIssues({
      repo: "org/repo-b",
      json: JSON.stringify([sampleIssues[0]]),
    });

    expect(obs1[0].dedupeHash).not.toBe(obs2[0].dedupeHash);
  });

  it("不正な JSON は errors を返す", () => {
    const { observations, errors } = parseGitHubIssues({
      repo: "example/repo",
      json: "not-valid-json",
    });

    expect(observations).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toContain("Failed to parse JSON");
  });

  it("空の配列は空の結果を返す", () => {
    const { observations, errors } = parseGitHubIssues({
      repo: "example/repo",
      json: "[]",
    });

    expect(observations).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("metadata に repo / issue_number / state が含まれる", () => {
    const { observations } = parseGitHubIssues({
      repo: "example/repo",
      json: JSON.stringify([sampleIssues[0]]),
      project: "my-project",
    });

    const meta = observations[0].metadata;
    expect(meta.repo).toBe("example/repo");
    expect(meta.issue_number).toBe(42);
    expect(meta.state).toBe("open");
    expect(meta.project).toBe("my-project");
  });
});

describe("buildGhIssueListCommand()", () => {
  it("デフォルトコマンドを生成する", () => {
    const cmd = buildGhIssueListCommand({ repo: "example/repo" });
    expect(cmd).toContain("gh issue list");
    expect(cmd).toContain("--repo example/repo");
    expect(cmd).toContain("--state all");
    expect(cmd).toContain("--limit 100");
    expect(cmd).toContain("--json");
  });

  it("ラベルフィルタを含む", () => {
    const cmd = buildGhIssueListCommand({
      repo: "example/repo",
      labels: ["bug", "priority:high"],
    });
    expect(cmd).toContain("--label bug,priority:high");
  });
});

// ---------------------------------------------------------------------------
// decisions.md コネクタ
// ---------------------------------------------------------------------------

describe("parseDecisionsMd()", () => {
  const sampleMd = `# Project Decisions

## 2026-01-10: Use SQLite for storage
SQLite is lightweight and sufficient for single-machine use.
It avoids the operational overhead of a separate DB server.

## 2026-01-15: Adopt TypeScript strict mode
All new code must pass TypeScript strict mode checks.
This catches common errors at compile time.

## No-date decision heading
This decision has no date prefix.
`;

  it("decisions.md のセクションを観測に変換する", () => {
    const { observations, errors } = parseDecisionsMd({
      filePath: "docs/decisions.md",
      content: sampleMd,
    });

    expect(errors).toHaveLength(0);
    expect(observations).toHaveLength(3);
  });

  it("日付付き見出しを正しく解析する", () => {
    const { observations } = parseDecisionsMd({
      filePath: "docs/decisions.md",
      content: sampleMd,
    });

    const first = observations[0];
    expect(first.title).toBe("[Decision] Use SQLite for storage");
    expect(first.created_at).toBe("2026-01-10T00:00:00.000Z");
    expect(first.content).toContain("SQLite is lightweight");
    expect(first.tags).toContain("decision");
  });

  it("日付なし見出しはフォールバック日時を使う", () => {
    const fixedNow = "2026-02-27T00:00:00.000Z";
    const { observations } = parseDecisionsMd({
      filePath: "docs/decisions.md",
      content: sampleMd,
      fallbackNowIso: () => fixedNow,
    });

    const noDateObs = observations.find((o) =>
      o.title.includes("No-date decision heading")
    );
    expect(noDateObs).toBeDefined();
    expect(noDateObs!.created_at).toBe(fixedNow);
  });

  it("重複排除ハッシュが filePath + 見出しで一意になる", () => {
    const { observations: obs1 } = parseDecisionsMd({
      filePath: "docs/decisions.md",
      content: sampleMd,
    });
    const { observations: obs2 } = parseDecisionsMd({
      filePath: "docs/decisions.md",
      content: sampleMd,
    });

    expect(obs1[0].dedupeHash).toBe(obs2[0].dedupeHash);
  });

  it("異なる filePath は異なるハッシュ", () => {
    const { observations: obs1 } = parseDecisionsMd({
      filePath: "docs/decisions-a.md",
      content: sampleMd,
    });
    const { observations: obs2 } = parseDecisionsMd({
      filePath: "docs/decisions-b.md",
      content: sampleMd,
    });

    expect(obs1[0].dedupeHash).not.toBe(obs2[0].dedupeHash);
  });

  it("空のコンテンツは空の結果を返す", () => {
    const { observations, errors } = parseDecisionsMd({
      filePath: "docs/decisions.md",
      content: "",
    });

    expect(observations).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ADR ファイルコネクタ
// ---------------------------------------------------------------------------

describe("parseAdrFile()", () => {
  const sampleAdr = `# ADR-0001: Use ONNX for embedding inference

## Status
Accepted

## Context
We need an embedding model for semantic search. Options are cloud API or local inference.

## Decision
Use ONNX Runtime with the ruri-v3-30m model for local inference.
This avoids API costs and latency.

## Consequences
- Requires ~100MB model download on first use
- Inference latency ~50ms on M2 chip
`;

  it("ADR ファイルを観測に変換する", () => {
    const { observation, error } = parseAdrFile({
      filePath: "docs/adr/0001-use-onnx.md",
      content: sampleAdr,
    });

    expect(error).toBeUndefined();
    expect(observation).not.toBeNull();
    expect(observation!.title).toBe("[ADR-0001] Use ONNX for embedding inference");
    expect(observation!.tags).toContain("adr");
    expect(observation!.tags).toContain("adr-status:accepted");
    expect(observation!.tags).toContain("adr-number:0001");
  });

  it("ADR番号をメタデータに含む", () => {
    const { observation } = parseAdrFile({
      filePath: "docs/adr/0001-use-onnx.md",
      content: sampleAdr,
      project: "harness-mem",
    });

    expect(observation!.metadata.adrNumber).toBe(1);
    expect(observation!.metadata.status).toBe("accepted");
    expect(observation!.metadata.project).toBe("harness-mem");
  });

  it("ファイル名から日付を推定する", () => {
    const { observation } = parseAdrFile({
      filePath: "docs/adr/2026-01-15-use-sqlite.md",
      content: sampleAdr,
    });

    expect(observation!.created_at).toBe("2026-01-15T00:00:00.000Z");
  });

  it("H1 見出しなしはエラーを返す", () => {
    const { observation, error } = parseAdrFile({
      filePath: "docs/adr/broken.md",
      content: "## Status\nProposed\n\nNo title here.",
    });

    expect(observation).toBeNull();
    expect(error).toContain("No H1 title");
  });

  it("重複排除ハッシュが filePath で一意になる", () => {
    const { observation: obs1 } = parseAdrFile({
      filePath: "docs/adr/0001.md",
      content: sampleAdr,
    });
    const { observation: obs2 } = parseAdrFile({
      filePath: "docs/adr/0001.md",
      content: sampleAdr,
    });

    expect(obs1!.dedupeHash).toBe(obs2!.dedupeHash);
  });
});
