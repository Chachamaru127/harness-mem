import { describe, expect, test } from "bun:test";
import { parseClaudeCodeProjectsChunk } from "../../src/ingest/claude-code-projects";

describe("claude-code-projects ingest parser", () => {
  test("extracts assistant message with model and usage", () => {
    const chunk = [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-01T10:00:00.000Z",
        message: {
          model: "claude-opus-4-6",
          content: [{ type: "text", text: "Here is my response." }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 5000,
            cache_read_input_tokens: 200,
          },
        },
      }),
    ].join("\n") + "\n";

    const parsed = parseClaudeCodeProjectsChunk({
      sourceKey: "claude_code_project:/tmp/test.jsonl",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-03-01T12:00:00.000Z",
      sessionId: "session-123",
      project: "/home/user/myproject",
    });

    expect(parsed.events.length).toBe(1);
    const event = parsed.events[0];
    expect(event.eventType).toBe("assistant_message");
    expect(event.model).toBe("claude-opus-4-6");
    expect(event.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 5000,
      cache_read_input_tokens: 200,
    });
    expect(event.sessionId).toBe("session-123");
    expect(event.project).toBe("/home/user/myproject");
    expect(event.timestamp).toBe("2026-03-01T10:00:00.000Z");
    expect(event.dedupeHash.length).toBe(64);
    expect(event.payload.source_type).toBe("claude_code_project");
    expect(event.payload.model).toBe("claude-opus-4-6");
    expect(event.payload.input_tokens).toBe(100);
    expect(event.payload.output_tokens).toBe(50);
  });

  test("extracts human message as user_prompt", () => {
    const chunk = [
      JSON.stringify({
        type: "human",
        timestamp: "2026-03-01T10:00:00.000Z",
        message: {
          content: [{ type: "text", text: "Please help me fix the bug." }],
        },
      }),
    ].join("\n") + "\n";

    const parsed = parseClaudeCodeProjectsChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-03-01T12:00:00.000Z",
      sessionId: "session-abc",
      project: "test-project",
    });

    expect(parsed.events.length).toBe(1);
    const event = parsed.events[0];
    expect(event.eventType).toBe("user_prompt");
    expect(event.model).toBeNull();
    expect(event.usage).toBeNull();
    expect(event.payload.prompt).toBe("Please help me fix the bug.");
  });

  test("extracts tool_result as tool_use", () => {
    const chunk = [
      JSON.stringify({
        type: "tool_result",
        timestamp: "2026-03-01T10:00:01.000Z",
        name: "Read",
      }),
    ].join("\n") + "\n";

    const parsed = parseClaudeCodeProjectsChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-03-01T12:00:00.000Z",
      sessionId: "s1",
      project: "p1",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0].eventType).toBe("tool_use");
    expect(parsed.events[0].payload.tool_name).toBe("Read");
  });

  test("handles multiple event types in one chunk", () => {
    const chunk = [
      JSON.stringify({
        type: "human",
        timestamp: "2026-03-01T10:00:00.000Z",
        message: { content: "Fix the test" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-01T10:00:01.000Z",
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Done." }],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      }),
      JSON.stringify({
        type: "tool_result",
        timestamp: "2026-03-01T10:00:02.000Z",
        name: "Edit",
      }),
    ].join("\n") + "\n";

    const parsed = parseClaudeCodeProjectsChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-03-01T12:00:00.000Z",
      sessionId: "multi-session",
      project: "multi-project",
    });

    expect(parsed.events.length).toBe(3);
    expect(parsed.events[0].eventType).toBe("user_prompt");
    expect(parsed.events[1].eventType).toBe("assistant_message");
    expect(parsed.events[1].model).toBe("claude-sonnet-4-6");
    expect(parsed.events[2].eventType).toBe("tool_use");
  });

  test("skips invalid JSON lines gracefully", () => {
    const chunk = [
      "not-json",
      JSON.stringify({
        type: "human",
        timestamp: "2026-03-01T10:00:00.000Z",
        message: { content: "Hello" },
      }),
      "also-invalid",
      "",
    ].join("\n") + "\n";

    const parsed = parseClaudeCodeProjectsChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-03-01T12:00:00.000Z",
      sessionId: "s1",
      project: "p1",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0].eventType).toBe("user_prompt");
  });

  test("handles assistant message with no usage", () => {
    const chunk = [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-01T10:00:00.000Z",
        message: {
          model: "claude-opus-4-6",
          content: [{ type: "text", text: "Response without usage" }],
        },
      }),
    ].join("\n") + "\n";

    const parsed = parseClaudeCodeProjectsChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-03-01T12:00:00.000Z",
      sessionId: "s1",
      project: "p1",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0].model).toBe("claude-opus-4-6");
    expect(parsed.events[0].usage).toBeNull();
  });

  test("consumedBytes tracks properly for streaming", () => {
    const line1 = JSON.stringify({ type: "human", message: { content: "test" } });
    const line2 = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-6",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    });
    const complete = line1 + "\n" + line2 + "\n";
    const incomplete = complete + "partial-line-without-newline";

    const parsed = parseClaudeCodeProjectsChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk: incomplete,
      fallbackNowIso: () => "2026-03-01T12:00:00.000Z",
      sessionId: "s1",
      project: "p1",
    });

    // Should consume only complete lines
    expect(parsed.consumedBytes).toBe(Buffer.byteLength(complete, "utf8"));
    expect(parsed.events.length).toBe(2);
  });

  test("handles string content directly", () => {
    const chunk = [
      JSON.stringify({
        type: "human",
        timestamp: "2026-03-01T10:00:00.000Z",
        message: { content: "Direct string content" },
      }),
    ].join("\n") + "\n";

    const parsed = parseClaudeCodeProjectsChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-03-01T12:00:00.000Z",
      sessionId: "s1",
      project: "p1",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0].payload.prompt).toBe("Direct string content");
  });

  test("skips unknown event types", () => {
    const chunk = [
      JSON.stringify({
        type: "unknown_type",
        timestamp: "2026-03-01T10:00:00.000Z",
        message: { content: "should be skipped" },
      }),
    ].join("\n") + "\n";

    const parsed = parseClaudeCodeProjectsChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-03-01T12:00:00.000Z",
      sessionId: "s1",
      project: "p1",
    });

    expect(parsed.events.length).toBe(0);
  });

  test("uses fallback timestamp when none provided", () => {
    const chunk = [
      JSON.stringify({
        type: "human",
        message: { content: "no timestamp" },
      }),
    ].join("\n") + "\n";

    const parsed = parseClaudeCodeProjectsChunk({
      sourceKey: "test",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-03-01T12:00:00.000Z",
      sessionId: "s1",
      project: "p1",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0].timestamp).toBe("2026-03-01T12:00:00.000Z");
  });
});
