import { describe, expect, test } from "bun:test";
import { parseOpencodeDbMessageRow } from "../../src/ingest/opencode-db";

describe("opencode db ingest parser", () => {
  test("parses user row and resolves project from session directory", () => {
    const parsed = parseOpencodeDbMessageRow({
      sourceKey: "opencode_db_message:/tmp/opencode.db",
      row: {
        rowid: 101,
        messageId: "msg_u1",
        sessionId: "ses_a",
        timeCreated: 1771210601750,
        messageData: JSON.stringify({
          role: "user",
          summary: { title: "summary title" },
        }),
        sessionDirectory: "/Users/test/Desktop/Code/CC-harness/Context-Harness",
      },
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
      resolveMessageText: () => "Hello from message part",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.eventType).toBe("user_prompt");
    expect(parsed?.project).toBe("Context-Harness");
    expect(parsed?.payload.prompt).toBe("Hello from message part");
    expect(parsed?.timestamp).toBe("2026-02-16T02:56:41.750Z");
    expect(parsed?.dedupeHash.length).toBe(64);
  });

  test("parses assistant row with checkpoint fallback text", () => {
    const parsed = parseOpencodeDbMessageRow({
      sourceKey: "opencode_db_message:/tmp/opencode.db",
      row: {
        rowid: 202,
        messageId: "msg_a1",
        sessionId: "ses_a",
        timeCreated: 1771210983039,
        messageData: JSON.stringify({
          role: "assistant",
          finish: "stop",
          path: { cwd: "/Users/test/Desktop/Code/CC-harness/harness-mem" },
        }),
        sessionDirectory: "",
      },
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
      resolveMessageText: () => "",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.eventType).toBe("checkpoint");
    expect(parsed?.project).toBe("harness-mem");
    expect(parsed?.payload.content).toBe("(assistant completed)");
  });

  test("skips assistant intermediate tool-calls without text", () => {
    const parsed = parseOpencodeDbMessageRow({
      sourceKey: "opencode_db_message:/tmp/opencode.db",
      row: {
        rowid: 303,
        messageId: "msg_a2",
        sessionId: "ses_a",
        timeCreated: 1771210984000,
        messageData: JSON.stringify({
          role: "assistant",
          finish: "tool-calls",
          path: { cwd: "/Users/test/Desktop/Code/CC-harness/harness-mem" },
        }),
        sessionDirectory: "",
      },
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
      resolveMessageText: () => "",
    });

    expect(parsed).toBeNull();
  });
});
