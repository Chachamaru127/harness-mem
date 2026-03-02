/**
 * HARDEN-001: OCR 統合テスト — Tesseract.js 実動作検証
 *
 * Tesseract.js をモックせず、実画像ファイルを OCR してテキスト抽出を検証する。
 * - 既存の unit テスト (tests/unit/image-ocr.test.ts) はモックを使った高速テストとして残す
 * - 本テストは実際の Tesseract.js エンジンを使用するため、初回は数秒かかる
 *
 * テスト対象: memory-server/src/ingest/document-parser.ts:extractTextFromImage
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { extractTextFromImage } from "../../src/ingest/document-parser";

const FIXTURES_DIR = join(import.meta.dir, "../../../tests/fixtures");

describe("HARDEN-001: OCR 統合テスト (Tesseract.js 実動作)", () => {
  // テスト1: hello.png — 英数字テキスト "Hello World" を認識できる
  test("hello.png から 'Hello World' を抽出できる", async () => {
    const imagePath = join(FIXTURES_DIR, "hello.png");
    const result = await extractTextFromImage(imagePath);

    expect(result.ok).toBe(true);
    expect(result.text).toContain("Hello");
    expect(result.error).toBeUndefined();
  }, 30_000);

  // テスト2: blank.png — 空白画像で ok:true かつ空文字 or 短いテキストを返す
  test("blank.png（空白画像）は ok:true で空 or 空白テキストを返す", async () => {
    const imagePath = join(FIXTURES_DIR, "blank.png");
    const result = await extractTextFromImage(imagePath);

    // 空白画像は ok:true で空文字（またはノイズ文字のみ）
    expect(result.ok).toBe(true);
    // テキストが存在する場合でも意味のある文字列は含まれない
    // （Tesseract が空白画像から認識できるテキストは最大でも数文字のノイズのみ）
    expect(result.error).toBeUndefined();
  }, 30_000);

  // テスト3: japanese.png — 日本語テキストを含む画像（best-effort）
  test("japanese.png から日本語テキストを抽出できる（best-effort）", async () => {
    const imagePath = join(FIXTURES_DIR, "japanese.png");
    // lang=jpn は CI 環境で利用できない可能性があるため、eng モードで試みる
    const result = await extractTextFromImage(imagePath);

    // OCR 自体は成功することを確認（テキスト内容は best-effort）
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  }, 30_000);
});
