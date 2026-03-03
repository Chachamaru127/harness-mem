/**
 * COMP-012: Notion / Google Drive コネクター
 *
 * Notion ページ / Google Drive ドキュメントを EventEnvelope に変換するアダプター。
 *
 * 設計方針:
 *   - 純粋変換関数（API呼び出しなし）なので単体テストしやすい
 *   - 実際のAPIコールは呼び出し元（ingest エンドポイントや CLI）で行う
 *   - dedupe_hash で同じドキュメントの重複取り込みを防止
 */

import { createHash } from "node:crypto";
import type { EventEnvelope } from "../core/harness-mem-core";
import type { PlatformIngester, IngesterDeps } from "./types";

// ─────────────────────────────────────────────────────────
// Notion
// ─────────────────────────────────────────────────────────

export interface NotionPage {
  id: string;
  title: string;
  content: string;
  url?: string;
  last_edited_time: string;
}

export interface ConnectorIngestOptions {
  platform: string;
  project: string;
  session_id: string;
}

/**
 * Notion ページを EventEnvelope に変換する。
 */
export function notionPageToEvent(
  page: NotionPage,
  options: ConnectorIngestOptions
): EventEnvelope {
  const dedupeHash = createHash("sha256")
    .update(`notion::${page.id}::${page.last_edited_time}`)
    .digest("hex");

  return {
    platform: options.platform,
    project: options.project,
    session_id: options.session_id,
    event_type: "document_ingested",
    ts: page.last_edited_time,
    payload: {
      source: "notion",
      document_id: page.id,
      title: page.title,
      content: page.content,
      url: page.url,
      last_edited_time: page.last_edited_time,
    },
    tags: ["notion", "document"],
    privacy_tags: [],
    dedupe_hash: dedupeHash,
  };
}

// ─────────────────────────────────────────────────────────
// Google Drive
// ─────────────────────────────────────────────────────────

export interface GoogleDriveFile {
  id: string;
  name: string;
  content: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime: string;
}

/**
 * Google Drive ファイルを EventEnvelope に変換する。
 */
export function googleDriveFileToEvent(
  file: GoogleDriveFile,
  options: ConnectorIngestOptions
): EventEnvelope {
  const dedupeHash = createHash("sha256")
    .update(`google_drive::${file.id}::${file.modifiedTime}`)
    .digest("hex");

  return {
    platform: options.platform,
    project: options.project,
    session_id: options.session_id,
    event_type: "document_ingested",
    ts: file.modifiedTime,
    payload: {
      source: "google_drive",
      document_id: file.id,
      title: file.name,
      content: file.content,
      url: file.webViewLink,
      mime_type: file.mimeType,
      modified_time: file.modifiedTime,
    },
    tags: ["google_drive", "document"],
    privacy_tags: [],
    dedupe_hash: dedupeHash,
  };
}

export class NotionGdriveIngester implements PlatformIngester {
  readonly name = "notion-gdrive";
  readonly description = "Notion ページと Google Drive ドキュメントを取り込む";
  readonly pollIntervalMs = 0;

  private deps?: IngesterDeps;

  async initialize(deps: IngesterDeps): Promise<boolean> {
    this.deps = deps;
    return true;
  }

  async poll(): Promise<number> {
    return 0;
  }

  async shutdown(): Promise<void> {
    // no-op
  }
}
