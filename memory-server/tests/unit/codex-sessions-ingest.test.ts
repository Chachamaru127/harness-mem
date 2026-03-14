import { describe, expect, test } from "bun:test";
import { parseCodexSessionsChunk } from "../../src/ingest/codex-sessions";

describe("codex sessions ingest parser", () => {
  test("extracts japanese user prompt + assistant final answer without duplicate checkpoints", () => {
    const chunk = [
      JSON.stringify({
        timestamp: "2026-02-15T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "session-abc",
          cwd: "/Users/test/Desktop/Code/CC-harness/harness-mem",
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-15T10:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "今まさに日本語でテスト中です" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-15T10:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "回答本文をきちんと保存します",
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-15T10:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "回答本文をきちんと保存します" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-15T10:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          last_agent_message: "回答本文をきちんと保存します",
          turn_id: "turn-1",
        },
      }),
    ].join("\n") + "\n";

    const parsed = parseCodexSessionsChunk({
      sourceKey: "codex_rollout:/tmp/rollout.jsonl",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-02-15T10:00:59.000Z",
      defaultProject: "fallback-project",
    });

    expect(parsed.events.length).toBe(2);
    expect(parsed.context.sessionId).toBe("session-abc");
    expect(parsed.context.project).toBe("/Users/test/Desktop/Code/CC-harness/harness-mem");

    const prompt = parsed.events[0];
    expect(prompt.eventType).toBe("user_prompt");
    expect(prompt.sessionId).toBe("session-abc");
    expect(prompt.project).toBe("/Users/test/Desktop/Code/CC-harness/harness-mem");
    expect(prompt.timestamp).toBe("2026-02-15T10:00:01.000Z");
    expect(prompt.payload.prompt).toBe("今まさに日本語でテスト中です");
    expect(prompt.dedupeHash.length).toBe(64);

    const checkpoint = parsed.events[1];
    expect(checkpoint.eventType).toBe("checkpoint");
    expect(checkpoint.sessionId).toBe("session-abc");
    expect(checkpoint.project).toBe("/Users/test/Desktop/Code/CC-harness/harness-mem");
    expect(checkpoint.payload.content).toBe("回答本文をきちんと保存します");
    expect(checkpoint.payload.last_agent_message).toBe("回答本文をきちんと保存します");
    expect(checkpoint.payload.prompt).toBe("今まさに日本語でテスト中です");
    expect(checkpoint.payload.title).toBe("assistant_response");
  });

  test("carries last user prompt across incremental chunks", () => {
    const firstChunk = [
      JSON.stringify({
        timestamp: "2026-02-15T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "session-xyz",
          cwd: "/tmp/project-y",
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-15T10:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "その時の回答を覚えておいて" }],
        },
      }),
    ].join("\n") + "\n";

    const firstParsed = parseCodexSessionsChunk({
      sourceKey: "codex_rollout:/tmp/incremental.jsonl",
      baseOffset: 0,
      chunk: firstChunk,
      fallbackNowIso: () => "2026-02-15T10:00:59.000Z",
    });

    expect(firstParsed.events.length).toBe(1);
    expect(firstParsed.context.lastUserPrompt).toBe("その時の回答を覚えておいて");

    const secondChunk = [
      JSON.stringify({
        timestamp: "2026-02-15T10:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "はい、回答も紐づけて記録します。",
        },
      }),
    ].join("\n") + "\n";

    const secondParsed = parseCodexSessionsChunk({
      sourceKey: "codex_rollout:/tmp/incremental.jsonl",
      baseOffset: firstParsed.consumedBytes,
      chunk: secondChunk,
      fallbackNowIso: () => "2026-02-15T10:01:00.000Z",
      context: firstParsed.context,
    });

    expect(secondParsed.events.length).toBe(1);
    expect(secondParsed.events[0]?.eventType).toBe("checkpoint");
    expect(secondParsed.events[0]?.payload.content).toBe("はい、回答も紐づけて記録します。");
    expect(secondParsed.events[0]?.payload.prompt).toBe("その時の回答を覚えておいて");
  });

  test("ignores invalid json and incomplete last line safely", () => {
    const line1 = JSON.stringify({
      type: "session_meta",
      payload: {
        id: "session-x",
        cwd: "/tmp/project-x",
      },
    });
    const line2 = "not-json";
    const line3 = JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "alpha" }],
      },
    });
    const line4 = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "task_complete",
        last_agent_message: "beta",
      },
    });

    const chunk = `${line1}\n${line2}\n${line3}\n${line4}`;

    const parsed = parseCodexSessionsChunk({
      sourceKey: "codex_rollout:/tmp/rollout2.jsonl",
      baseOffset: 128,
      chunk,
      fallbackNowIso: () => "2026-02-15T11:00:00.000Z",
      defaultSessionId: "fallback-session",
      defaultProject: "fallback-project",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0]?.eventType).toBe("user_prompt");
    expect(parsed.events[0]?.sessionId).toBe("session-x");
    expect(parsed.events[0]?.project).toBe("/tmp/project-x");

    const expectedConsumedBytes = Buffer.byteLength(`${line1}\n${line2}\n${line3}\n`, "utf8");
    expect(parsed.consumedBytes).toBe(expectedConsumedBytes);
  });

  test("uses defaults when session_meta is not present in chunk", () => {
    const line = JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "follow-up" }],
      },
    });

    const parsed = parseCodexSessionsChunk({
      sourceKey: "codex_rollout:/tmp/rollout3.jsonl",
      baseOffset: 0,
      chunk: `${line}\n`,
      fallbackNowIso: () => "2026-02-15T12:00:00.000Z",
      defaultSessionId: "session-from-path",
      defaultProject: "project-from-config",
    });

    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0]?.sessionId).toBe("session-from-path");
    expect(parsed.events[0]?.project).toBe("project-from-config");
  });

  test("recovers unseen tail messages from compacted replacement history", () => {
    const chunk = [
      JSON.stringify({
        timestamp: "2026-02-15T12:00:10.000Z",
        type: "compacted",
        payload: {
          replacement_history: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "前の依頼" }],
            },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "前の回答" }],
            },
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "今の依頼" }],
            },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "今の回答" }],
            },
          ],
        },
      }),
    ].join("\n") + "\n";

    const parsed = parseCodexSessionsChunk({
      sourceKey: "codex_rollout:/tmp/compacted.jsonl",
      baseOffset: 0,
      chunk,
      fallbackNowIso: () => "2026-02-15T12:00:59.000Z",
      context: {
        sessionId: "session-compact",
        project: "/tmp/project-compact",
        lastUserPrompt: "前の依頼",
        lastAssistantContent: "前の回答",
      },
      defaultSessionId: "session-compact",
      defaultProject: "/tmp/project-compact",
    });

    expect(parsed.events.length).toBe(2);
    expect(parsed.events[0]?.eventType).toBe("user_prompt");
    expect(parsed.events[0]?.payload.prompt).toBe("今の依頼");
    expect(parsed.events[1]?.eventType).toBe("checkpoint");
    expect(parsed.events[1]?.payload.content).toBe("今の回答");
    expect(parsed.events[1]?.payload.prompt).toBe("今の依頼");
  });
});
