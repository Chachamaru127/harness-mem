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
const SERVER = resolve(import.meta.dir, "../../src/server.ts");

/**
 * メソッド本体を切り出す。**両端のマーカーが見つかることを必ず assert する。**
 *
 * 素の `source.slice(start, source.indexOf(endMarker, start))` には静かな失敗がある:
 * 終端マーカーがリネーム/移動されると `indexOf` が -1 を返し、`slice(start, -1)` は
 * 「末尾の 1 文字を除く全体」を返す。結果 body にコーディネータ全体が入り、
 * `toContain` 系の assert が対象と無関係に全部通る。`body.length > 0` では検出できない。
 * (2026-07-30 レビュー指摘。§160-005c で塞いだ「テストが静かに通る」問題と同型。)
 */
function sliceMethodBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `開始マーカーが見つからない: ${startMarker}`).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end, `終端マーカーが見つからない: ${endMarker} (開始: ${startMarker})`).toBeGreaterThan(start);
  return source.slice(start, end);
}

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
    const body = sliceMethodBody(source, "private ingestClaudeCodeSessions", "ingestClaudeCodeHistory()");

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
      const body = sliceMethodBody(source, method, nextMethod);
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
    const codexBody = sliceMethodBody(source, "private ingestCodexSessionsRollouts", "private ingestLegacyCodexHistoryFile");
    const cursorBody = sliceMethodBody(source, "private ingestCursorHooksEvents", "ingestCursorHistory()");
    const claudeBody = sliceMethodBody(source, "private ingestClaudeCodeSessions", "ingestClaudeCodeHistory()");

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
      const body = sliceMethodBody(source, method, nextMethod);
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
    const body = sliceMethodBody(source, "private ingestCodexSessionsRollouts", "private ingestLegacyCodexHistoryFile");

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
    const body = sliceMethodBody(source, "private ingestCodexSessionsRollouts", "private ingestLegacyCodexHistoryFile");

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

/**
 * §160-005c (a): legacy codex history 経路そのものの直接検査。
 *
 * 背景: §159-003c は `ingestCodexSessionsRollouts` に budget を入れたが、
 * 同じ `runTick("codex", ...)` が呼ぶ `ingestLegacyCodexHistoryFile` は
 * 検査対象から漏れていた。上の "§159-003c codex ingest tick budget" にある
 * 既存テストは `"private ingestLegacyCodexHistoryFile"` を区切り文字
 * (rollouts 側の body を切り出す終端) として使うだけで、legacy 関数自体には
 * 何も assert していなかった。ここで legacy 関数の body を直接検査する。
 */
describe("§160-005c legacy codex history ingest 経路の直接検査", () => {
  test("ingestLegacyCodexHistoryFile は budget primitives を直接参照する", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const body = sliceMethodBody(source, "private ingestLegacyCodexHistoryFile", "private ingestCodexHistoryTick");
    expect(body.length).toBeGreaterThan(0);

    // DoD (a): 4 つの primitive を直接参照していること
    expect(body).toContain("resolveIngestTickBudgetMs()");
    expect(body).toContain("resolveIngestReadSliceBytes()");
    expect(body).toContain("statSync(historyPath)");
    expect(body).toContain("entry.lineOffset");

    // rollouts / cursor / claude_code と同じ形 (read slice → parse → budget 付き
    // insert ループ) に揃っていることも合わせて確認する
    expect(body).toContain("resolveIngestMaxBytesPerFile()");
    expect(body).toContain("Date.now() - startedAtMs > budgetMs");
  });
});

