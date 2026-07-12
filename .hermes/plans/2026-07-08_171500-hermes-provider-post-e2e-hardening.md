# Hermes Provider Post-E2E Hardening Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** E2E が通った `harness_mem` Hermes MemoryProvider を、実運用で取りこぼし・ノイズ・再現不能を減らせる状態へ harden し、LLM 抽出の安全設計を「目標」ではなく「コードで強制」する。

**Architecture:** Hermes Provider は引き続き thin provider とする。`sync_turn()` は daemon `/v1/events/record` へ会話ターンを流し、`prefetch()` は daemon `/v1/search` から短い context を返す。LLM fact extraction は provider に入れず、既存の `memory-server/src/consolidation/` pipeline を使う。

**Tech Stack:** Python Hermes MemoryProvider plugin, TypeScript/Bun memory-server, SQLite harness-mem daemon, pytest, Bun test, Hermes CLI.

**Self-review status (2026-07-08):** 初版 plan に事実誤認があったため改訂済み。下記「0. Self-Review Findings」を正とする。

---

## Planning Quality Contract (2026-07-09 sync)

**Spec delta:** root `Spec.md` now contains `Fact extraction LLM egress contract (must)`: heuristic remains the runtime default; LLM mode defaults to loopback-only Ollama; non-loopback Ollama is rejected even when the external allow flag is set; OpenAI / Anthropic / Gemini require both `HARNESS_MEM_ALLOW_EXTERNAL_LLM=1` and provider credentials; both extraction paths share the gate; audit is metadata-only; live cloud E2E is prohibited.

**team_validation_mode:** `manual-pass`. Product / Architecture / Security / QA / Skeptic review is represented by the self-review findings below. The original plan had three factual errors and has been corrected: `shutdown()` already exists, `HARNESS_MEM_ALLOW_EXTERNAL_LLM` is not implemented, and LLM mode currently defaults to `openai`.

**formatter_baseline:** `partial_configured`. Root `package.json` has `bun run test` and benchmark gates; no generic `lint` / `format` script was confirmed during planning. Each source-changing task therefore carries targeted pytest / bun test / `git diff --check` validation. Adding a new repo-wide formatter is out of scope for this hardening plan.

**Plans.md sync:** canonical task ledger entry is `Plans.md` §156. This detailed plan is the implementation brief; §156 is the status source.

**Risk gates:** do not read secrets, do not run live cloud LLM calls, do not mutate live Hermes config/plugin without explicit approval, and do not put LLM extraction logic inside the Hermes provider.

---

## 0. Self-Review Findings

### Finding A — H156-002 は「未実装」ではない

`integrations/hermes/provider/harness_mem/__init__.py` には既に存在する。

```python
def shutdown(self) -> None:
    if self._sync_thread and self._sync_thread.is_alive():
        self._sync_thread.join(timeout=10.0)
```

初版 plan の「`shutdown()` を追加する / Expected FAIL because not implemented」は誤り。

正しい H156-002:

- 既存 `shutdown()` の regression test を追加する
- 必要なら `_lock` で thread 参照を読み、timeout を 5s vs 10s で明文化する
- 新規に「未実装の shutdown を作る」作業はしない

### Finding B — `HARNESS_MEM_ALLOW_EXTERNAL_LLM` はコードに存在しない

repo 全体検索結果: **0 hits**。

`isExternalLlmProvider()` は存在するが、用途は主に **egress audit 分類**であり、**外部 LLM 呼び出しを阻止する gate ではない**。

初版 plan / 説明文の

```text
Cloud providers require HARNESS_MEM_ALLOW_EXTERNAL_LLM=1
```

は **desired policy** であり、**current code behavior ではない**。

### Finding C — LLM mode の provider default は `openai`

`memory-server/src/consolidation/extractor.ts`:

```ts
const provider = (process.env.HARNESS_MEM_FACT_LLM_PROVIDER || "openai").trim().toLowerCase();
```

つまり:

