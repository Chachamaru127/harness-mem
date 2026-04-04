import { describe, expect, test } from "bun:test";

import { createJsonToolResult } from "../../src/tool-result.js";

describe("tool result helper", () => {
  test("adds structured content and max result size metadata for JSON payloads", () => {
    const payload = { ok: true, items: [{ id: "obs-1" }] };
    const result = createJsonToolResult(payload);

    expect(result.content[0]?.text).toContain('"ok": true');
    expect(result.structuredContent).toEqual(payload);
    expect(result._meta?.["anthropic/maxResultSizeChars"]).toBe(500000);
  });

  test("preserves citations when provided", () => {
    const citations = [{ id: "obs-1", source: "harness-mem" }];
    const result = createJsonToolResult({ ok: true }, { citations });

    expect(result._citations).toEqual(citations);
  });
});
