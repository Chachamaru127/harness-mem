# Session Continuity Local Comparison

Date: 2026-03-24

## Scope

Local benchmark run against:

- `harness-mem` current worktree
- local `claude-mem` clone at `/Users/tachibanashuuta/.superset/projects/claude-mem/`

Goal:

- measure `first-turn continuity` as generated artifact quality
- measure `Claude/Codex parity` for harness hooks
- measure `memory recall` on the same synthetic multi-session fixture

## Command

```bash
CLAUDE_MEM_REPO=/Users/tachibanashuuta/.superset/projects/claude-mem \
CLAUDE_MEM_EXTRA_PATH=/tmp/uvbin \
CLAUDE_MEM_CHROMA_ENABLED=true \
bun run scripts/bench-session-continuity.ts
```

## Results

### harness-mem first-turn continuity

- Claude artifact recall: `1.00` (`4/4`)
- Codex artifact recall: `1.00` (`4/4`)
- False carryover: `0` on both clients
- Claude/Codex parity: `normalizedEqual=true`
- Latency:
  - Claude: `1723ms`
  - Codex: `1797ms`

### Claude-mem first-turn baseline

- Artifact recall: `0.25` (`1/4`)
- False carryover: `2`
- Latency: `21ms`

Observed output favored the more recent same-project noise session (`OpenAPI docs / dark mode`) instead of the targeted continuity chain.

### Memory recall comparison

- harness-mem:
  - Recall: `0.75` (`6/8`)
  - Avg latency: `2.35ms`
- claude-mem:
  - Recall: `0.00` (`0/8`)
  - Avg latency: `40.88ms`

## Interpretation

- On `first-turn continuity`, the current harness runtime + hook path now achieves exact Claude/Codex parity on the tested chain-targeted scenario.
- On the same scenario, `claude-mem` context injection remained project-recent and pulled in unrelated noise, so the remembered-first-turn UX was materially worse.
- The `memory recall` comparison uses local worker public routes and should be treated as a practical black-box measurement, not an internal algorithmic proof. The `first-turn continuity` comparison is the more representative UX metric for this workstream.
