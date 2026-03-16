/**
 * §54 S54-008: QA Fixture 統合スクリプト
 *
 * 既存の japanese-release-pack-96.json（LoCoMo形式）と
 * japanese-coding-session-self-eval-300.json（SelfEvalCase形式）を
 * 統一形式に変換して統合する。
 *
 * 使用方法: bun run fixture-integrator.ts [--output path]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// --- 統一 QA 形式 ---
export interface UnifiedQA {
  question_id: string;
  question: string;
  answer: string;         // LoCoMo: answer 文字列, SelfEval: entries の content 先頭を結合
  category: string;       // "cat-1" | "cat-2" | "cat-3" | "cat-4"
  slice: string;
  cross_lingual: boolean;
  source: "release-pack-96" | "self-eval-300" | "llm-generated";
  session_id?: string;
}

export interface IntegratedFixture {
  schema_version: "integrated-fixture-v1";
  generated_at: string;
  sources: Array<{ name: string; count: number; path: string }>;
  total_count: number;
  by_slice: Record<string, number>;
  by_source: Record<string, number>;
  by_category: Record<string, number>;
  items: UnifiedQA[];
}

// --- LoCoMo 形式の型 ---
interface LocomoSample {
  sample_id: string;
  conversation: Array<{ speaker: string; text: string }>;
  qa: Array<{
    question_id: string;
    question: string;
    answer: string;
    category: string;
    slice: string;
    cross_lingual?: boolean;
  }>;
}

// --- SelfEvalCase 形式の型 ---
interface SelfEvalCase {
  id: string;
  session_id: string;
  query: string;
  query_template: string;
  slice: string;
  entries: Array<{ id: string; content: string; created_at: string; session_id: string }>;
  expected_order: string[];
  generated_at: string;
}

/** LoCoMo QA → UnifiedQA */
export function convertLocomoQA(sample: LocomoSample): UnifiedQA[] {
  return sample.qa.map(qa => ({
    question_id: qa.question_id,
    question: qa.question,
    answer: qa.answer,
    category: qa.category,
    slice: qa.slice,
    cross_lingual: qa.cross_lingual ?? false,
    source: "release-pack-96" as const,
  }));
}

/** SelfEvalCase → UnifiedQA */
export function convertSelfEvalQA(c: SelfEvalCase): UnifiedQA {
  // answer: entries の先頭の content を結合（最大200文字）
  const answer = c.entries.slice(0, 3).map(e => e.content).join("; ").slice(0, 200);

  // slice → category マッピング
  const sliceToCat: Record<string, string> = {
    "temporal-order": "cat-4",
    "tool-recall": "cat-1",
    "error-resolution": "cat-3",
    "decision-why": "cat-3",
    "file-change": "cat-1",
    "cross-client": "cat-2",
    "session-summary": "cat-2",
    "noisy-ja": "cat-1",
    "cross-lingual": "cat-1",
    "dependency": "cat-1",
  };

  // 日本語判定
  const isJa = /[\u3041-\u3096\u30A1-\u30FA\u30FC\u4E00-\u9FFF]/.test(c.query);
  // cross_lingual: クエリの言語と entries の言語が異なる場合
  const entryIsJa = c.entries.some(e => /[\u3041-\u3096\u30A1-\u30FA\u30FC\u4E00-\u9FFF]/.test(e.content));
  const crossLingual = isJa !== entryIsJa;

  return {
    question_id: c.id,
    question: c.query,
    answer,
    category: sliceToCat[c.slice] ?? "cat-1",
    slice: c.slice,
    cross_lingual: c.slice === "cross-lingual" || crossLingual,
    source: "self-eval-300" as const,
    session_id: c.session_id,
  };
}

/** LLM 生成 QA → UnifiedQA */
export function convertLlmGeneratedQA(qa: { question_id: string; question: string; answer: string; slice: string; cross_lingual: boolean; session_id: string }): UnifiedQA {
  const sliceToCat: Record<string, string> = {
    "temporal-order": "cat-4", "tool-recall": "cat-1", "error-resolution": "cat-3",
    "decision-why": "cat-3", "file-change": "cat-1", "cross-client": "cat-2",
    "session-summary": "cat-2", "noisy-ja": "cat-1", "cross-lingual": "cat-1", "dependency": "cat-1",
  };
  return {
    question_id: qa.question_id,
    question: qa.question,
    answer: qa.answer,
    category: sliceToCat[qa.slice] ?? "cat-1",
    slice: qa.slice,
    cross_lingual: qa.cross_lingual,
    source: "llm-generated",
    session_id: qa.session_id,
  };
}

