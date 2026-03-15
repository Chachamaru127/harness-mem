/**
 * §54 S54-003: QA品質検証スクリプト
 *
 * self-eval-generator.ts が自動生成した SelfEvalCase[] の品質を機械的にチェックする。
 * 重複・スライス偏り・expected_order 異常・言語バランス・クエリ長を検証する。
 *
 * 使用方法: bun run memory-server/src/benchmark/qa-quality-check.ts <qa-json-path> [output-path]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SelfEvalCase } from "./self-eval-generator";

// ---------------------------------------------------------------------------
// 出力型定義
// ---------------------------------------------------------------------------

export interface QualityReport {
  schema_version: "qa-quality-check-v1";
  generated_at: string;
  total_cases: number;
  checks: {
    duplicates: {
      exact_query_dupes: number;
      session_slice_dupes: number;
      similar_query_pairs: number;
      details: Array<{ case_a: string; case_b: string; reason: string }>;
    };
    slice_distribution: {
      by_slice: Record<string, number>;
      max_min_ratio: number;
      warnings: string[];
    };
    expected_orders: {
      empty_order_count: number;
      invalid_id_count: number;
      uniform_order_count: number;
      details: Array<{ case_id: string; issue: string }>;
    };
    cross_lingual: {
      ja_count: number;
      en_count: number;
      ja_ratio: number;
      balanced: boolean;
    };
    query_length: {
      too_short: number;
      too_long: number;
      avg_length: number;
      details: Array<{ case_id: string; length: number; issue: string }>;
    };
  };
  passed: boolean;
  failure_reasons: string[];
}

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/** 簡易 Levenshtein 距離（短い文字列向け） */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/** 日本語文字を含むか判定 */
function isJapanese(text: string): boolean {
  return /[\u3041-\u3096\u30A1-\u30FA\u30FC\u4E00-\u9FFF]/.test(text);
}

// ---------------------------------------------------------------------------
// チェック関数
// ---------------------------------------------------------------------------

/** 1. 重複検出 */
export function checkDuplicates(cases: SelfEvalCase[]): QualityReport["checks"]["duplicates"] {
  const details: Array<{ case_a: string; case_b: string; reason: string }> = [];

  // 1a. 同一クエリ文字列の重複
  const queryMap = new Map<string, string[]>();
  for (const c of cases) {
    const key = c.query.trim();
    if (!queryMap.has(key)) queryMap.set(key, []);
    queryMap.get(key)!.push(c.id);
  }
  let exactQueryDupes = 0;
  for (const [, ids] of queryMap) {
    if (ids.length > 1) {
      exactQueryDupes += ids.length - 1;
      for (let i = 1; i < ids.length; i++) {
        details.push({ case_a: ids[0], case_b: ids[i], reason: "exact_query_duplicate" });
      }
    }
  }

  // 1b. 同一 session_id + slice の組み合わせ重複
  const sessionSliceMap = new Map<string, string[]>();
  for (const c of cases) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slice = (c as any).slice ?? c.query_template;
    const key = `${c.session_id}::${slice}`;
    if (!sessionSliceMap.has(key)) sessionSliceMap.set(key, []);
    sessionSliceMap.get(key)!.push(c.id);
  }
  let sessionSliceDupes = 0;
  for (const [, ids] of sessionSliceMap) {
    if (ids.length > 1) {
      sessionSliceDupes += ids.length - 1;
      for (let i = 1; i < ids.length; i++) {
        details.push({ case_a: ids[0], case_b: ids[i], reason: "session_slice_duplicate" });
      }
    }
  }

  // 1c. 類似クエリペア（Levenshtein距離が短い or query prefix が一致）
  let similarQueryPairs = 0;
  const caseList = cases.map((c) => ({ id: c.id, query: c.query.trim() }));
  for (let i = 0; i < caseList.length; i++) {
    for (let j = i + 1; j < caseList.length; j++) {
      const a = caseList[i].query;
      const b = caseList[j].query;
      // 既に完全一致として検出済みならスキップ
      if (a === b) continue;
      // prefix 一致チェック（最初の30文字が同じ）
      const prefixLen = 30;
      if (a.length >= prefixLen && b.length >= prefixLen && a.slice(0, prefixLen) === b.slice(0, prefixLen)) {
        similarQueryPairs++;
        details.push({ case_a: caseList[i].id, case_b: caseList[j].id, reason: "similar_query_prefix" });
        continue;
      }
      // Levenshtein 距離チェック（短い文字列のみ: 100文字以内）
      const maxLen = Math.max(a.length, b.length);
      if (maxLen <= 100) {
        const dist = levenshtein(a, b);
        if (dist <= 5) {
          similarQueryPairs++;
          details.push({ case_a: caseList[i].id, case_b: caseList[j].id, reason: `similar_query_levenshtein_${dist}` });
        }
      }
    }
  }

  return {
    exact_query_dupes: exactQueryDupes,
    session_slice_dupes: sessionSliceDupes,
    similar_query_pairs: similarQueryPairs,
    details,
  };
}

