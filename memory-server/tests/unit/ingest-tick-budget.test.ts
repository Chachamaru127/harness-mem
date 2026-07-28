import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_INGEST_MAX_BYTES_PER_FILE,
  DEFAULT_INGEST_READ_SLICE_BYTES,
  DEFAULT_INGEST_TICK_BUDGET_MS,
  resolveIngestMaxBytesPerFile,
  resolveIngestReadSliceBytes,
  resolveIngestTickBudgetMs,
} from "../../src/core/ingest-coordinator";

const COORDINATOR = resolve(import.meta.dir, "../../src/core/ingest-coordinator.ts");

const ORIGINAL = process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS;
const ORIGINAL_READ_SLICE = process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS;
  else process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS = ORIGINAL;
  if (ORIGINAL_READ_SLICE === undefined) delete process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES;
  else process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES = ORIGINAL_READ_SLICE;
});

/**
 * §159-003b: 定期 ingest tick が event loop を占有する時間に上限を設ける。
 *
 * 2026-07-26 の A/B 実測: claude_code の履歴 ingest (1665 ファイル / 1.5GB) が
 * 同期実行され、1 秒間隔の /health polling 241 回のうち 28 回が無応答だった。
 * claude_code ingest だけを止めると 28 → 1 に落ちたため発生源として確定した。
 */
describe("§159-003b ingest tick budget", () => {
  test("既定値は 200ms", () => {
    delete process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS;
    expect(DEFAULT_INGEST_TICK_BUDGET_MS).toBe(200);
    expect(resolveIngestTickBudgetMs()).toBe(DEFAULT_INGEST_TICK_BUDGET_MS);
  });

  test("env で上書きできる", () => {
    process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS = "50";
    expect(resolveIngestTickBudgetMs()).toBe(50);
  });

  test("0 以下は制限なし (Infinity) として扱う", () => {
    for (const raw of ["0", "-1"]) {
      process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS = raw;
      expect(resolveIngestTickBudgetMs()).toBe(Infinity);
    }
  });

  test("整数として解釈できない値は既定値に落ちる", () => {
    // "50ms" や "1.5" を parseInt が 50 / 1 と解釈して黙って受理する挙動を防ぐ
    for (const raw of ["", "   ", "abc", "50ms", "1.5", "1e3", "0x10", "--5"]) {
      process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS = raw;
      expect(resolveIngestTickBudgetMs()).toBe(DEFAULT_INGEST_TICK_BUDGET_MS);
    }
  });

  test("前後の空白は許容する", () => {
    process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS = "  120  ";
    expect(resolveIngestTickBudgetMs()).toBe(120);
  });

  test("claude_code の定期 ingest は最初のスライス後から budget を判定する", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const start = source.indexOf("private ingestClaudeCodeSessions");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("ingestClaudeCodeHistory()", start));

    expect(body).toContain("resolveIngestTickBudgetMs()");
    expect(body).toContain("slicesProcessed > 0");
    expect(body).toContain("slicesProcessed += 1");

    // tick の最初から budget 超過でも、readSync まで到達できる guard になっていること
    const progressGuardIdx = body.indexOf("slicesProcessed > 0");
    const readIdx = body.indexOf("openSync(filePath");
    expect(progressGuardIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(progressGuardIdx);
  });

  test("明示 API は budget 無制限で完走する", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const start = source.indexOf("ingestClaudeCodeHistory()");
    const body = source.slice(start, start + 1200);

    expect(body).toContain("budgetMs: Infinity");
    expect(body).toContain("replayFromStart: true");
  });
});

