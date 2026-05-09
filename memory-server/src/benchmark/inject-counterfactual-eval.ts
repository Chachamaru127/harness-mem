/**
 * §S109-005 — counterfactual eval harness (weekly batch).
 *
 * Runs the DEFAULT_SMOKE_FIXTURE through two paths:
 *   - with_inject:    envelope is created and persisted, then detectConsumed
 *                     is run against the fixture's synthetic next-turn artifact.
 *   - without_inject: a "ghost envelope" with empty signals[] is used instead.
 *                     detectConsumed always returns consumed=false for empty signals.
 *
 * effective = (with_inject → consumed) AND (without_inject → NOT consumed).
 * effective_rate = effective_count / fixture_size.
 *
 * Tier (D8 thresholds):
 *   effective_rate >= 0.50 → green
 *   0.20 <= effective_rate < 0.50 → yellow
 *   effective_rate < 0.20 → red
 *
 * The main block writes docs/benchmarks/artifacts/s109-actionability-<date>/effective-rate.json
 * and exits with code 1 when tier === "red".
 */
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SMOKE_FIXTURE,
  type SmokeFixture,
} from "./inject-actionability-smoke";
import {
  createInjectEnvelope,
  type InjectEnvelope,
} from "../inject/envelope";
import {
  ensureInjectTracesSchema,
  InjectTraceStore,
} from "../inject/trace-store";
import { detectConsumed } from "../inject/consume-detector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CounterfactualPathResult {
  consumed_count: number;
  consumed_rate: number;
}

export interface EvalResult {
  schema_version: 1;
  run_id: string;
  fixture_size: number;
  with_inject: CounterfactualPathResult;
  without_inject: CounterfactualPathResult;
  effective_count: number;
  effective_rate: number;
  tier: "green" | "yellow" | "red";
  fired_at_ms: number;
  decisions_md_d8_thresholds: {
    green_min: 0.5;
    red_max: 0.2;
  };
}

export interface CounterfactualEvalOptions {
  fixture?: readonly SmokeFixture[];
  sessionId?: string;
  nowMs?: number;
}

// ---------------------------------------------------------------------------
// Tier decision
// ---------------------------------------------------------------------------

/**
 * Classify effective_rate according to D8 thresholds:
 *   >= 0.50 → green
 *   0.20 <= rate < 0.50 → yellow
 *   < 0.20 → red
 */
export function decideEffectiveTier(
  rate: number,
): "green" | "yellow" | "red" {
  if (rate >= 0.5) return "green";
  if (rate >= 0.2) return "yellow";
  return "red";
}

// ---------------------------------------------------------------------------
// Core eval
// ---------------------------------------------------------------------------

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Run the counterfactual eval end-to-end.
 *
 * Two isolated :memory: SQLite databases are used so neither path contaminates
 * the other. The with_inject path mirrors inject-actionability-smoke behaviour.
 * The without_inject path creates a "ghost envelope" (empty signals[]) and
 * passes it to detectConsumed — which always returns consumed=false because
 * the detectConsumed implementation short-circuits on empty signals.
 */