/** 2. スライス分布の偏り検出 */
export function checkSliceDistribution(cases: SelfEvalCase[]): QualityReport["checks"]["slice_distribution"] {
  const bySlice: Record<string, number> = {};
  for (const c of cases) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slice = (c as any).slice ?? c.query_template;
    bySlice[slice] = (bySlice[slice] ?? 0) + 1;
  }

  const counts = Object.values(bySlice);
  const warnings: string[] = [];
  let maxMinRatio = 0;

  if (counts.length >= 2) {
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);
    if (minCount > 0) {
      maxMinRatio = maxCount / minCount;
      if (maxMinRatio > 5) {
        warnings.push(
          `Slice distribution is heavily skewed: max/min ratio = ${maxMinRatio.toFixed(2)} (threshold: 5.0)`
        );
      }
    } else {
      maxMinRatio = Infinity;
      warnings.push("Some slices have 0 cases");
    }
  }

  // 目標問数との乖離チェック（全スライス均等配分を理想とする）
  if (counts.length > 0 && cases.length > 0) {
    const idealPerSlice = cases.length / counts.length;
    for (const [slice, count] of Object.entries(bySlice)) {
      const deviation = Math.abs(count - idealPerSlice) / idealPerSlice;
      if (deviation > 0.5) {
        warnings.push(
          `Slice "${slice}" deviates ${(deviation * 100).toFixed(0)}% from ideal (${count} vs ${idealPerSlice.toFixed(1)})`
        );
      }
    }
  }

  return { by_slice: bySlice, max_min_ratio: maxMinRatio, warnings };
}

/** 3. Answer/Expected Order の異常検出 */
export function checkExpectedOrders(cases: SelfEvalCase[]): QualityReport["checks"]["expected_orders"] {
  const details: Array<{ case_id: string; issue: string }> = [];
  let emptyOrderCount = 0;
  let invalidIdCount = 0;

  for (const c of cases) {
    // 3a. expected_order が空配列
    if (c.expected_order.length === 0) {
      emptyOrderCount++;
      details.push({ case_id: c.id, issue: "empty_expected_order" });
    } else {
      // 3b. expected_order の ID が entries に存在しない
      const entryIds = new Set(c.entries.map((e) => e.id));
      for (const orderId of c.expected_order) {
        if (!entryIds.has(orderId)) {
          invalidIdCount++;
          details.push({ case_id: c.id, issue: `expected_order_id_not_in_entries: ${orderId}` });
        }
      }
    }
  }

  // 3c. 全ケースで同一の expected_order になっている
  let uniformOrderCount = 0;
  if (cases.length > 1) {
    const orderSignatures = cases.map((c) => JSON.stringify(c.expected_order));
    const signatureSet = new Set(orderSignatures);
    if (signatureSet.size === 1) {
      uniformOrderCount = cases.length;
      details.push({ case_id: "all", issue: "all_cases_have_identical_expected_order" });
    }
  }

  return { empty_order_count: emptyOrderCount, invalid_id_count: invalidIdCount, uniform_order_count: uniformOrderCount, details };
}

/** 4. クロスリンガルバランス検証 */
export function checkCrossLingual(cases: SelfEvalCase[]): QualityReport["checks"]["cross_lingual"] {
  let jaCount = 0;
  let enCount = 0;

  for (const c of cases) {
    if (isJapanese(c.query)) {
      jaCount++;
    } else {
      enCount++;
    }
  }

  const total = cases.length;
  const jaRatio = total > 0 ? jaCount / total : 0;
  // 理想は 40%〜60% の範囲
  const balanced = total === 0 || (jaRatio >= 0.4 && jaRatio <= 0.6);

  return { ja_count: jaCount, en_count: enCount, ja_ratio: jaRatio, balanced };
}

