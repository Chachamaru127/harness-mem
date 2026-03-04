/**
 * FD-005: TemporalAnchor 抽出器テスト
 *
 * extractTemporalAnchors() の 20件テスト
 * - after/Xの後 (asc)
 * - before/Xの前 (desc)
 * - between (around)
 * - sequence/最初/次 (asc)
 * - routeQuery に temporalAnchors が含まれることの確認
 */

import { describe, expect, test } from "bun:test";
import { extractTemporalAnchors, routeQuery, type TemporalAnchor } from "../../src/retrieval/router";

describe("extractTemporalAnchors", () => {
  // --- after パターン ---
  test("EN: 'after X' → type=after, direction=asc", () => {
    const anchors = extractTemporalAnchors("What happened after the migration?");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
    expect(after?.referenceText).toContain("migration");
  });

  test("EN: 'following X' → type=after, direction=asc", () => {
    const anchors = extractTemporalAnchors("What changed following the release?");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  test("EN: 'since X' → type=after, direction=asc", () => {
    const anchors = extractTemporalAnchors("What happened since last week?");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  test("JA: 'Xの後' → type=after, direction=asc", () => {
    const anchors = extractTemporalAnchors("リリースの後に何が変わりましたか？");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  test("JA: 'X以降' → type=after, direction=asc", () => {
    const anchors = extractTemporalAnchors("移行以降の変更を教えてください");
    const after = anchors.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  // --- before パターン ---
  test("EN: 'before X' → type=before, direction=desc", () => {
    const anchors = extractTemporalAnchors("What was the state before the deployment?");
    const before = anchors.find((a) => a.type === "before");
    expect(before).toBeDefined();
    expect(before?.direction).toBe("desc");
    expect(before?.referenceText).toContain("deployment");
  });

  test("EN: 'prior to X' → type=before, direction=desc", () => {
    const anchors = extractTemporalAnchors("What happened prior to the migration?");
    const before = anchors.find((a) => a.type === "before");
    expect(before).toBeDefined();
    expect(before?.direction).toBe("desc");
  });

  test("EN: 'until X' → type=before, direction=desc", () => {
    const anchors = extractTemporalAnchors("Show entries until the release");
    const before = anchors.find((a) => a.type === "before");
    expect(before).toBeDefined();
    expect(before?.direction).toBe("desc");
  });

  test("JA: 'Xの前' → type=before, direction=desc", () => {
    const anchors = extractTemporalAnchors("デプロイの前に何をしましたか？");
    const before = anchors.find((a) => a.type === "before");
    expect(before).toBeDefined();
    expect(before?.direction).toBe("desc");
  });

  test("JA: 'X以前' → type=before, direction=desc", () => {
    const anchors = extractTemporalAnchors("移行以前の設定を確認したい");
    const before = anchors.find((a) => a.type === "before");
    expect(before).toBeDefined();
    expect(before?.direction).toBe("desc");
  });

  // --- between パターン ---
  test("EN: 'between X and Y' → type=between, direction=around", () => {
    const anchors = extractTemporalAnchors("What happened between the release and the deployment?");
    const between = anchors.find((a) => a.type === "between");
    expect(between).toBeDefined();
    expect(between?.direction).toBe("around");
    expect(between?.referenceText).toContain("release");
    expect(between?.referenceText).toContain("deployment");
  });

  test("JA: 'XからYの間' → type=between, direction=around", () => {
    const anchors = extractTemporalAnchors("リリースからデプロイの間に何が起きましたか？");
    const between = anchors.find((a) => a.type === "between");
    expect(between).toBeDefined();
    expect(between?.direction).toBe("around");
  });

  // --- sequence パターン ---
  test("EN: 'first' → type=sequence, direction=asc", () => {
    const anchors = extractTemporalAnchors("What was done first?");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  test("EN: 'then/next' → type=sequence, direction=asc", () => {
    const anchors = extractTemporalAnchors("What happened next after setup?");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  test("EN: 'finally' → type=sequence, direction=asc", () => {
    const anchors = extractTemporalAnchors("What was finally deployed?");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  test("JA: '最初' → type=sequence, direction=asc", () => {
    const anchors = extractTemporalAnchors("最初に何を設定しましたか？");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  test("JA: '次に' → type=sequence, direction=asc", () => {
    const anchors = extractTemporalAnchors("次にやるべきことは？");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  test("JA: '最後' → type=sequence, direction=asc", () => {
    const anchors = extractTemporalAnchors("最後に実行したコマンドは？");
    const seq = anchors.find((a) => a.type === "sequence");
    expect(seq).toBeDefined();
    expect(seq?.direction).toBe("asc");
  });

  // --- edge cases ---
  test("empty query → no anchors", () => {
    const anchors = extractTemporalAnchors("");
    expect(anchors).toHaveLength(0);
  });

  test("non-temporal query → no anchors", () => {
    const anchors = extractTemporalAnchors("What is the authentication system?");
    expect(anchors).toHaveLength(0);
  });

  // --- routeQuery integration ---
  test("routeQuery includes temporalAnchors for timeline queries (EN 'before')", () => {
    const decision = routeQuery("What happened before the migration?");
    expect(decision.kind).toBe("timeline");
    expect(decision.temporalAnchors).toBeDefined();
    expect(decision.temporalAnchors!.length).toBeGreaterThan(0);
    const before = decision.temporalAnchors!.find((a) => a.type === "before");
    expect(before).toBeDefined();
  });

  test("routeQuery includes temporalAnchors for timeline queries (JA 'の後')", () => {
    const decision = routeQuery("リリースの後に何が起きましたか？");
    expect(decision.kind).toBe("timeline");
    expect(decision.temporalAnchors).toBeDefined();
    const after = decision.temporalAnchors!.find((a) => a.type === "after");
    expect(after).toBeDefined();
    expect(after?.direction).toBe("asc");
  });

  test("routeQuery with explicit timeline kind includes temporalAnchors", () => {
    const decision = routeQuery("What happened after the deployment?", "timeline");
    expect(decision.kind).toBe("timeline");
    expect(decision.temporalAnchors).toBeDefined();
    const after = decision.temporalAnchors!.find((a) => a.type === "after");
    expect(after).toBeDefined();
  });

  test("routeQuery non-temporal query has no temporalAnchors", () => {
    const decision = routeQuery("What is the authentication system?");
    // profile or hybrid — no temporalAnchors
    expect(decision.temporalAnchors).toBeUndefined();
  });
});
