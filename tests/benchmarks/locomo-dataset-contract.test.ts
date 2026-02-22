import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateLocomoDataset } from "./locomo-loader";

describe("LOCOMO dataset contract", () => {
  test("accepts locomo10 fixture with required fields", () => {
    const fixturePath = join(process.cwd(), "tests", "benchmarks", "fixtures", "locomo10.sample.json");
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
    const result = validateLocomoDataset(raw);
    expect(result.ok).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("rejects broken sample without required sample_id/conversation/qa/category", () => {
    const broken = [
      {
        sample_id: "",
        conversation: [{ speaker: "user", text: "x" }],
        qa: [{ question: "q", answer: "a" }],
      },
    ];
    const result = validateLocomoDataset(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("accepts numeric category in raw LoCoMo style", () => {
    const raw = [
      {
        sample_id: "sample-raw",
        conversation: [{ speaker: "user", text: "x" }],
        qa: [{ question: "q", answer: "a", category: 5 }],
      },
    ];
    const result = validateLocomoDataset(raw);
    expect(result.ok).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("accepts raw LoCoMo conversation object without sample_id", () => {
    const raw = [
      {
        qa: [{ question: "q", adversarial_answer: "a", category: 5 }],
        conversation: {
          speaker_a: "A",
          speaker_b: "B",
          session_1: [{ speaker: "A", text: "hello" }],
        },
      },
    ];
    const result = validateLocomoDataset(raw);
    expect(result.ok).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});
