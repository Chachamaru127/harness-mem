import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseClaudeCodeChunk } from "../../src/ingest/claude-code-sessions";
import { parseCodexHistoryChunk } from "../../src/ingest/codex-history";
import { parseCodexSessionsChunk } from "../../src/ingest/codex-sessions";
import { resolveIngestReadSliceBytes } from "../../src/core/ingest-coordinator";

/**
 * §159-003f (review 指摘): スライス分割の正しさを、source 文字列の一致ではなく
 * **実データを流して**確認する。
 *
 * ingest-coordinator は 1 tick の中で「readSliceBytes ずつ読む → parse →
 * consumedBytes だけ offset を進める」を繰り返す。行がスライス境界をまたぐ場合、
 * parser は「完全に消費できた行まで」しか consumedBytes を返さないので、残りは
 * 次スライスと連結して初めて 1 行になる。ここが崩れるとイベントの取りこぼしか
 * 二重取り込みが起きるため、境界条件を実際に流して固定する。
 *
 * coordinator の private メソッドは直接呼べないので、同じスライスループを
 * ここで再現して parser の契約を検証する。
 */

type SliceRun = { events: unknown[]; finalOffset: number; slices: number };

/** coordinator と同じ「スライス読み → parse → offset 前進」を再現する。 */
function runSliceLoop(
  content: string,
  sliceBytes: number,
  parse: (baseOffset: number, chunk: string) => { events: unknown[]; consumedBytes: number },
): SliceRun {
  const buffer = Buffer.from(content, "utf8");
  const collected: unknown[] = [];
  let currentOffset = 0;
  let nextReadOffset = 0;
  let pending = Buffer.alloc(0);
  let slices = 0;

  while (nextReadOffset < buffer.length) {
    const readSize = Math.min(sliceBytes, buffer.length - nextReadOffset);
    pending = Buffer.concat([pending, buffer.subarray(nextReadOffset, nextReadOffset + readSize)]);
    nextReadOffset += readSize;
    slices += 1;

    const parsed = parse(currentOffset, pending.toString("utf8"));
    if (parsed.consumedBytes === 0) {
      // 行が完結していない。次スライスを連結する (EOF なら諦める)。
      if (nextReadOffset >= buffer.length) break;
      continue;
    }
    collected.push(...parsed.events);
    currentOffset += parsed.consumedBytes;
    pending = pending.subarray(parsed.consumedBytes);
  }

  return { events: collected, finalOffset: currentOffset, slices };
}

function claudeCodeLine(prompt: string, index: number): string {
  return JSON.stringify({
    type: "user",
    timestamp: `2026-07-28T00:00:${String(index).padStart(2, "0")}.000Z`,
    sessionId: "slice-boundary-session",
    cwd: "/tmp/slice-boundary-project",
    message: { role: "user", content: prompt },
  });
}