| 状態 | 実際 |
|---|---|
| default extractor mode | `heuristic`（安全） |
| `HARNESS_MEM_FACT_EXTRACTOR_MODE=llm` だけ設定 | provider default は **`openai`** |
| cloud gate | **未実装** |
| OpenAI key が env にある場合 | LLM mode 有効化だけで外部送信し得る |

local-first は「推奨方針」であり、LLM mode のコード default はまだ local-first ではない。

### Finding D — 全体アーキテクチャ判断は正しい

以下は維持する。

```text
Hermes Provider = thin connection layer
LLM extraction = memory-server consolidation pipeline
cross-tool coding memory を優先
```

問題は戦略ではなく、**安全ゲートの実装状態を過大に記述したこと**。

---

## 1. Current Context

### E2E 完了済み

実 Hermes 環境で以下を確認済み。

- Provider 配置: `~/.hermes/plugins/harness_mem`
- Hermes config: `memory.provider=harness_mem`
- Backup: `~/.hermes/config.yaml.bak.harness_mem_provider.20260708164918`
- Discovery: `discover_memory_providers()` で `harness_mem` available
- Load: `load_memory_provider('harness_mem')` が `HarnessMemMemoryProvider` を返す
- Tools: `harness_mem_search`, `harness_mem_record`, `harness_mem_status`
- Live record session: `20260708_165742_49e528`
- Saved observation: `obs_00mrbscxqh1fb9a76cf55be7c2`
- Smoke marker: `hm_provider_live_smoke_20260708_165739_purple_dragon_7788`
- Search: `harness_mem_search("purple dragon 7788")` で marker hit
- Prefetch: `prefetch()` が `## harness-mem Context` と marker を返す
- Second live recall session: `20260708_170910_4774a8` が marker を回答

### この plan の scope

1. Hermes Provider post-E2E hardening
2. LLM extraction の **安全ゲート実装**（desired → enforced）
3. docs を current vs target で正確に書く

既存 plan `2026-07-07_192525-hermes-provider-local-first-llm-extraction.md` の大方針は維持する。ただし「cloud gate 済み」「LLM default=local」という表現は、この plan でコード実装するまで docs に書かない。

---

## 2. Non-Goals

- Hermes Provider 内に LLM fact extraction を実装しない。
- Hermes 本体を fork / patch しない。
- Cloud LLM の live E2E を実行しない（mock test のみ）。
- Live Ollama extraction smoke をこの plan の必須完了条件にしない（別 Task として任意）。
- API key / prompt / response body をログや audit に残さない。

---

## 3. Tasks

### Canonical Task Mapping

| Plans.md ID | Detailed task | Required order |
|---|---|---|
| H156-000 | Current-behavior preflight and baseline capture | first |
| H156-001 | LLM local-first default, loopback enforcement, and cloud gate | after H156-000 |
| H156-002 | Existing `shutdown()` regression coverage | after H156-000 |
| H156-003 | Stable bounded `prefetch()` post-ranking | after H156-002 |
| H156-004 | `metadata: null` investigation and safe allowlist | after H156-000 |
| H156-005 | Layer 2 MemoryProvider setup / rollback docs | after H156-002, H156-003 |
| H156-006 | Canonical LLM status and environment-variable docs | after H156-001 |
| H156-007 | Optional loopback Ollama live smoke | after H156-001, H156-006 |
| H156-008 | Future setup automation design note | after H156-005 |

### H156-000: Current-behavior preflight and baseline capture

**Objective:** implementation前に、self-reviewで確定したcurrent behaviorと今回追加したsecurity gapを根拠行・baseline testで固定する。

**DoD:**

- `shutdown()` は既存である
- fact provider default は現状 `openai`
- `HARNESS_MEM_ALLOW_EXTERNAL_LLM` は未実装である
- `callOllama()` は現状任意HTTP(S) hostを許可し、remote Ollamaをexternal auditしない
- provider tests 9件、LLM/egress tests 16件、`git diff --check` がPASS
- evidenceをH156-000 closeoutまたはPlans.md statusへ記録

