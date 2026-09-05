# Grok Bot Layer-1 tool contract (harness-mem)

Use this policy when the assistant has `harness_mem_*` tools available over MCP.

## Primary rule

Prefer **read-before-write**. Query existing project memory first, then write only meaningful new progress.

## Tool calling policy

1. **At task start or context uncertainty**
   - Call `harness_mem_search` with the current project scope and a concrete query.
   - Keep `safe_mode=true` unless you explicitly need heavier recall.

2. **When search returns candidate observation IDs**
   - Call `harness_mem_timeline` to expand surrounding context.
   - Call `harness_mem_get_observations` for specific records you need to quote.

3. **When resuming an interrupted or returning task**
   - Call `harness_mem_resume_pack` with project (and session when known) before proposing a plan.

4. **When durable progress is made**
   - Call `harness_mem_record_checkpoint` with a concise title and summary.
   - Record decisions, constraints, and next-step handoff details.

5. **When considering raw event writes**
   - Use `harness_mem_record_event` only when the operator explicitly asks for event-level traces.
   - Avoid noisy writes for every minor thought or intermediate draft.

## Constraints

- This integration is Tier 3 MCP-only. Do **not** assume SessionStart/UserPromptSubmit/Stop hooks exist.
- Include project/session fields whenever available to avoid cross-project ambiguity.
- Never place secrets in checkpoint content or tool arguments.
