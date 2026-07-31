import { createHash } from "node:crypto";
import type { PlatformIngester, IngesterDeps } from "./types";

export interface CodexHistoryEvent {
  lineIndex: number;
  /**
   * §160-005a: `.trim()` する前の、この行の先頭の絶対バイト位置 (`baseOffset` からの
   * オフセット込み)。`codex-sessions.ts` の `lineOffset` と同じ契約 — budget 打ち切り
   * 時の再開位置として使う。lineIndex (行番号) からの再計算はしない。空行・JSON
   * parse 失敗行を `continue` で読み飛ばしても後続行の lineOffset がずれないよう、
   * skip した行も含めてバッファを "\n" 区切りで走査する (実装は下記参照)。
   */
  lineOffset: number;
  line: string;
  parsed: Record<string, unknown>;
  role: string;
  eventType: "tool_use" | "user_prompt";
  sessionId: string;
  timestamp: string;
  dedupeHash: string;
}

export function parseCodexHistoryChunk(params: {
  sourceKey: string;
  baseOffset: number;
  chunk: string;
  fallbackNowIso: () => string;
}): {
  events: CodexHistoryEvent[];
  consumedLength: number;
} {
  const lines = params.chunk.split("\n");
  const consumedLength = lines.length > 0 ? params.chunk.length - (lines[lines.length - 1]?.length ?? 0) : 0;

  const events: CodexHistoryEvent[] = [];

  // §160-005a (review 対応): lineOffset は `Buffer.byteLength(line) + 1` の積算では
  // なく、`chunk` を再エンコードしたバッファ上で "\n" (0x0a) を直接走査して求める。
  // `codex-sessions.ts:57-68` と同じ機構に揃えることで、行の切り出し方 (split か
  // indexOf か) が変わっても常に同じ絶対バイト位置を指す。
  //
  // 検証メモ: 積算方式と走査方式は、`chunk` が既に (呼び出し側の `.toString("utf8")`
  // で) 1 回デコード済みの文字列である限り、数学的に同じ値を返す
  // (`Buffer.byteLength(a) + Buffer.byteLength(b) === Buffer.byteLength(a + b)` が
  // UTF-8 の加法性として常に成り立つため、chunk の中に不正バイト由来の U+FFFD が
  // 混入していても両者は一致する)。両者で異なるのは「元のファイルの生バイトに対する
  // 絶対位置がずれるかどうか」ではなく実装の見通しの良さであり、そのズレ自体は
  // coordinator 側の `.toString("utf8")` 変換に起因する別レイヤーの問題として
  // 4 経路 (claude_code / codex rollouts / cursor / codex-history) 共通で残る。
  const buffer = Buffer.from(params.chunk, "utf8");
  let byteCursor = 0;

  for (let index = 0; index < lines.length - 1; index += 1) {
    const rawLine = lines[index] ?? "";
    const lineOffset = params.baseOffset + byteCursor;
    const newline = buffer.indexOf(0x0a, byteCursor);
    byteCursor = newline === -1 ? buffer.length : newline + 1;

    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const role = typeof parsed.role === "string" ? parsed.role : "";
    const eventType: "tool_use" | "user_prompt" = role === "assistant" || role === "tool" ? "tool_use" : "user_prompt";
    const sessionId =
      (typeof parsed.session_id === "string" && parsed.session_id) ||
      (typeof parsed.thread_id === "string" && parsed.thread_id) ||
      "codex-history";

    const timestamp =
      (typeof parsed.ts === "string" && parsed.ts) ||
      (typeof parsed.timestamp === "string" && parsed.timestamp) ||
      params.fallbackNowIso();

    const dedupeHash = createHash("sha256")
      .update(`${params.sourceKey}:${params.baseOffset + index}:${line}`)
      .digest("hex");

    events.push({
      lineIndex: index,
      lineOffset,
      line,
      parsed,
      role,
      eventType,
      sessionId,
      timestamp,
      dedupeHash,
    });
  }

  return {
    events,
    consumedLength,
  };
}

export class CodexHistoryIngester implements PlatformIngester {
  readonly name = "codex-history";
  readonly description = "Codex の会話履歴 JSONL を取り込む";
  readonly pollIntervalMs = 30_000;

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
