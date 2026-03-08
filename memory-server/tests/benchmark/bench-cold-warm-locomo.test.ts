import { describe, expect, test } from "bun:test";
import { renderMarkdown, selectSingleQaCases, summarizeCases } from "../../../scripts/bench-cold-warm-locomo";

describe("selectSingleQaCases", () => {
  test("カテゴリを round-robin で拾い、1 QA dataset に分解する", () => {
    const selected = selectSingleQaCases(
      [
        {
          sample_id: "s1",
          conversation: [{ speaker: "user", text: "a" }],
          qa: [
            { question_id: "q1", question: "A?", answer: "A", category: "cat-1" },
            { question_id: "q2", question: "B?", answer: "B", category: "cat-2" },
          ],
        },
        {
          sample_id: "s2",
          conversation: [{ speaker: "user", text: "b" }],
          qa: [
            { question_id: "q3", question: "C?", answer: "C", category: "cat-1" },
            { question_id: "q4", question: "D?", answer: "D", category: "cat-3" },
          ],
        },
      ],
      4
    );

    expect(selected.map((item) => item.category)).toEqual(["cat-1", "cat-2", "cat-3", "cat-1"]);
    expect(selected[0]?.dataset[0]?.qa).toHaveLength(1);
    expect(selected[0]?.dataset[0]?.qa[0]?.question_id).toBe("q1");
  });
});

describe("summarizeCases", () => {
  test("cold/warm 差分を平均化できる", () => {
    const aggregate = summarizeCases([
      {
        sample_id: "s1",
        question_id: "q1",
        category: "cat-1",
        question: "A?",
        answer: "A",
        cold: {
          em: 1,
          f1: 0.5,
          latency_ms: 20,
          token_total: 100,
          prediction: "A",
          runtime_health_status: "healthy",
          runtime_health_details: "ok",
          gate_passed: true,
          prime_embedding_enabled: false,
        },
        warm: {
          em: 1,
          f1: 1,
          latency_ms: 10,
          token_total: 90,
          prediction: "A",
          runtime_health_status: "healthy",
          runtime_health_details: "ok",
          gate_passed: true,
          prime_embedding_enabled: true,
        },
        delta: { f1: 0.5, latency_ms: -10, token_total: -10 },
      },
      {
        sample_id: "s2",
        question_id: "q2",
        category: "cat-2",
        question: "B?",
        answer: "B",
        cold: {
          em: 1,
          f1: 1,
          latency_ms: 30,
          token_total: 120,
          prediction: "B",
          runtime_health_status: "healthy",
          runtime_health_details: "ok",
          gate_passed: true,
          prime_embedding_enabled: false,
        },
        warm: {
          em: 1,
          f1: 1,
          latency_ms: 15,
          token_total: 110,
          prediction: "B",
          runtime_health_status: "healthy",
          runtime_health_details: "ok",
          gate_passed: true,
          prime_embedding_enabled: true,
        },
        delta: { f1: 0, latency_ms: -15, token_total: -10 },
      },
    ]);

    expect(aggregate.cold.mean_f1).toBe(0.75);
    expect(aggregate.warm.mean_f1).toBe(1);
    expect(aggregate.delta.mean_latency_ms).toBe(-12.5);
    expect(aggregate.latency_improved_count).toBe(2);
    expect(aggregate.run_success_count).toBe(2);
    expect(aggregate.runtime_health_snapshot_statuses).toEqual(["healthy"]);
  });
});

describe("renderMarkdown", () => {
  test("集計表とケース表を描画する", () => {
    const markdown = renderMarkdown({
      generated_at: "2026-03-06T00:00:00.000Z",
      source_dataset: "fixtures/demo.json",
      selected_case_count: 1,
      method: {
        isolation: "isolated",
        cold_ready: "cold",
        warm_ready: "warm",
        selection: "round robin",
      },
      aggregate: {
        cold: { mean_f1: 0.5, mean_latency_ms: 20, p95_latency_ms: 20, mean_token_total: 100 },
        warm: { mean_f1: 1, mean_latency_ms: 10, p95_latency_ms: 10, mean_token_total: 90 },
        delta: { mean_f1: 0.5, mean_latency_ms: -10, mean_token_total: -10 },
        quality_regression_count: 0,
        latency_improved_count: 1,
        run_success_count: 1,
        runtime_health_snapshot_statuses: ["healthy"],
        runtime_health_snapshot_note: "snapshot note",
        gate_all_passed: true,
      },
      cases: [
        {
          sample_id: "s1",
          question_id: "q1",
          category: "cat-1",
          question: "A?",
          answer: "A",
          cold: {
            em: 0,
            f1: 0.5,
            latency_ms: 20,
            token_total: 100,
            prediction: "A",
            runtime_health_status: "healthy",
            runtime_health_details: "ok",
            gate_passed: true,
            prime_embedding_enabled: false,
          },
          warm: {
            em: 1,
            f1: 1,
            latency_ms: 10,
            token_total: 90,
            prediction: "A",
            runtime_health_status: "healthy",
            runtime_health_details: "ok",
            gate_passed: true,
            prime_embedding_enabled: true,
          },
          delta: { f1: 0.5, latency_ms: -10, token_total: -10 },
        },
      ],
    });

    expect(markdown).toContain("# S39 Cold vs Warm Observation");
    expect(markdown).toContain("| mean_f1 |");
    expect(markdown).toContain("| s1/q1 | cat-1 |");
  });
});
