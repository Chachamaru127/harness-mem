/**
 * S154-503: incumbent-path parity pin.
 *
 * The snapshot fixture was produced by the pre-refactor local-onnx
 * implementation (mean pooling + fitDimension) on multilingual-e5. The
 * refactored per-model pooling path must reproduce it (cosine drift < 1e-6)
 * — the production embedding path may not move as a side effect of adding
 * last_token/cls pooling or the dimension guard.
 *
 * The check runs in a SPAWNED bun process (scripts/s154-e5-parity-check.ts):
 * loading onnxruntime inside the bun test runner crashes the runner
 * (observed Bun 1.3.10). Skipped when multilingual-e5 is not installed.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ModelManager } from "../../src/embedding/model-manager";

const ROOT = join(import.meta.dir, "../../..");
const e5Installed = new ModelManager().getStatus("multilingual-e5").installed;

describe.skipIf(!e5Installed)("S154-503: e5 parity against the pre-refactor snapshot", () => {
  test("spawned parity check exits 0 (cosine drift < 1e-6)", async () => {
    const proc = Bun.spawn([process.execPath, "run", join(ROOT, "scripts/s154-e5-parity-check.ts")], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    expect(`${stdout}\n${stderr}`).toContain("s154-503-e5-parity");
    expect(exitCode).toBe(0);
  }, 180_000);
});
