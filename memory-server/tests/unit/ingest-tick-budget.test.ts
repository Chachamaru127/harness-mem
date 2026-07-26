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