### H156-002: Add regression coverage for existing `shutdown()` flush

**Objective:** 既に存在する `shutdown()` の取りこぼし防止をテストで固定する。必要なら `_lock` 読みと timeout 方針を整理する。

**Priority:** High
**Risk:** Low

**Files:**

- Modify: `integrations/hermes/provider/harness_mem/__init__.py`（必要時のみ）
- Modify: `integrations/hermes/provider/tests/test_provider.py`

**Current code:**

```python
def shutdown(self) -> None:
    if self._sync_thread and self._sync_thread.is_alive():
        self._sync_thread.join(timeout=10.0)
```

**Step 1: Write failing test for current contract**

```python
def test_shutdown_waits_for_pending_sync_thread():
    provider = HarnessMemMemoryProvider()
    provider.initialize(session_id="s1")
    joined = {"called": False, "timeout": None}

    class FakeThread:
        def is_alive(self):
            return True
        def join(self, timeout=None):
            joined["called"] = True
            joined["timeout"] = timeout

    provider._sync_thread = FakeThread()
    provider.shutdown()
    assert joined["called"] is True
    assert joined["timeout"] in (5.0, 10.0)
```

**Step 2: Run test**

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  integrations/hermes/provider/tests/test_provider.py::test_shutdown_waits_for_pending_sync_thread -v --tb=short
```

Expected: PASS if current implementation is sufficient; FAIL only if test expects lock behavior not present.

**Step 3: Optional tighten**

If desired, change implementation to:

```python
def shutdown(self) -> None:
    with self._lock:
        thread = self._sync_thread
    if thread and thread.is_alive():
        thread.join(timeout=5.0)
```

Decision rule:

- keep `10.0` if write latency is sometimes slow on large DB
- use `5.0` if exit latency is more important
- document chosen timeout in test assertion

**Step 4: Run provider suite**

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  integrations/hermes/provider/tests/test_provider.py -v --tb=short
```

Expected: all pass.

---

### H156-003: Reduce `prefetch()` noise without over-filtering

**Objective:** marker などの直接ヒットを優先し、関係ない Hermes state / backfill dump を過剰に混ぜない。ただし cross-tool relevant memory は消さない。

**Priority:** High
**Risk:** Medium

**Files:**

- Modify: `integrations/hermes/provider/harness_mem/__init__.py`
- Modify: `integrations/hermes/provider/tests/test_provider.py`

**Design rule:**

Do **not** hard-filter to only `tags=["hermes", "turn"]`.

Prefer:

1. provider-side deterministic, bounded, stable post-ranking
2. preserve daemon order as the tie-break and do not let tag boosts dominate a strongly relevant server result
3. boost direct `hermes/turn` hits only when normalized query evidence matches
4. demote obvious `hermes_state_db` / backfill tool-call dumps that do not match query evidence
5. keep strongly relevant cross-tool observations
6. support Japanese no-space queries; whitespace-only tokenization is not sufficient

**Step 1: Inspect search item fields**

Confirm available fields in live `/v1/search` items:

- `id`, `title`, `content`, `tags`, `metadata`, `session_id`, `platform`, `project`, `reason`, `scores`

**Step 2: Write tests**

```python
def test_prefetch_prefers_direct_hermes_turn_hits():
    ...

def test_prefetch_does_not_drop_cross_tool_relevant_items():
    ...

def test_prefetch_handles_japanese_query_without_spaces():
    ...

def test_prefetch_preserves_daemon_order_on_equal_post_rank_score():
    ...
```

Fixture mix:

1. `tags=["hermes","turn"]`, content contains query marker
2. `tags=["hermes","hermes_state_db","backfill"]`, weak relevance
3. cross-tool observation with strong relevance

Expected:

- direct hermes turn appears high
- weak backfill is not preferred over direct turn
- relevant cross-tool item is retained
- unrelated `hermes/turn` does not outrank a strong cross-tool result by tag alone
- Japanese no-space query gets deterministic matching behavior
- equal post-rank scores preserve the daemon's original order