// ---------------------------------------------------------------------------
// §160-005c (b): runTick(...) から到達する ingest 経路の網羅検査
//
// 個別関数を名指しでリストする方式は、新しい ingest 経路が増えたときに検査対象
// へ足し忘れると同じ穴が再発する (今回 legacy codex history が漏れたのがまさに
// これ)。ここでは検査対象そのものを `this.runTick("<label>", () => this.<fn>())`
// の呼び出しからソースを読んでその都度導出し、そこから `this.ingest*()` 形の
// 呼び出しを (最大 5 段まで) 辿って budget 参照の有無を判定する。
//
// できること:
//   - runTick 登録一覧をハードコードせずソースから抽出する
//   - dispatcher (本体が他の this.ingest*() を呼ぶだけの関数) を自動でスキップし、
//     実際に read/parse/insert する leaf 関数まで辿って判定する
//     (ingestCodexHistoryTick → ingestCodexSessionsRollouts /
//      ingestLegacyCodexHistoryFile のような 1 段の間接呼び出しを含む)
//   - budget 判定は `resolveIngestTickBudgetMs(` の呼び出し、または
//     `Date.now() - startedAtMs > budgetMs` の比較パターンの有無で行う
//
// できないこと (正直な限界):
//   - あくまで文字列検査。実行時に本当にそのチェックが正しい位置 (loop の中、
//     かつ最初の 1 件は通す等) に置かれているかまでは見ない。「該当する文字列が
//     関数本体に存在する」ことしか保証しない
//   - コメントや文字列リテラルに `resolveIngestTickBudgetMs(` と書かれているだけ
//     でも「参照あり」と誤判定しうる
//   - `this.<name>(` 形の呼び出ししか辿れない。`this.deps.<name>()` 経由
//     (retry_queue) や、関数参照をコールバックとして渡す形 (`array.map(this.foo)`)
//     は追えない
//   - 宣言境界の抽出はインデント幅 (クラス直下 = 半角スペース2つ) とキーワード
//     ブロックリストによるヒューリスティック。フォーマットが変わる (インデント幅
//     変更、ブロックリストに無い予約語の追加等) と誤検出しうる
//   - ingest 系メソッド名は "ingest" 始まりという命名規約に依存する
// ---------------------------------------------------------------------------

const JS_KEYWORD_BLOCKLIST = new Set([
  "if", "for", "while", "switch", "catch", "return", "else", "do", "function",
  "new", "typeof", "in", "of", "await", "yield", "case", "throw", "delete",
  "void", "instanceof", "constructor", "try", "finally", "let", "const",
  "var", "export", "import", "class",
]);

interface MethodDecl {
  name: string;
  start: number;
}

/**
 * クラス直下 (半角スペース2つのインデント) にあるメソッド宣言をソースから抽出する。
 * if/for/while 等の制御構文が偶然インデント2の位置に来るケース (トップレベル
 * 関数の本文など) は JS_KEYWORD_BLOCKLIST で弾く。
 */
function extractMethodDeclarations(source: string): MethodDecl[] {
  const decls: MethodDecl[] = [];
  const re = /^ {2}(?:private\s+|public\s+|protected\s+|readonly\s+|async\s+|static\s+)*([A-Za-z_$][\w$]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const name = m[1] as string;
    if (JS_KEYWORD_BLOCKLIST.has(name)) continue;
    decls.push({ name, start: m.index });
  }
  return decls;
}

interface RunTickCall {
  label: string;
  fnName: string;
}

/**
 * `this.runTick("<label>", () => this.<fn>(...))` の形を抽出する。
 * `this.deps.processRetryQueue()` のような deps 経由の呼び出しや、
 * `() => { ... }` のブロック本体 (wal_checkpoint) は意図的に対象外
 * (直接 `this.<method>(...)` を呼ぶ形だけを追う設計のため)。
 */
function extractRunTickCalls(source: string): RunTickCall[] {
  const calls: RunTickCall[] = [];
  const re = /this\.runTick\(\s*"([^"]+)"\s*,\s*\(\)\s*=>\s*this\.(\w+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    calls.push({ label: m[1] as string, fnName: m[2] as string });
  }
  return calls;
}

function getMethodBody(source: string, decls: MethodDecl[], name: string): string | null {
  const idx = decls.findIndex((d) => d.name === name);
  if (idx === -1) return null;
  const start = (decls[idx] as MethodDecl).start;
  const end = idx + 1 < decls.length ? (decls[idx + 1] as MethodDecl).start : source.length;
  return source.slice(start, end);
}

