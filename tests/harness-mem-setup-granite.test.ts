import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = resolve(ROOT, "scripts/harness-mem");
const GRANITE_MODEL = "granite-embedding-311m-r2";

async function runHarnessMem(
  args: string[],
  env: NodeJS.ProcessEnv,
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

function makeFakePlutil(home: string): { fakeBin: string; plutilLog: string } {
  const launchAgentsDir = join(home, "Library", "LaunchAgents");
  mkdirSync(launchAgentsDir, { recursive: true });
  writeFileSync(join(launchAgentsDir, "com.harness-mem.daemon.plist"), "<plist><dict></dict></plist>");

  const fakeBin = join(home, "bin");
  const plutilLog = join(home, "plutil.log");
  mkdirSync(fakeBin, { recursive: true });
  const fakePlutil = join(fakeBin, "plutil");
  writeFileSync(fakePlutil, "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$PLUTIL_LOG\"\nexit 0\n");
  chmodSync(fakePlutil, 0o755);
  return { fakeBin, plutilLog };
}

function modelPath(home: string): string {
  return join(home, "models", GRANITE_MODEL, "onnx", "model.onnx");
}

describe("harness-mem setup granite model pull", () => {
  test("setup pulls the Granite default model through the mock path and syncs LaunchAgent env", async () => {
    const home = mkdtempSync(join(tmpdir(), "hmem-setup-granite-"));
    const { fakeBin, plutilLog } = makeFakePlutil(home);
    try {
      const result = await runHarnessMem(
        ["setup", "--platform", "codex", "--skip-start", "--skip-smoke", "--skip-quality", "--skip-version-check"],
        {
          ...process.env,
          HOME: home,
          HARNESS_MEM_HOME: home,
          HARNESS_MEM_SETUP_MODEL_PULL_MOCK: "success",
          HARNESS_MEM_NON_INTERACTIVE: "1",
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          PLUTIL_LOG: plutilLog,
        },
      );

      expect(result.code).toBe(0);
      expect(existsSync(modelPath(home))).toBe(true);
      expect(result.stdout).toContain("Granite default model ready");

      const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as Record<string, unknown>;
      expect(config.embedding_provider).toBe("auto");
      const plutilCalls = readFileSync(plutilLog, "utf8");
      expect(plutilCalls).toContain("EnvironmentVariables.HARNESS_MEM_EMBEDDING_PROVIDER -string auto");
      expect(plutilCalls).toContain("EnvironmentVariables.HARNESS_MEM_EMBEDDING_MODEL -string multilingual-e5");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("--skip-model-pull leaves the model cache untouched", async () => {
    const home = mkdtempSync(join(tmpdir(), "hmem-setup-granite-skip-"));
    try {
      const result = await runHarnessMem(
        [
          "setup",
          "--platform",
          "codex",
          "--skip-start",
          "--skip-smoke",
          "--skip-quality",
          "--skip-version-check",
          "--skip-model-pull",
        ],
        {
          ...process.env,
          HOME: home,
          HARNESS_MEM_HOME: home,
          HARNESS_MEM_SETUP_MODEL_PULL_MOCK: "fail-if-called",
          HARNESS_MEM_NON_INTERACTIVE: "1",
        },
      );

      expect(result.code).toBe(0);
      expect(existsSync(modelPath(home))).toBe(false);
      expect(result.stderr).toContain("Skipping Granite model pull");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("offline detection skips model pull with a warning instead of failing setup", async () => {
    const home = mkdtempSync(join(tmpdir(), "hmem-setup-granite-offline-"));
    try {
      const result = await runHarnessMem(
        ["setup", "--platform", "codex", "--skip-start", "--skip-smoke", "--skip-quality", "--skip-version-check"],
        {
          ...process.env,
          HOME: home,
          HARNESS_MEM_HOME: home,
          HARNESS_MEM_SETUP_MODEL_PULL_MOCK: "offline",
          HARNESS_MEM_NON_INTERACTIVE: "1",
        },
      );

      expect(result.code).toBe(0);
      expect(existsSync(modelPath(home))).toBe(false);
      expect(result.stderr).toContain("offline");
      expect(result.stderr).toContain(`harness-mem model pull ${GRANITE_MODEL}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
