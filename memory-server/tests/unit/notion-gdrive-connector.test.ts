/**
 * COMP-012: Notion / Google Drive コネクター のテスト
 *
 * Notion ページ / Google Drive ドキュメントを EventEnvelope に変換する
 * アダプター関数を検証する。
 */
import { describe, expect, test } from "bun:test";
import {
  notionPageToEvent,
  googleDriveFileToEvent,
  type NotionPage,
  type GoogleDriveFile,
} from "../../src/ingest/notion-gdrive-connector";

const BASE_OPTIONS = {
  platform: "claude" as const,
  project: "test-project",
  session_id: "session-connector",
};

describe("COMP-012: Notion / Google Drive コネクター", () => {
  // Notion テスト
  test("notionPageToEvent は Notion ページを EventEnvelope に変換する", () => {
    const page: NotionPage = {
      id: "notion-page-001",
      title: "プロジェクト仕様書",
      content: "このドキュメントはプロジェクトの仕様を説明します。",
      url: "https://notion.so/test/notion-page-001",
      last_edited_time: "2026-01-15T10:00:00Z",
    };
    const event = notionPageToEvent(page, BASE_OPTIONS);
    expect(event.event_type).toBe("document_ingested");
    expect(event.payload.title).toBe("プロジェクト仕様書");
    expect(event.payload.source).toBe("notion");
    expect(event.payload.content).toContain("このドキュメント");
    expect(event.session_id).toBe("session-connector");
  });

  test("notionPageToEvent の ts は Notion の last_edited_time を使う", () => {
    const page: NotionPage = {
      id: "np-002",
      title: "テスト",
      content: "内容",
      last_edited_time: "2026-02-01T12:00:00Z",
    };
    const event = notionPageToEvent(page, BASE_OPTIONS);
    expect(event.ts).toBe("2026-02-01T12:00:00Z");
  });

  test("notionPageToEvent は tags に notion タグを含む", () => {
    const page: NotionPage = {
      id: "np-003",
      title: "タグテスト",
      content: "内容",
      last_edited_time: new Date().toISOString(),
    };
    const event = notionPageToEvent(page, BASE_OPTIONS);
    expect(event.tags).toContain("notion");
    expect(event.tags).toContain("document");
  });

  // Google Drive テスト
  test("googleDriveFileToEvent は Google Drive ファイルを EventEnvelope に変換する", () => {
    const file: GoogleDriveFile = {
      id: "gdrive-file-001",
      name: "会議メモ 2026-01",
      content: "今日の会議では以下の点について議論しました。",
      mimeType: "text/plain",
      webViewLink: "https://drive.google.com/file/d/gdrive-file-001/view",
      modifiedTime: "2026-01-20T09:00:00Z",
    };
    const event = googleDriveFileToEvent(file, BASE_OPTIONS);
    expect(event.event_type).toBe("document_ingested");
    expect(event.payload.title).toBe("会議メモ 2026-01");
    expect(event.payload.source).toBe("google_drive");
    expect(event.payload.content).toContain("今日の会議");
    expect(event.session_id).toBe("session-connector");
  });

  test("googleDriveFileToEvent は tags に google_drive タグを含む", () => {
    const file: GoogleDriveFile = {
      id: "gf-002",
      name: "仕様書",
      content: "内容",
      mimeType: "text/plain",
      modifiedTime: new Date().toISOString(),
    };
    const event = googleDriveFileToEvent(file, BASE_OPTIONS);
    expect(event.tags).toContain("google_drive");
    expect(event.tags).toContain("document");
  });

  test("空コンテンツのドキュメントも変換できる", () => {
    const page: NotionPage = {
      id: "np-empty",
      title: "空ページ",
      content: "",
      last_edited_time: new Date().toISOString(),
    };
    const event = notionPageToEvent(page, BASE_OPTIONS);
    expect(event).not.toBeNull();
    expect(event.payload.title).toBe("空ページ");
  });

  test("dedupe_hash は異なるページIDで異なる値になる", () => {
    const page1: NotionPage = { id: "p1", title: "A", content: "X", last_edited_time: new Date().toISOString() };
    const page2: NotionPage = { id: "p2", title: "A", content: "X", last_edited_time: new Date().toISOString() };
    const e1 = notionPageToEvent(page1, BASE_OPTIONS);
    const e2 = notionPageToEvent(page2, BASE_OPTIONS);
    expect(e1.dedupe_hash).not.toBe(e2.dedupe_hash);
  });

  test("Google Drive と Notion の dedupe_hash は異なる（ソース識別）", () => {
    const ts = new Date().toISOString();
    const page: NotionPage = { id: "doc-001", title: "A", content: "X", last_edited_time: ts };
    const file: GoogleDriveFile = { id: "doc-001", name: "A", content: "X", mimeType: "text/plain", modifiedTime: ts };
    const e1 = notionPageToEvent(page, BASE_OPTIONS);
    const e2 = googleDriveFileToEvent(file, BASE_OPTIONS);
    expect(e1.dedupe_hash).not.toBe(e2.dedupe_hash);
  });
});
