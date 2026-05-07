import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { rel, relativizeArtifactValue } from "../../scripts/s108-baseline-snapshot";

describe("S108 baseline snapshot artifact paths", () => {
  test("relativizes repo-local absolute paths while preserving external paths", () => {
    const root = resolve(import.meta.dir, "../..");
    const resultPath = join(root, "docs/benchmarks/artifacts/s108-baseline/result.json");
    const fixturePath = join(root, "tests/benchmarks/fixtures/japanese-release-pack-96.json");
    const externalPath = "/tmp/harness-mem/outside.json";

    const artifact = relativizeArtifactValue({
      result_path: resultPath,
      nested: {
        dataset_path: fixturePath,
        paths: [resultPath, externalPath],
      },
      external_path: externalPath,
    });

    expect(artifact.result_path).toBe("docs/benchmarks/artifacts/s108-baseline/result.json");
    expect(artifact.nested.dataset_path).toBe("tests/benchmarks/fixtures/japanese-release-pack-96.json");
    expect(artifact.nested.paths).toEqual([
      "docs/benchmarks/artifacts/s108-baseline/result.json",
      externalPath,
    ]);
    expect(artifact.external_path).toBe(externalPath);
  });

  test("returns dot for the repository root", () => {
    const root = resolve(import.meta.dir, "../..");

    expect(rel(root)).toBe(".");
  });
});
