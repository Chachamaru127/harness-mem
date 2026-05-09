/**
 * §S109-004 — CI smoke harness for inject actionability (delivered_rate / consumed_rate).
 *
 * Fires a representative N envelopes through `InjectTraceStore`, marks a configurable
 * subset as consumed via `detectConsumed` against synthetic next-turn artifacts, then
 * runs `aggregateInjectObservability` to derive:
 *   - delivered_rate = (aggregator.summary.delivered_count) / N
 *     i.e. "did every envelope we tried to fire actually land in the table"
 *   - consumed_rate  = aggregator.summary.consumed_rate (unchanged)
 *
 * The default mix mirrors the four kinds wired in S109-002 (contradiction / suggest /
 * recall_chain / risk_warn) so this smoke also acts as a sanity check that envelope
 * generation + persist + grep-based detect agree on shape.
 *
 * Out of scope:
 *   - effective_rate (S109-005, weekly counterfactual)
 *   - LLM-based judgement (consume = signal substring match — same as production)
 *   - mutating any persistent DB; we use `:memory:` SQLite.
 */
import { Database } from "bun:sqlite";
import {
  createInjectEnvelope,
  type InjectEnvelope,
  type InjectKind,
} from "../inject/envelope";
import {
  ensureInjectTracesSchema,
  InjectTraceStore,
} from "../inject/trace-store";
import {
  detectConsumed,
  type NextTurnArtifact,
} from "../inject/consume-detector";
import {
  aggregateInjectObservability,
  type InjectObservability,
} from "../inject/observability";

export type ActionabilityTier = "green" | "yellow" | "red";

export interface InjectActionabilitySmokeResult {
  delivered_rate: number;
  consumed_rate: number;
  fixture_size: number;
  consumed_count: number;
  hooks_health_summary: string;
  tier: ActionabilityTier;
}

export interface SmokeFixture {
  kind: InjectKind;
  signals: string[];
  action_hint: string;
  confidence: number;
  prose: string;
  /** Synthetic next-turn artifact that should produce a consume hit (when wantConsume=true). */
  artifact: NextTurnArtifact;
  /** When false, this envelope is fired but never marked consumed. */
  wantConsume: boolean;
}

/**
 * Default representative mix: 10 envelopes, 6 of which are configured to be
 * consumed by the synthetic next-turn artifact (target consumed_rate = 0.6).
 *
 * The mix is intentionally balanced across the 4 kinds so hooks_health
 * reports `alive` for all three tracked surfaces (session_start /
 * user_prompt_submit / stop) and we exercise each KIND_TO_HOOK branch.
 */
export const DEFAULT_SMOKE_FIXTURE: readonly SmokeFixture[] = [
  // contradiction (stop hook) — 3 fires, 2 consumed
  {
    kind: "contradiction",
    signals: ["MySQL", "PostgreSQL"],
    action_hint: "warn_user_before_act",
    confidence: 0.84,
    prose: "MySQL から PostgreSQL に切り替えた経緯があります。",
    artifact: {
      tool_calls: [
        {
          name: "harness_mem_search",
          arguments: { query: "PostgreSQL migration history" },
        },
      ],
    },
    wantConsume: true,
  },
  {
    kind: "contradiction",
    signals: ["v2-api", "v1-api"],
    action_hint: "warn_user_before_act",
    confidence: 0.78,
    prose: "v1-api を v2-api に置き換えた経緯があります。",
    artifact: { user_text: "Switching from v1-api to v2-api as decided." },
    wantConsume: true,
  },
  {
    kind: "contradiction",
    signals: ["redis-cache", "memcached"],
    action_hint: "warn_user_before_act",
    confidence: 0.65,
    prose: "redis-cache と memcached の選択は未確定です。",
    artifact: { user_text: "no consume here" },
    wantConsume: false,
  },
  // suggest (stop hook) — 2 fires, 1 consumed
  {
    kind: "suggest",
    signals: ["release-checklist"],
    action_hint: "consider_before_decide",
    confidence: 0.6,
    prose: "release-checklist を再確認してください。",
    artifact: { user_text: "Reviewing release-checklist before tag." },
    wantConsume: true,
  },
  {
    kind: "suggest",
    signals: ["benchmark-rerun"],
    action_hint: "consider_before_decide",
    confidence: 0.55,
    prose: "benchmark-rerun を検討してください。",
    artifact: { user_text: "skip" },
    wantConsume: false,
  },
  // recall_chain (user_prompt_submit hook + session_start bridge) — 3 fires, 2 consumed
  {
    kind: "recall_chain",
    signals: ["plans/§S109", "decisions.md D8"],
    action_hint: "read_before_edit",
    confidence: 0.7,
    prose: "plans/§S109 と decisions.md D8 を先に読んでください。",
    artifact: {
      tool_calls: [
        {
          name: "Read",
          arguments: { file_path: "/repo/.claude/memory/decisions.md D8" },
        },
      ],
    },
    wantConsume: true,
  },
  {
    kind: "recall_chain",
    signals: ["patterns.md P7"],
    action_hint: "read_before_edit",
    confidence: 0.65,
    prose: "patterns.md P7 を確認してください。",
    artifact: { user_text: "Looking up patterns.md P7." },
    wantConsume: true,
  },
  {
    kind: "recall_chain",
    signals: ["session-notes/2026-04-14"],
    action_hint: "read_before_edit",
    confidence: 0.5,
    prose: "session-notes/2026-04-14 を読んでください。",
    artifact: { user_text: "irrelevant turn" },
    wantConsume: false,
  },
  // risk_warn (user_prompt_submit hook) — 2 fires, 1 consumed
  {
    kind: "risk_warn",
    signals: ["force-push to main"],
    action_hint: "warn_user_before_act",
    confidence: 0.9,
    prose: "force-push to main は禁止です。",
    artifact: { user_text: "Cancelled — would have done a force-push to main." },
    wantConsume: true,
  },
  {
    kind: "risk_warn",
    signals: ["delete-prod-table"],
    action_hint: "warn_user_before_act",
    confidence: 0.95,
    prose: "delete-prod-table は禁止です。",
    artifact: { user_text: "noop" },
    wantConsume: false,
  },
];

