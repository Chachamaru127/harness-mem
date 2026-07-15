import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = resolve(ROOT, "scripts/harness-memd");

describe("harness-memd embedding env propagation", () => {
  test("auto incumbent config does not become an embedding model env pin", () => {
    const script = readFileSync(SCRIPT, "utf8");

    expect(script).toContain('should_export_embedding_model_env "$embedding_provider" "$embedding_model"');
    expect(script).toContain('[ "$provider" = "auto" ] && [ "$model" = "multilingual-e5" ]');
    expect(script).toContain('daemon_env+=(HARNESS_MEM_EMBEDDING_MODEL="$embedding_model")');
    expect(script).not.toContain('HARNESS_MEM_EMBEDDING_MODEL="$embedding_model" \\');
  });
});
