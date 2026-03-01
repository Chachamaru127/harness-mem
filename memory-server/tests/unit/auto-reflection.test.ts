/**
 * COMP-013: 自動リフレクション のテスト
 *
 * 矛盾ファクトを検出し、古いファクトを superseded_by で解消することを検証する。
 */
import { describe, expect, test } from "bun:test";
import {
  detectConflictingFacts,
  resolveConflicts,
  type FactConflict,
} from "../../src/consolidation/auto-reflection";
import type { ConsolidationFact } from "../../src/consolidation/deduper";

function makeFact(overrides: Partial<ConsolidationFact> & { fact_id: string; fact_key: string; fact_value: string }): ConsolidationFact {
  return {
    project: "test",
    session_id: "s1",
    fact_type: "preference",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("COMP-013: 自動リフレクション", () => {
  test("同一 fact_key で異なる fact_value を持つファクトは矛盾として検出される", () => {
    const facts: ConsolidationFact[] = [
      makeFact({ fact_id: "f1", fact_key: "language", fact_value: "TypeScript", created_at: "2026-01-01T00:00:00Z" }),
      makeFact({ fact_id: "f2", fact_key: "language", fact_value: "Python", created_at: "2026-01-02T00:00:00Z" }),
    ];
    const conflicts = detectConflictingFacts(facts);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].older_fact_id).toBe("f1");
    expect(conflicts[0].newer_fact_id).toBe("f2");
  });

  test("同一 fact_key で同一 fact_value のファクトは矛盾にならない", () => {
    const facts: ConsolidationFact[] = [
      makeFact({ fact_id: "f1", fact_key: "language", fact_value: "TypeScript", created_at: "2026-01-01T00:00:00Z" }),
      makeFact({ fact_id: "f2", fact_key: "language", fact_value: "TypeScript", created_at: "2026-01-02T00:00:00Z" }),
    ];
    const conflicts = detectConflictingFacts(facts);
    expect(conflicts).toHaveLength(0);
  });

  test("異なる fact_key のファクトは矛盾にならない", () => {
    const facts: ConsolidationFact[] = [
      makeFact({ fact_id: "f1", fact_key: "language", fact_value: "TypeScript" }),
      makeFact({ fact_id: "f2", fact_key: "framework", fact_value: "React" }),
    ];
    const conflicts = detectConflictingFacts(facts);
    expect(conflicts).toHaveLength(0);
  });

  test("resolveConflicts は古いファクトを superseded_by でマークする", () => {
    const conflicts: FactConflict[] = [
      { older_fact_id: "f1", newer_fact_id: "f2", fact_key: "language" },
    ];
    const decisions = resolveConflicts(conflicts);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].fact_id).toBe("f1");
    expect(decisions[0].superseded_by).toBe("f2");
  });

  test("3つのファクトがある場合、最新以外が全て superseded になる", () => {
    const facts: ConsolidationFact[] = [
      makeFact({ fact_id: "f1", fact_key: "lang", fact_value: "A", created_at: "2026-01-01T00:00:00Z" }),
      makeFact({ fact_id: "f2", fact_key: "lang", fact_value: "B", created_at: "2026-01-02T00:00:00Z" }),
      makeFact({ fact_id: "f3", fact_key: "lang", fact_value: "C", created_at: "2026-01-03T00:00:00Z" }),
    ];
    const conflicts = detectConflictingFacts(facts);
    const decisions = resolveConflicts(conflicts);
    // f1→f2 (または f1→f3)、f2→f3 のように最終的に f1,f2 が superseded
    const supersededIds = decisions.map(d => d.fact_id);
    expect(supersededIds).toContain("f1");
    expect(supersededIds).toContain("f2");
    expect(supersededIds).not.toContain("f3");
  });
});
