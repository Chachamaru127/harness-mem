import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

describe("claude precedence contract", () => {
  test("doctor --json marks claude_precedence drift when ~/.claude.json and settings.json disagree", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-claude-precedence-"));

    try {
      mkdirSync(join(tmpHome, ".claude"), { recursive: true });
      writeFileSync(
        join(tmpHome, ".claude.json"),
        JSON.stringify(
          {
            mcpServers: {
              harness: {
                command: `${ROOT}/bin/harness-mcp-server`,
                enabled: true,
                env: {
                  HARNESS_MEM_HOST: "127.0.0.1",
                  HARNESS_MEM_PORT: "37888",
                  HARNESS_MEM_DB_PATH: join(tmpHome, ".harness-mem", "harness-mem.db"),
                },
              },
            },
          },
          null,
          2
        )
      );
      writeFileSync(
        join(tmpHome, ".claude", "settings.json"),
        JSON.stringify(
          {
            mcpServers: {
              harness: {
                command: `${tmpHome}/stale-root/bin/harness-mcp-server`,
                enabled: true,
                env: {
                  HARNESS_MEM_HOST: "127.0.0.1",
                  HARNESS_MEM_PORT: "39999",
                  HARNESS_MEM_DB_PATH: join(tmpHome, "stale-root", ".harness-mem", "harness-mem.db"),
                },
              },
            },
          },
          null,
          2
        )
      );

      const result = await runHarnessMem(["doctor", "--json", "--platform", "claude", "--skip-version-check"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: join(tmpHome, ".harness-mem"),
        HARNESS_MEM_NON_INTERACTIVE: "1",
      });

      const parsed = JSON.parse(result.stdout) as {
        checks: Array<{ name: string; status: string }>;
      };
      const precedenceCheck = parsed.checks.find((check) => check.name === "claude_precedence");

      expect(precedenceCheck).toBeDefined();
      expect(precedenceCheck?.status).toBe("drift");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
