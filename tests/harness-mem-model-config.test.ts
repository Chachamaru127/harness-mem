import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("harness-mem model config", () => {
  function installFakeModel(home: string, modelId: string): void {
    const modelDir = join(home, "models", modelId);
    mkdirSync(join(modelDir, "onnx"), { recursive: true });
    writeFileSync(join(modelDir, "tokenizer.json"), "{}");
    writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");
  }

  test("model use persists local provider and model into config", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-model-config-"));
    installFakeModel(tmpHome, "multilingual-e5");

    try {
      const result = await runHarnessMem(["model", "use", "multilingual-e5"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: tmpHome,
      });

      expect(result.code).toBe(0);
      const config = JSON.parse(readFileSync(join(tmpHome, "config.json"), "utf8")) as Record<string, unknown>;
      expect(config.embedding_provider).toBe("local");
      expect(config.embedding_model).toBe("multilingual-e5");
      expect(result.stdout).toContain("Restart daemon to apply");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("model use-adaptive persists adaptive config and syncs LaunchAgent env when possible", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-model-adaptive-"));
    installFakeModel(tmpHome, "ruri-v3-30m");
    installFakeModel(tmpHome, "multilingual-e5");

    const launchAgentsDir = join(tmpHome, "Library", "LaunchAgents");
    mkdirSync(launchAgentsDir, { recursive: true });
    writeFileSync(join(launchAgentsDir, "com.harness-mem.daemon.plist"), "<plist><dict></dict></plist>");

    const fakeBin = join(tmpHome, "bin");
    const plutilLog = join(tmpHome, "plutil.log");
    mkdirSync(fakeBin, { recursive: true });
    const fakePlutil = join(fakeBin, "plutil");
    writeFileSync(fakePlutil, "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$PLUTIL_LOG\"\nexit 0\n");
    chmodSync(fakePlutil, 0o755);

    try {
      const result = await runHarnessMem(["model", "use-adaptive"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: tmpHome,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        PLUTIL_LOG: plutilLog,
      });

      expect(result.code).toBe(0);
      const config = JSON.parse(readFileSync(join(tmpHome, "config.json"), "utf8")) as Record<string, unknown>;
      expect(config.embedding_provider).toBe("adaptive");
      expect(config.embedding_model).toBe("adaptive");
      expect(result.stdout).toContain("embedding_provider=adaptive");
      expect(result.stdout).toContain("Restart daemon to apply");

      const plutilCalls = readFileSync(plutilLog, "utf8");
      expect(plutilCalls).toContain("EnvironmentVariables.HARNESS_MEM_EMBEDDING_PROVIDER -string adaptive");
      expect(plutilCalls).toContain("EnvironmentVariables.HARNESS_MEM_EMBEDDING_MODEL -string adaptive");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("model use-adaptive fails before writing config when a required model is missing", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-model-adaptive-missing-"));
    installFakeModel(tmpHome, "ruri-v3-30m");

    try {
      const result = await runHarnessMem(["model", "use-adaptive"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: tmpHome,
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Adaptive embedding requires installed models");
      expect(result.stderr).toContain("multilingual-e5");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
