# Checkpoint: Hermes MemoryProvider E2E + LLM Safety Plan Self-Review

**Created:** 2026-07-09 11:26:27 JST
**Scope:** harness-mem Hermes MemoryProvider only
**Out of scope:** freee / CANAI accounting / breezing / unrelated browser automation memory

---

## 1. Status Summary

### Done

1. Hermes MemoryProvider skeleton implemented under `integrations/hermes/provider/`
2. Provider unit tests passed (`9 passed`)
3. Existing bridge regression tests passed (`15 passed`)
4. Provider deployed to live Hermes:
   - `~/.hermes/plugins/harness_mem`
5. Hermes config activated:
   - `memory.provider: harness_mem`
6. Live E2E passed:
   - turn record via `/v1/events/record`
   - `harness_mem_search`
   - `prefetch()`
   - second-session recall
7. Post-E2E hardening plan written and **self-reviewed/corrected**

### Not done

1. Revised Task 4 (LLM local-first default + external cloud gate) **not implemented yet**
2. Live Hermes → Ollama LLM extraction E2E **not run**
3. Prefetch noise reduction not implemented
4. `metadata: null` investigation not completed
5. Docs not fully updated for Layer 2 MemoryProvider
6. No git commit of provider work yet

---

## 2. Repo / Environment Snapshot

### Git

```text
Branch: main...origin/main [behind 32]
```

Relevant dirty state:

```text
 M Plans.md
?? .hermes/
?? integrations/hermes/provider/
 D out/harness-mem-recall-explainer.html
?? .harness-worktrees/
?? docs/benchmarks/artifacts/s154-deep-freshness/
?? out/archive/
?? out/harness-mem-benchmark-overview-2026-06-28.html
```

**Caution:** provider work is currently **untracked**.
Also present: unrelated deleted/untracked output artifacts. Do not bundle those into a provider commit unless intentionally reviewed.

### Recent HEAD

```text
0470436 feat(s154-FU01): rollback drill probes fixture + D29 reversibility 完全証明
824899b docs(plans): close §HEAL-DB ...
be2263c Merge pull request #137 ...
bbb00b2 chore: release v0.28.4
d1058d3 fix(s91-003): Skeptic review amend ...
```

### Hermes live config

```yaml
memory:
  memory_enabled: true
  user_profile_enabled: true
  write_approval: false
  memory_char_limit: 2200
  user_char_limit: 1375
  provider: harness_mem
  flush_min_turns: 6
  nudge_interval: 10
```

Backup:

```text
~/.hermes/config.yaml.bak.harness_mem_provider.20260708164918
```

Live plugin placement:

```text
~/.hermes/plugins/harness_mem/
  __init__.py
  plugin.yaml
```

---

## 3. Files Created / Modified

### Provider implementation

```text
integrations/hermes/provider/harness_mem/__init__.py   (336 lines)
integrations/hermes/provider/harness_mem/plugin.yaml    (small metadata)
integrations/hermes/provider/tests/test_provider.py    (225 lines)
```

### Plans / docs tracking

```text
.hermes/plans/2026-07-07_192525-hermes-provider-local-first-llm-extraction.md
.hermes/plans/2026-07-08_171500-hermes-provider-post-e2e-hardening.md  (corrected after self-review)
Plans.md   # S112-008 updated to cc:完了 [E2E-local]
```

### This checkpoint

```text
.hermes/checkpoints/2026-07-09_112627-hermes-provider-e2e-and-llm-plan-checkpoint.md
```

Note: `.hermes/` is untracked. This checkpoint is durable on local disk, but not in git unless later committed intentionally.

---

## 4. Verified Tests

### Provider unit

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  integrations/hermes/provider/tests/test_provider.py -v --tb=short
```

Result: `9 passed`

### Bridge regression

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  integrations/hermes/plugin/tests/test_plugin.py -v --tb=short
```

Result: `15 passed`

