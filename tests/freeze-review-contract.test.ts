/**
 * freeze-review-contract.test.ts
 *
 * Freeze review の契約:
 * - 提出物4JSON不足で fail
 * - 必須ゲート（漏えい0/境界漏れ0/継続率>=95%/1コマンド導入）で run 判定
 * - 3-run 連続 pass 条件
 * - freeze-report.json の互換キー維持
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FREEZE_REVIEW_SCRIPT = resolve(import.meta.dir, "../scripts/freeze-review.sh");

describe("freeze-review contract", () => {
  test("freeze-review.sh exists", () => {
    const stat = Bun.file(FREEZE_REVIEW_SCRIPT);
    expect(stat.size).toBeGreaterThan(0);
  });

  test("jq prerequisite check exists", () => {
    const script = readFileSync(FREEZE_REVIEW_SCRIPT, "utf-8");
    expect(script).toContain("jq is required but not found");
  });

  test("requires 4 submission JSON artifacts per run", () => {
    const script = readFileSync(FREEZE_REVIEW_SCRIPT, "utf-8");
    expect(script).toContain("onboarding-report.json");
    expect(script).toContain("continuity-report.json");
    expect(script).toContain("privacy-boundary-report.json");
    expect(script).toContain("session-selfcheck-report.json");
    expect(script).toContain("missing_reports");
    expect(script).toContain("REPORTS_ALL_PRESENT");
  });

  test("mandatory gates are encoded in run decision", () => {
    const script = readFileSync(FREEZE_REVIEW_SCRIPT, "utf-8");
    expect(script).toContain("PRIVACY_LEAK_COUNT");
    expect(script).toContain("BOUNDARY_LEAK_COUNT");
    expect(script).toContain("CONTINUITY_RATE");
    expect(script).toContain("rate >= 95");
    expect(script).toContain("ONBOARDING_ONE_COMMAND");
    expect(script).toContain('MANDATORY_PASS="false"');
    expect(script).toContain('RUN_PASS_BOOL="false"');
  });

  test("3-run consecutive pass gate exists", () => {
    const script = readFileSync(FREEZE_REVIEW_SCRIPT, "utf-8");
    expect(script).toContain("MAX_CONSECUTIVE_STREAK");
    expect(script).toContain("THREE_RUN_CONSECUTIVE_PASS");
    expect(script).toContain("3-run consecutive pass");
  });

  test("freeze-report keeps compatibility keys and extends run details", () => {
    const script = readFileSync(FREEZE_REVIEW_SCRIPT, "utf-8");
    expect(script).toContain("backend_mode");
    expect(script).toContain("runs");
    expect(script).toContain("reproducibility");
    expect(script).toContain("frozen_at");
    expect(script).toContain("comment");
    expect(script).toContain("mandatory_gate");
    expect(script).toContain("required_reports");
  });
});
