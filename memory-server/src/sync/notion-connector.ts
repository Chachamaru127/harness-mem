/**
 * V5-005: Notion コネクタ
 *
 * Notion API (fetch ベース) でページ/データベースを同期する。
 * - pull: 指定データベースのページを取得→観察に変換
 * - push: 観察をページとして作成
 */

import type { SyncConnector, ConnectorConfig, SyncChangeset, PushResult } from "./types";

export class NotionConnector implements SyncConnector {
  readonly name: string;
  readonly type = 'notion' as const;

  private token = "";
  private databaseId = "";
  private apiBase = "https://api.notion.com/v1";
  private notionVersion = "2022-06-28";

  constructor(name: string) {
    this.name = name;
  }

  async initialize(config: ConnectorConfig): Promise<void> {
    this.token = config.credentials.token || process.env.NOTION_TOKEN || "";
    this.databaseId = (config.settings?.database_id as string) || "";
    if (config.settings?.api_base) {
      this.apiBase = config.settings.api_base as string;
    }
  }

  async pull(): Promise<SyncChangeset[]> {
    if (!this.token || !this.databaseId) {
      throw new Error("Notion connector not initialized: token and database_id are required");
    }

    const url = `${this.apiBase}/databases/${this.databaseId}/query`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Notion-Version": this.notionVersion,
      },
      body: JSON.stringify({ page_size: 100 }),
    });

    if (!response.ok) {
      throw new Error(`Notion API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { results: Array<Record<string, unknown>> };
    const changesets: SyncChangeset[] = [];

    for (const page of data.results) {
      const pageId = String(page.id || "");
      const lastEditedTime = String(page.last_edited_time || new Date().toISOString());

      // タイトルの抽出
      const properties = (page.properties as Record<string, unknown>) || {};
      let title = "";
      for (const [, prop] of Object.entries(properties)) {
        const p = prop as Record<string, unknown>;
        if (p.type === "title" && Array.isArray(p.title)) {
          title = (p.title as Array<Record<string, unknown>>)
            .map((t) => String((t.plain_text as string) || ""))
            .join("");
          break;
        }
      }

      changesets.push({
        id: `notion::${this.databaseId}::page::${pageId}`,
        action: 'create',
        content: title || `Notion page ${pageId}`,
        metadata: {
          source: "notion",
          database_id: this.databaseId,
          page_id: pageId,
          url: String(page.url || ""),
          last_edited_time: lastEditedTime,
        },
        timestamp: lastEditedTime,
      });
    }

    return changesets;
  }

  async push(changes: SyncChangeset[]): Promise<PushResult> {
    if (!this.token || !this.databaseId) {
      throw new Error("Notion connector not initialized: token and database_id are required");
    }

    const errors: string[] = [];
    let synced = 0;

    for (const change of changes) {
      if (change.action === 'delete') {
        continue;
      }

      try {
        const url = `${this.apiBase}/pages`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            "Notion-Version": this.notionVersion,
          },
          body: JSON.stringify({
            parent: { database_id: this.databaseId },
            properties: {
              title: {
                title: [
                  {
                    type: "text",
                    text: { content: change.content.slice(0, 200) },
                  },
                ],
              },
            },
            children: [
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: [
                    {
                      type: "text",
                      text: { content: change.content.slice(0, 2000) },
                    },
                  ],
                },
              },
            ],
          }),
        });

        if (!response.ok) {
          errors.push(`Failed to create Notion page for ${change.id}: ${response.status}`);
        } else {
          synced++;
        }
      } catch (err) {
        errors.push(`Error pushing change ${change.id}: ${String(err)}`);
      }
    }

    return { success: errors.length === 0, synced, errors };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.token) {
      return { ok: false, message: "Notion token is not configured" };
    }

    try {
      const url = `${this.apiBase}/users/me`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": this.notionVersion,
        },
      });

      if (response.ok) {
        return { ok: true, message: "Notion connection successful" };
      }
      return { ok: false, message: `Notion API returned ${response.status}: ${response.statusText}` };
    } catch (err) {
      return { ok: false, message: `Notion connection failed: ${String(err)}` };
    }
  }
}
