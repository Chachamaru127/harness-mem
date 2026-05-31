# Senpai Note Agent

Status: draft
Owner: harness-mem
Target: Claude Code / Codex local coding sessions
Scope: Skill-first MVP, no new daemon schema required
Companion: `skills/senpai-note/SKILL.md`, `Plans.md` §138

## Purpose

Senpai Note Agent converts AI coding session memory into a reusable handoff pack.
A handoff pack is not a generic summary. It must help the next operator, teammate,
or future self continue the work with less confusion, fewer repeated mistakes, and
clearer recovery steps.

The agent turns session memory into three concrete artifacts:

1. 30-second handoff card
2. Reusable runbook
3. Replay prompt for the next AI coding session

## Business Ops Positioning

The same engine applies beyond coding. Input can be any messy work log from
attrition-prone business operations — month-end accounting, customer-support
escalations, recruiting candidate handling, inquiry triage. A non-engineer can
paste rough notes and get a handoff card + runbook + replay prompt.

This works **without a running memory daemon**: when memory is unavailable, the
agent uses the user-provided log as its source and marks `source:` as
user-provided. Input can be typed notes or a voice transcript (e.g. VoiceOS),
so capture stays low-effort for non-engineers — voice is an optional booster,
not a dependency.

The value is not documentation but automation: the generated `REPLAY_PROMPT`
is a runnable instruction that lets the next AI agent perform the next task
(e.g. draft the customer reply) while respecting the "do not repeat" rules.
Business examples live in `examples/senpai-note/`:
`ops-demo-session.md` (typed log) / `ops-voice-input.md` (spoken transcript) →
`ops-handoff-pack.md` (handoff) → `ops-replay-result.md` (the next AI's output).
The hackathon pitch and setup are in `docs/senpai-note-hackathon-pitch.md` and
`docs/senpai-note-hackathon-setup.md`.

## Product Principle

The agent must optimize for "the next person can act immediately", not for
"the current session is summarized beautifully".

A valid output must answer:

- Where should the next person start?
- What was decided?
- What should not be repeated?
- What commands or checks can be copied?
- What failure signs should be watched?
- What recovery path is available?
- Which memory/source supports the output?

## Non-goals

Senpai Note Agent must not:

- Become a generic company knowledge base.
- Require cloud storage.
- Add a new default external integration.
- Mutate or delete local memory.
- Auto-create ADRs or durable decisions without explicit user action.
- Depend on unscoped broad search as its normal path.
- Claim that generated runbooks are guaranteed correct without evidence.

## Existing Runtime Fit

Senpai Note Agent is a thin product layer over existing harness-mem primitives:

- session resume context (`harness_mem_resume_pack`)
- session thread retrieval (`harness_mem_session_thread`)
- scoped search (`harness_mem_search`)
- observation detail retrieval (`harness_mem_get_observations`)
- checkpoint and session summary (`harness_mem_record_checkpoint` / `harness_mem_finalize_session`)
- procedural skill persistence where explicitly requested (`harness_mem_finalize_session` with `persist_skill=true`)

The MVP is implemented as a Skill and documentation first. It does not add new
database tables, daemon endpoints, or external services.

## Trigger Phrases

The Skill activates when the user asks for one of these intents:

- Senpai Note
- 引き継ぎ
- 手順化
- runbook
- handoff
- 再利用できる形 / 再利用
- 次の人に渡す
- 次回使える形
- replay prompt
- 作業ログをまとめて / 作業ログ
- このセッションを資産化

## Input Sources

The agent uses the best available source in this order:

1. Current session thread, if `session_id` is known.
2. Resume pack, if the task is about recent continuation.
3. Scoped search results for the current project.
4. Explicit user-provided logs or pasted notes.
5. Demo fixture only when running a demo or fallback mode.

The agent must prefer project-scoped retrieval. If project scope cannot be
inferred, the output must say so and avoid pretending that the search was complete.

## Retrieval Rules

The agent follows bounded recall behavior (inherited from §127 search safety):

1. Resolve project scope first when possible.
2. Prefer `harness_mem_session_thread` for a known session.
3. Use `harness_mem_search` with `project`, `session_id`, and small `limit` where possible.
4. Use `safe_mode=true` or `vector_search=false` only as fallback when search is slow or unavailable.
5. Treat `503` as backpressure, not as "no memory".
6. Avoid broad unscoped forensic search unless the user explicitly asks for cross-project investigation.

## Output Contract

The output must contain exactly these top-level artifacts, preceded by a
`source:` / `summary:` header.

### 1. HANDOFF_CARD

A short card that can be read in 30 seconds. Required sections: Start here,
Current conclusion, What was decided (Decisions), What is still open (Still open),
Do not repeat, Next best action.

### 2. RUNBOOK

A reusable procedure for the same type of work. Required sections: Use when,
Preconditions, Steps, Commands / checks, Expected result, Failure signs,
Recovery, Risks, Evidence.

### 3. REPLAY_PROMPT

A prompt that can be pasted into Claude Code, Codex, or another local coding
agent. Required sections: Role/Goal, Known context, First actions, Do not,
checks, Evidence references.

## Evidence Rules

Every generated handoff pack must include a source block with:

- source route used
- project, if known
- session_id, if known
- observation ids or document ids, if available
- fallback reason, if any
- whether the result was generated from user-provided text rather than memory

The agent must not expose private-tagged content unless the user explicitly
allows it.

## Quality Bar

A Senpai Note is acceptable only if it helps a future operator avoid at least
one of the following:

- repeating the same investigation
- misreading a known failure mode
- running the wrong command first
- losing a decision rationale
- asking the same context-setting question again

## MVP Behavior

For the first MVP, this is implemented as:

- `skills/senpai-note/SKILL.md`
- `examples/senpai-note/demo-session.md`
- `examples/senpai-note/handoff-pack.md`
- `tests/senpai-note-skill-contract.test.ts`

No daemon API changes are required.

## Future Extensions

Future work may add:

- `harness_mem_finalize_session` integration with `persist_skill=true`
- generated runbook ingestion as a procedural memory observation
- team sharing via explicit user action (`harness_mem_share_to_team`)
- UI preview
- quality scoring for generated runbooks
- deduplication against existing procedural memories

These extensions must remain local-first by default and explicit when sharing or
persisting generated content.
