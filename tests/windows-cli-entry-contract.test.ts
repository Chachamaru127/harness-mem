import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PACKAGE_JSON = resolve(ROOT, "package.json");
const RUN_SCRIPT = resolve(ROOT, "scripts/run-script.js");
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
  windowsUnsupportedMessage: (commandName: string) => string;
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

  test("Windows script paths are normalized to Git Bash POSIX paths", () => {
    expect(bashEntry.toPosixWindowsPath("C:\\Users\\shuta\\repo\\scripts\\harness-mem")).toBe(
      "/c/Users/shuta/repo/scripts/harness-mem"
    );
    expect(bashEntry.toPosixWindowsPath("D:\\worktree\\tmp\\data.db")).toBe("/d/worktree/tmp/data.db");
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

  test("Git Bash detection ignores non-MSYS bash and prefers Git for Windows candidates", () => {
    const seen: string[] = [];
    const bashPath = bashEntry.findWindowsBash({
      env: {
        ...process.env,
        PROGRAMFILES: "C:\\Program Files",
        "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      },
      spawnImpl: (command: string) => {
        seen.push(command);
        return {
          status: 0,
          stdout: Buffer.from("GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)\n"),
          stderr: Buffer.alloc(0),
        };
      },
      existsSyncImpl: (candidate: string) => candidate === "C:\\Program Files\\Git\\bin\\bash.exe",
    });

    expect(seen).toEqual([]);
    expect(bashPath).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });

  test("PATH bash is accepted when it looks like Git Bash / MSYS2", () => {
    const bashPath = bashEntry.findWindowsBash({
      env: {
        ...process.env,
        PROGRAMFILES: "",
        "PROGRAMFILES(X86)": "",
      },
      spawnImpl: () => ({
        status: 0,
        stdout: Buffer.from("GNU bash, version 5.2.15(1)-release (x86_64-pc-msys)\n"),
        stderr: Buffer.alloc(0),
      }),
      existsSyncImpl: () => false,
    });

    expect(bashPath).toBe("bash");
    expect(bashEntry.looksLikeWindowsGitBash("GNU bash, version 5.2.15(1)-release (x86_64-pc-msys)")).toBe(true);
    expect(bashEntry.looksLikeWindowsGitBash("GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)")).toBe(
      false
    );
  });

  test("missing Git Bash still returns an actionable Windows error message", () => {
    const stderr = bashEntry.windowsUnsupportedMessage("harness-mem");
    expect(stderr).toContain("Install Git for Windows");
    expect(stderr).toContain("Run harness-mem from Git Bash terminal");
    expect(stderr).toContain("Use WSL2");
  });

  test("Claude hook runner uses the shared Windows Bash detector and skips missing Bash non-blockingly", () => {
    const runner = readFileSync(RUN_SCRIPT, "utf8");

    expect(runner).toContain("findWindowsBash");
    expect(runner).toContain("windowsUnsupportedMessage");
    expect(runner).toContain("process.exit(0)");
  });
});