**Step 3: Implement minimal scoring helper**

Non-normative sketch only; implementation must satisfy the bounded/stable/Japanese tests above rather than copy a whitespace-only scorer:

```python
def _prefetch_item_score(item: dict, query: str) -> int:
    tags = set(item.get("tags") or [])
    text = f"{item.get('title','')} {item.get('content','')}".lower()
    q = query.lower()
    score = 0
    if "hermes" in tags and "turn" in tags:
        score += 3
    if any(tok and tok in text for tok in q.split()):
        score += 2
    if "hermes_state_db" in tags and q not in text:
        score -= 2
    return score
```

**Step 4: Run unit tests**

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest \
  integrations/hermes/provider/tests/test_provider.py -v --tb=short
```

**Step 5: Optional live smoke**

Use a **new** marker, not the old one.

```bash
MARKER="hm_provider_prefetch_noise_smoke_$(date +%Y%m%d_%H%M%S)_purple_dragon_9911"
hermes chat -q "Hermes provider prefetch noise smoke. Please reply exactly: ACK $MARKER" -Q --max-turns 3 --source cli
```

---

### H156-004: Investigate `metadata: null` on provider-created search results

**Objective:** provider が `metadata={"source":"hermes_memory_provider"}` を送っているのに search 結果が `metadata: null` になる理由を特定する。

**Priority:** Medium
**Risk:** Medium (privacy)

**Files likely to inspect:**

- `memory-server/src/server.ts`
- `memory-server/src/core/search*.ts`
- `memory-server/src/core/observations*.ts`
- `memory-server/src/middleware/validator.ts`
- related unit/integration tests

**Outcomes allowed:**

1. intentional omission for privacy → document only, no behavior change
2. stored but not selected → safe allowlist return
3. provider payload shape wrong → fix provider
4. dropped during ingest → fix ingest mapping

**Safety rule:**

If metadata is returned, allowlist only safe keys (e.g. `source`). Never return:

- prompt / response body
- API keys / tokens
- secrets / credentials

**Verification:**

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test memory-server/tests/unit/<target>.test.ts
bun test memory-server/tests/integration/<target>.test.ts
```

---

### H156-001: Enforce LLM local-first default + external cloud gate  **[SAFETY]**

**Objective:** desired policy を code で強制する。

1. LLM mode の provider default を `openai` から `ollama` に変更する
2. Ollama は `localhost` / `127.0.0.1` / `::1` のloopback HTTP(S)だけ許可する
3. non-loopback Ollama は `HARNESS_MEM_ALLOW_EXTERNAL_LLM=1` があっても拒否し、fetch 0にする
4. external provider (`openai` / `anthropic` / `gemini`) は allow flag + provider credentialの両方がない限り呼ばない
5. `extractFacts()`→`llmExtract()` と `llmExtractWithDiff()` の両経路に同一gateを適用する
6. unit test でcloud callをmockし、live cloudは呼ばない

**Priority:** Highest among remaining safety work
**Risk:** High if skipped

**Files:**

- Modify: `memory-server/src/consolidation/extractor.ts`
- Possibly modify: `memory-server/src/consolidation/worker.ts` if call path also needs guard
- Modify/Add tests:
  - `memory-server/tests/unit/llm-multi-provider.test.ts`
  - `memory-server/tests/unit/external-egress-audit.test.ts`
  - both files must isolate `HARNESS_MEM_ALLOW_EXTERNAL_LLM` in `ENV_KEYS`

**Step 1: Write failing tests first**

Required cases:

1. `HARNESS_MEM_FACT_EXTRACTOR_MODE=llm` + no provider env
   → uses loopback `ollama`; cloud fetch 0
2. `provider=ollama` + `HARNESS_MEM_OLLAMA_HOST=https://ollama.example.com`
   → fetch 0 with allow flag absent **and** present
3. `provider=openai` + API key set + **no** `HARNESS_MEM_ALLOW_EXTERNAL_LLM`
   → does **not** call OpenAI; returns empty / falls back safely
