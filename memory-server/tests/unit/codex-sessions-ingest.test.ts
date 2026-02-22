import { describe, expect, test } from "bun:test";
import { parseCodexSessionsChunk } from "../../src/ingest/codex-sessions";

describe("codex sessions ingest parser", () => {
  test("extracts japanese user prompt + task_complete checkpoint", () => {
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
          type: "task_complete",
          last_agent_message: "完了しました",
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
    expect(checkpoint.payload.last_agent_message).toBe("完了しました");
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
});