### LLM multi-provider unit

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test memory-server/tests/unit/llm-multi-provider.test.ts
```

Result: PASS
Note: `bun` requires `$HOME/.bun/bin` on PATH.

### Hermes venv pytest caveat

```text
~/.hermes/hermes-agent/venv/bin/python: No module named pytest
```

Use system `python3` + `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`.

---

## 5. Live E2E Evidence

### Session A — write path

```text
session_id: 20260708_165742_49e528
marker: hm_provider_live_smoke_20260708_165739_purple_dragon_7788
observation: obs_00mrbscxqh1fb9a76cf55be7c2
title: Hermes turn
tags: ["hermes", "turn"]
```

Content shape:

```text
User: Hermes provider live smoke. Please reply exactly: ACK hm_provider_live_smoke_20260708_165739_purple_dragon_7788
Assistant: ACK hm_provider_live_smoke_20260708_165739_purple_dragon_7788
```

### Search

```text
query: purple dragon 7788
→ hit obs_00mrbscxqh1fb9a76cf55be7c2
```

### Prefetch

Returned:

```text
## harness-mem Context
- [obs_00mrbscxqh1fb9a76cf55be7c2] Hermes turn: ... purple_dragon_7788 ...
```

Also mixed some older Hermes state/backfill noise.

### Session B — recall path

```text
session_id: 20260708_170910_4774a8
question: previous Hermes provider smoke marker about purple dragon 7788
answer: hm_provider_live_smoke_20260708_165739_purple_dragon_7788
```

### Non-blocking warning observed

```text
RuntimeError: Event loop is closed
```

Appears to be Hermes MCP cleanup noise; did not block record/search/prefetch success.

---

## 6. Architecture Decisions (Keep)

```text
Hermes Provider = thin connection layer
  sync_turn()  -> POST /v1/events/record
  prefetch()   -> POST /v1/search (safe_mode)
  tools        -> search / record / status
  on_session_end consolidation only if HARNESS_MEM_HERMES_CONSOLIDATE_ON_END=1

LLM fact extraction = memory-server consolidation pipeline
  memory-server/src/consolidation/extractor.ts
  memory-server/src/consolidation/worker.ts

Positioning = cross-tool coding memory
  Claude Code / Codex / Cursor / Hermes share same daemon pipeline
```

Do **not** put LLM extraction inside Hermes Provider.

---

## 7. Self-Review Corrections (Critical)

Initial post-E2E plan had 3 factual errors. Corrected in:

```text
.hermes/plans/2026-07-08_171500-hermes-provider-post-e2e-hardening.md
```

### Correction A — `shutdown()` already exists

Current code:

```python
def shutdown(self) -> None:
    if self._sync_thread and self._sync_thread.is_alive():
        self._sync_thread.join(timeout=10.0)
```

Initial plan said “implement shutdown”. That was wrong.
Correct work: add regression test; optionally tighten lock/timeout.

### Correction B — `HARNESS_MEM_ALLOW_EXTERNAL_LLM` not implemented

Repo search hits: **0**

So this claim was wrong as current behavior:

```text
Cloud providers require HARNESS_MEM_ALLOW_EXTERNAL_LLM=1
```

That is desired policy only, until Task 4 lands.

`isExternalLlmProvider()` exists, but is primarily for egress classification / audit, not a hard block.

### Correction C — LLM mode provider default is currently `openai`

In `memory-server/src/consolidation/extractor.ts`:

```ts
const provider = (process.env.HARNESS_MEM_FACT_LLM_PROVIDER || "openai")
```

Current truth:

| Item | Current | Desired |
|---|---|---|
| Extractor default mode | `heuristic` | keep `heuristic` |
| LLM mode provider default | `openai` | `ollama` |
| External cloud gate | not enforced | require `HARNESS_MEM_ALLOW_EXTERNAL_LLM=1` |
| Live Ollama extraction E2E | not run | optional later |

**Risk:** if someone sets `HARNESS_MEM_FACT_EXTRACTOR_MODE=llm` and an OpenAI key exists in env, content may leave the machine. Do not document local-first as enforced until Task 4 is implemented.

---

## 8. Corrected Next Plan Priority

Source:

```text
.hermes/plans/2026-07-08_171500-hermes-provider-post-e2e-hardening.md
```

Recommended order:

1. **Task 4 [SAFETY FIRST]**
   - change LLM provider default `openai` → `ollama`
   - block openai/anthropic/gemini unless `HARNESS_MEM_ALLOW_EXTERNAL_LLM=1`
   - cover both `llmExtract` and `llmExtractWithDiff`
   - unit tests only; no live cloud
2. Task 1 — regression test for existing `shutdown()`
3. Task 2 — prefetch noise reduction (boost, not hard-filter-only)
4. Task 3 — investigate `metadata: null`
5. Task 5 — MemoryProvider docs
6. Task 6 — accurate LLM current-vs-target docs
7. Task 7 — optional live Ollama extraction smoke
8. Task 8 — future setup automation sketch

---

## 9. Restore / Rollback Commands

### Re-deploy provider files

```bash
mkdir -p "$HOME/.hermes/plugins/harness_mem"
rsync -a --delete \
  /Users/tachibanashuuta/LocalWork/Code/CC-harness/harness-mem/integrations/hermes/provider/harness_mem/ \
  "$HOME/.hermes/plugins/harness_mem/"