function hasBudgetEnforcement(body: string): boolean {
  return (
    /resolveIngestTickBudgetMs\s*\(/.test(body) ||
    /Date\.now\(\)\s*-\s*\w+\s*>\s*budgetMs\b/.test(body)
  );
}

type CoverageStatus = "ok" | "missing_budget" | "not_found" | "depth_exceeded";

interface CoverageResult {
  label: string;
  chain: string[];
  status: CoverageStatus;
}

/**
 * runTick(...) から到達できる ingest 系メソッドを辿り、budget 参照の有無を判定する。
 * dispatcher (本体が他の this.ingest*() を呼ぶだけの関数) は自動的にスキップし、
 * 実際に処理する leaf 関数だけを判定対象にする。
 */
function traceIngestBudgetCoverage(source: string, maxDepth = 5): CoverageResult[] {
  const decls = extractMethodDeclarations(source);
  const runTickCalls = extractRunTickCalls(source);
  const results: CoverageResult[] = [];

  function visit(fnName: string, chain: string[], label: string, depth: number): void {
    if (depth > maxDepth) {
      results.push({ label, chain: [...chain, fnName], status: "depth_exceeded" });
      return;
    }
    const body = getMethodBody(source, decls, fnName);
    if (body === null) {
      results.push({ label, chain: [...chain, fnName], status: "not_found" });
      return;
    }
    const subCalls = [...body.matchAll(/this\.(ingest\w*)\s*\(/g)]
      .map((mm) => mm[1] as string)
      .filter((n) => n !== fnName);
    const uniqueSubCalls = [...new Set(subCalls)];

    if (uniqueSubCalls.length > 0) {
      // dispatcher: 自身は budget を持たなくてよい。呼び先を辿る。
      for (const sub of uniqueSubCalls) {
        visit(sub, [...chain, fnName], label, depth + 1);
      }
      return;
    }

    // leaf: 自身の body に budget 参照が必要
    results.push({
      label,
      chain: [...chain, fnName],
      status: hasBudgetEnforcement(body) ? "ok" : "missing_budget",
    });
  }

  for (const call of runTickCalls) {
    visit(call.fnName, [], call.label, 0);
  }

  return results;
}

describe("§160-005c runTick 到達性による ingest budget 網羅検査", () => {
  test("抽出ロジックの死活チェック: runTick 経路が現状 6 件以上ソースから読み取れる", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const calls = extractRunTickCalls(source);
    // ここが 0 件になったら (フォーマット変更等で正規表現が壊れた場合)、
    // 以降の網羅検査が「対象 0 件だから全部 OK」に静かに堕ちてしまう。
    // まず検査対象を実際に捕まえていることを確認する。
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const label of ["codex", "opencode", "cursor", "antigravity", "gemini", "claude_code"]) {
      expect(calls.some((c) => c.label === label)).toBe(true);
    }
    // retry_queue (this.deps.X 経由) と wal_checkpoint (inline block) は
    // 設計上追わない対象なので、抽出結果に含まれないことも確認する。
    expect(calls.some((c) => c.label === "retry_queue")).toBe(false);
    expect(calls.some((c) => c.label === "wal_checkpoint")).toBe(false);
  });

  test("検出ロジックの正しさ: budget 無しの偽ソースを与えると検出する (実ファイルは変更しない)", () => {
    // 実ファイルを壊さずに「検査ロジックが機能する」ことを固定するための、
    // クラス構造だけを模した合成ソース。dispatcher → leaf の 1 段の間接呼び出しを
    // 含む new_platform (budget 忘れ) と、leaf が直接 budget を持つ already_safe、
    // this.deps 経由で追わない retry_queue の 3 パターンを 1 度に検証する。
    const fakeSource = `
export class FakeCoordinator {
  private runTick(label: string, fn: () => void): void {
    fn();
  }

  startTimers(): void {
    this.runTick("new_platform", () => this.ingestNewPlatformTick());
    this.runTick("already_safe", () => this.ingestAlreadySafeLeaf());
    this.runTick("retry_queue", () => this.deps.processRetryQueue());
  }

  private ingestNewPlatformTick(): void {
    this.ingestNewPlatformFiles();
  }

  private ingestNewPlatformFiles(): void {
    // 新しい ingest 経路を追加したが budget チェックを入れ忘れた想定
    const content = readFileSync(this.path, "utf8");
    for (const line of content.split("\\n")) {
      this.deps.recordEvent(line);
    }
  }

  private ingestAlreadySafeLeaf(): void {
    const budgetMs = resolveIngestTickBudgetMs();
    const startedAtMs = Date.now();
    if (Date.now() - startedAtMs > budgetMs) return;
  }
}
`;
    const results = traceIngestBudgetCoverage(fakeSource);

    const newPlatform = results.find((r) => r.label === "new_platform");
    expect(newPlatform).toBeDefined();
    expect(newPlatform?.status).toBe("missing_budget");
    expect(newPlatform?.chain).toEqual(["ingestNewPlatformTick", "ingestNewPlatformFiles"]);

    const alreadySafe = results.find((r) => r.label === "already_safe");
    expect(alreadySafe).toBeDefined();
    expect(alreadySafe?.status).toBe("ok");

    // retry_queue は this.deps 経由の呼び出しなので、そもそも抽出対象に入らない
    expect(results.some((r) => r.label === "retry_queue")).toBe(false);
  });

  test("regression lock: runTick から到達する全 ingest 経路が budget-aware である", () => {
    const source = readFileSync(COORDINATOR, "utf8");
    const results = traceIngestBudgetCoverage(source);
    // §160-007 で opencode / antigravity / gemini も対応済みになったため、
    // 「一部の経路だけ」ではなく **runTick から到達する全経路** を対象にする。
    // 新しい ingest 経路を runTick に足して budget を入れ忘れたら、ここで落ちる。
    //
    // この検査の限界 (2026-07-31 に実測で確認):
    // budget 参照の有無を **ソース文字列** で見ているだけなので、実行時に budget が
    // 正しく効くことは保証しない。判定は `resolveIngestTickBudgetMs(` または
    // `Date.now() - startedAtMs > budgetMs` の **いずれか**が本体に現れるかで、
    // 片方だけ残して他方を潰しても検出できない (両方消せば落ちることは実測済み)。
    // 「break が正しい位置にあるか」「1 件目を通す guard になっているか」も見ない。
    // それらは各経路の振る舞いテスト (ingest-coordinator.test.ts) の責務。
    //
    // 除外ラベルは 1 つも置かない。`already_safe` は直前のテストの合成ソース専用の
    // ラベルであって実ソースには存在しないため、ここで除外すると「同名のラベルで
    // 新経路を足せば lock をすり抜けられる」抜け道を作るだけになる。

    // results が空だと以下の assert が意味を持たなくなる (対象を取り逃していないか)
    expect(results.length).toBeGreaterThan(0);
    const broken = results.filter((r) => r.status !== "ok");
    expect(broken).toEqual([]);
  });

  /**
   * §160-007 (review 指摘): 上の lock は「呼ばれた先の本体に budget の文字列が
   * あるか」しか見ないので、**scheduler がどの関数を呼んでいるか**は検査できない。
   * 実際、`startTimers()` が明示 API (`ingestAntigravityHistory` 等) を直接呼ぶ
   * 状態に戻しても上の lock は通ってしまうことを実測で確認した。それこそが
   * この PR が直した回帰そのものである。
   *
   * ここでは別の角度から固定する: **HTTP route が明示 ingest API として公開して
   * いる関数を、scheduler が runTick の対象にしていないこと**。両者が同じ関数を
   * 指した瞬間、Spec.md「## Periodic Ingest Budget」の explicit ingest exemption
   * (明示呼び出しは完走させる) が破れる。
   *
   * この検査で分かること: timer 経路と明示経路が同じ関数に融合していないか。
   * 分からないこと: 分離した先の tick 関数が実際に budget を効かせるか
   * (それは上の lock と各経路の振る舞いテストの責務)。
   */
  test("regression lock: scheduler は HTTP が公開する明示 ingest API を直接呼ばない", () => {
    const coordinatorSource = readFileSync(COORDINATOR, "utf8");
    const serverSource = readFileSync(SERVER, "utf8");

    // route handler が `core.<fn>()` の形で呼ぶ ingest 系関数 = 明示 API
    const explicitApiNames = new Set(
      [...serverSource.matchAll(/\bcore\.(ingest\w*(?:History|Sessions))\s*\(/g)].map(
        (m) => m[1] as string
      )
    );
    // 取り逃していたら以下の assert が空振りする
    expect(explicitApiNames.size).toBeGreaterThan(0);

    const scheduled = extractRunTickCalls(coordinatorSource);
    expect(scheduled.length).toBeGreaterThan(0);

    const fused = scheduled.filter((call) => explicitApiNames.has(call.fnName));
    expect(
      fused,
      `scheduler が明示 API をそのまま呼んでいる: ${JSON.stringify(fused)}\n` +
        `HTTP 公開関数: ${JSON.stringify([...explicitApiNames])}\n` +
        "この状態では明示呼び出しが tick budget で打ち切られる (Spec.md の explicit ingest exemption 違反)。"
    ).toEqual([]);
  });

});
