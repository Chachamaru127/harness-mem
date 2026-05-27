import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

function mergeCursorHooksJson(file: string, hookCommand: string): void {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    version?: number;
    hooks: Record<string, Array<{ command?: string }>>;
  };

  const stripMemoryHook = (entries: Array<{ command?: string }>) =>
    entries.filter((entry) => !(entry.command || "").includes("memory-cursor-event.sh"));

  const hasExactCmd = (entries: Array<{ command?: string }>, cmd: string) =>
    entries.some((entry) => (entry.command || "") === cmd);

  const ensureCmd = (entries: Array<{ command?: string }>, cmd: string) =>
    hasExactCmd(entries, cmd) ? entries : [...entries, { command: cmd }];

  const mergeHook = (key: string) => {
    const current = stripMemoryHook(parsed.hooks[key] || []);
    parsed.hooks[key] = ensureCmd(current, hookCommand);
  };

  parsed.version = parsed.version ?? 1;
  parsed.hooks = parsed.hooks ?? {};
  for (const key of [
    "sessionStart",
    "beforeSubmitPrompt",
    "afterAgentResponse",
    "afterMCPExecution",
    "afterShellExecution",
    "afterFileEdit",
    "sessionEnd",
    "stop",
  ]) {
    mergeHook(key);
  }

  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

describe("cursor hooks merge contract", () => {
  test("merge keeps unrelated user hooks and adds memory-cursor-event.sh entries", () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "harness-mem-cursor-hooks-"));
    const cursorDir = join(tmpHome, ".cursor");
    const hooksJson = join(cursorDir, "hooks.json");
    mkdirSync(cursorDir, { recursive: true });

    const foreignHook = "/Users/example/.superset/hooks/cursor-hook.sh Start";
    const memoryHook = `bash ${tmpHome}/.cursor/hooks/memory-cursor-event.sh`;

    writeFileSync(
      hooksJson,
      JSON.stringify(
        {
          version: 1,
          hooks: {
            beforeSubmitPrompt: [{ command: foreignHook }, { command: memoryHook }],
            sessionStart: [{ command: foreignHook }],
            afterAgentResponse: [],
            sessionEnd: [],
            stop: [{ command: foreignHook }],
          },
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    mergeCursorHooksJson(hooksJson, memoryHook);

    const parsed = JSON.parse(readFileSync(hooksJson, "utf8")) as {
      hooks: Record<string, Array<{ command?: string }>>;
    };

    const readCommands = (key: string): string[] =>
      (parsed.hooks[key] || [])
        .map((entry) => entry.command || "")
        .filter(Boolean);

    expect(readCommands("beforeSubmitPrompt")).toContain(foreignHook);
    expect(readCommands("beforeSubmitPrompt").some((cmd) => cmd.includes("memory-cursor-event.sh"))).toBe(
      true
    );
    expect(readCommands("sessionStart")).toContain(foreignHook);
    expect(readCommands("sessionStart").some((cmd) => cmd.includes("memory-cursor-event.sh"))).toBe(true);
    expect(readCommands("afterAgentResponse").some((cmd) => cmd.includes("memory-cursor-event.sh"))).toBe(
      true
    );
    expect(readCommands("sessionEnd").some((cmd) => cmd.includes("memory-cursor-event.sh"))).toBe(true);
    expect(readCommands("stop")).toContain(foreignHook);
    expect(readCommands("stop").some((cmd) => cmd.includes("memory-cursor-event.sh"))).toBe(true);

    const example = JSON.parse(readFileSync(resolve(ROOT, ".cursor/hooks.json.example"), "utf8")) as {
      hooks: Record<string, unknown[]>;
    };
    for (const key of [
      "sessionStart",
      "beforeSubmitPrompt",
      "afterAgentResponse",
      "afterMCPExecution",
      "afterShellExecution",
      "afterFileEdit",
      "sessionEnd",
      "stop",
    ]) {
      expect(Array.isArray(example.hooks[key])).toBe(true);
    }

    rmSync(tmpHome, { recursive: true, force: true });
  });
});
