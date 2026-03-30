import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const TESTING_DOC_PATH = join(ROOT, "docs", "TESTING.md");
const BATCH_RUNNER_PATH = join(ROOT, "scripts", "run-bun-test-batches.sh");
const SAFE_RUNNER_PATH = join(ROOT, "scripts", "run-bun-test-safe.sh");

describe("root test script contract", () => {
  test("package.json test script delegates memory-server to the chunked runner", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      scripts?: { test?: string };
    };
    const testScript = pkg.scripts?.test ?? "";

    expect(testScript).toContain("(cd memory-server && bun run test)");
    expect(testScript).toContain("bash scripts/run-bun-test-batches.sh tests sdk/tests mcp-server/tests");
    expect(testScript).not.toContain("bun test memory-server/tests/");
    expect(testScript).not.toContain("bun test ./tests/ sdk/tests/ mcp-server/tests/");
  });

  test("testing guide explains the chunked root test path and its reason", () => {
    const doc = readFileSync(TESTING_DOC_PATH, "utf8");

    expect(doc).toContain("npm test");
    expect(doc).toContain("cd memory-server && bun run test");
    expect(doc).toContain("Bun 本体が終了時に panic");
    expect(doc).toContain("bash scripts/run-bun-test-batches.sh tests sdk/tests mcp-server/tests");
    expect(doc).toContain("1ファイルずつ");
    expect(doc).toContain("scripts/run-bun-test-safe.sh");
  });

  test("batch runner delegates each batch to the safe bun wrapper", () => {
    const batchRunner = readFileSync(BATCH_RUNNER_PATH, "utf8");
    const safeRunner = readFileSync(SAFE_RUNNER_PATH, "utf8");

    expect(batchRunner).toContain('SAFE_RUNNER="${BASH_DIR}/run-bun-test-safe.sh"');
    expect(batchRunner).toContain('"$SAFE_RUNNER" "${batch[@]}"');
    expect(safeRunner).toContain('panic(main thread): A C++ exception occurred');
    expect(safeRunner).toContain('0 fail');
  });
});
