import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseClaudeCodeChunk } from "../../src/ingest/claude-code-sessions";
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
