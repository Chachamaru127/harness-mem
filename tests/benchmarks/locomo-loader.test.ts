import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocomoDataset } from "./locomo-loader";

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
});
