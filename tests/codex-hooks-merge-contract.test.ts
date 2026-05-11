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
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const code = await proc.exited;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
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

function writeStaleCodexConfig(tmpHome: string): void {
  const codexDir = join(tmpHome, ".codex");
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(
    join(codexDir, "config.toml"),
    `
notify = ["bash", "/tmp/missing-harness/scripts/hook-handlers/memory-codex-notify.sh"]

[mcp_servers.harness]
command = "/tmp/missing-harness/bin/harness-mcp-server"
args = []
cwd = "/tmp/missing-harness"
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

// Per-test timeout raised to 60s globally: all tests in this suite spawn the
// harness-mem CLI subprocess. On GitHub Actions ubuntu-latest the cold boot
// routinely exceeds bun's 5s default (observed 5001ms timeout during v0.13.0
// release attempt), and full-suite local release gates can slow doctor
// subprocesses enough to exceed 30s under load.
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
        expect(readFileSync(join(tmpHome, ".codex", "skills", "harness-mem", "SKILL.md"), "utf8")).toContain("harness-mem");
        expect(readFileSync(join(tmpHome, ".codex", "skills", "harness-recall", "SKILL.md"), "utf8")).toContain("harness-recall");
      } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("non-tty setup repairs existing Codex skill drift without explicit non-interactive env", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-codex-skill-drift-"));

    try {
      writeCodexConfig(tmpHome);
      mkdirSync(join(tmpHome, ".codex", "skills", "harness-mem"), { recursive: true });
      mkdirSync(join(tmpHome, ".codex", "skills", "harness-recall"), { recursive: true });
      writeFileSync(join(tmpHome, ".codex", "skills", "harness-mem", "SKILL.md"), "stale harness-mem skill\n");
      writeFileSync(join(tmpHome, ".codex", "skills", "harness-recall", "SKILL.md"), "stale harness-recall skill\n");

      const result = await runHarnessMem(
        ["setup", "--platform", "codex", "--skip-start", "--skip-smoke", "--skip-quality", "--skip-version-check"],
        {
          ...process.env,
          HOME: tmpHome,
          HARNESS_MEM_HOME: join(tmpHome, ".harness-mem"),
        }
      );

      expect(result.code).toBe(0);
      expect(readFileSync(join(tmpHome, ".codex", "skills", "harness-mem", "SKILL.md"), "utf8")).toBe(
        readFileSync(join(ROOT, "codex", "skills", "harness-mem", "SKILL.md"), "utf8")
      );
      expect(readFileSync(join(tmpHome, ".codex", "skills", "harness-recall", "SKILL.md"), "utf8")).toBe(
        readFileSync(join(ROOT, "codex", "skills", "harness-recall", "SKILL.md"), "utf8")
      );
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

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

      const result = await runHarnessMem(["doctor", "--json", "--platform", "codex", "--skip-version-check", "--read-only"], {
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
  }, 60_000);

  test("setup rewrites stale managed Codex config paths to the current checkout", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-codex-stale-config-"));

    try {
      writeStaleCodexConfig(tmpHome);

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

      const configText = readFileSync(join(tmpHome, ".codex", "config.toml"), "utf8");
      expect(configText).toContain(`notify = ["bash", "${ROOT}/scripts/hook-handlers/memory-codex-notify.sh"]`);
      expect(configText).toContain(`command = "${ROOT}/bin/harness-mcp-server"`);
      expect(configText).toContain(`cwd = "${ROOT}"`);
      expect(configText).not.toContain("/tmp/missing-harness");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

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

      const result = await runHarnessMem(["doctor", "--json", "--platform", "codex", "--skip-version-check", "--read-only"], {
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
  }, 60_000);

  test("doctor --json marks codex_wiring missing when config.toml points to a stale harness root", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-codex-stale-root-"));

    try {
      // 5a: Use mkdtempSync + rmSync for a guaranteed-nonexistent stale path
      const staleRoot = mkdtempSync(join(tmpdir(), "hmem-stale-root-"));
      rmSync(staleRoot, { recursive: true, force: true });

      mkdirSync(join(tmpHome, ".codex"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".codex", "config.toml"),
        `
notify = "bash ${staleRoot}/scripts/hook-handlers/memory-codex-notify.sh"

[mcp_servers.harness]
command = "node"
args = ["mcp-server/dist/index.js"]
cwd = "${staleRoot}"
enabled = true

[mcp_servers.harness.env]
HARNESS_MEM_HOST = "127.0.0.1"
HARNESS_MEM_PORT = "37888"
HARNESS_MEM_DB_PATH = "${join(tmpHome, ".harness-mem", "harness-mem.db")}"

[features]
codex_hooks = true
`.trimStart()
      );
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

      const result = await runHarnessMem(["doctor", "--json", "--platform", "codex", "--skip-version-check", "--read-only"], {
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
  }, 60_000);

  // 5b: Section-scoped extraction — other MCP server before harness should not affect checks
  test("doctor checks only [mcp_servers.harness] section, ignoring other MCP servers", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-codex-multi-mcp-"));
    const staleRoot = mkdtempSync(join(tmpdir(), "hmem-stale-root-"));
    rmSync(staleRoot, { recursive: true, force: true });

    try {
      mkdirSync(join(tmpHome, ".codex"), { recursive: true });
      mkdirSync(join(tmpHome, ".harness-mem"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".codex", "config.toml"),
        `
notify = "bash ${ROOT}/scripts/hook-handlers/memory-codex-notify.sh"

[mcp_servers.other]
command = "node"
args = ["other-server/dist/index.js"]
cwd = "${ROOT}"
enabled = true

[mcp_servers.other.env]
HARNESS_MEM_HOST = "127.0.0.1"
HARNESS_MEM_PORT = "37888"
HARNESS_MEM_DB_PATH = "${join(tmpHome, ".harness-mem", "harness-mem.db")}"

[mcp_servers.harness]
command = "node"
args = ["mcp-server/dist/index.js"]
cwd = "${staleRoot}"
enabled = true

[mcp_servers.harness.env]
HARNESS_MEM_HOST = "127.0.0.1"
HARNESS_MEM_PORT = "37888"
HARNESS_MEM_DB_PATH = "${join(staleRoot, ".harness-mem", "harness-mem.db")}"

[features]
codex_hooks = true
`.trimStart()
      );
      writeFileSync(
        join(tmpHome, ".codex", "hooks.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: `bash ${ROOT}/scripts/hook-handlers/codex-session-start.sh` }] }],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: `bash ${ROOT}/scripts/hook-handlers/codex-user-prompt.sh` }] }],
            Stop: [{ hooks: [{ type: "command", command: `bash ${ROOT}/scripts/hook-handlers/codex-session-stop.sh` }] }],
          },
        }, null, 2)
      );

      const result = await runHarnessMem(["doctor", "--json", "--platform", "codex", "--skip-version-check", "--read-only"], {
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

      // harness section has stale cwd/db_path, so should be missing
      // even though [mcp_servers.other] has valid paths
      expect(parsed.all_green).toBe(false);
      expect(codexCheck?.status).toBe("missing");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  // 5d: Missing [mcp_servers.harness] section entirely
  test("doctor --json marks codex_wiring missing when [mcp_servers.harness] section is absent", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-codex-no-section-"));

    try {
      mkdirSync(join(tmpHome, ".codex"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".codex", "config.toml"),
        `
notify = "bash ${ROOT}/scripts/hook-handlers/memory-codex-notify.sh"

[features]
codex_hooks = true
`.trimStart()
      );
      writeFileSync(
        join(tmpHome, ".codex", "hooks.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: `bash ${ROOT}/scripts/hook-handlers/codex-session-start.sh` }] }],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: `bash ${ROOT}/scripts/hook-handlers/codex-user-prompt.sh` }] }],
            Stop: [{ hooks: [{ type: "command", command: `bash ${ROOT}/scripts/hook-handlers/codex-session-stop.sh` }] }],
          },
        }, null, 2)
      );

      const result = await runHarnessMem(["doctor", "--json", "--platform", "codex", "--skip-version-check", "--read-only"], {
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
  }, 60_000);

  // 5e: [mcp_servers.harness] present but no args key
  test("doctor --json marks codex_wiring missing when harness section has no args key", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-codex-no-args-"));

    try {
      mkdirSync(join(tmpHome, ".codex"), { recursive: true });
      mkdirSync(join(tmpHome, ".harness-mem"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".codex", "config.toml"),
        `
notify = "bash ${ROOT}/scripts/hook-handlers/memory-codex-notify.sh"

[mcp_servers.harness]
command = "node"
enabled = true

[mcp_servers.harness.env]
HARNESS_MEM_HOST = "127.0.0.1"
HARNESS_MEM_PORT = "37888"
HARNESS_MEM_DB_PATH = "${join(tmpHome, ".harness-mem", "harness-mem.db")}"

[features]
codex_hooks = true
`.trimStart()
      );
      writeFileSync(
        join(tmpHome, ".codex", "hooks.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: `bash ${ROOT}/scripts/hook-handlers/codex-session-start.sh` }] }],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: `bash ${ROOT}/scripts/hook-handlers/codex-user-prompt.sh` }] }],
            Stop: [{ hooks: [{ type: "command", command: `bash ${ROOT}/scripts/hook-handlers/codex-session-stop.sh` }] }],
          },
        }, null, 2)
      );

      const result = await runHarnessMem(["doctor", "--json", "--platform", "codex", "--skip-version-check", "--read-only"], {
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
  }, 60_000);

  test("doctor --json marks codex_requirements_precedence drift when requirements.toml keeps stale harness paths", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-codex-requirements-drift-"));

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
      writeFileSync(
        join(tmpHome, ".codex", "requirements.toml"),
        `
[managed.harness]
notify = "/tmp/old-harness/scripts/hook-handlers/memory-codex-notify.sh"
entry = "/tmp/old-harness/bin/harness-mcp-server"
HARNESS_MEM_HOST = "127.0.0.1"
HARNESS_MEM_PORT = "39999"
`.trimStart()
      );

      const result = await runHarnessMem(["doctor", "--json", "--platform", "codex", "--skip-version-check", "--read-only"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: join(tmpHome, ".harness-mem"),
        HARNESS_MEM_NON_INTERACTIVE: "1",
      });

      const parsed = JSON.parse(result.stdout) as {
        checks: Array<{ name: string; status: string }>;
      };
      const precedenceCheck = parsed.checks.find((check) => check.name === "codex_requirements_precedence");

      expect(precedenceCheck).toBeDefined();
      expect(precedenceCheck?.status).toBe("drift");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);
});