/** 5. クエリ長の異常検出 */
export function checkQueryLength(cases: SelfEvalCase[]): QualityReport["checks"]["query_length"] {
  const details: Array<{ case_id: string; length: number; issue: string }> = [];
  let tooShort = 0;
  let tooLong = 0;
  let totalLength = 0;

  for (const c of cases) {
    const len = c.query.length;
    totalLength += len;
    if (len < 10) {
      tooShort++;
      details.push({ case_id: c.id, length: len, issue: "query_too_short" });
    } else if (len > 500) {
      tooLong++;
      details.push({ case_id: c.id, length: len, issue: "query_too_long" });
    }
  }

  const avgLength = cases.length > 0 ? totalLength / cases.length : 0;

  return { too_short: tooShort, too_long: tooLong, avg_length: avgLength, details };
}

// ---------------------------------------------------------------------------
// メインのチェック実行
// ---------------------------------------------------------------------------

/**
 * SelfEvalCase[] の品質チェックを実行して QualityReport を返す。
 */
export function runQualityCheck(cases: SelfEvalCase[]): QualityReport {
  const duplicates = checkDuplicates(cases);
  const sliceDistribution = checkSliceDistribution(cases);
  const expectedOrders = checkExpectedOrders(cases);
  const crossLingual = checkCrossLingual(cases);
  const queryLength = checkQueryLength(cases);

  const failureReasons: string[] = [];

  if (duplicates.exact_query_dupes > 0) {
    failureReasons.push(`${duplicates.exact_query_dupes} exact query duplicate(s) detected`);
  }
  if (duplicates.session_slice_dupes > 0) {
    failureReasons.push(`${duplicates.session_slice_dupes} session+slice duplicate(s) detected`);
  }
  if (sliceDistribution.max_min_ratio > 5) {
    failureReasons.push(`Slice distribution skew ratio ${sliceDistribution.max_min_ratio.toFixed(2)} exceeds threshold 5.0`);
  }
  if (expectedOrders.empty_order_count > 0) {
    failureReasons.push(`${expectedOrders.empty_order_count} case(s) have empty expected_order`);
  }
  if (expectedOrders.invalid_id_count > 0) {
    failureReasons.push(`${expectedOrders.invalid_id_count} invalid ID(s) in expected_order`);
  }
  if (expectedOrders.uniform_order_count > 0 && cases.length > 1) {
    failureReasons.push("All cases share identical expected_order (possible generation bug)");
  }
  if (!crossLingual.balanced && cases.length > 0) {
    const pct = (crossLingual.ja_ratio * 100).toFixed(1);
    failureReasons.push(`Cross-lingual balance off: ja_ratio=${pct}% (expected 40%–60%)`);
  }
  if (queryLength.too_short > 0) {
    failureReasons.push(`${queryLength.too_short} query(ies) are too short (<10 chars)`);
  }
  if (queryLength.too_long > 0) {
    failureReasons.push(`${queryLength.too_long} query(ies) are too long (>500 chars)`);
  }

  return {
    schema_version: "qa-quality-check-v1",
    generated_at: new Date().toISOString(),
    total_cases: cases.length,
    checks: {
      duplicates,
      slice_distribution: sliceDistribution,
      expected_orders: expectedOrders,
      cross_lingual: crossLingual,
      query_length: queryLength,
    },
    passed: failureReasons.length === 0,
    failure_reasons: failureReasons,
  };
}

// ---------------------------------------------------------------------------
// CLI エントリポイント
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath) {
    console.error("Usage: bun qa-quality-check.ts <qa-json-path> [output-path]");
    process.exit(1);
  }

  const resolved = resolve(inputPath);
  const raw = readFileSync(resolved, "utf8");
  const cases: SelfEvalCase[] = JSON.parse(raw);

  console.log(`[qa-quality-check] Loaded ${cases.length} cases from ${resolved}`);

  const report = runQualityCheck(cases);

  if (report.passed) {
    console.log("[qa-quality-check] All checks PASSED");
  } else {
    console.warn("[qa-quality-check] FAILED:");
    for (const reason of report.failure_reasons) {
      console.warn(`  - ${reason}`);
    }
  }

  const reportJson = JSON.stringify(report, null, 2);

  if (outputPath) {
    const out = resolve(outputPath);
    writeFileSync(out, reportJson);
    console.log(`[qa-quality-check] Report written to ${out}`);
  } else {
    console.log(reportJson);
  }

  process.exit(report.passed ? 0 : 1);
}
