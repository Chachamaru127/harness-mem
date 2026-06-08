import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chunkContextText,
  loadMemoryAgentBenchDataset,
  MAX_CHUNK_CHARS,
  MEMORY_AGENT_BENCH_REVISION,
  MEMORY_AGENT_BENCH_TRANSFORM_VERSION,
  SMOKE_MAX_CHUNK_CHARS,
  SMOKE_MAX_MEMORY_CHUNKS,
  SMOKE_MAX_QUERY_CHARS,
  transformMemoryAgentBenchRows,
  type MemoryAgentBenchRawRow,
} from "../lib/memoryagentbench-loader";
import { scoreCase } from "../lib/score-case";
import type { AdapterQueryResult } from "../lib/types";

const officialLikeRows: MemoryAgentBenchRawRow[] = [
  {
    context: [
      "Session 1: Nora moved the release freeze from Friday to Monday.",
      "Session 2: The deployment owner is Ken.",
    ],
    questions: ["When is the release freeze now?"],
    answers: ["Monday"],
    metadata: {
      haystack_sessions: ["Older haystack: release freeze was Friday before the update."],
    },
    keypoints: ["release freeze", "Monday"],
    previous_events: ["Friday was superseded."],
    qa_pair_ids: ["qa-1"],
  },
];

describe("MemoryAgentBench loader", () => {
  test("maps official split names to internal competencies", () => {
    const expectations = [
      ["Accurate_Retrieval", "AR"],
      ["Test_Time_Learning", "TTL"],
      ["Long_Range_Understanding", "LRU"],
      ["Conflict_Resolution", "CR"],
    ] as const;

    for (const [split, competency] of expectations) {
      const cases = transformMemoryAgentBenchRows({
        rows: officialLikeRows,
        split,
        limit: 1,
      });
      expect(cases).toHaveLength(1);
      expect(cases[0].competency).toBe(competency);
      expect(cases[0].source_split).toBe(split);
      expect(cases[0].dataset_revision).toBe(MEMORY_AGENT_BENCH_REVISION);
      expect(cases[0].official_metric?.expected_answers).toContain("Monday");
      expect(cases[0].memories.length).toBeGreaterThan(0);
    }
  });

  test("uses cache on repeated loads without network", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "mab-cache-"));
    let fetchCount = 0;
    try {
      const fetchImpl = async () => {
        fetchCount += 1;
        return new Response(
          JSON.stringify({
            rows: [{ row_idx: 0, row: officialLikeRows[0] }],
            num_rows_total: 1,
          }),
          { status: 200 },
        );
      };

      const first = await loadMemoryAgentBenchDataset({
        split: "Accurate_Retrieval",
        limit: 1,
        cacheDir,
        fetchImpl,
      });
      const second = await loadMemoryAgentBenchDataset({
        split: "Accurate_Retrieval",
        limit: 1,
        cacheDir,
        fetchImpl: async () => {
          throw new Error("network should not be used when cache exists");
        },
      });

      expect(fetchCount).toBe(1);
      expect(first.cases[0].case_id).toBe(second.cases[0].case_id);
      expect(second.manifest.cache_dir).toBe(cacheDir);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  test("keeps nested answer aliases aligned to each question", () => {
    const cases = transformMemoryAgentBenchRows({
      rows: [
        {
          context: [
            "Session 1: The release freeze moved to Monday.",
            "Session 2: The deployment owner is Ken.",
          ],
          questions: ["When is the release freeze?", "Who owns deployment?"],
          answers: [
            ["Monday", "Mon"],
            ["Ken", "Kenny"],
          ],
          keypoints: [["release freeze"], ["deployment owner"]],
        },
      ],
      split: "Accurate_Retrieval",
    });

    expect(cases).toHaveLength(2);
    expect(cases[0].official_metric?.expected_answers).toEqual(["Monday", "Mon", "release freeze"]);
    expect(cases[0].expected_keywords).toEqual(["Monday", "Mon", "release freeze"]);
    expect(cases[0].official_metric?.expected_answers).not.toContain("Ken");
    expect(cases[0].official_metric?.expected_answers).not.toContain("Kenny");
    expect(cases[0].relevant_ids).toContain("mab-Accurate_Retrieval-1-m1");
    expect(cases[0].relevant_ids).not.toContain("mab-Accurate_Retrieval-1-m2");

    expect(cases[1].official_metric?.expected_answers).toEqual(["Ken", "Kenny", "deployment owner"]);
    expect(cases[1].expected_keywords).toEqual(["Ken", "Kenny", "deployment owner"]);
    expect(cases[1].official_metric?.expected_answers).not.toContain("Monday");
    expect(cases[1].official_metric?.expected_answers).not.toContain("Mon");
    expect(cases[1].relevant_ids).toContain("mab-Accurate_Retrieval-1-m2");
    expect(cases[1].relevant_ids).not.toContain("mab-Accurate_Retrieval-1-m1");
  });

  test("splits Document markers into multiple memory chunks", () => {
    const cases = transformMemoryAgentBenchRows({
      rows: [
        {
          context:
            "Document 1:\nParis is the capital of France.\nDocument 2:\nLondon has Big Ben.\nDocument 3:\nTokyo is in Japan.",
          questions: ["Which city has Big Ben?", "What capital is in Document 1?"],
          answers: [["London"], ["Paris"]],
        },
      ],
      split: "Accurate_Retrieval",
    });

    expect(cases).toHaveLength(2);
    expect(cases[0].memories).toHaveLength(3);
    expect(cases[0].memories[0].content).toMatch(/^Document 1:/);
    expect(cases[0].memories[1].content).toMatch(/^Document 2:/);
    expect(cases[0].memories[2].content).toMatch(/^Document 3:/);

    expect(cases[0].relevant_ids).toEqual(["mab-Accurate_Retrieval-1-m2"]);
    expect(cases[0].relevant_ids).not.toContain("mab-Accurate_Retrieval-1-m1");
    expect(cases[0].relevant_ids).not.toContain("mab-Accurate_Retrieval-1-m3");

    expect(cases[1].relevant_ids).toEqual(["mab-Accurate_Retrieval-1-m1"]);
    expect(cases[1].relevant_ids).not.toContain("mab-Accurate_Retrieval-1-m2");
  });

  test("chunks haystack sessions without collapsing context documents", () => {
    const cases = transformMemoryAgentBenchRows({
      rows: [
        {
          context: "Document 1:\nAnswer alpha lives here.",
          metadata: {
            haystack_sessions: [
              [
                { role: "user", content: "Older note about beta only." },
                { role: "assistant", content: "Acknowledged beta." },
              ],
            ],
          },
          questions: ["Where is alpha?"],
          answers: [["alpha"]],
        },
      ],
      split: "Accurate_Retrieval",
    });

    expect(cases[0].memories).toHaveLength(2);
    expect(cases[0].relevant_ids).toEqual(["mab-Accurate_Retrieval-1-m1"]);
    expect(cases[0].relevant_ids).not.toContain("mab-Accurate_Retrieval-1-m2");
  });

  test("caps smoke rows while preserving answer-containing chunks", () => {
    const documents = Array.from(
      { length: 450 },
      (_, index) => `Document ${index + 1}:\nFiller text ${index + 1}.`,
    );
    documents[399] = "Document 400:\nThe hidden answer is Zebra City.";
    const cases = transformMemoryAgentBenchRows({
      rows: [
        {
          context: documents.join("\n"),
          questions: ["What is the hidden answer?"],
          answers: [["Zebra City"]],
        },
      ],
      split: "Accurate_Retrieval",
      limit: 2,
    });

    expect(cases[0].memories.length).toBeLessThanOrEqual(SMOKE_MAX_MEMORY_CHUNKS);
    expect(cases[0].memories.every((memory) => memory.content.length <= SMOKE_MAX_CHUNK_CHARS)).toBe(true);
    expect(cases[0].memories.some((memory) => memory.content.includes("Zebra City"))).toBe(true);
    expect(cases[0].relevant_ids.some((id) => id.includes("-m"))).toBe(true);
  });

  test("bounds smoke LRU-like prose to a small seed corpus", () => {
    const prose = Array.from(
      { length: 200 },
      (_, index) => `Paragraph ${index + 1}: ${"word ".repeat(500)}`,
    ).join("\n\n");
    const cases = transformMemoryAgentBenchRows({
      rows: [
        {
          context: `${prose}\n\nParagraph 201: The heroine Jennifer marries Mina Loris.`,
          questions: ["Who does Jennifer marry?"],
          answers: [["Mina Loris"]],
        },
      ],
      split: "Long_Range_Understanding",
      limit: 2,
    });

    const { memories } = cases[0];
    const totalChars = memories.reduce((sum, memory) => sum + memory.content.length, 0);
    expect(memories.length).toBeLessThanOrEqual(SMOKE_MAX_MEMORY_CHUNKS);
    expect(memories.every((memory) => memory.content.length <= SMOKE_MAX_CHUNK_CHARS)).toBe(true);
    expect(totalChars).toBeLessThanOrEqual(SMOKE_MAX_MEMORY_CHUNKS * SMOKE_MAX_CHUNK_CHARS);
    expect(
      memories.some(
        (memory) => memory.content.includes("Mina Loris") || memory.content.includes("Jennifer"),
      ),
    ).toBe(true);
    expect(cases[0].query.length).toBeLessThanOrEqual(SMOKE_MAX_QUERY_CHARS);
    expect(cases[0].query).toContain("Jennifer");
  });

  test("splits oversized Document chunks to MAX_CHUNK_CHARS", () => {
    const hugeBody = "x".repeat(100_000);
    const chunked = chunkContextText(`Document 1:\n${hugeBody}\nDocument 2:\nShort.`);
    expect(chunked.length).toBeGreaterThan(2);
    expect(chunked.every((chunk) => chunk.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(chunked[0]).toMatch(/^Document 1:/);
    expect(chunked.at(-1)).toBe("Document 2:\nShort.");
  });

  test("bounds full-transform memories to MAX_CHUNK_CHARS", () => {
    const cases = transformMemoryAgentBenchRows({
      rows: [
        {
          context: `Document 1:\n${"y".repeat(90_000)}`,
          questions: ["Find y"],
          answers: [["y"]],
        },
      ],
      split: "Accurate_Retrieval",
    });
    expect(cases[0].memories.length).toBeGreaterThan(1);
    expect(cases[0].memories.every((memory) => memory.content.length <= MAX_CHUNK_CHARS)).toBe(true);
  });

  test("uses transform v3 for bounded chunked official rows", () => {
    const chunked = chunkContextText(
      "Document 1:\nOne.\nDocument 2:\nTwo.",
    );
    expect(chunked).toHaveLength(2);
    expect(MEMORY_AGENT_BENCH_TRANSFORM_VERSION).toBe("memoryagentbench-transform-v3");
  });

  test("medium gate keeps full chunking for a single upstream row", () => {
    const documents = Array.from(
      { length: 450 },
      (_, index) => `Document ${index + 1}:\nFiller text ${index + 1}.`,
    );
    documents[399] = "Document 400:\nThe hidden answer is Zebra City.";
    const cases = transformMemoryAgentBenchRows({
      rows: [
        {
          context: documents.join("\n"),
          questions: ["What is the hidden answer?", "Another question?"],
          answers: [["Zebra City"], ["none"]],
        },
      ],
      split: "Accurate_Retrieval",
      rowLimit: 1,
    });

    expect(cases.length).toBeGreaterThan(1);
    expect(cases[0].memories.length).toBeGreaterThan(SMOKE_MAX_MEMORY_CHUNKS);
    expect(cases[0].memories.every((memory) => memory.content.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(cases[0].memories.some((memory) => memory.content.includes("Zebra City"))).toBe(true);
  });

  test("keeps official metric separate from internal retrieval metrics", () => {
    const [caseRow] = transformMemoryAgentBenchRows({
      rows: officialLikeRows,
      split: "Test_Time_Learning",
      limit: 1,
    });
    const queryResult: AdapterQueryResult = {
      status: "ok",
      hits: [
        {
          id: caseRow.relevant_ids[0],
          rank: 1,
          content: "The release freeze is now Monday.",
        },
      ],
      latency_ms: 1,
    };

    const scored = scoreCase(caseRow, "harness-mem", queryResult);
    expect(scored.recall_at_10).toBe(0);
    expect(scored.official_metric?.score).toBe(1);
    expect(scored.source_split).toBe("Test_Time_Learning");
  });
});