export function runInjectCounterfactualEval(
  opts: CounterfactualEvalOptions = {},
): EvalResult {
  const fixture = opts.fixture ?? DEFAULT_SMOKE_FIXTURE;
  const sessionId = opts.sessionId ?? "counterfactual_s109_005";
  const nowMs = opts.nowMs ?? Date.now();
  const fixtureSize = fixture.length;

  // -------------------------------------------------------------------------
  // Path A: with_inject — real envelopes, detect against fixture artifacts
  // -------------------------------------------------------------------------
  let withConsumedCount = 0;
  const withConsumedSet = new Set<number>(); // index of consumed entries

  const dbWith = new Database(":memory:");
  try {
    ensureInjectTracesSchema(dbWith);
    const storeWith = new InjectTraceStore(dbWith);

    for (let i = 0; i < fixture.length; i++) {
      const spec = fixture[i];
      const env: InjectEnvelope = createInjectEnvelope({
        kind: spec.kind,
        signals: spec.signals,
        action_hint: spec.action_hint,
        confidence: spec.confidence,
        prose: spec.prose,
      });
      storeWith.recordTrace(env, sessionId, nowMs - (fixture.length - i) * 1000);

      if (!spec.wantConsume) continue;
      const result = detectConsumed(env, spec.artifact);
      if (result.consumed && result.evidence) {
        storeWith.markConsumed(env.structured.trace_id, result.evidence, nowMs);
        withConsumedCount++;
        withConsumedSet.add(i);
      }
    }
  } finally {
    dbWith.close();
  }

  // -------------------------------------------------------------------------
  // Path B: without_inject — ghost envelopes (empty signals[])
  // detectConsumed returns consumed=false when signals is empty
  // -------------------------------------------------------------------------
  let withoutConsumedCount = 0;
  const withoutConsumedSet = new Set<number>();

  const dbWithout = new Database(":memory:");
  try {
    ensureInjectTracesSchema(dbWithout);
    const storeWithout = new InjectTraceStore(dbWithout);

    for (let i = 0; i < fixture.length; i++) {
      const spec = fixture[i];
      // Ghost envelope: same structure but empty signals — no signals to echo
      const ghostEnv: InjectEnvelope = createInjectEnvelope({
        kind: spec.kind,
        signals: [],  // empty = no signals, detectConsumed always returns false
        action_hint: spec.action_hint,
        confidence: spec.confidence,
        prose: spec.prose,
      });
      storeWithout.recordTrace(
        ghostEnv,
        sessionId + "_without",
        nowMs - (fixture.length - i) * 1000,
      );

      // Run detectConsumed against the same artifact — should always be false
      // because ghostEnv.structured.signals is empty.
      if (!spec.wantConsume) continue;
      const result = detectConsumed(ghostEnv, spec.artifact);
      if (result.consumed && result.evidence) {
        // This should never happen given the empty-signals invariant, but we
        // count it defensively.
        storeWithout.markConsumed(
          ghostEnv.structured.trace_id,
          result.evidence,
          nowMs,
        );
        withoutConsumedCount++;
        withoutConsumedSet.add(i);
      }
    }
  } finally {
    dbWithout.close();
  }

  // -------------------------------------------------------------------------
  // Effective count: with=consumed AND without=NOT consumed
  // -------------------------------------------------------------------------
  let effectiveCount = 0;
  for (let i = 0; i < fixtureSize; i++) {
    const withConsumed = withConsumedSet.has(i);
    const withoutConsumed = withoutConsumedSet.has(i);
    if (withConsumed && !withoutConsumed) {
      effectiveCount++;
    }
  }

  const withConsumedRate = fixtureSize === 0 ? 0 : withConsumedCount / fixtureSize;
  const withoutConsumedRate =
    fixtureSize === 0 ? 0 : withoutConsumedCount / fixtureSize;
  const effectiveRate = fixtureSize === 0 ? 0 : effectiveCount / fixtureSize;
  const tier = decideEffectiveTier(effectiveRate);

  const dateStr = new Date(nowMs).toISOString().slice(0, 10);
  const runId = `s109_counterfactual_${new Date(nowMs).toISOString()}`;

  return {
    schema_version: 1,
    run_id: runId,
    fixture_size: fixtureSize,
    with_inject: {
      consumed_count: withConsumedCount,
      consumed_rate: round4(withConsumedRate),
    },
    without_inject: {
      consumed_count: withoutConsumedCount,
      consumed_rate: round4(withoutConsumedRate),
    },
    effective_count: effectiveCount,
    effective_rate: round4(effectiveRate),
    tier,
    fired_at_ms: nowMs,
    decisions_md_d8_thresholds: {
      green_min: 0.5,
      red_max: 0.2,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const nowMs = Date.now();
  const result = runInjectCounterfactualEval({ nowMs });

  const dateStr = new Date(nowMs).toISOString().slice(0, 10);

  // Resolve artifact dir relative to this file's repo root.
  // import.meta.dir = memory-server/src/benchmark
  // 3 levels up → harness-mem (repo root)
  const repoRoot = join(import.meta.dir, "..", "..", "..");
  const artifactDir = join(
    repoRoot,
    "docs",
    "benchmarks",
    "artifacts",
    `s109-actionability-${dateStr}`,
  );

  mkdirSync(artifactDir, { recursive: true });

  const artifactPath = join(artifactDir, "effective-rate.json");
  writeFileSync(artifactPath, JSON.stringify(result, null, 2) + "\n", "utf-8");

  // eslint-disable-next-line no-console
  console.log(
    `[s109-counterfactual] effective_rate=${result.effective_rate} tier=${result.tier}`,
  );
  // eslint-disable-next-line no-console
  console.log(`[s109-counterfactual] artifact written: ${artifactPath}`);

  process.exit(result.tier === "red" ? 1 : 0);
}
