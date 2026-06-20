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
// S154-FU02: gate judgment added. Thresholds are consumed from
// data/deep-freshness-thresholds.json (gate_consumer_contract).
// --------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FreshnessLagResult, SupersessionResult, TenseRewriteResult } from "./deep-freshness-bench.js";

const THRESHOLDS_CONFIG_PATH = resolve(
  import.meta.dir,
  "../../../data/deep-freshness-thresholds.json",
);
const THRESHOLDS_SOURCE_RELPATH = "data/deep-freshness-thresholds.json";

interface DeepFreshnessThresholds {
  gate_consumer_contract: {
    enforce_metrics: string[];
    warn_only_metrics: string[];
    green_definition: string;
    lag_handling: string;
  };
  thresholds: {
    tense_rewrite: {
      gate_mode: string;
      accuracy_min: number;
      fp_rate_max: number;
    };
    supersession: {
      gate_mode: string;
      precision_min: number;
      recall_min: number;
      f1_min: number;
    };
    freshness_lag: {
      gate_mode: string;
      p50_ms_ceiling: number;
      p95_ms_ceiling: number;
    };
  };
}

function loadThresholds(): DeepFreshnessThresholds {
  const raw = readFileSync(THRESHOLDS_CONFIG_PATH, "utf8");
  return JSON.parse(raw) as DeepFreshnessThresholds;
}

export type DeepFreshnessGateVerdict = "green" | "yellow" | "red";

export interface DeepFreshnessGateDetail {
  shallow_ok: boolean;
  tense_rewrite_ok: boolean | null;
  supersession_ok: boolean | null;
}

export interface DeepFreshnessSubBlock {
  /** Distinguishes this from the shallow flagship metric. */
  depth: "deep";
  /** report-only: does not gate the release pipeline. */
  report_only: true;
  tense_rewrite: TenseRewriteResult;
  supersession: SupersessionResult;
  freshness_lag: FreshnessLagResult;
  measured_by: "scripts/s154-deep-freshness-bench.ts";
  /** S154-FU02: composite gate verdict derived from gate_consumer_contract. */
  gate_verdict: DeepFreshnessGateVerdict;
  gate_detail: DeepFreshnessGateDetail;
  /** true when freshness_lag exceeds warn-only ceiling (does NOT affect gate_verdict). */
  lag_warn: boolean;
  /** Path to the config file that defines the thresholds consumed here. */
  thresholds_source: string;
}

export function buildDeepFreshnessSubBlock(params: {
  tense_rewrite: TenseRewriteResult;
  supersession: SupersessionResult;
  freshness_lag: FreshnessLagResult;
  /** shallow Freshness@k value (from FlagshipKpi). Required for green gate evaluation. */
  shallow_freshness: number;
}): DeepFreshnessSubBlock {
  const cfg = loadThresholds();
  const tr = cfg.thresholds.tense_rewrite;
  const sup = cfg.thresholds.supersession;
  const lag = cfg.thresholds.freshness_lag;

  const shallowOk = params.shallow_freshness >= FLAGSHIP_FRESHNESS_GREEN_THRESHOLD;

  // enforce_metrics gate — skipped metrics → yellow (indeterminate), failed → red
  let tenseRewriteOk: boolean | null = null;
  if (params.tense_rewrite.status === "measured") {
    tenseRewriteOk =
      params.tense_rewrite.accuracy >= tr.accuracy_min &&
      params.tense_rewrite.false_positive_rate <= tr.fp_rate_max;
  }

  let supersessionOk: boolean | null = null;
  if (params.supersession.status === "measured") {
    supersessionOk =
      params.supersession.precision >= sup.precision_min &&
      params.supersession.recall >= sup.recall_min &&
      params.supersession.f1 >= sup.f1_min;
  }

  // Verdict logic per gate_consumer_contract.green_definition:
  //   green = shallow >= 0.95 AND enforce_metrics ALL PASS
  //   yellow = any enforce metric skipped (indeterminate)
  //   red = shallow fail OR any enforce metric explicitly failed
  let gateVerdict: DeepFreshnessGateVerdict;
  if (!shallowOk || tenseRewriteOk === false || supersessionOk === false) {
    gateVerdict = "red";
  } else if (tenseRewriteOk === null || supersessionOk === null) {
    gateVerdict = "yellow";
  } else {
    gateVerdict = "green";
  }

  // warn-only lag check — does NOT participate in gate_verdict
  let lagWarn = false;
  if (params.freshness_lag.status === "measured") {
    lagWarn =
      params.freshness_lag.p50_ms > lag.p50_ms_ceiling ||
      params.freshness_lag.p95_ms > lag.p95_ms_ceiling;
  }

  return {
    depth: "deep",
    report_only: true,
    tense_rewrite: params.tense_rewrite,
    supersession: params.supersession,
    freshness_lag: params.freshness_lag,
    measured_by: "scripts/s154-deep-freshness-bench.ts",
    gate_verdict: gateVerdict,
    gate_detail: {
      shallow_ok: shallowOk,
      tense_rewrite_ok: tenseRewriteOk,
      supersession_ok: supersessionOk,
    },
    lag_warn: lagWarn,
    thresholds_source: THRESHOLDS_SOURCE_RELPATH,
  };
}
