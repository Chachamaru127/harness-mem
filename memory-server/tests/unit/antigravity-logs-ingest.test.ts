import { describe, expect, test } from "bun:test";
import { parseAntigravityLogChunk } from "../../src/ingest/antigravity-logs";

describe("antigravity log ingest parser", () => {
  test("parses planner request line into checkpoint activity event", () => {
    const chunk = [
      "2026-02-16 18:37:31.889 [info] language server listening",
      "2026-02-16 18:38:24.369 [info] I0216 18:38:24.369166 91838 planner_generator.go:275] Requesting planner with 5 chat messages at model retry attempt 1 and API retry attempt 1",
      "",
    ].join("\n");

    const parsed = parseAntigravityLogChunk({
      sourceKey: "antigravity_log:/tmp/Antigravity.log",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-02-16T09:38:24.369Z",
      project: "harness-mem",
      sessionSeed: "harness-mem:946865",
      filePath: "/tmp/Antigravity.log",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0]?.eventType).toBe("checkpoint");
    expect(parsed.events[0]?.project).toBe("harness-mem");
    expect(parsed.events[0]?.sessionId).toContain("antigravity:harness-mem:");
    expect(parsed.events[0]?.payload.chat_message_count).toBe(5);
    expect(parsed.events[0]?.payload.title).toBe("Antigravity planner activity");
    expect((parsed.events[0]?.dedupeHash || "").length).toBe(64);
    expect(parsed.consumedBytes).toBe(Buffer.byteLength(chunk, "utf8"));
  });

  test("keeps offset when line is incomplete", () => {
    const chunk = "2026-02-16 18:38:24.369 [info] Requesting planner with 3 chat messages";
    const parsed = parseAntigravityLogChunk({
      sourceKey: "antigravity_log:/tmp/Antigravity.log",
      baseOffset: 42,
      chunk,
      fallbackNowIso: () => "2026-02-16T09:38:24.369Z",
      project: "harness-mem",
      sessionSeed: "harness-mem:946865",
      filePath: "/tmp/Antigravity.log",
    });

    expect(parsed.events.length).toBe(0);
    expect(parsed.consumedBytes).toBe(0);
  });
});
