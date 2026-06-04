import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocomoDataset, parseLocomoSessionDate } from "./locomo-loader";

describe("LOCOMO session date parser", () => {
  test("parses '1:56 pm on 8 May, 2023' to ISO", () => {
    expect(parseLocomoSessionDate("1:56 pm on 8 May, 2023")).toBe("2023-05-08T13:56:00.000Z");
  });

  test("parses date without time", () => {
    expect(parseLocomoSessionDate("8 May, 2023")).toBe("2023-05-08T00:00:00.000Z");
  });

  test("handles 12 am/pm correctly", () => {
    expect(parseLocomoSessionDate("12:00 am on 1 January, 2024")).toBe("2024-01-01T00:00:00.000Z");
    expect(parseLocomoSessionDate("12:30 pm on 1 January, 2024")).toBe("2024-01-01T12:30:00.000Z");
  });

  test("returns undefined for unknown format", () => {
    expect(parseLocomoSessionDate("sometime later")).toBeUndefined();
    expect(parseLocomoSessionDate("")).toBeUndefined();
  });
});

describe("LOCOMO loader", () => {
  test("normalizes sample fields and creates missing question_id", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "locomo-loader-"));
    const datasetPath = join(tempDir, "locomo10.json");
    try {
      writeFileSync(
        datasetPath,
        JSON.stringify([
          {
            sample_id: " sample-1 ",
            conversation: [{ speaker: " user ", text: " moved to seattle " }],
            qa: [{ question: " where did I move? ", answer: " seattle ", category: " profile " }],
          },
        ])
      );

      const loaded = loadLocomoDataset(datasetPath);
      expect(loaded[0]?.sample_id).toBe("sample-1");
      expect(loaded[0]?.conversation[0]?.speaker).toBe("user");
      expect(loaded[0]?.conversation[0]?.text).toBe("moved to seattle");
      expect(loaded[0]?.qa[0]?.category).toBe("profile");
      expect(loaded[0]?.qa[0]?.question_id).toBe("sample-1-q1");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("uses adversarial_answer and normalizes numeric category", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "locomo-loader-"));
    const datasetPath = join(tempDir, "locomo10.json");
    try {
      writeFileSync(
        datasetPath,
        JSON.stringify([
          {
            sample_id: "sample-2",
            conversation: [{ speaker: "user", text: "hello" }],
            qa: [
              {
                question: "trick question",
                answer: null,
                adversarial_answer: "safe answer",
                category: 5,
              },
            ],
          },
        ])
      );

      const loaded = loadLocomoDataset(datasetPath);
      expect(loaded[0]?.qa[0]?.answer).toBe("safe answer");
      expect(loaded[0]?.qa[0]?.category).toBe("cat-5");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("supports raw LoCoMo schema with conversation sessions", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "locomo-loader-"));
    const datasetPath = join(tempDir, "locomo10.json");
    try {
      writeFileSync(
        datasetPath,
        JSON.stringify([
          {
            qa: [
              {
                question: "where did I move?",
                category: 5,
                adversarial_answer: "Kyoto",
              },
            ],
            conversation: {
              speaker_a: "A",
              speaker_b: "B",
              session_2: [{ speaker: "B", text: " second turn " }],
              session_1: [{ speaker: "A", text: " first turn " }],
            },
          },
        ])
      );

      const loaded = loadLocomoDataset(datasetPath);
      expect(loaded[0]?.sample_id).toBe("sample-1");
      expect(loaded[0]?.conversation.length).toBe(2);
      expect(loaded[0]?.conversation[0]?.text).toBe("first turn");
      expect(loaded[0]?.conversation[1]?.text).toBe("second turn");
      expect(loaded[0]?.qa[0]?.answer).toBe("Kyoto");
      expect(loaded[0]?.qa[0]?.category).toBe("cat-5");
      expect(loaded[0]?.qa[0]?.question_id).toBe("sample-1-q1");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("loads official locomo10.json when present locally", () => {
    const datasetPath = join(process.cwd(), ".tmp", "locomo", "locomo10.json");
    if (!existsSync(datasetPath)) return;
    const loaded = loadLocomoDataset(datasetPath);
    expect(loaded.length).toBe(10);
    expect(loaded.reduce((count, sample) => count + sample.qa.length, 0)).toBeGreaterThan(1000);
    // official raw shape carries session_N_date_time → turns should have timestamps
    const withTs = loaded[0]?.conversation.filter((turn) => turn.timestamp).length || 0;
    expect(withTs).toBeGreaterThan(0);
  });

  test("attaches session timestamp to raw conversation turns", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "locomo-loader-ts-"));
    const datasetPath = join(tempDir, "locomo10.json");
    try {
      writeFileSync(
        datasetPath,
        JSON.stringify([
          {
            qa: [{ question: "when?", adversarial_answer: "x", category: 2 }],
            conversation: {
              speaker_a: "A",
              speaker_b: "B",
              session_1_date_time: "1:56 pm on 8 May, 2023",
              session_1: [{ speaker: "A", text: "I went to the group yesterday." }],
            },
          },
        ])
      );
      const loaded = loadLocomoDataset(datasetPath);
      expect(loaded[0]?.conversation[0]?.timestamp).toBe("2023-05-08T13:56:00.000Z");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