4. `provider=openai` + API key set + `HARNESS_MEM_ALLOW_EXTERNAL_LLM=1`
   → may call mocked OpenAI path
5. `provider=ollama` + loopback host
   → allowed without external gate
6. `extractFacts()` blocked path
   → no external fetch and deterministic heuristic fallback
7. `llmExtractWithDiff()` blocked path
   → no external fetch and empty diff result
8. both test files add `HARNESS_MEM_ALLOW_EXTERNAL_LLM` to `ENV_KEYS` setup/cleanup
9. audit/log output does **not** contain prompt, response body, API key, token, or secret

**Step 2: Run tests RED**

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test memory-server/tests/unit/llm-multi-provider.test.ts
bun test memory-server/tests/unit/external-egress-audit.test.ts
```

**Step 3: Implement gate and default**

In `extractor.ts`:

```ts
function externalLlmAllowed(): boolean {
  return (process.env.HARNESS_MEM_ALLOW_EXTERNAL_LLM || "").trim() === "1";
}
```

Add a shared loopback validator following existing `query-rewrite.ts` / `llm-reranker.ts` behavior. `callOllama()` must return without fetch for non-loopback hosts. Do not treat remote Ollama as local or as an allow-flag exception.

Change defaults:

```ts
// before
const provider = (process.env.HARNESS_MEM_FACT_LLM_PROVIDER || "openai")...

// after
const provider = (process.env.HARNESS_MEM_FACT_LLM_PROVIDER || "ollama")...
```

Apply in both:

- `llmExtract(...)`
- `llmExtractWithDiff(...)`

Before external calls:

```ts
if (isExternalLlmProvider(provider) && !externalLlmAllowed()) {
  return []; // or empty FactDiffResult
}
```

Also verify worker path does not bypass extractor guard.

**Step 4: Run tests GREEN**

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test memory-server/tests/unit/llm-multi-provider.test.ts
bun test memory-server/tests/unit/external-egress-audit.test.ts
```

**Step 5: Do not run live cloud**

Cloud paths are mock-only. Live extraction smoke, if any, uses loopback Ollama only.

---

### H156-005: Documentation update for Layer 2 MemoryProvider

**Objective:** E2E で通った Hermes MemoryProvider 手順を再現可能にする。

**Priority:** High
**Risk:** Low

**Files:**

- Modify: `integrations/hermes/README.md`
- Modify: `docs/integrations/hermes.md`
- Optional: `README.md` / `README_ja.md` if tier text needs update

**Content:**

#### Layer distinction

```text
Layer 1: MCP tool integration
- explicit harness_mem_search / record tools
- model calls tools when needed

Layer 2: Hermes MemoryProvider
- sync_turn() records completed turns
- prefetch() injects relevant context before next turn
- provider exposes search/record/status tools
```

#### Setup

```bash
mkdir -p "$HOME/.hermes/plugins/harness_mem"
rsync -a --delete integrations/hermes/provider/harness_mem/ "$HOME/.hermes/plugins/harness_mem/"
hermes config set memory.provider harness_mem
```

#### Discovery / live smoke / search / rollback

Include concrete commands from the successful E2E.

#### Non-blocking warning

Document:

```text
RuntimeError: Event loop is closed
```

as Hermes MCP cleanup noise unless correlated with missing memory writes.

**Verification:**

```bash
git diff --check
```

---

### H156-006: Documentation update for accurate LLM status

**Objective:** docs で current vs target を混同しない。

**Priority:** High
**Risk:** Medium if wrong wording remains

**Files:**

- Modify: `docs/integrations/hermes.md`
- Modify: `integrations/hermes/README.md`
- Modify: `docs/environment-variables.md`（canonical default / new flag / loopback rule / variable index）
- Reference: `.hermes/plans/2026-07-07_192525-hermes-provider-local-first-llm-extraction.md`

**Required accurate wording after H156-001 lands:**

