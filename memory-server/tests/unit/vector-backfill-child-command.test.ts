import { parseVectorBackfillChildResponse } from "../../src/core/harness-mem-core";
import { describe, expect, test } from "bun:test";
import { buildVectorBackfillChildCommand, shouldContinuouslyRepairVectors } from "../../src/core/harness-mem-core";

describe("vector backfill child command", () => {
  test("uses nice on Unix-like hosts", () => {
    const command = buildVectorBackfillChildCommand("/tmp/vector-backfill-tick.ts", {
      type: "reindex",
      limit: 5,
    }, "darwin");

    expect(command.slice(0, 3)).toEqual(["nice", "-n", "10"]);
    expect(command).toContain(process.execPath);
    expect(command).toContain("run");
  });

  test("does not require Unix nice on Windows", () => {
    const command = buildVectorBackfillChildCommand("C:\\tmp\\vector-backfill-tick.ts", {
      type: "compact",
      model: "local-hash-v3",
      dimension: 384,
      limit: 5,
    }, "win32");

    expect(command[0]).toBe(process.execPath);
    expect(command).not.toContain("nice");
    expect(command).toContain("C:\\tmp\\vector-backfill-tick.ts");
  });
});


test("automatic repair keeps remote providers opt-in and respects the repair disable flag", () => {
  for (const local of ["adaptive", "local", "fallback"]) expect(shouldContinuouslyRepairVectors(local, false, {})).toBe(true);
  for (const remote of ["openai", "ollama", "pro-api"]) {
    expect(shouldContinuouslyRepairVectors(remote, false, {})).toBe(false);
    expect(shouldContinuouslyRepairVectors(remote, true, {})).toBe(true);
  }
  expect(shouldContinuouslyRepairVectors("local", true, { HARNESS_MEM_VECTOR_REPAIR_ENABLED: "0" })).toBe(false);
});


test("vector child parse errors never expose captured output", () => {
  expect(() => parseVectorBackfillChildResponse("{private capture", "private stderr"))
    .toThrow("vector backfill child returned invalid JSON");
  try { parseVectorBackfillChildResponse("{private capture", "private stderr"); }
  catch (error) { expect(String(error)).not.toContain("private"); }
});
