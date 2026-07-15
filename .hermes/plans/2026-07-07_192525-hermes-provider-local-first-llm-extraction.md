# Hermes Provider + Local-first LLM Extraction Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Hermes だけに閉じない、harness-mem 全体の cross-tool coding memory に LLM fact extraction を接続し、ローカルモデル default / クラウド opt-in の設計を明確化する。

**Architecture:** LLM 抽出は Hermes 専用機能にしない。`memory-server` の既存 consolidation pipeline を正本にし、Hermes Memory Provider は `sync_turn` / `on_session_end` から既存 daemon API に turn/event を流す薄い接続層にする。local-first は `ollama` default、cloud provider は明示 opt-in + audit とする。

**Tech Stack:** TypeScript/Bun memory-server, Python Hermes MemoryProvider plugin, SQLite harness-mem daemon, Ollama local LLM, optional OpenAI/Anthropic/Gemini cloud providers.

---

## 0. 結論 / Scope

### 回答

長期提案は **Hermes だけに限ったものではない**。

正しい設計は以下。

```text
Claude Code / Codex / Cursor / Hermes
        ↓
harness-mem daemon / events / observations
        ↓
consolidation worker
        ↓
heuristic または LLM fact extraction
        ↓
mem_facts / recall / search / graph
```

Hermes はこのパイプラインに入る 1 client であり、Hermes 自体に LLM 抽出を抱え込ませない。Hermes MemoryProvider は、Hermes の turn を harness-mem daemon に同期する接続層にする。

### 既にある実装

既存コード上、LLM 抽出基盤はかなり存在する。

- `memory-server/src/consolidation/extractor.ts`
  - `HARNESS_MEM_FACT_EXTRACTOR_MODE=heuristic|llm`
  - `llmExtractWithDiff(...)`
  - provider: `ollama`, `openai`, `anthropic`, `gemini`
  - `isExternalLlmProvider(...)`
  - external egress metadata
- `memory-server/src/consolidation/worker.ts`
  - consolidation 時に LLM mode なら `llmExtractWithDiff(...)` を使う
  - external provider call は `external.llm.call` audit
  - dreaming consolidation は local ollama default の設計あり
- `memory-server/tests/unit/llm-multi-provider.test.ts`
  - multi-provider LLM extraction tests
- `integrations/hermes/plugin/harness_mem_hermes_bridge/plugin.py`
  - 現状は lifecycle hook plugin
  - `on_session_start` / `on_session_end` のみ
  - MemoryProvider ABC 実装ではない

### 不足しているもの

不足は LLM 抽出そのものではなく、**Hermes MemoryProvider から既存 pipeline へ turn を流す接続**。

作るべきものは以下。

```text
integrations/hermes/provider/harness_mem/__init__.py
```

ここで Hermes MemoryProvider ABC を実装し、ByteRover 型にする。

---

## 1. Design Decisions

### D1. LLM extraction は harness-mem core の責務

- Hermes provider 内で LLM API を直接呼ばない。
- provider は daemon へ event / turn を送るだけ。
- 抽出、差分比較、supersedes、audit は `memory-server` 側に集約する。

理由:

- Claude Code / Codex / Cursor / Hermes の全ツールで同じ抽出品質を使える。
- provider ごとに抽出ロジックが分岐しない。
- local-first / cloud egress audit を一箇所で守れる。

### D2. local-first default

推奨 default:

```bash
HARNESS_MEM_FACT_EXTRACTOR_MODE=heuristic
```

LLM 抽出を明示的に使う場合:

```bash
HARNESS_MEM_FACT_EXTRACTOR_MODE=llm
HARNESS_MEM_FACT_LLM_PROVIDER=ollama
HARNESS_MEM_FACT_LLM_MODEL=qwen3.5:9b
HARNESS_MEM_OLLAMA_HOST=http://127.0.0.1:11434
```

cloud opt-in 例:

```bash
HARNESS_MEM_FACT_EXTRACTOR_MODE=llm
HARNESS_MEM_FACT_LLM_PROVIDER=openai
HARNESS_MEM_FACT_LLM_MODEL=gpt-4o-mini
HARNESS_MEM_OPENAI_API_KEY=...
```

または:

```bash
HARNESS_MEM_FACT_LLM_PROVIDER=anthropic
HARNESS_MEM_ANTHROPIC_API_KEY=...
```

```bash
HARNESS_MEM_FACT_LLM_PROVIDER=gemini
HARNESS_MEM_GEMINI_API_KEY=...
```

cloud provider 使用時は audit に provider/model/bytes のみ記録し、prompt/response body は記録しない。

### D3. Hermes Provider の `sync_turn()` は非同期

Hermes MemoryProvider contract に従い、`sync_turn()` は即 return する。

- daemon thread を使う
- 直列化のため前回 thread が生存していたら短時間 join
- LLM 抽出は同期実行しない
- 必要なら `on_session_end()` で consolidation request を送る

### D4. Positioning は Option 1 + LLM wiring

最終ポジションは Option 1。

```text
cross-tool coding memory
```

ただし、既存 LLM extractor を Hermes Provider 経由でも使えるようにする。つまり Option 2 は主戦略ではなく、Option 1 を強化する optional extraction layer として扱う。

---

## 2. Files likely to change

### Create

- `integrations/hermes/provider/harness_mem/__init__.py`
- `integrations/hermes/provider/harness_mem/plugin.yaml`
- `integrations/hermes/provider/README.md`
- `integrations/hermes/provider/tests/test_provider.py`

### Modify

- `integrations/hermes/README.md`
- `docs/integrations/hermes.md`
- `Plans.md`
- Optional: `scripts/lib/mcp-config.js` or setup docs only if provider install automation is included

### Mostly reuse, avoid rewriting

- `memory-server/src/consolidation/extractor.ts`
- `memory-server/src/consolidation/worker.ts`
- `memory-server/tests/unit/llm-multi-provider.test.ts`

---

## 3. Hermes MemoryProvider mapping

| Hermes MemoryProvider method | harness-mem behavior |
|---|---|
| `name` | return `harness_mem` |
| `is_available()` | local filesystem/binary check only; no daemon HTTP call |
| `initialize(session_id, **kwargs)` | store `session_id`, `hermes_home`, env config |
| `get_tool_schemas()` | expose minimal search/record/status tools or proxy to daemon-compatible tools |
| `handle_tool_call(tool_name, args, **kwargs)` | call daemon HTTP endpoints |
| `prefetch(query, session_id="")` | call `/v1/search` or `/v1/recall`, return compact context string |
| `sync_turn(user, assistant, session_id="", messages=None)` | async thread posts events to `/v1/events/record` |
| `on_session_end(messages)` | optionally request consolidation for session |
| `on_memory_write(action, target, content)` | mirror durable memory write as observation/checkpoint |
| `shutdown()` | join worker thread briefly |

---

## 4. Implementation Tasks

### Task 1: Confirm existing LLM extraction contract

**Objective:** Treat existing extractor as the shared core and avoid reimplementation.

**Files:**
- Read: `memory-server/src/consolidation/extractor.ts`
- Read: `memory-server/src/consolidation/worker.ts`
- Test: `memory-server/tests/unit/llm-multi-provider.test.ts`

**Steps:**

1. Verify `extractFacts(...)` default is heuristic.
2. Verify `llmExtractWithDiff(...)` supports `ollama`, `openai`, `anthropic`, `gemini`.
3. Verify cloud egress is represented only as metadata.
4. Run:

```bash
bun test memory-server/tests/unit/llm-multi-provider.test.ts
```

Expected: PASS.

**Do not:** add a second extractor inside the Hermes provider.

---

### Task 2: Create Hermes MemoryProvider skeleton

**Objective:** Add an out-of-tree Hermes MemoryProvider plugin directory.

**Files:**
- Create: `integrations/hermes/provider/harness_mem/__init__.py`
- Create: `integrations/hermes/provider/harness_mem/plugin.yaml`
- Create: `integrations/hermes/provider/tests/test_provider.py`