```text
LLM fact extraction is NOT implemented in the Hermes provider.
Hermes provider is intentionally thin:
- sync_turn() -> /v1/events/record
- prefetch() -> /v1/search
- on_session_end() -> optional consolidation trigger

Fact extraction lives in memory-server/src/consolidation/.
Default extractor mode is heuristic.
LLM mode is explicit via HARNESS_MEM_FACT_EXTRACTOR_MODE=llm.
LLM provider default is ollama (local-first).
Ollama fact extraction is loopback-only; non-loopback Ollama is rejected even when the external allow flag is set.
Cloud providers (openai/anthropic/gemini) require both HARNESS_MEM_ALLOW_EXTERNAL_LLM=1 and the provider credential.
Audit records metadata only; never prompt/response body.
Live Ollama extraction E2E is optional and separate.
```

**Before H156-001 lands, docs must not claim the cloud gate exists.**

If docs are written before H156-001, use:

```text
Current:
- default mode = heuristic
- LLM mode provider default is currently openai unless changed
- external cloud gate is not yet enforced

Target / after H156-001:
- LLM mode provider default = ollama
- Ollama fact extraction = loopback-only; remote rejected
- external cloud providers require HARNESS_MEM_ALLOW_EXTERNAL_LLM=1 plus provider credential
```

**Verification:**

- docs do not instruct putting API keys into repo files
- docs do not claim live Ollama E2E has passed unless run
- docs do not claim cloud gate exists before H156-001 merges
- `docs/environment-variables.md` and its variable index contain `HARNESS_MEM_ALLOW_EXTERNAL_LLM`, default=`ollama`, and loopback-only semantics

---

### H156-007 (optional): Live loopback Ollama LLM extraction smoke against real Hermes turns

**Objective:** Hermes turn → consolidation → loopback Ollama fact extraction → fact/search の live path を確認する。

**Priority:** Medium
**Risk:** Medium (local model availability)

**Do only after H156-001 and H156-006.**

Steps:

1. Confirm Ollama is running
2. Confirm model exists (e.g. `qwen3.5:9b` or documented default)
3. Confirm host is exactly loopback (`localhost`, `127.0.0.1`, or `::1`); abort otherwise
4. Set:

```bash
HARNESS_MEM_FACT_EXTRACTOR_MODE=llm
HARNESS_MEM_FACT_LLM_PROVIDER=ollama
HARNESS_MEM_FACT_LLM_MODEL=qwen3.5:9b
HARNESS_MEM_OLLAMA_HOST=http://127.0.0.1:11434
# do NOT set HARNESS_MEM_ALLOW_EXTERNAL_LLM
```

5. Record a fact-rich Hermes turn
6. Trigger consolidation
7. Verify facts/search
8. Verify no external egress audit row

Non-goal: do not call remote Ollama or OpenAI/Anthropic/Gemini live.

---

### H156-008 (future): Setup automation sketch

**Objective:** future `harness-mem setup --platform hermes` の設計メモ。実装はこの plan の必須完了条件にしない。

**Priority:** Low

Desired behavior:

```bash
harness-mem setup --platform hermes
```

1. daemon health check
2. locate Hermes home
3. copy provider files
4. backup config
5. dry-run by default; `--apply` for mutation
6. discovery check
7. print live smoke + rollback instructions

Safety:

- never print secrets
- never mutate other Hermes profiles unless explicitly targeted

---

## 4. Validation Matrix

| Area | Command | Expected |
|---|---|---|
| Provider unit | `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest integrations/hermes/provider/tests/test_provider.py -v --tb=short` | PASS |
| Bridge regression | `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest integrations/hermes/plugin/tests/test_plugin.py -v --tb=short` | PASS |
| LLM multi-provider unit | `export PATH="$HOME/.bun/bin:$PATH"; bun test memory-server/tests/unit/llm-multi-provider.test.ts` | both extraction paths gated; remote Ollama fetch 0; PASS |
| External egress unit | `export PATH="$HOME/.bun/bin:$PATH"; bun test memory-server/tests/unit/external-egress-audit.test.ts` | ambient allow env isolated; cloud allow/deny + metrics-only audit PASS |
| Markdown whitespace | `git diff --check` | PASS |
| Live provider discovery | Python loader from `~/.hermes/hermes-agent` | `available=True` |
| Live record/search | marker smoke + `/v1/search` | marker observation hit |
| Live prefetch | second `hermes chat` recall | exact marker returned |
| Cloud live E2E | — | **Do not run** |