describe("§159-003e ingest read slice", () => {
  test("既定値は 64KB", () => {
    delete process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES;
    expect(DEFAULT_INGEST_READ_SLICE_BYTES).toBe(64 * 1024);
    expect(resolveIngestReadSliceBytes()).toBe(DEFAULT_INGEST_READ_SLICE_BYTES);
  });

  test("env で上書きできる", () => {
    process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES = "32768";
    expect(resolveIngestReadSliceBytes()).toBe(32768);
  });

  test("0 以下は制限なし (Infinity) として扱う", () => {
    for (const raw of ["0", "-1"]) {
      process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES = raw;
      expect(resolveIngestReadSliceBytes()).toBe(Infinity);
    }
  });

  test("整数として解釈できない値は既定値に落ちる", () => {
    for (const raw of ["", "   ", "64kb", "1.5", "1e3", "0x10", "--5"]) {
      process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES = raw;
      expect(resolveIngestReadSliceBytes()).toBe(DEFAULT_INGEST_READ_SLICE_BYTES);
    }
  });

  test("3 経路が read → parse → insert をスライスごとに繰り返す", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const ranges = [
      ["private ingestCodexSessionsRollouts", "private ingestLegacyCodexHistoryFile"],
      ["private ingestCursorHooksEvents", "ingestCursorHistory()"],
      ["private ingestClaudeCodeSessions", "ingestClaudeCodeHistory()"],
    ] as const;

    for (const [method, nextMethod] of ranges) {
      const start = source.indexOf(method);
      expect(start).toBeGreaterThan(-1);
      const body = source.slice(start, source.indexOf(nextMethod, start));
      expect(body).toContain("resolveIngestReadSliceBytes()");
      expect(body).toMatch(/while \(\s*nextReadOffset < fileSize/);
      expect(body).toContain("readSync(");
      expect(body).toContain('pending.toString("utf8")');
      expect(body).toContain("this.deps.recordEvent(");
      expect(body).toContain("Date.now() - startedAtMs > budgetMs");
    }
  });

  test("最初のスライスは budget 超過済みでも処理する", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const codexStart = source.indexOf("private ingestCodexSessionsRollouts");
    const codexBody = source.slice(codexStart, source.indexOf("private ingestLegacyCodexHistoryFile", codexStart));
    const cursorStart = source.indexOf("private ingestCursorHooksEvents");
    const cursorBody = source.slice(cursorStart, source.indexOf("ingestCursorHistory()", cursorStart));
    const claudeStart = source.indexOf("private ingestClaudeCodeSessions");
    const claudeBody = source.slice(claudeStart, source.indexOf("ingestClaudeCodeHistory()", claudeStart));

    expect(codexBody).toContain("slicesProcessed > 0");
    expect(codexBody).toContain("slicesProcessed += 1");
    expect(cursorBody).toContain("processed > 0");
    expect(cursorBody).toContain("slicesProcessed += 1");
    expect(claudeBody).toContain("slicesProcessed > 0");
    expect(claudeBody).toContain("slicesProcessed += 1");
  });

  test("consumedBytes が 0 でもスライスを連結し、上限または EOF で抜ける", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const ranges = [
      ["private ingestCodexSessionsRollouts", "private ingestLegacyCodexHistoryFile"],
      ["private ingestCursorHooksEvents", "ingestCursorHistory()"],
      ["private ingestClaudeCodeSessions", "ingestClaudeCodeHistory()"],
    ] as const;

    for (const [method, nextMethod] of ranges) {
      const start = source.indexOf(method);
      const body = source.slice(start, source.indexOf(nextMethod, start));
      expect(body).toContain("parsedChunk.consumedBytes === 0");
      expect(body).toContain("nextReadOffset >= fileSize");
      expect(body).toContain("bytesReadThisFile >=");
      expect(body).toContain("continue;");
    }
  });
});

/**
 * §159-003c: 本番実測で codex tick が 11.9〜16.4 秒 event loop を塞いでいた
 * (`[ingest] slow tick: codex blocked the event loop for ...`)。codex 経路は
 * ファイルの残り全体を読み、件数・バイト上限も持っていなかった。
 */