**Implementation requirements:**

- Include `MemoryProvider` or `register_memory_provider` string within first 8192 chars of `__init__.py`.
- Use ByteRover pattern.
- `is_available()` must not call daemon HTTP.
- `sync_turn()` must be non-blocking.
- Use env:
  - `HARNESS_MEM_URL`, default `http://127.0.0.1:37888`
  - `HARNESS_MEM_TOKEN`
  - `HARNESS_MEM_PROJECT_KEY`, default `default`

**Test expectation:**

```bash
cd integrations/hermes/provider && pytest
```

Expected:

- provider can be imported
- `is_available()` does not call network
- `sync_turn()` returns quickly
- mocked HTTP call receives `/v1/events/record`

---

### Task 3: Wire `sync_turn()` to `/v1/events/record`

**Objective:** Store Hermes user/assistant turn as harness-mem observations.

**Event shape:**

Use payload content, not top-level content only.

```json
{
  "event": {
    "platform": "hermes",
    "project": "<HARNESS_MEM_PROJECT_KEY>",
    "session_id": "<session_id>",
    "event_type": "assistant_response",
    "title": "Hermes turn",
    "content": "<compact turn text>",
    "payload": {
      "title": "Hermes turn",
      "content": "<compact turn text>",
      "user": "<user text>",
      "assistant": "<assistant text>"
    },
    "tags": ["hermes", "turn"],
    "metadata": {
      "source": "hermes_memory_provider"
    }
  }
}
```

**Important:** `payload.content` is required; otherwise content can be stored as `{}` and become unsearchable.

**Test expectation:** mocked request body includes `payload.content` with non-empty string.

---

### Task 4: Add optional session-end consolidation trigger

**Objective:** Let Hermes sessions trigger existing fact extraction without blocking turns.

**Preferred behavior:**

- `sync_turn()` records raw turns only.
- `on_session_end()` sends a consolidation request.
- If `HARNESS_MEM_FACT_EXTRACTOR_MODE=llm`, existing worker uses local/cloud provider config.

Candidate daemon endpoint:

```text
POST /v1/admin/consolidation/run
```

Body:

```json
{
  "reason": "hermes_session_end",
  "project": "<project>",
  "session_id": "<session_id>",
  "limit": 50
}
```

If endpoint shape differs, inspect `memory-server/src/server.ts` and `memory-server/src/consolidation/worker.ts` before implementing.

**Risk:** Do not run consolidation synchronously inside `sync_turn()`.

---

### Task 5: Add `prefetch()` recall/search

**Objective:** Hermes gets compact context before each turn.

**Preferred route:**

1. Try `/v1/recall` if project/session scope is available.
2. Fallback to `/v1/search` with safe settings.
3. Return compact plain text with source ids and titles.

**Constraints:**

- no private content unless explicitly configured
- bounded result count
- no broad unscoped search by default

**Test expectation:** mocked daemon search response becomes a compact string under token budget.

---

### Task 6: Document local/cloud extraction config

**Objective:** Make CJ’s desired operating model explicit.

**Files:**
- Modify: `integrations/hermes/README.md`
- Modify: `docs/integrations/hermes.md`

**Docs must say:**

- LLM extraction is not Hermes-only.
- Hermes provider only feeds events into harness-mem.
- Default is heuristic unless LLM mode is explicitly enabled.
- Recommended LLM mode is local Ollama.
- Cloud providers require explicit env vars and are audited as external egress.
- Single-provider rule: Hermes can activate only one external memory provider at a time.

**Example local config:**

```bash
export HARNESS_MEM_FACT_EXTRACTOR_MODE=llm
export HARNESS_MEM_FACT_LLM_PROVIDER=ollama
export HARNESS_MEM_FACT_LLM_MODEL=qwen3.5:9b
export HARNESS_MEM_OLLAMA_HOST=http://127.0.0.1:11434
```

**Example cloud config:**

