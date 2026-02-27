/**
 * GitHub Issues コネクタ
 *
 * gh CLI を利用して GitHub Issues を取得し、harness-mem の観測形式に変換する。
 * 重複排除は dedupeHash (repo + issue number) で行う。
 */

import { createHash } from "node:crypto";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string };
}

export interface GitHubIssueObservation {
  dedupeHash: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

/**
 * gh CLI から JSON 配列文字列をパースして観測に変換する。
 *
 * gh issue list --json number,title,body,state,labels,url,createdAt,updatedAt,author
 */
export function parseGitHubIssues(params: {
  repo: string;
  json: string;
  project?: string;
}): {
  observations: GitHubIssueObservation[];
  errors: Array<{ index: number; error: string }>;
} {
  const observations: GitHubIssueObservation[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  let issues: unknown[];
  try {
    issues = JSON.parse(params.json) as unknown[];
  } catch {
    return {
      observations: [],
      errors: [{ index: -1, error: "Failed to parse JSON from gh CLI output" }],
    };
  }

  if (!Array.isArray(issues)) {
    return {
      observations: [],
      errors: [{ index: -1, error: "Expected JSON array from gh CLI output" }],
    };
  }

  for (let i = 0; i < issues.length; i++) {
    try {
      const raw = issues[i] as Record<string, unknown>;

      const issue: GitHubIssue = {
        number: raw.number as number,
        title: String(raw.title ?? ""),
        body: String(raw.body ?? ""),
        state: (raw.state as "open" | "closed") ?? "open",
        labels: (raw.labels as Array<{ name: string }>) ?? [],
        url: String(raw.url ?? ""),
        createdAt: String(raw.createdAt ?? new Date().toISOString()),
        updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
        author: { login: String((raw.author as Record<string, unknown>)?.login ?? "") },
      };

      // 重複排除ハッシュ: repo + issue番号で一意
      const dedupeHash = createHash("sha256")
        .update(`github-issue:${params.repo}:${issue.number}`)
        .digest("hex")
        .slice(0, 16);

      const labelTags = issue.labels.map((l) => `label:${l.name}`);
      const stateTags = [`state:${issue.state}`];
      const tags = ["github-issue", ...labelTags, ...stateTags];

      const content = [
        `Repository: ${params.repo}`,
        `Issue #${issue.number}: ${issue.title}`,
        `State: ${issue.state}`,
        `Author: ${issue.author.login}`,
        `URL: ${issue.url}`,
        issue.labels.length > 0
          ? `Labels: ${issue.labels.map((l) => l.name).join(", ")}`
          : null,
        "",
        issue.body || "(no description)",
      ]
        .filter((line) => line !== null)
        .join("\n");

      observations.push({
        dedupeHash,
        title: `[${params.repo}] #${issue.number}: ${issue.title}`,
        content,
        tags,
        source: `github:${params.repo}`,
        created_at: issue.createdAt,
        updated_at: issue.updatedAt,
        metadata: {
          repo: params.repo,
          issue_number: issue.number,
          state: issue.state,
          url: issue.url,
          author: issue.author.login,
          project: params.project ?? null,
        },
      });
    } catch (err) {
      errors.push({ index: i, error: String(err) });
    }
  }

  return { observations, errors };
}

/**
 * gh CLI コマンドを生成する（実行は呼び出し元に委譲）。
 */
export function buildGhIssueListCommand(params: {
  repo: string;
  state?: "open" | "closed" | "all";
  limit?: number;
  labels?: string[];
}): string {
  const state = params.state ?? "all";
  const limit = params.limit ?? 100;
  const fields = "number,title,body,state,labels,url,createdAt,updatedAt,author";
  let cmd = `gh issue list --repo ${params.repo} --state ${state} --limit ${limit} --json ${fields}`;
  if (params.labels && params.labels.length > 0) {
    cmd += ` --label ${params.labels.join(",")}`;
  }
  return cmd;
}