describe("§159-003c codex ingest tick budget", () => {
  test("codex rollouts は budget と読み込みバイト上限を持つ", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const start = source.indexOf("private ingestCodexSessionsRollouts");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("private ingestLegacyCodexHistoryFile", start));

    expect(body).toContain("resolveIngestTickBudgetMs()");
    expect(body).toContain("resolveIngestMaxBytesPerFile()");
    expect(body).toContain("resolveIngestReadSliceBytes()");
    // 最初のスライスを処理した後の打ち切り
    expect(body).toContain("slicesProcessed > 0");
    // insert ループ内の打ち切りと再開位置の保存
    expect(body).toContain("nextOffset = Math.max(currentOffset, entry.lineOffset)");
    expect(body).toContain("budgetExhausted = true");
    // 1 件目では抜けない (offset が進まず同じ chunk を読み直し続けるため)
    expect(body).toContain("processed > 0");
  });

  test("読み込み合計は maxBytesPerFile で止める", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const start = source.indexOf("private ingestCodexSessionsRollouts");
    const body = source.slice(start, source.indexOf("private ingestLegacyCodexHistoryFile", start));

    expect(body).toContain("bytesReadThisFile < maxBytesPerFile");
    expect(body).toContain("maxBytesPerFile - bytesReadThisFile");
  });

  test("scheduler は budget 無制限の公開 API を呼ばない", () => {
    const source = readFileSync(COORDINATOR, "utf8");

    // 定期 tick は専用の private 経路を通す。公開 API (ingestCodexHistory) は
    // budgetMs: Infinity で完走する契約なので、scheduler から呼ぶと budget が無効化される。
    expect(source).toContain('this.runTick("codex", () => this.ingestCodexHistoryTick())');
    expect(source).not.toContain('this.runTick("codex", () => this.ingestCodexHistory())');

    const apiStart = source.indexOf("ingestCodexHistory(): ApiResponse");
    const apiBody = source.slice(apiStart, apiStart + 1400);
    expect(apiBody).toContain("budgetMs: Infinity");
    expect(apiBody).toContain("maxBytesPerFile: Infinity");
  });

  test("読み込みバイト上限は env で上書きでき、既定は 512KB", () => {
    const original = process.env.HARNESS_MEM_INGEST_MAX_BYTES_PER_FILE;
    try {
      delete process.env.HARNESS_MEM_INGEST_MAX_BYTES_PER_FILE;
      expect(DEFAULT_INGEST_MAX_BYTES_PER_FILE).toBe(512 * 1024);
      expect(resolveIngestMaxBytesPerFile()).toBe(DEFAULT_INGEST_MAX_BYTES_PER_FILE);

      process.env.HARNESS_MEM_INGEST_MAX_BYTES_PER_FILE = "65536";
      expect(resolveIngestMaxBytesPerFile()).toBe(65536);

      for (const raw of ["0", "-1"]) {
        process.env.HARNESS_MEM_INGEST_MAX_BYTES_PER_FILE = raw;
        expect(resolveIngestMaxBytesPerFile()).toBe(Infinity);
      }
      for (const raw of ["512kb", "1.5", ""]) {
        process.env.HARNESS_MEM_INGEST_MAX_BYTES_PER_FILE = raw;
        expect(resolveIngestMaxBytesPerFile()).toBe(DEFAULT_INGEST_MAX_BYTES_PER_FILE);
      }
    } finally {
      if (original === undefined) delete process.env.HARNESS_MEM_INGEST_MAX_BYTES_PER_FILE;
      else process.env.HARNESS_MEM_INGEST_MAX_BYTES_PER_FILE = original;
    }
  });

  test("cursor 経路も読み込みを切り出し、時間でも打ち切る", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const start = source.indexOf("private ingestCursorHooksEvents");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 5000);

    expect(body).toContain("resolveIngestMaxBytesPerFile()");
    expect(body).toContain("resolveIngestReadSliceBytes()");
    expect(body).toContain("bytesReadThisFile < maxBytesPerFile");
    // 件数上限だけでなく時間でも抜ける
    expect(body).toContain("processed >= MAX_CURSOR_HOOK_EVENTS_PER_INGEST || overBudget");
    expect(body).toContain("nextOffset = Math.max(currentOffset, entry.lineOffset)");
  });

  test("遅い tick を記録する仕組みがある", () => {
    const source = readFileSync(COORDINATOR, "utf8");

    expect(source).toContain("HARNESS_MEM_SLOW_TICK_LOG_MS");
    expect(source).toContain("private runTick(");
    expect(source).toContain("blocked the event loop for");
    // 各 60 秒 job が runTick を通ること
    for (const label of ["codex", "opencode", "cursor", "gemini", "claude_code"]) {
      expect(source).toContain(`this.runTick("${label}"`);
    }
  });
});