describe("§159-003f スライス境界の実データ検証", () => {
  test("既定のスライス幅は 64KB", () => {
    const original = process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES;
    try {
      delete process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES;
      expect(resolveIngestReadSliceBytes()).toBe(64 * 1024);
    } finally {
      if (original === undefined) delete process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES;
      else process.env.HARNESS_MEM_INGEST_READ_SLICE_BYTES = original;
    }
  });

  test("claude_code: 1 行がスライスより長くても欠落も重複もしない", () => {
    // 1 行 = 約 200KB。4KB スライスなら 1 行が 50 スライスにまたがる。
    const longPrompt = "あ".repeat(70_000);
    const content = [claudeCodeLine(longPrompt, 1), claudeCodeLine("短い行", 2)].join("\n") + "\n";

    const whole = parseClaudeCodeChunk({
      sourceKey: "test:whole",
      baseOffset: 0,
      chunk: content,
      fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
    });

    const sliced = runSliceLoop(content, 4096, (baseOffset, chunk) =>
      parseClaudeCodeChunk({
        sourceKey: "test:sliced",
        baseOffset,
        chunk,
        fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
      }),
    );

    // 一括 parse と同じイベント数・同じ最終 offset に着地する
    expect(sliced.events.length).toBe(whole.events.length);
    expect(sliced.finalOffset).toBe(whole.consumedBytes);
    expect(sliced.slices).toBeGreaterThan(1);

    // dedupeHash が全件ユニーク = 二重取り込みしていない
    const hashes = sliced.events.map((e) => (e as { dedupeHash: string }).dedupeHash);
    expect(new Set(hashes).size).toBe(hashes.length);

    // lineOffset は狂わず単調増加する
    const offsets = sliced.events.map((e) => (e as { lineOffset: number }).lineOffset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  test("claude_code: 行がスライス境界をまたぐ位相をずらしても一致する", () => {
    const lines = Array.from({ length: 8 }, (_, i) =>
      claudeCodeLine("x".repeat(200 + i * 137), i + 1),
    );
    const content = lines.join("\n") + "\n";

    const whole = parseClaudeCodeChunk({
      sourceKey: "test:whole",
      baseOffset: 0,
      chunk: content,
      fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
    });

    // 境界位相を変えても結果が変わらないこと
    for (const sliceBytes of [64, 97, 128, 251, 512]) {
      const sliced = runSliceLoop(content, sliceBytes, (baseOffset, chunk) =>
        parseClaudeCodeChunk({
          sourceKey: "test:sliced",
          baseOffset,
          chunk,
          fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
        }),
      );
      expect(sliced.events.length).toBe(whole.events.length);
      expect(sliced.finalOffset).toBe(whole.consumedBytes);
    }
  });

  test("codex: スライス分割しても一括 parse と一致する", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-slice-codex-"));
    try {
      const lines = [
        JSON.stringify({
          timestamp: "2026-07-28T00:00:00.000Z",
          type: "session_meta",
          payload: { id: "slice-session", cwd: dir },
        }),
        ...Array.from({ length: 6 }, (_, i) =>
          JSON.stringify({
            timestamp: `2026-07-28T00:00:${String(i + 1).padStart(2, "0")}.000Z`,
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "ん".repeat(300 + i * 211) }],
            },
          }),
        ),
      ];
      const content = lines.join("\n") + "\n";
      writeFileSync(join(dir, "rollout.jsonl"), content, "utf8");

      const whole = parseCodexSessionsChunk({
        sourceKey: "test:whole",
        baseOffset: 0,
        chunk: content,
        fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
      });

      for (const sliceBytes of [128, 333, 1024]) {
        const sliced = runSliceLoop(content, sliceBytes, (baseOffset, chunk) =>
          parseCodexSessionsChunk({
            sourceKey: "test:sliced",
            baseOffset,
            chunk,
            fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
          }),
        );
        expect(sliced.events.length).toBe(whole.events.length);
        expect(sliced.finalOffset).toBe(whole.consumedBytes);
        const hashes = sliced.events.map((e) => (e as { dedupeHash: string }).dedupeHash);
        expect(new Set(hashes).size).toBe(hashes.length);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("末尾に改行が無い不完全行は次 tick へ持ち越す (取りこぼしも重複もしない)", () => {
    const complete = claudeCodeLine("完結した行", 1);
    const partial = claudeCodeLine("まだ改行が来ていない行", 2).slice(0, 50);
    const content = `${complete}\n${partial}`;

    const sliced = runSliceLoop(content, 64, (baseOffset, chunk) =>
      parseClaudeCodeChunk({
        sourceKey: "test:partial",
        baseOffset,
        chunk,
        fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
      }),
    );

    // 完結した 1 行だけが取り込まれ、offset はその行の直後で止まる
    expect(sliced.events.length).toBe(1);
    expect(sliced.finalOffset).toBe(Buffer.byteLength(complete, "utf8") + 1);
  });
});

/**
 * §160-005a: `parseCodexHistoryChunk` (legacy `~/.codex/history.jsonl` 用パーサ) に
 * 生バイト位置 `lineOffset` を追加する。
 *
 * `codex-sessions.ts` (rollouts) と同じく `.trim()` する前の絶対バイト位置を持たせる。
 * 空行・JSON parse 失敗行を `continue` で読み飛ばす一方で lineIndex は進むため、
 * lineOffset をここからの再計算に頼ると容易にずれる。ここではパーサが返す
 * lineOffset をバイト列に対して直接検証し、`dedupeHash` の式・`lineIndex` は
 * 変更されていないことも合わせて固定する。
 */
function historyLine(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

/** coordinator の `Buffer.byteLength(chunk.slice(0, consumedLength), "utf8")` 変換を
 * そのまま再現し、runSliceLoop が期待する `{ events, consumedBytes }` 形にそろえる。 */
function parseCodexHistoryChunkAsBytes(baseOffset: number, chunk: string) {
  const result = parseCodexHistoryChunk({
    sourceKey: "test:codex-history",
    baseOffset,
    chunk,
    fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
  });
  const consumedBytes = Buffer.byteLength(chunk.slice(0, result.consumedLength), "utf8");
  return { events: result.events, consumedBytes };
}

describe("§160-005a codex-history lineOffset", () => {
  test("lineOffset は trim 前の絶対バイト位置を指す (ASCII)", () => {
    const lines = [
      historyLine({ role: "user", session_id: "s1", ts: "2026-07-28T00:00:00.000Z", content: "first" }),
      historyLine({ role: "assistant", session_id: "s1", ts: "2026-07-28T00:00:01.000Z", content: "second" }),
      historyLine({ role: "user", session_id: "s1", ts: "2026-07-28T00:00:02.000Z", content: "third" }),
    ];
    const content = lines.join("\n") + "\n";
    const buffer = Buffer.from(content, "utf8");

    const { events } = parseCodexHistoryChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk: content,
      fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
    });

    expect(events.length).toBe(3);
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i]!;
      const expectedLineBytes = Buffer.byteLength(lines[i]!, "utf8");
      expect(buffer.subarray(event.lineOffset, event.lineOffset + expectedLineBytes).toString("utf8")).toBe(lines[i]);
    }
  });

  test("マルチバイト文字を含む行でも lineOffset が正しいバイト位置に着地する", () => {
    const lines = [
      historyLine({ role: "user", session_id: "s1", ts: "2026-07-28T00:00:00.000Z", content: "日本語のプロンプト" }),
      historyLine({ role: "assistant", session_id: "s1", ts: "2026-07-28T00:00:01.000Z", content: "絵文字😀入り" }),
      historyLine({ role: "user", session_id: "s1", ts: "2026-07-28T00:00:02.000Z", content: "ascii mixed 混在" }),
    ];
    const content = lines.join("\n") + "\n";
    const buffer = Buffer.from(content, "utf8");

    const { events } = parseCodexHistoryChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk: content,
      fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
    });

    expect(events.length).toBe(3);
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i]!;
      const expectedLineBytes = Buffer.byteLength(lines[i]!, "utf8");
      expect(buffer.subarray(event.lineOffset, event.lineOffset + expectedLineBytes).toString("utf8")).toBe(lines[i]);
    }
  });

  test("baseOffset がある chunk でも lineOffset は絶対位置になる", () => {
    const prefix = historyLine({ role: "user", session_id: "s0", ts: "2026-07-28T00:00:00.000Z", content: "prefix" }) + "\n";
    const baseOffset = Buffer.byteLength(prefix, "utf8");
    const line = historyLine({ role: "user", session_id: "s1", ts: "2026-07-28T00:00:01.000Z", content: "after prefix" });
    const chunk = line + "\n";

    const { events } = parseCodexHistoryChunk({
      sourceKey: "test",
      baseOffset,
      chunk,
      fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
    });

    expect(events.length).toBe(1);
    expect(events[0]!.lineOffset).toBe(baseOffset);
  });

  test("空行 / JSON parse 失敗行 / \\r 終端行を挟んでも後続行の lineOffset は正しい", () => {
    const good1 = historyLine({ role: "user", session_id: "s1", ts: "2026-07-28T00:00:00.000Z", content: "before blank" });
    const badJson = "{not valid json";
    const good2 = historyLine({ role: "assistant", session_id: "s1", ts: "2026-07-28T00:00:02.000Z", content: "after skips" });

    // CRLF 終端の行を挟む: split("\n") 後は行末に "\r" が残る。
    const content = [good1, "", badJson, "   ", `${good2}\r`, ""].join("\n");
    const buffer = Buffer.from(content, "utf8");

    const { events } = parseCodexHistoryChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk: content,
      fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
    });

    // 空行・parse 失敗行・空白行は読み飛ばされ、2 件だけが残る
    expect(events.length).toBe(2);
    expect(buffer.subarray(events[0]!.lineOffset, events[0]!.lineOffset + Buffer.byteLength(good1, "utf8")).toString("utf8")).toBe(
      good1,
    );
    // \r 終端行の lineOffset は "\r" を含む生の行の開始位置 (trim 前)
    const rawGood2 = `${good2}\r`;
    expect(
      buffer.subarray(events[1]!.lineOffset, events[1]!.lineOffset + Buffer.byteLength(rawGood2, "utf8")).toString("utf8"),
    ).toBe(rawGood2);
  });

  test("lineIndex は行番号のまま残り、dedupeHash の式は変更されていない", () => {
    const lines = [
      historyLine({ role: "user", session_id: "s1", ts: "2026-07-28T00:00:00.000Z", content: "a" }),
      "", // 空行 (lineIndex は消費するが event は作らない)
      historyLine({ role: "assistant", session_id: "s1", ts: "2026-07-28T00:00:01.000Z", content: "b" }),
    ];
    const content = lines.join("\n") + "\n";
    const sourceKey = "test:dedupe";
    const baseOffset = 1000;

    const { events } = parseCodexHistoryChunk({
      sourceKey,
      baseOffset,
      chunk: content,
      fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
    });

    expect(events.length).toBe(2);
    expect(events[0]!.lineIndex).toBe(0);
    expect(events[1]!.lineIndex).toBe(2); // 空行 (index 1) は読み飛ばされてもカウントは進む

    for (const event of events) {
      const expectedHash = createHash("sha256")
        .update(`${sourceKey}:${baseOffset + event.lineIndex}:${event.line}`)
        .digest("hex");
      expect(event.dedupeHash).toBe(expectedHash);
    }
  });

  /**
   * §160-005a (review 対応): レビューで「Buffer.byteLength の積算だと chunk 中間の
   * U+FFFD (不正 UTF-8 バイト列を toString("utf8") でデコードした際の置換文字) で
   * lineOffset がずれるのでは」と指摘された。実装は codex-sessions.ts と同じ
   * `buffer.indexOf(0x0a, cursor)` 走査に揃えたが、chunk がすでに 1 回デコード済みの
   * 文字列である限り、積算方式と走査方式は数学的に同じ値を返す
   * (`Buffer.byteLength(a) + Buffer.byteLength(b) === Buffer.byteLength(a + b)` が
   * UTF-8 の加法性として常に成り立つため)。ここでは U+FFFD を明示的に含む chunk を
   * 与え、後続行の lineOffset が (a) buffer.indexOf の実位置と一致すること、
   * (b) クラッシュしないこと を固定する。
   */
  test("chunk に U+FFFD (不正バイトの置換文字) が混じっていても後続行の lineOffset は buffer 上の実位置と一致する", () => {
    const before = historyLine({ role: "user", session_id: "s1", ts: "2026-07-28T00:00:00.000Z", content: "before" });
    // U+FFFD (0xEF 0xBF 0xBD, 3 バイト) を、不正バイト列を toString("utf8") した結果として模擬する。
    const corrupted = `��${historyLine({ role: "assistant", session_id: "s1", ts: "2026-07-28T00:00:01.000Z", content: "after-invalid-bytes" })}`;
    const after = historyLine({ role: "user", session_id: "s1", ts: "2026-07-28T00:00:02.000Z", content: "third" });
    const content = [before, corrupted, after].join("\n") + "\n";
    const buffer = Buffer.from(content, "utf8");

    const { events } = parseCodexHistoryChunk({
      sourceKey: "test:fffd",
      baseOffset: 0,
      chunk: content,
      fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
    });

    expect(events.length).toBe(2); // corrupted 行は JSON.parse に失敗するので読み飛ばされる
    expect(
      buffer.subarray(events[0]!.lineOffset, events[0]!.lineOffset + Buffer.byteLength(before, "utf8")).toString("utf8"),
    ).toBe(before);
    // after は corrupted 行 (U+FFFD 2 個 + JSON 本体) の直後に位置する。
    const expectedAfterOffset = Buffer.byteLength(before, "utf8") + 1 + Buffer.byteLength(corrupted, "utf8") + 1;
    expect(events[1]!.lineOffset).toBe(expectedAfterOffset);
    expect(
      buffer.subarray(events[1]!.lineOffset, events[1]!.lineOffset + Buffer.byteLength(after, "utf8")).toString("utf8"),
    ).toBe(after);
  });

  test("スライス分割しても一括 parse と同じ件数・offset・重複なしに収束する", () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      historyLine({
        role: i % 2 === 0 ? "user" : "assistant",
        session_id: "slice-session",
        ts: `2026-07-28T00:00:${String(i).padStart(2, "0")}.000Z`,
        content: "x".repeat(50 + i * 37),
      }),
    );
    const content = lines.join("\n") + "\n";

    const whole = parseCodexHistoryChunk({
      sourceKey: "test:whole",
      baseOffset: 0,
      chunk: content,
      fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
    });
    const wholeConsumedBytes = Buffer.byteLength(content.slice(0, whole.consumedLength), "utf8");

    for (const sliceBytes of [37, 97, 251, 512]) {
      const sliced = runSliceLoop(content, sliceBytes, parseCodexHistoryChunkAsBytes);
      expect(sliced.events.length).toBe(whole.events.length);
      expect(sliced.finalOffset).toBe(wholeConsumedBytes);

      const hashes = sliced.events.map((e) => (e as { dedupeHash: string }).dedupeHash);
      expect(new Set(hashes).size).toBe(hashes.length);

      const offsets = sliced.events.map((e) => (e as { lineOffset: number }).lineOffset);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    }
  });

  test("1 行がスライスより長くても連結すれば欠落も重複もしない (マルチバイト)", () => {
    const longLine = historyLine({
      role: "user",
      session_id: "slice-session",
      ts: "2026-07-28T00:00:00.000Z",
      content: "ん".repeat(70_000),
    });
    const shortLine = historyLine({
      role: "assistant",
      session_id: "slice-session",
      ts: "2026-07-28T00:00:01.000Z",
      content: "短い返信",
    });
    const content = [longLine, shortLine].join("\n") + "\n";

    const whole = parseCodexHistoryChunk({
      sourceKey: "test:whole",
      baseOffset: 0,
      chunk: content,
      fallbackNowIso: () => "2026-07-28T00:00:00.000Z",
    });
    const wholeConsumedBytes = Buffer.byteLength(content.slice(0, whole.consumedLength), "utf8");

    const sliced = runSliceLoop(content, 4096, parseCodexHistoryChunkAsBytes);
    expect(sliced.events.length).toBe(whole.events.length);
    expect(sliced.finalOffset).toBe(wholeConsumedBytes);
    expect(sliced.slices).toBeGreaterThan(1);
  });
});
