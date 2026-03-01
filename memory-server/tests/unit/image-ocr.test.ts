/**
 * NEXT-007: 画像 OCR 取り込み のテスト
 *
 * extractTextFromImage() と ingestImageFile() が正しく動作することを検証する。
 * - Tesseract.js でテキスト抽出できること
 * - 空・無効なパスでエラーを返すこと
 * - 抽出テキストが観察として登録されること
 * - OCR 結果が空の場合のハンドリング
 */
import { describe, expect, test, mock, afterEach } from "bun:test";
import { extractTextFromImage, ingestImageFile } from "../../src/ingest/document-parser";

// tesseract.js を差し替えるためモック関数を用意
const mockRecognize = mock(async (_path: string) => ({
  data: { text: "Hello OCR World\nThis is extracted text." },
}));
const mockTerminate = mock(async () => {});
const mockCreateWorker = mock(async () => ({
  recognize: mockRecognize,
  terminate: mockTerminate,
}));

// tesseract.js モック
mock.module("tesseract.js", () => ({
  createWorker: mockCreateWorker,
}));

afterEach(() => {
  mockRecognize.mockClear();
  mockTerminate.mockClear();
  mockCreateWorker.mockClear();
});

describe("extractTextFromImage", () => {
  test("画像ファイルからテキストを抽出できる", async () => {
    const result = await extractTextFromImage("/fake/image.png");
    expect(result.ok).toBe(true);
    expect(result.text).toContain("Hello OCR World");
    expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    expect(mockTerminate).toHaveBeenCalledTimes(1);
  });

  test("空のパスを渡すとエラーを返す", async () => {
    const result = await extractTextFromImage("");
    expect(result.ok).toBe(false);
    expect(result.text).toBe("");
    expect(result.error).toBeDefined();
  });

  test("OCR 結果のテキストが空の場合も ok:true で空文字を返す", async () => {
    mockRecognize.mockImplementationOnce(async () => ({ data: { text: "   " } }));
    const result = await extractTextFromImage("/fake/blank.png");
    expect(result.ok).toBe(true);
    expect(result.text).toBe("");
  });

  test("Tesseract がエラーを投げた場合は ok:false を返す", async () => {
    mockCreateWorker.mockImplementationOnce(async () => {
      throw new Error("Tesseract init failed");
    });
    const result = await extractTextFromImage("/fake/bad.png");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Tesseract init failed");
  });
});

describe("ingestImageFile", () => {
  test("OCR テキストを観察として登録できる", async () => {
    const events: unknown[] = [];
    const mockCore = {
      recordEvent: mock(async (event: unknown) => {
        events.push(event);
      }),
    } as any;

    const result = await ingestImageFile({
      core: mockCore,
      imagePath: "/fake/image.png",
      project: "test-project",
      session_id: "test-session",
    });

    expect(result.ok).toBe(true);
    expect(result.observations_created).toBe(1);
    expect(events).toHaveLength(1);
    const ev = events[0] as any;
    expect(ev.payload.title).toContain("image.png");
    expect(ev.payload.content).toContain("Hello OCR World");
  });

  test("OCR 結果が空の場合は観察を登録しない", async () => {
    mockRecognize.mockImplementationOnce(async () => ({ data: { text: "" } }));
    const mockCore = {
      recordEvent: mock(async () => {}),
    } as any;

    const result = await ingestImageFile({
      core: mockCore,
      imagePath: "/fake/blank.png",
      project: "test-project",
      session_id: "test-session",
    });

    expect(result.ok).toBe(true);
    expect(result.observations_created).toBe(0);
  });

  test("カスタムタイトルを指定できる", async () => {
    const events: unknown[] = [];
    const mockCore = {
      recordEvent: mock(async (event: unknown) => { events.push(event); }),
    } as any;

    await ingestImageFile({
      core: mockCore,
      imagePath: "/fake/image.png",
      project: "test-project",
      session_id: "test-session",
      source_title: "マイ画像",
    });

    const ev = events[0] as any;
    expect(ev.payload.title).toBe("マイ画像");
  });

  test("OCR エラー時は ok:false を返す", async () => {
    mockCreateWorker.mockImplementationOnce(async () => {
      throw new Error("Worker crash");
    });
    const mockCore = {
      recordEvent: mock(async () => {}),
    } as any;

    const result = await ingestImageFile({
      core: mockCore,
      imagePath: "/fake/error.png",
      project: "test-project",
      session_id: "test-session",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Worker crash");
    expect(result.observations_created).toBe(0);
  });
});
