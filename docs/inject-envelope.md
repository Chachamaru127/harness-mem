# Inject envelope contract (§S109)

This document specifies how harness-mem packages inject payloads (recall
chains, contradiction warnings, skill suggestions, risk warnings) so that
their downstream effect on the AI agent can be measured, not just
delivered.

The single source of truth for the underlying decision is
[`.claude/memory/decisions.md` D8](../.claude/memory/decisions.md). This
document is the implementation-facing companion.

## Table of Contents

- [Why an envelope](#why-an-envelope)
- [Envelope shape (case C: structured + prose)](#envelope-shape-case-c-structured--prose)
- [Invariants and validation](#invariants-and-validation)
- [Four inject paths in v0.20.0](#four-inject-paths-in-v0200)
- [`inject_traces` table schema](#inject_traces-table-schema)
- [Observability — `harness_mem_observability`](#observability--harness_mem_observability)
- [CI tier gate](#ci-tier-gate)
- [`effective_rate` is a separate, weekly artifact](#effective_rate-is-a-separate-weekly-artifact)
- [Known limits](#known-limits)
- [Where the code lives](#where-the-code-lives)

## Why an envelope

The harness-mem differentiation question is not "did we surface a
memory hint?" — it is "did that hint change what the AI agent did
next?" Three observable values define that:

1. `delivered` — the structured payload reached the client (server-side log).
2. `consumed` — the next-turn `tool_call` arguments or user-visible
   response echoed at least one of the envelope `signals[]`.
3. `effective` — a post-hoc judgement, computed weekly (S109-005),
   from outcome tags + counterfactual run pairs.

`delivered` and `consumed` are continuous CI signals. `effective` is a
weekly batch and intentionally stays out of the release-blocking gate.

## Envelope shape (case C: structured + prose)

The envelope carries two co-equal sides. The **structured** side is the
canonical record. The **prose** side is the first-person directive
addressed to the AI agent so the model has a directly readable cue.

```ts
interface InjectEnvelope {
  structured: {
    kind: "contradiction" | "recall_chain" | "risk_warn" | "suggest";
    signals: string[];           // literal tokens we expect to echo
    action_hint: string;         // e.g. "warn_user_before_act"
    confidence: number;          // 0.0 - 1.0
    trace_id: string;            // inj_YYYY-MM-DD_<8-alphanum>
  };
  prose: string;
}
```

### Field notes

- **`kind`** — fixed enum. Three contradiction-style values fan out from
  the four inject sources below; each source maps to exactly one kind.
- **`signals[]`** — verbatim tokens (observation IDs, file paths,
  decision identifiers, salient nouns) that the next turn is expected
  to mention if the agent actually acts on the inject. Substring grep
  is sufficient (see [Known limits](#known-limits)).
- **`action_hint`** — short canonical action label
  (`warn_user_before_act`, `read_before_edit`, `consider_before_decide`,
  `no_action`). Free-form strings are also accepted but the four above
  are the documented vocabulary.
- **`confidence`** — emitter-supplied. For contradictions this is the
  Jaccard score of the disagreeing observation pair; for recall it is
  the rerank-normalised top hit score.
- **`trace_id`** — `inj_<YYYY-MM-DD>_<8 alphanumeric>` (see
  `generateTraceId` in [`memory-server/src/inject/envelope.ts`](../memory-server/src/inject/envelope.ts)).
  Globally unique inside `inject_traces`.
- **`prose`** — the natural-language form. By contract, every signal in
  `structured.signals[]` must appear verbatim in `prose`. This is what
  ties the prose back to the structured side and avoids drift.

## Invariants and validation

`createInjectEnvelope` rejects unknown `kind` values at runtime. After
construction, every emitter is expected to call:

```ts
const result = validateProseContainsSignals(envelope);
if (!result.ok) {
  // result.missing is the list of signals not present in prose.
  throw new Error(`prose drift: missing ${result.missing.join(", ")}`);
}
```

This guard is exercised by the unit tests in
`memory-server/src/inject/__tests__/inject-envelope.test.ts` (or
equivalent under `tests/unit/`). Treat it as load-bearing — if the
prose stops containing a signal, the consume-detector grep will fall
silent for that signal and `consumed_rate` will quietly degrade.

## Four inject paths in v0.20.0

S109-002 retrofitted four pre-existing inject sites onto the envelope.
Each path emits its envelope **and** persists it to `inject_traces` as
a side effect; the public response shape of each surface is unchanged.

| Source surface | Envelope `kind` | `action_hint` | Bridge module |
|---|---|---|---|
| `runConsolidation` / contradiction_scan (Stop hook lineage) | `contradiction` | `warn_user_before_act` | [`inject/contradiction-envelope.ts`](../memory-server/src/inject/contradiction-envelope.ts) |
| `finalize_session` skill suggestion | `suggest` | `consider_before_decide` | [`inject/skill-suggestion-envelope.ts`](../memory-server/src/inject/skill-suggestion-envelope.ts) |
| `SessionStart` artifact (resume pack) | `recall_chain` | `read_before_edit` | [`inject/session-start-envelope.ts`](../memory-server/src/inject/session-start-envelope.ts) |
| `UserPromptSubmit` contextual recall | `recall_chain` (or `risk_warn` when flagged) | `read_before_edit` / `warn_user_before_act` | [`inject/user-prompt-recall-envelope.ts`](../memory-server/src/inject/user-prompt-recall-envelope.ts) |

The persistence mode is intentionally side-effect only. None of the
existing client-visible response payloads gained or lost a field; all
four bridges write into `inject_traces` and return unchanged JSON.

## `inject_traces` table schema

Defined in [`memory-server/src/inject/trace-store.ts`](../memory-server/src/inject/trace-store.ts).
Created with `CREATE TABLE IF NOT EXISTS` so it is additive and
idempotent for upgraders.

| Column | Type | Notes |
|---|---|---|
| `trace_id` | TEXT PRIMARY KEY | Matches `envelope.structured.trace_id` |
| `kind` | TEXT NOT NULL | One of the four kinds |
| `session_id` | TEXT NOT NULL | Session attribution (or `system_consolidation` for cron-driven contradictions) |
| `fired_at` | INTEGER NOT NULL | Unix ms |
| `signals_json` | TEXT NOT NULL | `JSON.stringify(signals)` |
| `action_hint` | TEXT NOT NULL | Mirrors `structured.action_hint` |
| `confidence` | REAL NOT NULL | Mirrors `structured.confidence` |
| `prose` | TEXT NOT NULL | Mirrors `envelope.prose` |
| `consumed` | INTEGER NOT NULL DEFAULT 0 | `1` once a next-turn echo is detected |
| `consumed_at` | INTEGER NULL | Unix ms when marked consumed |
| `consumed_evidence` | TEXT NULL | e.g. `tool_call:harness_mem_search:E1` |
| `effective` | INTEGER NULL | Filled by the weekly batch (S109-005) |
| `effective_evidence` | TEXT NULL | Filled by the weekly batch (S109-005) |

A composite index `idx_inject_traces_session_fired (session_id, fired_at)`
supports the per-session aggregation used by
`harness_mem_observability`.

## Observability — `harness_mem_observability`

The Go MCP tool surface mirrors the TypeScript aggregator
`aggregateInjectObservability` in
[`memory-server/src/inject/observability.ts`](../memory-server/src/inject/observability.ts)
and the REST endpoint `GET /v1/admin/inject-observability` (see
`memory-server/src/server.ts`).

### Tool call

```jsonc
{
  "tool": "harness_mem_observability",
  "args": {
    "session_id": "sess_abcdef0123",
    "since_ms": 1715200000000,   // optional
    "until_ms": 1715300000000    // optional
  }
}
```

### Returned shape (abridged)

```jsonc
{
  "session_id": "sess_abcdef0123",
  "injects_in_session": [
    {
      "trace_id": "inj_2026-05-09_a1b2c3d4",
      "kind": "contradiction",
      "delivered_at": 1715290000000,
      "signals": ["E12", "E18", "PostgreSQL", "MySQL"],
      "action_hint": "warn_user_before_act",
      "consumed": true,
      "consumed_evidence": "tool_call:harness_mem_search:E12",
      "effective": null,
      "outcome_tag": null
    }
  ],
  "summary": {
    "delivered_count": 6,
    "consumed_count": 4,
    "consumed_rate": 0.6667,
    "effective_rate": null
  },
  "hooks_health": {
    "session_start": "alive",
    "user_prompt_submit": "alive",
    "stop": "stale_4d"
  },
  "pending_contradictions": {
    "count": 1,
    "top_pairs": [{ "a": "E12", "b": "E18", "jaccard": 0.84 }]
  },
  "suggested_action": "harness-mem doctor --fix"
}
```

`hooks_health` classifies each tracked hook as `alive`, `stale_<N>d`,
or `unwired` based on the most recent `fired_at` for any kind that maps
to that hook (`recall_chain` and `risk_warn` → `user_prompt_submit`;
`contradiction` and `suggest` → `stop`; `recall_chain` is also used as
the proxy for `session_start`). When any hook is `stale_*` or
`unwired`, `suggested_action` returns `harness-mem doctor --fix`.

## CI tier gate

`scripts/check-inject-actionability.sh` reads
`memory-server/src/benchmark/results/ci-run-manifest-latest.json` and
classifies the run into a release tier:

| Condition | Tier | CI behaviour |
|---|---|---|
| `delivered_rate < 0.95` | red | `::error::` and `exit 1` (block) |
| `consumed_rate < 0.30` | red | `::error::` and `exit 1` (block) |
| `0.30 ≤ consumed_rate < 0.60` | yellow | `::warning::` and `exit 0` (warn) |
| `delivered_rate ≥ 0.95` and `consumed_rate ≥ 0.60` | green | silent `exit 0` |

The tier itself is computed inside
`memory-server/src/benchmark/inject-actionability-smoke.ts` →
`decideTier()` and injected into the manifest under
`inject_actionability`. `release.yml` runs the gate script after the
benchmark step so a regression in either rate is visible alongside the
existing recall@10 / freshness gates.

The thresholds (95 / 30 / 60) match D8 and are intentionally
revisitable: see "Review Conditions" in
[`.claude/memory/decisions.md`](../.claude/memory/decisions.md).

## `effective_rate` is a separate, weekly artifact

`effective_rate` is *not* part of the per-build CI gate. It is the
output of the weekly counterfactual harness scheduled in S109-005:

- Replay a fixture twice — once with envelopes injected, once without.
- Diff the agent's behaviour. Inject made the agent take the safer or
  more correct branch ⇒ `effective=1`; no observable diff ⇒
  `effective=0`.
- Aggregate across the fixture into `effective_rate` and store as
  `docs/benchmarks/artifacts/s109-actionability-<date>/effective-rate.json`.

The reason this lives outside the per-PR gate is cost (counterfactual
runs are expensive) and signal-to-noise (a weekly batch trends better
than a per-build datum). `consumed_rate` remains the per-build proxy.

## Known limits

These are deliberate scope choices for v0.20.0; treat them as backlog
candidates rather than bugs.

- **Substring match only.** `consume-detector.ts` does
  `haystack.includes(signal)`. No fuzzy matching, no embedding
  similarity, no token-boundary awareness. A signal of `DB` will hit
  the literal substring `DB` but will not hit `database`.
- **No synonym resolution.** `本番反映` and `deploy` are independent
  signals; surface both in `signals[]` if both should count.
- **Case sensitivity.** Substring matching is case-sensitive. Emitters
  pick the casing the next turn is most likely to echo.
- **Single-turn span.** Only the immediate next turn is inspected.
  Echoes that take two turns to land are missed by design.
- **Hook-source heuristic.** `inject_traces` does not record which
  hook (`SessionStart` vs `UserPromptSubmit`) emitted each row;
  `hooks_health` classification uses the `kind`→hook map in
  `observability.ts`. `recall_chain` doubles as the proxy for
  `session_start` because it is the dominant emitter on that path.
- **`session_start` health is approximate** for the same reason. A
  separate `hook_source` column would tighten this; tracked for a
  later cycle.

## Where the code lives

- Envelope contract: [`memory-server/src/inject/envelope.ts`](../memory-server/src/inject/envelope.ts)
- Persistence: [`memory-server/src/inject/trace-store.ts`](../memory-server/src/inject/trace-store.ts)
- Four bridges:
  - [`inject/contradiction-envelope.ts`](../memory-server/src/inject/contradiction-envelope.ts)
  - [`inject/skill-suggestion-envelope.ts`](../memory-server/src/inject/skill-suggestion-envelope.ts)
  - [`inject/session-start-envelope.ts`](../memory-server/src/inject/session-start-envelope.ts)
  - [`inject/user-prompt-recall-envelope.ts`](../memory-server/src/inject/user-prompt-recall-envelope.ts)
- Aggregator: [`memory-server/src/inject/observability.ts`](../memory-server/src/inject/observability.ts)
- Consume detector: [`memory-server/src/inject/consume-detector.ts`](../memory-server/src/inject/consume-detector.ts)
- CI smoke + tier decider: [`memory-server/src/benchmark/inject-actionability-smoke.ts`](../memory-server/src/benchmark/inject-actionability-smoke.ts)
- Tier gate script: [`scripts/check-inject-actionability.sh`](../scripts/check-inject-actionability.sh)
- Go MCP tool registration: [`mcp-server-go/internal/tools/memory_defs.go`](../mcp-server-go/internal/tools/memory_defs.go) (see `memToolObservability`)
- REST surface: `GET /v1/admin/inject-observability` (see `memory-server/src/server.ts`)