/**
 * Tier judgement (matches `.claude/memory/decisions.md` D8 contract):
 *   - delivered_rate < 0.95           → red (the inject path itself is broken)
 *   - consumed_rate  < 0.30           → red
 *   - 0.30 ≤ consumed_rate < 0.60     → yellow
 *   - delivered_rate ≥ 0.95 AND
 *     consumed_rate  ≥ 0.60           → green
 */
export function decideTier(
  deliveredRate: number,
  consumedRate: number,
): ActionabilityTier {
  if (deliveredRate < 0.95) return "red";
  if (consumedRate < 0.3) return "red";
  if (consumedRate < 0.6) return "yellow";
  return "green";
}

export interface SmokeRunOptions {
  fixture?: readonly SmokeFixture[];
  sessionId?: string;
  /** Override Date.now() for deterministic hooks_health classification. */
  nowMs?: number;
}

/**
 * Run the smoke harness end-to-end. Caller may pass a custom fixture for
 * boundary testing (e.g. force every envelope to be consumed to hit the
 * green tier, or zero to hit red).
 */
export function runInjectActionabilitySmoke(
  opts: SmokeRunOptions = {},
): InjectActionabilitySmokeResult {
  const fixture = opts.fixture ?? DEFAULT_SMOKE_FIXTURE;
  const sessionId = opts.sessionId ?? "smoke_s109_004";
  const baseTs = opts.nowMs ?? Date.now();

  const db = new Database(":memory:");
  try {
    ensureInjectTracesSchema(db);
    const store = new InjectTraceStore(db);

    let firedSuccessfully = 0;
    const envelopes: Array<{ env: InjectEnvelope; spec: SmokeFixture }> = [];

    fixture.forEach((spec, idx) => {
      const env = createInjectEnvelope({
        kind: spec.kind,
        signals: spec.signals,
        action_hint: spec.action_hint,
        confidence: spec.confidence,
        prose: spec.prose,
      });
      try {
        store.recordTrace(env, sessionId, baseTs - (fixture.length - idx) * 1000);
        firedSuccessfully += 1;
        envelopes.push({ env, spec });
      } catch (err) {
        // hook fail simulation: record the attempt but don't increment fired
        // (mirrors a hook that crashed before persisting).
        // eslint-disable-next-line no-console
        console.error(
          `[inject-actionability-smoke] recordTrace failed for kind=${spec.kind}: ${(err as Error).message}`,
        );
      }
    });

    // Run consume detection for each fixture marked wantConsume=true.
    for (const { env, spec } of envelopes) {
      if (!spec.wantConsume) continue;
      const result = detectConsumed(env, spec.artifact);
      if (result.consumed && result.evidence) {
        store.markConsumed(env.structured.trace_id, result.evidence, baseTs);
      }
    }

    const observability: InjectObservability = aggregateInjectObservability(
      db,
      sessionId,
      { nowMs: baseTs },
    );

    const fixtureSize = fixture.length;
    const deliveredCount = observability.summary.delivered_count;
    const consumedCount = observability.summary.consumed_count;
    const deliveredRate = fixtureSize === 0 ? 0 : deliveredCount / fixtureSize;
    const consumedRate =
      observability.summary.consumed_rate === null
        ? 0
        : observability.summary.consumed_rate;

    const tier = decideTier(deliveredRate, consumedRate);
    const hooksHealthSummary = summarizeHooksHealth(observability);

    return {
      delivered_rate: round4(deliveredRate),
      consumed_rate: round4(consumedRate),
      fixture_size: fixtureSize,
      consumed_count: consumedCount,
      hooks_health_summary: hooksHealthSummary,
      tier,
    };
  } finally {
    db.close();
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function summarizeHooksHealth(obs: InjectObservability): string {
  const h = obs.hooks_health;
  return `session_start=${h.session_start};user_prompt_submit=${h.user_prompt_submit};stop=${h.stop}`;
}

if (import.meta.main) {
  const result = runInjectActionabilitySmoke();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}
