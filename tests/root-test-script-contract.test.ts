import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const MEMORY_SERVER_PACKAGE_JSON_PATH = join(ROOT, "memory-server", "package.json");
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

  test("memory-server test script uses the safe wrapper and batched runner", () => {
    const pkg = JSON.parse(readFileSync(MEMORY_SERVER_PACKAGE_JSON_PATH, "utf8")) as {
      scripts?: { test?: string; "test:unit"?: string; "test:integration"?: string; "test:benchmark"?: string };
    };
    const testScript = pkg.scripts?.test ?? "";

    expect(testScript).toContain("bash ../scripts/run-bun-test-safe.sh tests/*.test.ts");
    expect(testScript).toContain(
      "bash ../scripts/run-bun-test-batches.sh tests/unit tests/core-split tests/integration tests/benchmark tests/performance"
    );
    expect(pkg.scripts?.["test:unit"]).toBe("bash ../scripts/run-bun-test-safe.sh tests/unit");
    expect(pkg.scripts?.["test:integration"]).toBe("bash ../scripts/run-bun-test-safe.sh tests/integration");
    expect(pkg.scripts?.["test:benchmark"]).toBe("bash ../scripts/run-bun-test-safe.sh tests/benchmark");
    expect(testScript).not.toContain("bun test tests/unit");
  });

  test("testing guide explains the chunked root test path and its reason", () => {
    const doc = readFileSync(TESTING_DOC_PATH, "utf8");

    expect(doc).toContain("npm test");
    expect(doc).toContain("cd memory-server && bun run test");
    expect(doc).toContain("Bun 本体が終了時に panic");
    expect(doc).toContain("scripts/run-bun-test-safe.sh");
    expect(doc).toContain("tests/unit");
    expect(doc).toContain("tests/core-split");
    expect(doc).toContain("tests/integration");
    expect(doc).toContain("tests/benchmark");
    expect(doc).toContain("tests/performance");
    expect(doc).toContain("bash scripts/run-bun-test-batches.sh tests sdk/tests mcp-server/tests");
    expect(doc).toContain("1ファイルずつ");
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
