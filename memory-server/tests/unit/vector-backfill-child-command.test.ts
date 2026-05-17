import { describe, expect, test } from "bun:test";
import { buildVectorBackfillChildCommand } from "../../src/core/harness-mem-core";

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
