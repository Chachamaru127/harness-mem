import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../memory-server/src/core/harness-mem-core";
import { type LocomoSample } from "./locomo-loader";
import { HarnessMemLocomoAdapter } from "./locomo-harness-adapter";

function createConfig(dir: string): Config {
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 37888,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
}

describe("LOCOMO harness adapter", () => {
  test("ingests one sample and answers QA via search replay", () => {
    const tmp = mkdtempSync(join(tmpdir(), "locomo-harness-adapter-"));
    const core = new HarnessMemCore(createConfig(tmp));
    try {
      const fixturePath = join(process.cwd(), "tests", "benchmarks", "fixtures", "locomo10.sample.json");
      const samples = JSON.parse(readFileSync(fixturePath, "utf8")) as LocomoSample[];
      const sample = samples[0];
      const qa = sample.qa[0];

      const adapter = new HarnessMemLocomoAdapter(core, { project: "locomo-harness-test" });
      adapter.ingestSample(sample);
      const replay = adapter.answerQuestion(qa.question);

      expect(replay.search_hit_count).toBeGreaterThan(0);
      expect(replay.prediction.toLowerCase()).toContain("seattle");
      expect(replay.question_kind).toBe("location");
      expect(replay.answer_strategy).toContain("location");
      expect(replay.selected_evidence_ids.length).toBeGreaterThan(0);
      expect(replay.answer_trace.extraction.selected_candidates.length).toBeGreaterThan(0);
      expect(replay.answer_trace.normalization.after.length).toBeGreaterThan(0);
      expect(replay.answer_trace.final_short_answer).toBe(replay.prediction);
      expect(replay.search_latency_ms).toBeGreaterThanOrEqual(0);
      expect(replay.token_estimate_total_tokens).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("isolates search by session_id to avoid cross-sample mixing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "locomo-harness-adapter-"));
    const core = new HarnessMemCore(createConfig(tmp));
    try {
      const sampleA: LocomoSample = {
        sample_id: "sample-a",
        conversation: [
          { speaker: "user", text: "I moved to Seattle in 2024." },
          { speaker: "assistant", text: "You moved to Seattle in 2024." },
        ],
        qa: [],
      };
      const sampleB: LocomoSample = {
        sample_id: "sample-b",
        conversation: [
          { speaker: "user", text: "I moved to Kyoto in 2024." },
          { speaker: "assistant", text: "You moved to Kyoto in 2024." },
        ],
        qa: [],
      };

      const adapterA = new HarnessMemLocomoAdapter(core, { project: "locomo-harness-test", session_id: "session-a" });
      const adapterB = new HarnessMemLocomoAdapter(core, { project: "locomo-harness-test", session_id: "session-b" });
      adapterA.ingestSample(sampleA);
      adapterB.ingestSample(sampleB);

      const replayA = adapterA.answerQuestion("Where did I move?");
      const replayB = adapterB.answerQuestion("Where did I move?");

      expect(replayA.prediction.toLowerCase()).toContain("seattle");
      expect(replayA.prediction.toLowerCase()).not.toContain("kyoto");
      expect(replayB.prediction.toLowerCase()).toContain("kyoto");
      expect(replayB.prediction.toLowerCase()).not.toContain("seattle");
      expect(replayA.selected_evidence_ids.length).toBeGreaterThan(0);
      expect(replayB.selected_evidence_ids.length).toBeGreaterThan(0);
      expect(replayA.token_estimate_total_tokens).toBeGreaterThan(0);
      expect(replayB.token_estimate_total_tokens).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("extracts temporal answers and merges multi-hop evidence", () => {
    const tmp = mkdtempSync(join(tmpdir(), "locomo-harness-adapter-"));
    const core = new HarnessMemCore(createConfig(tmp));
    try {
      const sample: LocomoSample = {
        sample_id: "sample-temporal-hop",
        conversation: [
          { speaker: "user", text: "I spoke at school on 7 May 2023." },
          { speaker: "assistant", text: "The support group gave me courage to pursue counseling." },
        ],
        qa: [],
      };

      const adapter = new HarnessMemLocomoAdapter(core, { project: "locomo-harness-test", session_id: "session-hop" });
      adapter.ingestSample(sample);

      const temporal = adapter.answerQuestion("When did I speak at school?", { category: "cat-2" });
      expect(temporal.prediction).toContain("May 7, 2023");
      expect(temporal.answer_strategy).toContain("temporal");
      expect(temporal.answer_trace.query_variants.length).toBeGreaterThanOrEqual(5);
      expect(temporal.answer_trace.search_policy.candidate_limit).toBe(5);

      const multiHop = adapter.answerQuestion(
        "Would I still pursue counseling if I hadn't received support?",
        { category: "cat-3" }
      );
      expect(multiHop.prediction.toLowerCase()).toContain("likely");
      expect(multiHop.prediction).toContain("Reason:");
      expect(multiHop.answer_strategy).toContain("counterfactual");
      expect(multiHop.search_hit_count).toBeGreaterThanOrEqual(2);
      expect(multiHop.selected_evidence_ids.length).toBeGreaterThan(0);
      expect(multiHop.answer_trace.query_variants.length).toBeGreaterThanOrEqual(6);
      expect(multiHop.answer_trace.search_policy.limit).toBeGreaterThanOrEqual(18);
      expect(multiHop.answer_trace.normalization.multi_hop_reasoning?.format).toBe("counterfactual");
    } finally {
      core.shutdown("test");
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("integrates top-N evidence (N=5) for list questions", () => {
    const tmp = mkdtempSync(join(tmpdir(), "locomo-harness-adapter-"));
    const core = new HarnessMemCore(createConfig(tmp));
    try {
      const sample: LocomoSample = {
        sample_id: "sample-list-topn",
        conversation: [
          { speaker: "user", text: "I enjoyed swimming last week." },
          { speaker: "assistant", text: "You also practiced guitar yesterday." },
          { speaker: "user", text: "I completed a painting class." },
          { speaker: "assistant", text: "I read two mystery books recently." },
          { speaker: "user", text: "I played tennis with friends." },
          { speaker: "assistant", text: "I attended a coding meetup." },
        ],
        qa: [],
      };

      const adapter = new HarnessMemLocomoAdapter(core, { project: "locomo-harness-test", session_id: "session-list" });
      adapter.ingestSample(sample);
      const replay = adapter.answerQuestion("What activities did I do recently?", { category: "cat-4" });

      expect(replay.question_kind).toBe("list");
      expect(replay.answer_trace.search_policy.candidate_limit).toBe(5);
      expect(replay.answer_trace.extraction.selected_candidates.length).toBeGreaterThanOrEqual(3);
      expect(replay.selected_evidence_ids.length).toBeGreaterThanOrEqual(3);
      expect(replay.prediction.length).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
