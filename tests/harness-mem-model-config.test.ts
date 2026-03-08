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

describe("harness-mem model config", () => {
  test("model use persists local provider and model into config", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-model-config-"));
    const modelDir = join(tmpHome, "models", "multilingual-e5");
    mkdirSync(join(modelDir, "onnx"), { recursive: true });
    writeFileSync(join(modelDir, "tokenizer.json"), "{}");
    writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");

    try {
      const result = await runHarnessMem(["model", "use", "multilingual-e5"], {
        ...process.env,
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
});
