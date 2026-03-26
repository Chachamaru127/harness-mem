import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = resolve(ROOT, "scripts/harness-mem");

async function runHarnessMem(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout, stderr };
}

function writeCodexConfig(tmpHome: string): void {
  const codexDir = join(tmpHome, ".codex");
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(
    join(codexDir, "config.toml"),
    `
notify = "bash ${ROOT}/scripts/hook-handlers/memory-codex-notify.sh"

[mcp_servers.harness]
command = "node"
args = ["${ROOT}/mcp-server/dist/index.js"]
enabled = true

[mcp_servers.harness.env]
HARNESS_MEM_HOST = "127.0.0.1"
HARNESS_MEM_PORT = "37888"
HARNESS_MEM_DB_PATH = "${join(tmpHome, ".harness-mem", "harness-mem.db")}"
`.trimStart()
  );
}

function readCommands(data: Record<string, unknown>, event: string): string[] {
  const hooks = ((data.hooks as Record<string, unknown>)[event] as Array<Record<string, unknown>>) ?? [];
  return hooks.flatMap((entry) =>
    (((entry.hooks as Array<Record<string, unknown>>) ?? []).map((hook) => String(hook.command ?? "")))
  );
}

describe("codex hooks merge contract", () => {
  test("setup merges required harness hooks into an existing ~/.codex/hooks.json", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-codex-hooks-merge-"));

    try {
      writeCodexConfig(tmpHome);
      writeFileSync(
        join(tmpHome, ".codex", "hooks.json"),
        JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "/Users/tachibanashuuta/.superset/hooks/notify.sh",
                    },
                  ],
                },
              ],
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "/Users/tachibanashuuta/.superset/hooks/notify.sh",
                    },
                  ],
                },
              ],
            },
          },
          null,
          2
        )
      );

      const result = await runHarnessMem(
        ["setup", "--platform", "codex", "--skip-start", "--skip-smoke", "--skip-quality", "--skip-version-check"],
        {
          ...process.env,
          HOME: tmpHome,
          HARNESS_MEM_HOME: join(tmpHome, ".harness-mem"),
          HARNESS_MEM_NON_INTERACTIVE: "1",
        }
      );

      expect(result.code).toBe(0);

      const hooks = JSON.parse(readFileSync(join(tmpHome, ".codex", "hooks.json"), "utf8")) as Record<
        string,
        unknown
      >;
      const configText = readFileSync(join(tmpHome, ".codex", "config.toml"), "utf8");
      const sessionStartCommands = readCommands(hooks, "SessionStart");
      const promptCommands = readCommands(hooks, "UserPromptSubmit");
      const stopCommands = readCommands(hooks, "Stop");

      expect(sessionStartCommands).toContain("/Users/tachibanashuuta/.superset/hooks/notify.sh");
      expect(sessionStartCommands).toContain(`bash ${ROOT}/scripts/hook-handlers/codex-session-start.sh`);
      expect(promptCommands).toContain(`bash ${ROOT}/scripts/hook-handlers/codex-user-prompt.sh`);
      expect(stopCommands).toContain("/Users/tachibanashuuta/.superset/hooks/notify.sh");
      expect(stopCommands).toContain(`bash ${ROOT}/scripts/hook-handlers/codex-session-stop.sh`);
      expect(configText).toContain("[features]");
      expect(configText).toContain("codex_hooks = true");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("doctor --json marks codex_wiring missing when harness hooks are absent", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-codex-doctor-"));

    try {
      writeCodexConfig(tmpHome);
      writeFileSync(
        join(tmpHome, ".codex", "hooks.json"),
        JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "/Users/tachibanashuuta/.superset/hooks/notify.sh",
                    },
                  ],
                },
              ],
            },
          },
          null,
          2
        )
      );

      const result = await runHarnessMem(["doctor", "--json", "--platform", "codex", "--skip-version-check"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: join(tmpHome, ".harness-mem"),
        HARNESS_MEM_NON_INTERACTIVE: "1",
      });

      const parsed = JSON.parse(result.stdout) as {
        all_green: boolean;
        checks: Array<{ name: string; status: string }>;
      };
      const codexCheck = parsed.checks.find((check) => check.name === "codex_wiring");

      expect(parsed.all_green).toBe(false);
      expect(codexCheck).toBeDefined();
      expect(codexCheck?.status).toBe("missing");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("doctor --json marks codex_wiring missing when codex hooks feature is disabled", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-codex-feature-doctor-"));

    try {
      writeCodexConfig(tmpHome);
      writeFileSync(
        join(tmpHome, ".codex", "hooks.json"),
        JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: `bash ${ROOT}/scripts/hook-handlers/codex-session-start.sh`,
                    },
                  ],
                },
              ],
              UserPromptSubmit: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: `bash ${ROOT}/scripts/hook-handlers/codex-user-prompt.sh`,
                    },
                  ],
                },
              ],
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: `bash ${ROOT}/scripts/hook-handlers/codex-session-stop.sh`,
                    },
                  ],
                },
              ],
            },
          },
          null,
          2
        )
      );

      const result = await runHarnessMem(["doctor", "--json", "--platform", "codex", "--skip-version-check"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: join(tmpHome, ".harness-mem"),
        HARNESS_MEM_NON_INTERACTIVE: "1",
      });

      const parsed = JSON.parse(result.stdout) as {
        all_green: boolean;
        checks: Array<{ name: string; status: string }>;
      };
      const codexCheck = parsed.checks.find((check) => check.name === "codex_wiring");

      expect(parsed.all_green).toBe(false);
      expect(codexCheck?.status).toBe("missing");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
