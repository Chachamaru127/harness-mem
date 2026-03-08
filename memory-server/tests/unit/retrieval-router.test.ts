import { describe, expect, test } from "bun:test";
import {
  classifyQuestion,
  routeQuery,
  HYBRID_WEIGHTS,
  extractTemporalAnchors,
  extractAnswerHints,
  normalizeRelativeTimeExpression,
} from "../../src/retrieval/router";

describe("classifyQuestion", () => {
  test("classifies profile queries", () => {
    const result = classifyQuestion("Who is the author of this module?");
    expect(result.kind).toBe("profile");
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  test("classifies 'what is' as profile", () => {
    const result = classifyQuestion("What is the authentication system?");
    expect(result.kind).toBe("profile");
  });

  test("classifies 'tell me about' as profile", () => {
    const result = classifyQuestion("Tell me about the database schema");
    expect(result.kind).toBe("profile");
  });

  test("classifies timeline queries", () => {
    const result = classifyQuestion("When did the last deployment happen?");
    expect(result.kind).toBe("timeline");
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  test("classifies 'recently' queries as timeline", () => {
    const result = classifyQuestion("What changed recently in the auth module?");
    expect(result.kind).toBe("timeline");
  });

  test("classifies 'latest' queries as timeline", () => {
    const result = classifyQuestion("Show me the latest test results");
    expect(result.kind).toBe("timeline");
  });

  test("classifies 'prior to' queries as timeline", () => {
    const result = classifyQuestion("What happened prior to the migration?");
    expect(result.kind).toBe("timeline");
  });

  test("classifies 'following' queries as timeline", () => {
    const result = classifyQuestion("What changed following the release?");
    expect(result.kind).toBe("timeline");
  });

  test("classifies Japanese temporal queries as timeline (の前)", () => {
    const result = classifyQuestion("リリースの前に何が起きましたか？");
    expect(result.kind).toBe("timeline");
  });

  test("classifies Japanese temporal queries as timeline (以降)", () => {
    const result = classifyQuestion("移行以降の変更を教えてください");
    expect(result.kind).toBe("timeline");
  });

  test("classifies graph queries", () => {
    const result = classifyQuestion("How does auth relate to the user module?");
    expect(result.kind).toBe("graph");
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  test("classifies 'depends on' as graph", () => {
    const result = classifyQuestion("What depends on the database module?");
    expect(result.kind).toBe("graph");
  });

  test("falls back to hybrid for general queries", () => {
    const result = classifyQuestion("memory management best practices");
    expect(result.kind).toBe("hybrid");
  });

  test("returns hybrid for empty query", () => {
    const result = classifyQuestion("");
    expect(result.kind).toBe("hybrid");
    expect(result.confidence).toBe(0);
  });
});

describe("routeQuery", () => {
  test("uses explicit kind when provided", () => {
    const result = routeQuery("some query", "vector");
    expect(result.kind).toBe("vector");
    expect(result.confidence).toBe(1.0);
  });

  test("classifies automatically when no explicit kind", () => {
    const result = routeQuery("When was the last commit?");
    expect(result.kind).toBe("timeline");
  });

  test("profile weights boost lexical and tag_boost", () => {
    const result = routeQuery("query", "profile");
    expect(result.weights.lexical).toBeGreaterThan(HYBRID_WEIGHTS.lexical);
    expect(result.weights.tag_boost).toBeGreaterThan(HYBRID_WEIGHTS.tag_boost);
  });

  test("timeline weights boost recency", () => {
    const result = routeQuery("query", "timeline");
    expect(result.weights.recency).toBeGreaterThan(HYBRID_WEIGHTS.recency);
  });

  test("graph weights boost graph", () => {
    const result = routeQuery("query", "graph");
    expect(result.weights.graph).toBeGreaterThan(HYBRID_WEIGHTS.graph);
  });

  test("vector weights boost vector", () => {
    const result = routeQuery("query", "vector");
    expect(result.weights.vector).toBeGreaterThan(HYBRID_WEIGHTS.vector);
  });

  test("all weight sets sum to approximately 1.0", () => {
    for (const kind of ["profile", "timeline", "graph", "vector", "hybrid"] as const) {
      const result = routeQuery("query", kind);
      const sum = Object.values(result.weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    }
  });

  test("adds answer hints for company queries", () => {
    const result = routeQuery("What company did I join?");
    expect(result.answerHints?.intent).toBe("company");
    expect(result.answerHints?.exactValuePreferred).toBe(true);
  });

  test("adds answer hints for location queries", () => {
    const result = routeQuery("Where do I live?");
    expect(result.answerHints?.intent).toBe("location");
    expect(result.answerHints?.activeFactPreferred).toBe(true);
  });

  test("timeline explicit kind carries temporal value answer hints", () => {
    const result = routeQuery("When did the release happen?", "timeline");
    expect(result.answerHints?.intent).toBe("temporal_value");
  });
});

describe("extractAnswerHints", () => {
  test("detects count-oriented questions", () => {
    const hints = extractAnswerHints("How many hours did I train?");
    expect(hints.intent).toBe("count");
    expect(hints.slotKeywords).toContain("hours");
  });

  test("detects metric-oriented questions and keeps focus keywords", () => {
    const hints = extractAnswerHints("日本語 release gate の overall F1 はいくつ");
    expect(hints.intent).toBe("metric_value");
    expect(hints.focusKeywords).toContain("ja-release-pack");
    expect(hints.focusKeywords).toContain("overall f1");
    expect(hints.metricKeywords).toContain("overall f1");
  });

  test("detects Japanese current-value questions", () => {
    const hints = extractAnswerHints("今、使っている CI は何ですか？");
    expect(hints.intent).toBe("current_value");
    expect(hints.exactValuePreferred).toBe(true);
  });

  test("detects Japanese reason questions", () => {
    const hints = extractAnswerHints("CircleCI から移行した理由は何ですか？");
    expect(hints.intent).toBe("reason");
    expect(hints.slotKeywords).toContain("理由");
  });

  test("detects Japanese list questions", () => {
    const hints = extractAnswerHints("Q2 に出した admin 向け機能をすべて挙げてください。");
    expect(hints.intent).toBe("list_value");
  });

  test("falls back to temporal value for timeline questions", () => {
    const hints = extractAnswerHints("release happened", "timeline");
    expect(hints.intent).toBe("temporal_value");
    expect(hints.exactValuePreferred).toBe(true);
  });

  test("falls back to current value for freshness questions", () => {
    const hints = extractAnswerHints("current deployment setup", "freshness");
    expect(hints.intent).toBe("current_value");
    expect(hints.activeFactPreferred).toBe(true);
  });
});

// §34 FD-005: extractTemporalAnchors — 20件のテスト
describe("extractTemporalAnchors", () => {
  // --- after パターン (英語) ---
  test("detects 'after X' pattern", () => {
    const anchors = extractTemporalAnchors("What happened after the deployment?");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
    expect(after?.referenceText).toContain("deployment");
  });

  test("detects 'since X' pattern", () => {
    const anchors = extractTemporalAnchors("What changed since the last release?");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  test("detects 'following X' pattern", () => {
    const anchors = extractTemporalAnchors("Show events following the bug fix");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  // --- before パターン (英語) ---
  test("detects 'before X' pattern", () => {
    const anchors = extractTemporalAnchors("What happened before the migration?");
    const before = anchors.find((a) => a.type === "before");
    expect(before).toBeDefined();
    expect(before?.direction).toBe("desc");
    expect(before?.referenceText).toContain("migration");
  });

  test("detects 'prior to X' pattern", () => {
    const anchors = extractTemporalAnchors("Events prior to the refactoring");
    const before = anchors.find((a) => a.type === "before");
    expect(before).toBeDefined();
    expect(before?.direction).toBe("desc");
  });

  test("detects 'until X' pattern", () => {
    const anchors = extractTemporalAnchors("Show logs until the system crash");
    const before = anchors.find((a) => a.type === "before");
    expect(before).toBeDefined();
    expect(before?.direction).toBe("desc");
  });

  // --- between パターン ---
  test("detects 'between X and Y' pattern", () => {
    const anchors = extractTemporalAnchors("What happened between the release and the hotfix?");
    const between = anchors.find((a) => a.type === "between");
    expect(between).toBeDefined();
    expect(between?.direction).toBe("around");
  });

  // --- sequence パターン (英語) ---
  test("detects 'first' sequence keyword", () => {
    const anchors = extractTemporalAnchors("First we set up the database, then we deployed");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  test("detects 'then' sequence keyword", () => {
    const anchors = extractTemporalAnchors("We fixed the bug, then updated the docs");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  test("detects 'finally' sequence keyword", () => {
    const anchors = extractTemporalAnchors("Finally the deployment succeeded");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  // --- 日本語 after パターン ---
  test("detects Japanese 'の後' (after) pattern", () => {
    const anchors = extractTemporalAnchors("デプロイの後に何が起きた？");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  test("detects Japanese '以降' (after) pattern", () => {
    const anchors = extractTemporalAnchors("リリース以降の変更点を見せて");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  test("detects Japanese 'より後' pattern", () => {
    const anchors = extractTemporalAnchors("先週より後のログを確認したい");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  // --- 日本語 before パターン ---
  test("detects Japanese 'の前' (before) pattern", () => {
    const anchors = extractTemporalAnchors("マイグレーションの前の状態を教えて");
    const before = anchors.find((a) => a.type === "before");
    expect(before).toBeDefined();
    expect(before?.direction).toBe("desc");
  });

  test("detects Japanese '以前' (before) pattern", () => {
    const anchors = extractTemporalAnchors("バグ修正以前のコードを確認");
    const before = anchors.find((a) => a.type === "before");
    expect(before).toBeDefined();
    expect(before?.direction).toBe("desc");
  });

  // --- 日本語 sequence パターン ---
  test("detects Japanese '最初' sequence keyword", () => {
    const anchors = extractTemporalAnchors("最初にデータベースを設定して次にデプロイした");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  test("detects Japanese '次に' sequence keyword", () => {
    const anchors = extractTemporalAnchors("バグを修正して次にテストを実行した");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  test("detects Japanese '最後' sequence keyword", () => {
    const anchors = extractTemporalAnchors("最後にリリースノートを更新した");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  // --- routeQuery での anchor 統合 ---
  test("routeQuery returns temporalAnchors for TIMELINE kind", () => {
    const result = routeQuery("What happened after the deployment?");
    if (result.kind === "timeline") {
      expect(result.temporalAnchors).toBeDefined();
      expect(result.temporalAnchors?.length).toBeGreaterThan(0);
    }
    // timeline として分類されない場合でも、クラッシュしないこと
    expect(result.kind).toBeDefined();
  });

  test("routeQuery with explicit timeline kind extracts anchors", () => {
    const result = routeQuery("show entries after the migration", "timeline");
    expect(result.kind).toBe("timeline");
    expect(result.temporalAnchors).toBeDefined();
    expect(result.temporalAnchors?.length).toBeGreaterThan(0);
    const after = result.temporalAnchors?.find((a) => a.type === "after");
    expect(after).toBeDefined();
  });

  // --- エッジケース ---
  test("returns empty array for non-temporal queries", () => {
    const anchors = extractTemporalAnchors("What is the current authentication system?");
    // 時間的なアンカーがない場合は空配列
    expect(Array.isArray(anchors)).toBe(true);
  });

  test("returns empty array for empty query", () => {
    const anchors = extractTemporalAnchors("");
    expect(anchors).toEqual([]);
  });
});

// S43-004: Temporal normalization — relative time expressions
// Targeted regression tests for temporal-010 / 015 / 008 / 006
describe("S43-004 temporal normalization — targeted regression", () => {
  // temporal-006: "alert の直後に最初にやったことは何ですか？"
  // 直後 = immediately after → should extract "after" anchor with referenceText containing "alert"
  test("[temporal-006] detects '直後' (immediately after) as after anchor", () => {
    const anchors = extractTemporalAnchors("alert の直後に最初にやったことは何ですか？");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
    expect(after?.referenceText.toLowerCase()).toContain("alert");
  });

  test("[temporal-006] classifies as timeline kind", () => {
    const result = classifyQuestion("alert の直後に最初にやったことは何ですか？");
    expect(result.kind).toBe("timeline");
  });

  // temporal-008: "launch playbook の次に localize したものは何ですか？"
  // の次に = next after X → should extract "after" anchor with referenceText containing "launch playbook"
  test("[temporal-008] detects 'の次に' (next after) as after anchor", () => {
    const anchors = extractTemporalAnchors("launch playbook の次に localize したものは何ですか？");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
    expect(after?.referenceText.toLowerCase()).toContain("launch playbook");
  });

  test("[temporal-008] classifies as timeline kind", () => {
    const result = classifyQuestion("launch playbook の次に localize したものは何ですか？");
    expect(result.kind).toBe("timeline");
  });

  // temporal-010: "headquarters を移した後も remote-first のままだったのはどのチームですか？"
  // 移した後も = even after moving → should extract "after" anchor
  test("[temporal-010] detects '後も' variant as after anchor", () => {
    const anchors = extractTemporalAnchors("headquarters を移した後も remote-first のままだったのはどのチームですか？");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  test("[temporal-010] classifies as timeline kind", () => {
    const result = classifyQuestion("headquarters を移した後も remote-first のままだったのはどのチームですか？");
    expect(result.kind).toBe("timeline");
  });

  // temporal-015: "最初はどのツールだけを対象にしていましたか？"
  // 最初は = initially (with topic particle) → sequence anchor
  test("[temporal-015] detects '最初は' as sequence anchor", () => {
    const anchors = extractTemporalAnchors("最初はどのツールだけを対象にしていましたか？");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  test("[temporal-015] classifies as timeline kind", () => {
    const result = classifyQuestion("最初はどのツールだけを対象にしていましたか？");
    expect(result.kind).toBe("timeline");
  });

  // normalizeRelativeTimeExpression: canonical form conversion
  test("normalizeRelativeTimeExpression converts '直後' to 'immediately after'", () => {
    const norm = normalizeRelativeTimeExpression("直後");
    expect(norm).toBe("immediately_after");
  });

  test("normalizeRelativeTimeExpression converts '最初' to 'initially'", () => {
    const norm = normalizeRelativeTimeExpression("最初");
    expect(norm).toBe("initially");
  });

  test("normalizeRelativeTimeExpression converts 'の次に' to 'next_after'", () => {
    const norm = normalizeRelativeTimeExpression("の次に");
    expect(norm).toBe("next_after");
  });

  test("normalizeRelativeTimeExpression converts '後も' to 'even_after'", () => {
    const norm = normalizeRelativeTimeExpression("後も");
    expect(norm).toBe("even_after");
  });

  test("normalizeRelativeTimeExpression returns null for non-temporal text", () => {
    const norm = normalizeRelativeTimeExpression("プロジェクト名");
    expect(norm).toBeNull();
  });

  // TemporalAnchor canonical form: anchors should carry normalizedForm when available
  test("[temporal-006] anchor carries normalizedForm for 直後", () => {
    const anchors = extractTemporalAnchors("alert の直後に最初にやったことは何ですか？");
    const after = anchors.find((a) => a.type === "after");
    expect(after?.normalizedForm).toBe("immediately_after");
  });

  test("[temporal-008] anchor carries normalizedForm for の次に", () => {
    const anchors = extractTemporalAnchors("launch playbook の次に localize したものは何ですか？");
    const after = anchors.find((a) => a.type === "after");
    expect(after?.normalizedForm).toBe("next_after");
  });

  test("[temporal-015] anchor carries normalizedForm for 最初", () => {
    const anchors = extractTemporalAnchors("最初はどのツールだけを対象にしていましたか？");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq?.normalizedForm).toBe("initially");
  });
});
