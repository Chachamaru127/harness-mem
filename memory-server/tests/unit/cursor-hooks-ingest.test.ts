import { describe, expect, test } from "bun:test";
import { parseCursorHooksChunk } from "../../src/ingest/cursor-hooks";

describe("cursor hooks ingest parser", () => {
  test("extracts japanese prompt + tool_use + session_end", () => {
    const chunk = [
      JSON.stringify({
        hook_event_name: "beforeSubmitPrompt",
        conversation_id: "cursor-conv-1",
        workspace_roots: ["/Users/test/Desktop/Code/CC-harness/harness-mem"],
        prompt: "今これ手動でのテストです。Helloとだけ回答して",
        timestamp: "2026-02-16T10:00:00.000Z",
      }),
      JSON.stringify({
        hook_event_name: "afterMCPExecution",
        conversation_id: "cursor-conv-1",
        workspace_roots: ["/Users/test/Desktop/Code/CC-harness/harness-mem"],
        tool_name: "Read",
        tool_input: { file_path: "README.md" },
        result_json: { ok: true },
        timestamp: "2026-02-16T10:00:01.000Z",
      }),
      JSON.stringify({
        hook_event_name: "stop",
        conversation_id: "cursor-conv-1",
        workspace_roots: ["/Users/test/Desktop/Code/CC-harness/harness-mem"],
        status: "completed",
        timestamp: "2026-02-16T10:00:02.000Z",
      }),
    ].join("\n") + "\n";

    const parsed = parseCursorHooksChunk({
      sourceKey: "cursor_hooks:/tmp/events.jsonl",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-02-16T10:00:59.000Z",
    });

    expect(parsed.events.length).toBe(3);
    expect(parsed.events[0]?.eventType).toBe("user_prompt");
    expect(parsed.events[0]?.sessionId).toBe("cursor-conv-1");
    expect(parsed.events[0]?.project).toBe("/Users/test/Desktop/Code/CC-harness/harness-mem");
    expect(parsed.events[0]?.payload.prompt).toBe("今これ手動でのテストです。Helloとだけ回答して");
    expect(parsed.events[1]?.eventType).toBe("tool_use");
    expect(parsed.events[1]?.payload.tool_name).toBe("Read");
    expect(parsed.events[2]?.eventType).toBe("session_end");
    expect(parsed.events[2]?.payload.status).toBe("completed");
    expect(parsed.events[0]?.dedupeHash.length).toBe(64);
  });

  test("maps sessionStart, afterAgentResponse, and sessionEnd with metadata", () => {
    const chunk = [
      JSON.stringify({
        hook_event_name: "sessionStart",
        conversation_id: "cursor-conv-2",
        session_id: "cursor-conv-2",
        generation_id: "gen-start",
        transcript_path: "/tmp/transcripts/conv-2.jsonl",
        workspace_roots: ["/Users/test/proj"],
        composer_mode: "agent",
        timestamp: "2026-02-16T09:00:00.000Z",
      }),
      JSON.stringify({
        hook_event_name: "afterAgentResponse",
        conversation_id: "cursor-conv-2",
        generation_id: "gen-response-1",
        transcript_path: "/tmp/transcripts/conv-2.jsonl",
        workspace_roots: ["/Users/test/proj"],
        text: "Assistant says hello from Cursor hook.",
        timestamp: "2026-02-16T09:00:01.000Z",
      }),
      JSON.stringify({
        hook_event_name: "sessionEnd",
        conversation_id: "cursor-conv-2",
        generation_id: "gen-end",
        workspace_roots: ["/Users/test/proj"],
        reason: "completed",
        duration_ms: 1200,
        timestamp: "2026-02-16T09:00:02.000Z",
      }),
    ].join("\n") + "\n";

    const parsed = parseCursorHooksChunk({
      sourceKey: "cursor_hooks:/tmp/events.jsonl",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-02-16T09:00:59.000Z",
    });

    expect(parsed.events.length).toBe(3);
    expect(parsed.events[0]?.eventType).toBe("session_start");
    expect(parsed.events[0]?.payload.composer_mode).toBe("agent");
    expect(parsed.events[0]?.payload.generation_id).toBe("gen-start");
    expect(parsed.events[0]?.payload.transcript_path).toBe("/tmp/transcripts/conv-2.jsonl");

    expect(parsed.events[1]?.eventType).toBe("checkpoint");
    expect(parsed.events[1]?.payload.title).toBe("assistant_response");
    expect(parsed.events[1]?.payload.content).toBe("Assistant says hello from Cursor hook.");
    expect(parsed.events[1]?.payload.generation_id).toBe("gen-response-1");

    expect(parsed.events[2]?.eventType).toBe("session_end");
    expect(parsed.events[2]?.payload.hook_event_name).toBe("sessionEnd");
    expect(parsed.events[2]?.payload.status).toBe("completed");
    expect(parsed.events[2]?.payload.duration_ms).toBe(1200);
  });

  test("prefers conversation_id over generation_id for session id", () => {
    const line = JSON.stringify({
      hook_event_name: "afterAgentResponse",
      conversation_id: "conv-stable",
      generation_id: "gen-ephemeral",
      workspace_roots: ["/tmp/project"],
      text: "reply body",
      timestamp: "2026-02-16T11:30:00.000Z",
    });

    const parsed = parseCursorHooksChunk({
      sourceKey: "cursor_hooks:/tmp/events.jsonl",
      baseOffset: 0,
      chunk: `${line}\n`,
      fallbackNowIso: () => "2026-02-16T11:30:59.000Z",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0]?.sessionId).toBe("conv-stable");
    expect(parsed.events[0]?.payload.generation_id).toBe("gen-ephemeral");
  });

  test("ignores afterAgentThought", () => {
    const line = JSON.stringify({
      hook_event_name: "afterAgentThought",
      conversation_id: "conv-thought",
      workspace_roots: ["/tmp/project"],
      text: "hidden reasoning",
      duration_ms: 900,
    });

    const parsed = parseCursorHooksChunk({
      sourceKey: "cursor_hooks:/tmp/events.jsonl",
      baseOffset: 0,
      chunk: `${line}\n`,
      fallbackNowIso: () => "2026-02-16T12:00:00.000Z",
    });

    expect(parsed.events.length).toBe(0);
  });

  test("falls back session_id to cursor:<project>:<date>", () => {
    const line = JSON.stringify({
      hook_event_name: "beforeSubmitPrompt",
      workspace_root: "/Users/test/Desktop/Code/CC-harness/Context-Harness",
      prompt: "fallback session id test",
      timestamp: "2026-02-16T11:00:00.000Z",
    });

    const parsed = parseCursorHooksChunk({
      sourceKey: "cursor_hooks:/tmp/events2.jsonl",
      baseOffset: 0,
      chunk: `${line}\n`,
      fallbackNowIso: () => "2026-02-16T11:00:59.000Z",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0]?.project).toBe("/Users/test/Desktop/Code/CC-harness/Context-Harness");
    expect(parsed.events[0]?.sessionId).toBe("cursor:/Users/test/Desktop/Code/CC-harness/Context-Harness:2026-02-16");
  });

  test("ignores malformed/incomplete lines safely", () => {
    const valid = JSON.stringify({
      hook_event_name: "beforeSubmitPrompt",
      conversation_id: "conv-x",
      workspace_root: "/tmp/project-x",
      prompt: "alpha",
    });
    const invalid = "not-json";
    const incomplete = JSON.stringify({
      hook_event_name: "stop",
      conversation_id: "conv-x",
      workspace_root: "/tmp/project-x",
    });

    const parsed = parseCursorHooksChunk({
      sourceKey: "cursor_hooks:/tmp/events3.jsonl",
      baseOffset: 128,
      chunk: `${valid}\n${invalid}\n${incomplete}`,
      fallbackNowIso: () => "2026-02-16T12:00:00.000Z",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0]?.eventType).toBe("user_prompt");
    const expectedConsumed = Buffer.byteLength(`${valid}\n${invalid}\n`, "utf8");
    expect(parsed.consumedBytes).toBe(expectedConsumed);
  });
});