```bash
export HARNESS_MEM_FACT_EXTRACTOR_MODE=llm
export HARNESS_MEM_FACT_LLM_PROVIDER=openai
export HARNESS_MEM_FACT_LLM_MODEL=gpt-4o-mini
export HARNESS_MEM_OPENAI_API_KEY=...
```

---

### Task 7: Update Plans.md

**Objective:** Add a dedicated section/task group for Hermes provider + local-first LLM extraction wiring.

**Files:**
- Modify: `Plans.md`

**Suggested section title:**

```text
§155 Hermes MemoryProvider + Local-first LLM Extraction Wiring
```

**Initial task rows:**

- `S155-000` — Spec/ADR freeze: extraction is core, Hermes provider is glue
- `S155-001` — Provider skeleton + discovery contract
- `S155-002` — `sync_turn` event recording with `payload.content`
- `S155-003` — `on_session_end` consolidation trigger
- `S155-004` — `prefetch` scoped recall/search
- `S155-005` — local Ollama E2E smoke
- `S155-006` — docs/setup/provider install guidance

Status starts as `cc:TODO` unless implementation begins.

---

## 5. Validation Plan

### Unit tests

```bash
bun test memory-server/tests/unit/llm-multi-provider.test.ts
```

```bash
cd integrations/hermes/provider && pytest
```

### Integration tests

If provider tests can start a local fake daemon:

```bash
cd integrations/hermes/provider && pytest -k "sync_turn or prefetch or consolidation"
```

### Existing memory-server checks

```bash
bun test memory-server/tests/integration/
cd memory-server && bun run typecheck
git diff --check
```

### Local Ollama smoke, optional

Only if Ollama/model is available locally:

```bash
export HARNESS_MEM_FACT_EXTRACTOR_MODE=llm
export HARNESS_MEM_FACT_LLM_PROVIDER=ollama
export HARNESS_MEM_FACT_LLM_MODEL=qwen3.5:9b
export HARNESS_MEM_OLLAMA_HOST=http://127.0.0.1:11434
bun test memory-server/tests/unit/llm-multi-provider.test.ts -t ollama
```

Expected:

- if Ollama is mocked: PASS
- if live smoke: graceful fallback or PASS depending on local model availability

---

## 6. Risks / Tradeoffs

### R1. Hermes-only に見えるリスク

Mitigation: docs and code comments say extraction lives in `memory-server`, not provider.

### R2. local-first violation

Mitigation:

- default heuristic or local ollama
- cloud requires explicit env
- cloud egress audit records metadata only
- no prompt/response body in audit

### R3. `sync_turn()` latency

Mitigation:

- daemon thread only
- no LLM call inside provider
- consolidation at session end or background worker

### R4. Hermes single-provider rule

Mitigation:

- positioning remains cross-tool coding memory
- do not claim best Hermes-only memory accuracy
- explain switching cost from Mem0/Hindsight/Holographic

### R5. Duplicate plugin confusion

Current path:

```text
integrations/hermes/plugin/
```

is lifecycle hook plugin.

New path:

```text
integrations/hermes/provider/
```

is MemoryProvider plugin.

Docs must clearly separate them.

---

## 7. Open Questions

1. Default for LLM extraction should remain `heuristic`, or should Hermes provider setup offer a guided `ollama` opt-in?
2. Should `on_session_end()` always request consolidation, or only when `HARNESS_MEM_HERMES_CONSOLIDATE_ON_END=1`?
3. Should provider expose all MCP-style tools, or only `search`, `record`, `status` initially?
4. Which local model should be the recommended default: `qwen3.5:9b`, `llama3.2`, or an env-only user choice?
5. Should cloud provider use require an explicit `HARNESS_MEM_ALLOW_EXTERNAL_LLM=1` safety gate in addition to provider env?

---

## 8. Recommended Decision

Proceed with:

```text
Option 1 as north star
+ existing local-first LLM extraction wired through Hermes provider
```

Do not build a Hermes-only extractor.
Do not chase Mem0/Hindsight LoCoMo parity as the main goal.
Use LLM extraction as an optional quality layer for the shared cross-tool memory runtime.
