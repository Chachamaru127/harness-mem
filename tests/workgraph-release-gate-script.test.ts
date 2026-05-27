import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "../scripts/check-workgraph-release-gate.sh");

async function runGate(manifestPath: string, mode = "warn") {
  const proc = Bun.spawn(["bash", SCRIPT], {
    env: {
      ...process.env,
      MANIFEST_PATH: manifestPath,
      HARNESS_MEM_WORKGRAPH_GATE: mode,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? 0, stdout, stderr };
}

function writeManifest(path: string, passed: boolean): void {
  writeFileSync(
    path,
    JSON.stringify(
      {
        workgraph_release_gate: {
          mode: "warn",
          tier: passed ? "green" : "red",
          passed,
          failed_metrics: passed ? [] : ["ready_precision"],
          metrics: {
            plans_import_fidelity: 1,
            ready_precision: passed ? 1 : 0,
            blocker_recall: 1,
            next_action_accuracy: 1,
            duplicate_work_rate: 0,
            claim_lease_success_rate: 1,
            work_hint_consumed_rate: 0.6,
          },
        },
      },
      null,
      2
    )
  );
}

describe("check-workgraph-release-gate.sh (§S125-016)", () => {
  test("passes a green manifest", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hmem-workgraph-gate-pass-"));
    try {
      mkdirSync(tmp, { recursive: true });
      const manifest = join(tmp, "manifest.json");
      writeManifest(manifest, true);

      const result = await runGate(manifest);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("WorkGraph release gate: PASSED");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("warn mode does not block a failing manifest", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hmem-workgraph-gate-warn-"));
    try {
      const manifest = join(tmp, "manifest.json");
      writeManifest(manifest, false);

      const result = await runGate(manifest, "warn");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("::warning::WorkGraph release gate");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("enforce mode blocks a failing manifest", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hmem-workgraph-gate-enforce-"));
    try {
      const manifest = join(tmp, "manifest.json");
      writeManifest(manifest, false);

      const result = await runGate(manifest, "enforce");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("::error::WorkGraph release gate");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
