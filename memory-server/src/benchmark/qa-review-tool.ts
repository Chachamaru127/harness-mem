/**
 * §54 S54-007: QA レビューツール（自動品質フィルタ）
 *
 * LLM 生成 QA に自動品質フィルタをかけ、verified フラグを付与する。
 *
 * 使用方法: bun run qa-review-tool.ts <input.json> [output.json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface GeneratedQA {
  question_id: string;
  question: string;
  answer: string;
  slice: string;
  cross_lingual: boolean;
  source_observation_ids: string[];
  session_id: string;
  platform: string;
  project: string;
  generated_at: string;
  verified: boolean;
}

export interface ReviewResult {
  qa: GeneratedQA;
  passed: boolean;
  issues: string[];
}

export interface ReviewReport {
  schema_version: "qa-review-v1";
  generated_at: string;
  total_input: number;
  total_passed: number;
  total_rejected: number;
  pass_rate: number;
  by_slice: Record<string, { passed: number; rejected: number }>;
  issues_summary: Record<string, number>;
  results: ReviewResult[];
}

const VALID_SLICES = [
  "temporal-order",
  "tool-recall",
  "error-resolution",
  "decision-why",
  "file-change",
  "cross-client",
  "session-summary",
  "noisy-ja",
  "cross-lingual",
  "dependency",
  "config-diff",
];

export function reviewSingleQA(qa: GeneratedQA): ReviewResult {
  const issues: string[] = [];

  // 1. answer チェック
  if (!qa.answer || qa.answer.trim().length === 0) {
    issues.push("empty_answer");
  } else if (qa.answer.trim().length < 5) {
    issues.push("answer_too_short");
  } else if (qa.answer.trim().length > 300) {
    issues.push("answer_too_long");
  }

  // 2. question チェック
  if (!qa.question || qa.question.trim().length === 0) {
    issues.push("empty_question");
  } else if (qa.question.trim().length < 10) {
    issues.push("question_too_short");
  } else if (qa.question.trim().length > 200) {
    issues.push("question_too_long");
  }

  // 3. slice 有効性
  if (!VALID_SLICES.includes(qa.slice)) {
    issues.push(`invalid_slice: ${qa.slice}`);
  }

  // 4. source_observation_ids
  if (!qa.source_observation_ids || qa.source_observation_ids.length === 0) {
    issues.push("empty_source_observations");
  }

  // 5. question_id 形式
  if (!qa.question_id || qa.question_id.trim().length === 0) {
    issues.push("empty_question_id");
  }

  return {
    qa: { ...qa, verified: issues.length === 0 },
    passed: issues.length === 0,
    issues,
  };
}

export function reviewBatch(qas: GeneratedQA[]): ReviewReport {
  const results: ReviewResult[] = [];
  const seenQuestions = new Set<string>();

  for (const qa of qas) {
    const result = reviewSingleQA(qa);

    // 重複チェック
    const qKey = qa.question.trim().toLowerCase();
    if (seenQuestions.has(qKey)) {
      result.issues.push("duplicate_question");
      result.passed = false;
      result.qa.verified = false;
    }
    seenQuestions.add(qKey);

    results.push(result);
  }

  const totalPassed = results.filter((r) => r.passed).length;
  const totalRejected = results.length - totalPassed;

  // by_slice 集計
  const bySlice: Record<string, { passed: number; rejected: number }> = {};
  for (const r of results) {
    const s = r.qa.slice;
    if (!bySlice[s]) bySlice[s] = { passed: 0, rejected: 0 };
    if (r.passed) bySlice[s].passed++;
    else bySlice[s].rejected++;
  }

  // issues_summary
  const issuesSummary: Record<string, number> = {};
  for (const r of results) {
    for (const issue of r.issues) {
      const key = issue.startsWith("invalid_slice") ? "invalid_slice" : issue;
      issuesSummary[key] = (issuesSummary[key] ?? 0) + 1;
    }
  }

  return {
    schema_version: "qa-review-v1",
    generated_at: new Date().toISOString(),
    total_input: qas.length,
    total_passed: totalPassed,
    total_rejected: totalRejected,
    pass_rate: qas.length > 0 ? totalPassed / qas.length : 0,
    by_slice: bySlice,
    issues_summary: issuesSummary,
    results,
  };
}

/** verified=true の QA のみ抽出して返す */
export function extractVerified(report: ReviewReport): GeneratedQA[] {
  return report.results.filter((r) => r.passed).map((r) => r.qa);
}

// CLI
if (import.meta.main) {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath) {
    console.error("Usage: bun qa-review-tool.ts <input.json> [output.json]");
    process.exit(1);
  }

  const raw = readFileSync(resolve(inputPath), "utf8");
  const qas: GeneratedQA[] = JSON.parse(raw);

  console.log(`[qa-review] Loaded ${qas.length} QA pairs`);

  const report = reviewBatch(qas);

  console.log(
    `[qa-review] Passed: ${report.total_passed}/${report.total_input} (${(report.pass_rate * 100).toFixed(1)}%)`
  );
  console.log(`[qa-review] Issues:`);
  for (const [issue, count] of Object.entries(report.issues_summary)) {
    console.log(`  ${issue}: ${count}`);
  }

  if (outputPath) {
    const verified = extractVerified(report);
    writeFileSync(resolve(outputPath), JSON.stringify(verified, null, 2));
    console.log(
      `[qa-review] Verified QA written to ${outputPath} (${verified.length} items)`
    );
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  // pass_rate < 50% なら exit 1
  process.exit(report.pass_rate >= 0.5 ? 0 : 1);
}
