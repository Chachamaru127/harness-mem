import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Fixture {
  model: string;
  prompt: string;
  threshold: number;
  captured: string;
  rows: Array<{ id: string; gold: "keep" | "transient" | "unsure"; score: number }>;
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "../fixtures/triage-100-scores.json"), "utf8"),
) as Fixture;

/**
 * Regression test on recorded Jev keep probabilities.
 *
 * This is not a fresh generalization measurement: the 0.3 threshold was chosen
 * on this same 100-row sample. It exists so a future change to the client,
 * prompt, or threshold cannot silently regress the operating point.
 */
describe("Triage 100-row operating point", () => {
  const rows = fixture.rows.filter((row) => row.gold !== "unsure");
  const keep = rows.filter((row) => row.gold === "keep");
  const transient = rows.filter((row) => row.gold === "transient");
  const keptKeep = keep.filter((row) => row.score >= fixture.threshold).length;
  const droppedTransient = transient.filter((row) => row.score < fixture.threshold).length;

  test("fixture shape is the recorded 100-row sample", () => {
    expect(fixture.model).toBe("typesafe/jev-1.14.0");
    expect(fixture.prompt).toBe("ja");
    expect(fixture.threshold).toBe(0.3);
    expect(rows).toHaveLength(88);
    expect(keep).toHaveLength(17);
    expect(transient).toHaveLength(71);
  });

  test("keep recall stays at or above 0.95", () => {
    expect(keptKeep / keep.length).toBeGreaterThanOrEqual(0.95);
  });

  test("transient recall stays at or above 0.70", () => {
    expect(droppedTransient / transient.length).toBeGreaterThanOrEqual(0.7);
  });

  test("no durable row is dropped at the recorded threshold", () => {
    const droppedKeep = keep.filter((row) => row.score < fixture.threshold);
    expect(droppedKeep).toEqual([]);
  });
});
