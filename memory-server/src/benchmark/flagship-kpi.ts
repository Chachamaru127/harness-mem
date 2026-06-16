/**
 * S154-304: flagship KPI display promotion (spec.md "North Star And Flagship
 * Metric"). Bilingual Coding-Memory Freshness@k is the flagship metric; its
 * measured source today is the knowledge-update benchmark's freshness@10
 * (CIRunManifest results.freshness).
 *
 * The green threshold is a release-gate constant fixed from measured evidence
 * (manifest 0.99, README claim bar >= 0.95, layer-1 floor 0.90 — Why in
 * decisions.md D39). This module is display/threshold only: enforcement
 * (process-exit gating) is S154-305 scope and must not live here.
 */

export const FLAGSHIP_KPI_NAME = "bilingual_coding_memory_freshness_at_k";
export const FLAGSHIP_KPI_LABEL = "Bilingual Coding-Memory Freshness@k";
export const FLAGSHIP_FRESHNESS_GREEN_THRESHOLD = 0.95;
/** Self-seeded relative metric — implementation health, not competitor superiority (spec.md). */
export const FLAGSHIP_KPI_SCOPE_NOTE =
  "self-seeded relative metric; not a superiority claim over competitors";

export interface FlagshipKpi {
  name: typeof FLAGSHIP_KPI_NAME;
  label: string;
  value: number;
  green_threshold: number;
  green: boolean;
  measured_by: string;
  /** spec.md "Shallow vs deep freshness": this value is the shallow metric. */
  depth: "shallow";
  scope_note: string;
}

export function buildFlagshipKpi(freshnessAtK: number): FlagshipKpi {
  return {
    name: FLAGSHIP_KPI_NAME,
    label: FLAGSHIP_KPI_LABEL,
    value: freshnessAtK,
    green_threshold: FLAGSHIP_FRESHNESS_GREEN_THRESHOLD,
    green: freshnessAtK >= FLAGSHIP_FRESHNESS_GREEN_THRESHOLD,
    measured_by: "knowledge-update freshness@10 (memory-server/src/benchmark/run-ci.ts)",
    depth: "shallow",
    scope_note: FLAGSHIP_KPI_SCOPE_NOTE,
  };
}

// --------------------------------------------------------------------------
// S154-310: deep freshness sub-block (report-only, depth:"deep")
// IMPORTANT: does NOT affect `depth: "shallow"` on FlagshipKpi (D39 preserved).
// --------------------------------------------------------------------------

import type { FreshnessLagResult, SupersessionResult, TenseRewriteResult } from "./deep-freshness-bench.js";

export interface DeepFreshnessSubBlock {
  /** Distinguishes this from the shallow flagship metric. */
  depth: "deep";
  /** report-only: does not gate the release pipeline. */
  report_only: true;
  tense_rewrite: TenseRewriteResult;
  supersession: SupersessionResult;
  freshness_lag: FreshnessLagResult;
  measured_by: "scripts/s154-deep-freshness-bench.ts";
}

export function buildDeepFreshnessSubBlock(params: {
  tense_rewrite: TenseRewriteResult;
  supersession: SupersessionResult;
  freshness_lag: FreshnessLagResult;
}): DeepFreshnessSubBlock {
  return {
    depth: "deep",
    report_only: true,
    tense_rewrite: params.tense_rewrite,
    supersession: params.supersession,
    freshness_lag: params.freshness_lag,
    measured_by: "scripts/s154-deep-freshness-bench.ts",
  };
}
