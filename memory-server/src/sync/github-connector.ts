/**
 * V5-005: GitHub コネクタ
 *
 * GitHub API (fetch ベース) で Issues を記憶として同期する。
 * - pull: 指定リポジトリの Issues からコメントを取得→観察に変換
 * - push: 観察の要約を Issue コメントとして追加
 */

import type { SyncConnector, ConnectorConfig, SyncChangeset, PushResult } from "./types";

export class GitHubConnector implements SyncConnector {
  readonly name: string;
  readonly type = 'github' as const;

  private token = "";
  private repo = "";
  private apiBase = "https://api.github.com";

  constructor(name: string) {
    this.name = name;
  }

  async initialize(config: ConnectorConfig): Promise<void> {
    this.token = config.credentials.token || process.env.GITHUB_TOKEN || "";
    this.repo = (config.settings?.repo as string) || "";
    if (config.settings?.api_base) {
      this.apiBase = config.settings.api_base as string;
    }
  }

  async pull(): Promise<SyncChangeset[]> {
    if (!this.token || !this.repo) {
      throw new Error("GitHub connector not initialized: token and repo are required");
    }

    const url = `${this.apiBase}/repos/${this.repo}/issues?state=all&per_page=100`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const issues = await response.json() as Array<Record<string, unknown>>;
    const changesets: SyncChangeset[] = [];

    for (const issue of issues) {
      const id = String(issue.number);
      const title = String(issue.title || "");
      const body = String(issue.body || "");
      const updatedAt = String(issue.updated_at || new Date().toISOString());

      changesets.push({
        id: `github::${this.repo}::issue::${id}`,
        action: 'create',
        content: `${title}\n\n${body}`,
        metadata: {
          source: "github",
          repo: this.repo,
          issue_number: id,
          url: String(issue.html_url || ""),
          state: String(issue.state || ""),
          labels: Array.isArray(issue.labels)
            ? (issue.labels as Array<Record<string, unknown>>).map((l) => String(l.name || ""))
            : [],
        },
        timestamp: updatedAt,
      });
    }

    return changesets;
  }

  async push(changes: SyncChangeset[]): Promise<PushResult> {
    if (!this.token || !this.repo) {
      throw new Error("GitHub connector not initialized: token and repo are required");
    }

    const errors: string[] = [];
    let synced = 0;

    for (const change of changes) {
      if (change.action === 'delete') {
        continue;
      }

      try {
        // 観察の要約を Issue コメントとして追加
        const issueNumber = change.metadata.issue_number as string | undefined;
        if (!issueNumber) {
          // 新規 Issue として作成
          const url = `${this.apiBase}/repos/${this.repo}/issues`;
          const response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.token}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({
              title: `[harness-mem] ${change.id}`,
              body: change.content,
            }),
          });
          if (!response.ok) {
            errors.push(`Failed to create issue for ${change.id}: ${response.status}`);
          } else {
            synced++;
          }
        } else {
          // 既存 Issue にコメント追加
          const url = `${this.apiBase}/repos/${this.repo}/issues/${issueNumber}/comments`;
          const response = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.token}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({ body: change.content }),
          });
          if (!response.ok) {
            errors.push(`Failed to comment on issue ${issueNumber}: ${response.status}`);
          } else {
            synced++;
          }
        }
      } catch (err) {
        errors.push(`Error pushing change ${change.id}: ${String(err)}`);
      }
    }

    return { success: errors.length === 0, synced, errors };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.token) {
      return { ok: false, message: "GitHub token is not configured" };
    }

    try {
      const url = this.repo
        ? `${this.apiBase}/repos/${this.repo}`
        : `${this.apiBase}/user`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (response.ok) {
        return { ok: true, message: "GitHub connection successful" };
      }
      return { ok: false, message: `GitHub API returned ${response.status}: ${response.statusText}` };
    } catch (err) {
      return { ok: false, message: `GitHub connection failed: ${String(err)}` };
    }
  }
}