```

### Activate provider

```bash
hermes config set memory.provider harness_mem
```

### Rollback provider selection

```bash
hermes config set memory.provider builtin
# or:
cp ~/.hermes/config.yaml.bak.harness_mem_provider.20260708164918 ~/.hermes/config.yaml
```

### Re-run provider tests

```bash
cd /Users/tachibanashuuta/LocalWork/Code/CC-harness/harness-mem
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  integrations/hermes/provider/tests/test_provider.py -v --tb=short
```

### Live smoke pattern

```bash
MARKER="hm_provider_live_smoke_$(date +%Y%m%d_%H%M%S)_purple_dragon_7788"
hermes chat -q "Hermes provider live smoke. Please reply exactly: ACK $MARKER" -Q --max-turns 3 --source cli
```

Then search local daemon for the marker via `/v1/search`.

---

## 10. Risks at Checkpoint Time

| Risk | Severity | Notes |
|---|---|---|
| Provider files untracked in git | High | `integrations/hermes/provider/` is `??`; can be lost by clean/reset |
| Checkpoint itself untracked | Medium | under `.hermes/` |
| Live Hermes config already mutated | Medium | currently uses `harness_mem` |
| Cloud LLM egress if LLM mode enabled | High | default provider still `openai`; no ALLOW gate in code |
| Branch behind origin by 32 | Medium | rebase/merge risk later |
| Unrelated dirty artifacts present | Medium | do not mix into provider commit |
| Prefetch noise | Low-Med | works, but can inject less relevant state dumps |
| MCP event-loop warning | Low | non-blocking so far |

---

## 11. Explicit Non-Actions

At this checkpoint, do **not** automatically:

- create a git commit unless user asks
- run live cloud LLM extraction
- claim `HARNESS_MEM_ALLOW_EXTERNAL_LLM` is enforced
- claim LLM default is already local-first
- mix freee/CANAI accounting work into this checkpoint
- delete/reset unrelated untracked files

---

## 12. Resume Instructions (for next session)

If resuming later:

1. Read this checkpoint file.
2. Read corrected plan:
   `.hermes/plans/2026-07-08_171500-hermes-provider-post-e2e-hardening.md`
3. Start with **Task 4 TDD** in `memory-server/src/consolidation/extractor.ts`.
4. Do not write docs claiming cloud gate / ollama default until Task 4 is green.
5. Keep Hermes Provider thin.
6. If durable VCS protection is needed, create a focused commit only for:
   - `integrations/hermes/provider/**`
   - relevant plan/docs
   - not unrelated `out/` / worktree artifacts

---

## 13. One-paragraph Resume Pack

Hermes MemoryProvider Layer 2 is implemented, unit-tested, deployed to `~/.hermes/plugins/harness_mem`, and activated with `memory.provider=harness_mem`. Live E2E proved turn recording (`obs_00mrbscxqh1fb9a76cf55be7c2`), search, prefetch, and second-session recall of marker `hm_provider_live_smoke_20260708_165739_purple_dragon_7788`. The post-E2E plan was self-reviewed and corrected: `shutdown()` already exists; `HARNESS_MEM_ALLOW_EXTERNAL_LLM` is not implemented; LLM mode provider default is currently `openai`. Next work must prioritize Task 4 safety (default to ollama + require external gate) before docs overclaim local-first. Provider code is still untracked in git.
