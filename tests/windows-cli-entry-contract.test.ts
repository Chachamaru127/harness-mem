import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PACKAGE_JSON = resolve(ROOT, "package.json");
const HARNESS_MEM_WRAPPER = resolve(ROOT, "scripts/harness-mem.js");
const require = createRequire(import.meta.url);
const bashEntry = require(resolve(ROOT, "scripts/lib/bash-entry.js")) as {
  findWindowsBash: (options?: {
    env?: NodeJS.ProcessEnv;
    spawnImpl?: (command: string, args: string[], options: Record<string, unknown>) => {
      error?: unknown;
      status?: number | null;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    existsSyncImpl?: (path: string) => boolean;
  }) => string | null;
  looksLikeWindowsGitBash: (versionOutput: string) => boolean;
  normalizeWindowsCliArgs: (args: string[]) => string[];
  toPosixWindowsPath: (value: string) => string;
};

describe("windows CLI entry contract", () => {
  test("package bin entries point at node launchers instead of raw bash scripts", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
      bin: Record<string, string>;
    };

    expect(pkg.bin["harness-mem"]).toBe("scripts/harness-mem.js");
    expect(pkg.bin["harness-memd"]).toBe("scripts/harness-memd.js");
    expect(pkg.bin["harness-mem-client"]).toBe("scripts/harness-mem-client.js");
  });

  test("native Windows receives an actionable error instead of a /bin/bash shim failure", async () => {
    const proc = Bun.spawn(["node", HARNESS_MEM_WRAPPER, "setup"], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HARNESS_MEM_FORCE_PLATFORM: "win32",
      },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    expect(code).toBe(1);
    expect(stdout.trim()).toBe("");
    expect(stderr).toContain("requires bash, which was not found");
    expect(stderr).toContain("Install Git for Windows");
    expect(stderr).toContain("Use WSL2");
  });

  test("native Windows can still run mcp-config for MCP-only Claude/Codex wiring", async () => {
    const proc = Bun.spawn(["node", HARNESS_MEM_WRAPPER, "mcp-config", "--client", "codex"], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HARNESS_MEM_FORCE_PLATFORM: "win32",
      },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout).toContain("[mcp_servers.harness]");
    expect(stdout).toContain('args = ["mcp-server\\\\dist\\\\index.js"]');
  });

  test("Windows script paths are normalized to Git Bash POSIX paths", () => {
    expect(
      bashEntry.toPosixWindowsPath("C:\\Users\\shuta\\repo\\scripts\\harness-mem")
    ).toBe("/c/Users/shuta/repo/scripts/harness-mem");
    expect(bashEntry.toPosixWindowsPath("D:\\worktree\\tmp\\data.db")).toBe(
      "/d/worktree/tmp/data.db"
    );
  });

  test("Windows CLI path flags are normalized before invoking Git Bash", () => {
    expect(
      bashEntry.normalizeWindowsCliArgs([
        "setup",
        "--platform",
        "codex",
        "--project",
        "C:\\Users\\shuta\\OneDrive\\Desktop\\Code\\harness-mem",
        "--source=C:\\tmp\\claude-mem.db",
        "--dest-dir",
        "D:\\backups\\harness-mem",
      ])
    ).toEqual([
      "setup",
      "--platform",
      "codex",
      "--project",
      "/c/Users/shuta/OneDrive/Desktop/Code/harness-mem",
      "--source=/c/tmp/claude-mem.db",
      "--dest-dir",
      "/d/backups/harness-mem",
    ]);
  });

  test("Git Bash detection prefers default install paths and accepts PATH bash only for MSYS-like runtimes", () => {
    const detectedDefault = bashEntry.findWindowsBash({
      env: {
        ...process.env,
        PROGRAMFILES: "C:\\Program Files",
        "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      },
      spawnImpl: () => ({
        status: 0,
        stdout: Buffer.from(
          "GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)\n"
        ),
        stderr: Buffer.alloc(0),
      }),
      existsSyncImpl: (candidate: string) =>
        candidate === "C:\\Program Files\\Git\\bin\\bash.exe",
    });
    expect(detectedDefault).toBe("C:\\Program Files\\Git\\bin\\bash.exe");

    const detectedPathBash = bashEntry.findWindowsBash({
      env: {
        ...process.env,
        PROGRAMFILES: "",
        "PROGRAMFILES(X86)": "",
      },
      spawnImpl: () => ({
        status: 0,
        stdout: Buffer.from(
          "GNU bash, version 5.2.15(1)-release (x86_64-pc-msys)\n"
        ),
        stderr: Buffer.alloc(0),
      }),
      existsSyncImpl: () => false,
    });
    expect(detectedPathBash).toBe("bash");
    expect(
      bashEntry.looksLikeWindowsGitBash(
        "GNU bash, version 5.2.15(1)-release (x86_64-pc-msys)"
      )
    ).toBe(true);
    expect(
      bashEntry.looksLikeWindowsGitBash(
        "GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)"
      )
    ).toBe(false);
  });
});
