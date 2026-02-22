/**
 * human-eval-contract.test.ts
 *
 * verify-human-eval.sh の契約:
 * - 5名以上
 * - evaluator ID 重複なし
 * - わかりやすい平均 >= 80
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VERIFY_HUMAN_EVAL_SCRIPT = resolve(import.meta.dir, "../scripts/verify-human-eval.sh");

async function runVerify(payload: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-human-eval-"));
  try {
    const inputPath = join(dir, "input.json");
    writeFileSync(inputPath, JSON.stringify(payload, null, 2), "utf8");
    const proc = Bun.spawn(["bash", VERIFY_HUMAN_EVAL_SCRIPT, inputPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { exitCode, stdout, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("verify-human-eval contract", () => {
  test("verify-human-eval.sh exists", () => {
    const stat = Bun.file(VERIFY_HUMAN_EVAL_SCRIPT);
    expect(stat.size).toBeGreaterThan(0);
  });

  test("jq prerequisite check exists", () => {
    const script = readFileSync(VERIFY_HUMAN_EVAL_SCRIPT, "utf8");
    expect(script).toContain("jq is required but not found");
    expect(script).toContain(".evaluations");
  });

  test("passes with >=5 evaluators, unique IDs, and understandability >=80", async () => {
    const payload = {
      evaluations: [
        { evaluator_id: "u1", understandability_pct: 82 },
        { evaluator_id: "u2", understandability_pct: 80 },
        { evaluator_id: "u3", understandability_pct: 90 },
        { evaluator_id: "u4", understandability_pct: 88 },
        { evaluator_id: "u5", understandability_pct: 84 },
      ],
    };
    const result = await runVerify(payload);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.pass).toBe(true);
    expect(parsed.gates.min_evaluators).toBe(true);
    expect(parsed.gates.unique_ids).toBe(true);
    expect(parsed.gates.understandability_ge_80).toBe(true);
  });

  test("fails when evaluator IDs are duplicated", async () => {
    const payload = {
      evaluations: [
        { evaluator_id: "u1", understandability_pct: 82 },
        { evaluator_id: "u1", understandability_pct: 84 },
        { evaluator_id: "u3", understandability_pct: 90 },
        { evaluator_id: "u4", understandability_pct: 88 },
        { evaluator_id: "u5", understandability_pct: 84 },
      ],
    };
    const result = await runVerify(payload);
    expect(result.exitCode).toBe(1);
  });

  test("fails when evaluator count is below 5", async () => {
    const payload = {
      evaluations: [
        { evaluator_id: "u1", understandability_pct: 82 },
        { evaluator_id: "u2", understandability_pct: 80 },
        { evaluator_id: "u3", understandability_pct: 90 },
        { evaluator_id: "u4", understandability_pct: 88 },
      ],
    };
    const result = await runVerify(payload);
    expect(result.exitCode).toBe(1);
  });

  test("fails when understandability average is below 80", async () => {
    const payload = {
      evaluations: [
        { evaluator_id: "u1", understandability_pct: 70 },
        { evaluator_id: "u2", understandability_pct: 75 },
        { evaluator_id: "u3", understandability_pct: 78 },
        { evaluator_id: "u4", understandability_pct: 79 },
        { evaluator_id: "u5", understandability_pct: 77 },
      ],
    };
    const result = await runVerify(payload);
    expect(result.exitCode).toBe(1);
  });
});
