/**
 * S154-203: observation type classification — reduce the "context" catch-all.
 *
 * Verifies the expanded classifier assigns the right type to known dev-log patterns
 * (>= 0.95 accuracy) and strictly lowers the "context" (uninformative) ratio versus
 * the original patterns, with the improved ratio under the 12% target on the fixture.
 */

import { describe, expect, test } from "bun:test";
import { classifyObservationType, classificationStats } from "../../src/core/event-recorder";

/** The pre-S154-203 classifier, inlined for a before/after comparison. */
function baselineClassify(eventType: string, title: string, content: string): string {
  if (eventType === "session_end") return "summary";
  if (eventType === "session_start") return "context";
  if (eventType === "tool_use") return "action";
  const text = `${title} ${content}`.toLowerCase();
  if (/(decided|chose|picked|switched to|方針|決定|採用|選択)/.test(text)) return "decision";
  if (/(pattern|usually|consistently|repeatedly|傾向|パターン|毎回|常に)/.test(text)) return "pattern";
  if (/(prefer|dislike|avoid|rather|preference|好み|希望|避けたい)/.test(text)) return "preference";
  if (/(learned|lesson|realized|gotcha|mistake|学び|反省|気づき|教訓)/.test(text)) return "lesson";
  if (/(next step|todo|next action|次対応|次の対応|アクション)/.test(text)) return "action";
  return "context";
}

type Labeled = { content: string; expected: string };

// Clearly-typeable dev-log lines (the "known patterns").
const TYPEABLE: Labeled[] = [
  { content: "Decided to use PostgreSQL for the main DB.", expected: "decision" },
  { content: "本番DBを Postgres に決定した。", expected: "decision" },
  { content: "We're going with a monorepo.", expected: "decision" },
  { content: "Ruri を採用することにした。", expected: "decision" },
  { content: "We consistently see timeouts at peak load.", expected: "pattern" },
  { content: "毎回 race condition が起きる。", expected: "pattern" },
  { content: "I prefer tabs over spaces.", expected: "preference" },
  { content: "N+1 クエリは避けたい。", expected: "preference" },
  { content: "Fixed the race condition in worker.ts.", expected: "lesson" },
  { content: "Root cause was a missing await.", expected: "lesson" },
  { content: "バグを修正した。", expected: "lesson" },
  { content: "原因は環境変数の未設定だった。", expected: "lesson" },
  { content: "Learned that sqlite-vec needs explicit init.", expected: "lesson" },
  { content: "ハマったポイント: ESM の import 解決。", expected: "lesson" },
  { content: "Need to add retry logic.", expected: "action" },
  { content: "TODO: write integration tests.", expected: "action" },
  { content: "次の対応: migration を完了させる。", expected: "action" },
  { content: "Should add a rollback path.", expected: "action" },
  { content: "Will implement the shadow embedding provider.", expected: "action" },
  { content: "やることリスト: ベンチを回す。", expected: "action" },
];

// Genuinely neutral lines that should stay "context".
const CONTEXTUAL: Labeled[] = [
  { content: "The dev server runs on port 8080.", expected: "context" },
  { content: "Reviewed the open PRs this morning.", expected: "context" },
];

describe("S154-203 classifyObservationType", () => {
  test("known dev-log patterns classified with >= 0.95 accuracy", () => {
    const correct = TYPEABLE.filter(
      (row) => classifyObservationType("checkpoint", "", row.content) === row.expected,
    ).length;
    expect(correct / TYPEABLE.length).toBeGreaterThanOrEqual(0.95);
  });

  test("neutral lines stay context", () => {
    for (const row of CONTEXTUAL) {
      expect(classifyObservationType("checkpoint", "", row.content)).toBe("context");
    }
  });

  test("event_type shortcuts preserved", () => {
    expect(classifyObservationType("session_end", "", "x")).toBe("summary");
    expect(classifyObservationType("session_start", "", "x")).toBe("context");
    expect(classifyObservationType("tool_use", "", "x")).toBe("action");
  });
});

describe("S154-203 context catch-all reduction", () => {
  const corpus = [...TYPEABLE, ...CONTEXTUAL].map((row) => ({
    eventType: "checkpoint",
    title: "",
    content: row.content,
  }));

  test("improved classifier lowers the context ratio below the baseline and < 0.12", () => {
    const baselineContext =
      corpus.filter((c) => baselineClassify(c.eventType, c.title, c.content) === "context").length /
      corpus.length;
    const improved = classificationStats(corpus);
    expect(improved.context_ratio).toBeLessThan(baselineContext);
    expect(improved.context_ratio).toBeLessThan(0.12);
  });

  test("classificationStats reports type distribution + ratio", () => {
    const stats = classificationStats(corpus);
    expect(stats.total).toBe(corpus.length);
    expect(stats.by_type.context).toBe(CONTEXTUAL.length);
    expect(Object.values(stats.by_type).reduce((a, b) => a + b, 0)).toBe(corpus.length);
  });
});
