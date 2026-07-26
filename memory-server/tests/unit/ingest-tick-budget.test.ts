import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_INGEST_TICK_BUDGET_MS,
  resolveIngestTickBudgetMs,
} from "../../src/core/ingest-coordinator";

const COORDINATOR = resolve(import.meta.dir, "../../src/core/ingest-coordinator.ts");

const ORIGINAL = process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS;
  else process.env.HARNESS_MEM_INGEST_TICK_BUDGET_MS = ORIGINAL;
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

  test("claude_code の定期 ingest は読み込み前に budget を判定する", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const start = source.indexOf("private ingestClaudeCodeSessions");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("ingestClaudeCodeHistory()", start));

    expect(body).toContain("resolveIngestTickBudgetMs()");
    expect(body).toMatch(/Number\.isFinite\(budgetMs\) && Date\.now\(\) - startedAtMs > budgetMs/);

    // budget 判定は openSync による読み込みより前にあること
    const budgetIdx = body.indexOf("Date.now() - startedAtMs > budgetMs");
    const readIdx = body.indexOf("openSync(filePath");
    expect(budgetIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(budgetIdx);
  });

  test("明示 API は budget 無制限で完走する", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const start = source.indexOf("ingestClaudeCodeHistory()");
    const body = source.slice(start, start + 1200);

    expect(body).toContain("budgetMs: Infinity");
    expect(body).toContain("replayFromStart: true");
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
    expect(body).toContain("DEFAULT_INGEST_MAX_BYTES_PER_FILE");
    // 読み込み前の打ち切り
    expect(body).toMatch(/Number\.isFinite\(budgetMs\) && Date\.now\(\) - startedAtMs > budgetMs\) break;/);
    // insert ループ内の打ち切りと再開位置の保存
    expect(body).toContain("nextOffset = Math.max(offset, entry.lineOffset)");
    expect(body).toContain("budgetExhausted = true");
    // 1 件目では抜けない (offset が進まず同じ chunk を読み直し続けるため)
    expect(body).toContain("processed > 0");
  });

  test("読み込みは maxBytesPerFile で切り出す", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const start = source.indexOf("private ingestCodexSessionsRollouts");
    const body = source.slice(start, source.indexOf("private ingestLegacyCodexHistoryFile", start));

    expect(body).toContain("remaining.subarray(0, maxBytesPerFile)");
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