/** メイン統合関数 */
export function integrateFixtures(
  locomoPath: string,
  selfEvalPath: string,
  llmGeneratedPath?: string,
): IntegratedFixture {
  const items: UnifiedQA[] = [];
  const sources: IntegratedFixture["sources"] = [];

  // 1. LoCoMo 96問
  if (existsSync(locomoPath)) {
    const locomoData: LocomoSample[] = JSON.parse(readFileSync(locomoPath, "utf8"));
    for (const sample of locomoData) {
      items.push(...convertLocomoQA(sample));
    }
    sources.push({ name: "release-pack-96", count: items.length, path: locomoPath });
  }

  // 2. SelfEval 300問
  const selfEvalStart = items.length;
  if (existsSync(selfEvalPath)) {
    const selfEvalData: SelfEvalCase[] = JSON.parse(readFileSync(selfEvalPath, "utf8"));
    for (const c of selfEvalData) {
      items.push(convertSelfEvalQA(c));
    }
    sources.push({ name: "self-eval-300", count: items.length - selfEvalStart, path: selfEvalPath });
  }

  // 3. LLM 生成 QA（オプション）
  if (llmGeneratedPath && existsSync(llmGeneratedPath)) {
    const llmStart = items.length;
    const llmData = JSON.parse(readFileSync(llmGeneratedPath, "utf8")) as Array<{ question_id: string; question: string; answer: string; slice: string; cross_lingual: boolean; session_id: string }>;
    for (const qa of llmData) {
      items.push(convertLlmGeneratedQA(qa));
    }
    sources.push({ name: "llm-generated", count: items.length - llmStart, path: llmGeneratedPath });
  }

  // 集計
  const bySlice: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const item of items) {
    bySlice[item.slice] = (bySlice[item.slice] ?? 0) + 1;
    bySource[item.source] = (bySource[item.source] ?? 0) + 1;
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
  }

  return {
    schema_version: "integrated-fixture-v1",
    generated_at: new Date().toISOString(),
    sources,
    total_count: items.length,
    by_slice: bySlice,
    by_source: bySource,
    by_category: byCategory,
    items,
  };
}

// CLI
if (import.meta.main) {
  const FIXTURES_DIR = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures");
  const locomoPath = join(FIXTURES_DIR, "japanese-release-pack-96.json");
  const selfEvalPath = join(FIXTURES_DIR, "japanese-coding-session-self-eval-300.json");
  const llmPath = join(FIXTURES_DIR, "japanese-llm-generated-147.json");

  const outputArg = process.argv.indexOf("--output");
  const outputPath = outputArg >= 0 && process.argv[outputArg + 1]
    ? resolve(process.argv[outputArg + 1])
    : join(FIXTURES_DIR, "japanese-integrated-benchmark.json");

  console.log(`[fixture-integrator] LoCoMo: ${locomoPath}`);
  console.log(`[fixture-integrator] SelfEval: ${selfEvalPath}`);
  console.log(`[fixture-integrator] LLM Generated: ${llmPath}`);

  const result = integrateFixtures(locomoPath, selfEvalPath, llmPath);

  console.log(`[fixture-integrator] Total: ${result.total_count} QA items`);
  console.log(`[fixture-integrator] By source:`);
  for (const [src, cnt] of Object.entries(result.by_source)) {
    console.log(`  ${src}: ${cnt}`);
  }
  console.log(`[fixture-integrator] By slice:`);
  for (const [slice, cnt] of Object.entries(result.by_slice).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slice}: ${cnt}`);
  }

  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`[fixture-integrator] Written to ${outputPath}`);

  // 500問以上かチェック
  if (result.total_count >= 500) {
    console.log(`[fixture-integrator] PASS: ${result.total_count} >= 500`);
  } else {
    console.log(`[fixture-integrator] NOTE: ${result.total_count} < 500 (LLM generation needed to reach target)`);
  }
}
