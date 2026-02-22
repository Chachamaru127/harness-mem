import { describe, expect, test } from "bun:test";
import { parseAntigravityFile } from "../../src/ingest/antigravity-files";

describe("antigravity file ingest parser", () => {
  test("parses checkpoint markdown into checkpoint event", () => {
    const parsed = parseAntigravityFile({
      sourceKey: "antigravity_file:/tmp/project/docs/checkpoints/20260216.md",
      filePath: "/tmp/project/docs/checkpoints/20260216.md",
      workspaceRoot: "/Users/test/Desktop/Code/CC-harness/harness-mem",
      content: "# Checkpoint: 2026-02-16\n\n## 完了した作業\n- A\n",
      mtimeMs: 1771220400000,
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("checkpoint");
    expect(parsed?.eventType).toBe("checkpoint");
    expect(parsed?.project).toBe("/Users/test/Desktop/Code/CC-harness/harness-mem");
    expect(parsed?.sessionId).toBe("antigravity:/Users/test/Desktop/Code/CC-harness/harness-mem:20260216");
    expect(parsed?.payload.title).toBe("Checkpoint: 2026-02-16");
    expect(parsed?.dedupeHash.length).toBe(64);
  });

  test("maps codex response file prefix to tool_name", () => {
    const parsed = parseAntigravityFile({
      sourceKey: "antigravity_file:/tmp/project/logs/codex-responses/debug-20260216.md",
      filePath: "/tmp/project/logs/codex-responses/debug-20260216.md",
      workspaceRoot: "/Users/test/Desktop/Code/CC-harness/Context-Harness",
      content: "## Root cause\nSomething failed",
      mtimeMs: 1771220500000,
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("codex_response");
    expect(parsed?.eventType).toBe("tool_use");
    expect(parsed?.project).toBe("/Users/test/Desktop/Code/CC-harness/Context-Harness");
    expect(parsed?.payload.tool_name).toBe("codex-debug");
    expect(parsed?.payload.source_type).toBe("antigravity_codex_response");
  });

  test("returns null for unsupported path or empty content", () => {
    const unsupported = parseAntigravityFile({
      sourceKey: "antigravity_file:/tmp/project/docs/README.md",
      filePath: "/tmp/project/docs/README.md",
      workspaceRoot: "/tmp/project",
      content: "# README",
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
    });
    expect(unsupported).toBeNull();

    const empty = parseAntigravityFile({
      sourceKey: "antigravity_file:/tmp/project/docs/checkpoints/empty.md",
      filePath: "/tmp/project/docs/checkpoints/empty.md",
      workspaceRoot: "/tmp/project",
      content: "   ",
      fallbackNowIso: () => "2026-02-16T00:00:00.000Z",
    });
    expect(empty).toBeNull();
  });
});
