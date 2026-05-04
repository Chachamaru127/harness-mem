import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const HOOKS_JSON = resolve(ROOT, "hooks/hooks.json");

type HookCommand = {
  command?: string;
};

type HookEntry = {
  hooks?: HookCommand[];
};

function collectCommands(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry: HookEntry) => (entry.hooks ?? []).map((hook) => hook.command ?? ""));
}

function runScriptTarget(command: string): string | null {
  const match = command.match(/scripts\/run-script\.js"?\s+([^\s"']+)/);
  if (!match) {
    return null;
  }

  const scriptName = match[1];
  const suffix = extname(scriptName) ? "" : ".sh";
  return `scripts/${scriptName}${suffix}`;
}

function directScriptTargets(command: string): string[] {
  return [...command.matchAll(/scripts\/([^\s"']+\.(?:js|sh))/g)].map((match) => `scripts/${match[1]}`);
}

describe("hooks manifest target contract", () => {
  test("every hook command points at a packaged script that exists", () => {
    const manifest = JSON.parse(readFileSync(HOOKS_JSON, "utf8")) as {
      hooks: Record<string, unknown>;
    };

    const commands = Object.values(manifest.hooks).flatMap(collectCommands);
    const targets = new Set<string>();

    for (const command of commands) {
      for (const target of directScriptTargets(command)) {
        targets.add(target);
      }

      const target = runScriptTarget(command);
      if (target) {
        targets.add(target);
      }
    }

    const missing = [...targets].filter((target) => !existsSync(resolve(ROOT, target)));
    expect(missing).toEqual([]);
  });

  test("manifest does not reference sibling-owned development guard hooks", () => {
    const content = readFileSync(HOOKS_JSON, "utf8");
    for (const retired of [
      "pretooluse-guard",
      "auto-test-runner",
      "session-cleanup",
      "session-summary",
      "plans-watcher",
      "posttooluse-quality-pack",
      "subagent-tracker",
    ]) {
      expect(content).not.toContain(retired);
    }
  });
});
