/**
 * V5-005: Google Drive コネクタ
 *
 * Google Drive API (fetch ベース) でドキュメントを同期する。
 * - pull: 指定フォルダのドキュメントを取得→観察に変換
 * - push: 観察をドキュメントとして作成
 */

import type { SyncConnector, ConnectorConfig, SyncChangeset, PushResult } from "./types";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export class GoogleDriveConnector implements SyncConnector {
  readonly name: string;
  readonly type = 'gdrive' as const;

  private accessToken = "";
  private folderId = "";
  private serviceAccountKey: ServiceAccountKey | null = null;
  private apiBase = "https://www.googleapis.com";

  constructor(name: string) {
    this.name = name;
  }

  async initialize(config: ConnectorConfig): Promise<void> {
    const rawKey = config.credentials.service_account_key
      || process.env.GDRIVE_SERVICE_ACCOUNT_KEY
      || "";

    if (rawKey) {
      try {
        this.serviceAccountKey = JSON.parse(rawKey) as ServiceAccountKey;
      } catch {
        // 直接トークンとして扱う
        this.accessToken = rawKey;
      }
    }

    // テスト用に直接トークンも受け付ける
    if (config.credentials.access_token) {
      this.accessToken = config.credentials.access_token;
    }

    this.folderId = (config.settings?.folder_id as string) || "";
    if (config.settings?.api_base) {
      this.apiBase = config.settings.api_base as string;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }
    if (!this.serviceAccountKey) {
      throw new Error("Google Drive: no credentials configured");
    }
    // サービスアカウントの JWT 認証は実装せず、テスト環境では access_token を直接使用
    throw new Error("Google Drive: service account JWT authentication not implemented; use access_token directly");
  }

  async pull(): Promise<SyncChangeset[]> {
    const token = await this.getAccessToken();

    const query = this.folderId
      ? `'${this.folderId}' in parents and trashed=false`
      : "trashed=false";

    const url = new URL(`${this.apiBase}/drive/v3/files`);
    url.searchParams.set("q", query);
    url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,webViewLink)");
    url.searchParams.set("pageSize", "100");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { files: Array<Record<string, unknown>> };
    const changesets: SyncChangeset[] = [];

    for (const file of data.files) {
      const fileId = String(file.id || "");
      const fileName = String(file.name || "");
      const modifiedTime = String(file.modifiedTime || new Date().toISOString());
      const mimeType = String(file.mimeType || "");

      // テキストコンテンツを取得（Google Docs のみ）
      let content = fileName;
      if (mimeType === "application/vnd.google-apps.document") {
        try {
          const exportUrl = `${this.apiBase}/drive/v3/files/${fileId}/export?mimeType=text/plain`;
          const exportRes = await fetch(exportUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (exportRes.ok) {
            content = await exportRes.text();
          }
        } catch {
          // エクスポート失敗は無視、ファイル名のみ使用
        }
      }

      changesets.push({
        id: `gdrive::${this.folderId || "root"}::file::${fileId}`,
        action: 'create',
        content: `${fileName}\n\n${content}`.slice(0, 10000),
        metadata: {
          source: "gdrive",
          folder_id: this.folderId || "root",
          file_id: fileId,
          file_name: fileName,
          mime_type: mimeType,
          url: String(file.webViewLink || ""),
          modified_time: modifiedTime,
        },
        timestamp: modifiedTime,
      });
    }

    return changesets;
  }

  async push(changes: SyncChangeset[]): Promise<PushResult> {
    const token = await this.getAccessToken();
    const errors: string[] = [];
    let synced = 0;

    for (const change of changes) {
      if (change.action === 'delete') {
        continue;
      }

      try {
        // multipart upload でテキストファイルを作成
        const metadata: Record<string, unknown> = {
          name: `[harness-mem] ${change.id.split("::").pop() || change.id}`,
          mimeType: "text/plain",
        };
        if (this.folderId) {
          metadata.parents = [this.folderId];
        }

        const boundary = "-------harness_mem_boundary";
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;
        const body = [
          delimiter,
          "Content-Type: application/json\r\n\r\n",
          JSON.stringify(metadata),
          delimiter,
          "Content-Type: text/plain\r\n\r\n",
          change.content,
          closeDelimiter,
        ].join("");

        const url = `${this.apiBase}/upload/drive/v3/files?uploadType=multipart`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        });

        if (!response.ok) {
          errors.push(`Failed to create GDrive file for ${change.id}: ${response.status}`);
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
    try {
      const token = await this.getAccessToken();
      const url = `${this.apiBase}/drive/v3/about?fields=user`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        return { ok: true, message: "Google Drive connection successful" };
      }
      return { ok: false, message: `Google Drive API returned ${response.status}: ${response.statusText}` };
    } catch (err) {
      return { ok: false, message: `Google Drive connection failed: ${String(err)}` };
    }
  }
}
