import { describe, expect, test } from "bun:test";
import { parseOpencodeMessageChunk } from "../../src/ingest/opencode-storage";

describe("opencode storage ingest parser", () => {
  test("normalizes user prompt with cwd->project from session directory", () => {
    const chunk = JSON.stringify({
      id: "msg_1",
      sessionID: "ses_1",
      role: "user",
      time: { created: 1771208230144 },
      summary: { title: "fallback title" },
    });

    const parsed = parseOpencodeMessageChunk({
      sourceKey: "opencode_rollout:/tmp/msg_1.json",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
      resolveSessionDirectory: (sessionId) =>
        sessionId === "ses_1" ? "/Users/test/Desktop/Code/CC-harness/Context-Harness" : undefined,
      resolveMessageText: (messageId) => (messageId === "msg_1" ? "opencode interactive ingest test" : ""),
    });

    expect(parsed.events.length).toBe(1);
    const event = parsed.events[0];
    expect(event?.eventType).toBe("user_prompt");
    expect(event?.sessionId).toBe("ses_1");
    expect(event?.project).toBe("Context-Harness");
    expect(event?.payload.prompt).toBe("opencode interactive ingest test");
    expect(event?.dedupeHash.length).toBe(64);
  });

  test("normalizes assistant completion to checkpoint", () => {
    const chunk = JSON.stringify({
      id: "msg_2",
      sessionID: "ses_2",
      role: "assistant",
      finish: "stop",
      time: { created: 1771208231000, completed: 1771208234999 },
      path: {
        cwd: "/Users/test/Desktop/Code/CC-harness/harness-mem",
      },
      summary: { title: "assistant summary" },
    });

    const parsed = parseOpencodeMessageChunk({
      sourceKey: "opencode_rollout:/tmp/msg_2.json",
      baseOffset: 99,
      chunk,
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
      resolveSessionDirectory: () => undefined,
      resolveMessageText: () => "assistant final answer",
    });

    expect(parsed.events.length).toBe(1);
    const event = parsed.events[0];
    expect(event?.eventType).toBe("checkpoint");
    expect(event?.project).toBe("harness-mem");
    expect(event?.payload.content).toBe("assistant final answer");
    expect(event?.timestamp).toBe("2026-02-16T02:17:14.999Z");
  });

  test("ignores malformed or incomplete json safely", () => {
    const parsed = parseOpencodeMessageChunk({
      sourceKey: "opencode_rollout:/tmp/msg_3.json",
      baseOffset: 0,
      chunk: "{\"id\":\"msg_3\",\"role\":\"user\"",
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
      resolveSessionDirectory: () => undefined,
      resolveMessageText: () => "",
    });

    expect(parsed.events.length).toBe(0);
    expect(parsed.consumedBytes).toBe(0);
  });

  test("skips assistant intermediate tool-calls without text", () => {
    const chunk = JSON.stringify({
      id: "msg_3",
      sessionID: "ses_3",
      role: "assistant",
      finish: "tool-calls",
      time: { created: 1771209000000 },
      path: { cwd: "/Users/test/Desktop/Code/CC-harness/harness-mem" },
    });

    const parsed = parseOpencodeMessageChunk({
      sourceKey: "opencode_rollout:/tmp/msg_3.json",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
      resolveSessionDirectory: () => undefined,
      resolveMessageText: () => "",
    });

    expect(parsed.events.length).toBe(0);
    expect(parsed.consumedBytes).toBe(Buffer.byteLength(chunk, "utf8"));
  });
});