---

## 5. Risks and Mitigations

### Risk 1: Over-filtering prefetch

Hard filter to `hermes/turn` only would hide useful Claude Code / Codex / Cursor memory.

**Mitigation:** scoring/boosting, not hard exclusion.

### Risk 2: Shutdown wait slows exit

**Mitigation:** bounded join timeout; only when thread is alive.

### Risk 3: Metadata exposure

Returning metadata can leak unsafe fields.

**Mitigation:** explicit allowlist only.

### Risk 4: MCP cleanup warning false alarm

```text
RuntimeError: Event loop is closed
```

**Mitigation:** document as non-blocking unless missing writes correlate.

### Risk 5: Docs overclaim LLM safety

This already happened in plan v1.

**Mitigation:** H156-001 must land before docs claim cloud gate / ollama default as current behavior.

### Risk 6: Enabling LLM mode currently risks cloud egress

Current code default provider is `openai` when mode=llm.

**Mitigation:** H156-001 is safety-critical and should precede optional live extraction docs.

### Risk 7: Remote Ollama is mislabeled as local

`HARNESS_MEM_OLLAMA_HOST` currently accepts any HTTP(S) host while egress classification assumes Ollama is loopback.

**Mitigation:** H156-001 adds an explicit loopback validator and tests non-loopback fetch=0 with the allow flag both absent and present.

---

## 6. LLM Extraction Status (corrected)

### Architecture (correct, keep)

```text
Claude Code / Codex / Cursor / Hermes
        ↓
harness-mem daemon / events / observations
        ↓
consolidation worker
        ↓
heuristic or LLM fact extraction
        ↓
mem_facts / recall / search / graph
```

Hermes Provider does **not** own LLM extraction.

### Current code (as of this self-review)

```text
Default mode: heuristic
LLM mode provider default: openai
External cloud gate: NOT implemented
isExternalLlmProvider(): audit classification helper exists
External egress audit: partial / path-dependent; do not overclaim full coverage until verified
Live Hermes→Ollama extraction E2E: not run
```

### Target after H156-001

```text
Default mode: heuristic
LLM mode provider default: ollama
External cloud providers: blocked unless HARNESS_MEM_ALLOW_EXTERNAL_LLM=1
Loopback ollama: allowed without external gate
Non-loopback ollama: rejected regardless of allow flag
Audit: metadata only, no prompt/response body
```

---

## 7. Recommended Execution Order

1. **H156-000 → H156-001** — current behaviorを固定してからlocal-first / loopback / cloud gateを実装 **[SAFETY FIRST]**
2. **H156-002 → H156-003** — shutdown regressionとstable bounded prefetch hardening
3. **H156-004** — metadata null investigation
4. **H156-005 → H156-006** — MemoryProvider docsとcanonical LLM/env docs
5. **H156-007 / H156-008** — optional follow-ups

### Why H156-001 is first after preflight

Provider E2E は既に通っている。
今いちばん危険なのは「LLM を有効にした瞬間に、ドキュメント上の local-first と違う挙動で cloud に出る可能性」である。

### Minimal useful stop points

- Stop after H156-001 if only the safety fix is needed.
- Stop after H156-001+H156-002+H156-003 if operational hardening is enough.
- Stop after H156-005+H156-006 if documentation must be published.
- H156-007/H156-008 are optional follow-ups.

---

## 8. Decision

この plan は **そのままでは問題があった**。
ただしアーキテクチャ方針自体は正しい。

修正後の plan は実行してよい。
特に H156-001 は、docs に cloud gate を current behavior として書く前に必ず実装する。
