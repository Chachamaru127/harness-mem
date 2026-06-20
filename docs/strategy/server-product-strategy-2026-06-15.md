# harness-mem 製品・事業戦略 再構築（2026-06-15）

サーバー化 + 法人課金を見据えた製品戦略。本セッションの内部知見（granite 切替・hybrid moat・Pro API フック既存・サーバー化足場）に、外部リサーチ 6 角度（競合 JA 弱点 / 記憶可視化 UI / 大容量対策 / OTel→BigQuery / ZDR 埋め込み / 法人課金、15 agent・主張検証済み）を統合したもの。

## 結論（1 画面）

- **ポジション**: 「日本語と英語が混ざった作業ログを、混ざったまま引ける local-first 記憶ランタイム」。英語単体の長期記憶精度では戦わない（そう明言する）。
- **moat = 競合の構造的弱点 2 層**: (1) 英語デフォルトの dense 埋め込み（mem0 / Supermemory は `text-embedding-3-small` 既定、cross-lingual が最弱点）、(2) CJK を分割しない BM25 トークナイザ（SQLite FTS5 / fastembed は日本語キーワード検索が静かに崩れる）。harness-mem は granite（多言語）+ CJK-aware ハイブリッドで両層を同時に押さえる、唯一の end-user 向け local-first。
- **最初に作るもの**: 既存の約 375k granite index 上の **意味マップ（2D semantic map, deck.gl ScatterplotLayer）**。force-directed の「銀河グラフ」は flagship にしない（375k では hairball で無価値）。意味マップは「日英が同じ概念で隣接する」= moat が目で見える証拠になる。
- **大容量対策**: sqlite-vec に留めたまま **binary 粗選別 + float 再ランク**（32x 小・約 10x 速、品質は再ランクで保持）＋ 既存 consolidation / forget-policy の定期実行 + hot/cold 階層。1M+ で初めて LanceDB sidecar。
- **課金**: open-core + hybrid（定額 + 従量 overage）。Free(local) / Pro(~$20-40) / Team(~$200-300, SAML) / Enterprise(~$2,000 級, 3 本柱)。純 seat・純クラウド・純エンプラ営業は却下。
- **Pro 層決定 (2026-06-18)**: **C = granite-768（高精度設定）+ ZDR/managed/team** を採用。free=granite-384 に対し「精度上乗せ + 統制」で差別化。D（クラウドモデル差し替え）は日英 cross-lingual moat を毀損するため却下。COGS は `docs/strategy/granite-serving-cogs-2026-06-16.md` で計測済（価格詰めの入力あり）。
- **3 本柱の置き場**: ZDR 埋め込み = Pro(標準) / Enterprise(ZDR)、OTel→BigQuery = Enterprise(データ egress / residency)、VPS/BigQuery 保存 = Enterprise(residency)。**保持期間 (retention) を課金軸にすると「記憶の肥大化」対策がそのまま売上になる**。
- **唯一の前提工事**: 既存 Pro フック (`registry.ts:289-309`) は今「adaptive の英語 leg を OpenAI に格上げ」配線。これを「granite route を ZDR 自前エンドポイントに格上げ」へ付け替えるのが pillar(b) 収益化の唯一の必須エンジニアリング。

**確信度: medium-high。** 競合の JA 弱点・市場の課金パターン・OTel/ZDR の制約は外部ソースで裏取り済み。弱いのは価格の具体値（granite serving COGS 未計測）と「viz が実際に moat を可視化できるか」（375k の 2D projection キャッシュ有無に依存）。

## 外部リサーチで補正/反証した主張（重要）

- granite-311m-r2 は **native 768 次元**、384 は MRL 切り詰めターゲット（「native 384」は誤り）。粗選別だけ強く切り詰め、再ランクは 384/768 で。
- harness-mem は **Sudachi を積んでいない**（SSOT 確認: `Intl.Segmenter` + CJK bigram + NFKC）。対外コピーは "CJK-aware hybrid tokenization" と書く。"Sudachi" は将来の賭けであり現状機能ではない。
- **OTel→BigQuery にネイティブ exporter は無い**（collector-contrib #34809 は not planned）。OTLP→Collector(googlecloudpubsub)→Pub/Sub→Cloud Function decode→BigQuery の「維持される Collector 構成」として売る。
- **ZDR はプロバイダの営業ゲート**で、しかも「API 呼び出しがモデルに残すもの」しか保証しない（周辺システムの保存は別問題）。だから granite を顧客 VPS で自前ホストし、ZDR を「資格取得」でなく「自分で付与」する方が監査上強い。

## Codex 独立レビュー結果（2026-06-15）

別 LLM（Codex）に本プラン + Spec.md を独立レビューさせた。**判定: APPROVE-WITH-CHANGES**（技術方向は大半 ADOPTED で追認）。確信度: 整合性 / コード追認 = high、市場・価格 = medium（検証を 4 件に絞ったため）。

**追認（ADOPTED）**: vector scaling（binary 粗選別 + float 再ランク / MRL / LanceDB 退避）、viz（意味マップ hero + ego-graph 限定）、OTel パイプライン構成、Pro フック再ポイント。

**要修正（must-fix、優先順）:**

1. **Spec.md との整合（最重要・owner 承認事項）** — Spec.md は「local-first / generic cloud memory API にはしない」「local memory を既定で export しない」を SSOT 宣言している。Enterprise の VPS/BigQuery/サーバー課金はこの境界を広げる。→ **Spec.md に修正条項が必要**: 管理/クラウド経路は「顧客所有・opt-in・継続性/データ所在のための拡張」に限り、既定 export や汎用クラウド memory API にはしない、と明記。SSOT 変更なので勝手に書かず owner 判断を仰ぐ。
2. **OTel exporter 名の誤記**（修正済み） — `googlepubsub` は誤り、正しくは `googlecloudpubsub`。Pub/Sub の protobuf decode / スキーマ変換は「任意の磨き」でなく**必須工程**。
3. **granite 引用の緩和**（修正済み） — 「strongest open sub-500M」は scope/日付を pin しないと言い過ぎ → 「one of the strongest」。arXiv 番号は HF model card に pin（contested のため本文は model card 参照に置換）。
4. **ZDR を標語から強制可能な統制へ** — `retention=0` だけでは不十分。request log / crash dump / metrics / cache / backup / support access / subprocessor まで no-persist を明文化して初めて監査に耐える。
5. **未検証の市場主張は仮定に降格** — 「Voyage が唯一の self-serve ZDR」「Anthropic の ZDR ゲート」「具体価格」は一次ソースで再確認するまで SSOT にしない。

**技術指摘（修正済み）**: binary 粗選別は dense leg の候補だけを絞り、BM25/RRF は自前の候補を union で出すこと。dense bit-vector prefilter で keyword hit が巻き込まれて落ちない「候補 union」セマンティクスを明示。

---

## Product, UX & Moat

### Positioning: the one sentence

**harness-mem is the local-first memory runtime that retrieves your Japanese-and-English work the way you actually wrote it — mixed.** Everything else (capture, resume, visualization, enterprise) hangs off that single defensible claim. We do not compete on English long-memory accuracy, and we say so out loud.

### Target user

The buyer is the owner's own shape: a **solo / SMB user who is both a coder and a businessperson, working bilingually in JA+EN**. This persona sits in a gap the market structurally ignores:

- **IDE memories** (Cursor, Windsurf, Cline) are coding-only, workspace-scoped, English-first, and not cross-tool. Cursor *removed* its native Memories feature in v2.1.x and now tells users to convert to static Rules files (*MemNexus, "How to Give Cursor Persistent Memory"*); Windsurf's Cascade memory is explicitly "long-lived prompt state," not a searchable knowledge base (*DigitalApplied, "Windsurf 2 Deep Dive"*); Cline's Memory Bank is a markdown-doc methodology, not a retrieval engine (*Cline docs, "Memory Bank"*).
- **Agent-memory APIs** (mem0, Zep, Supermemory, Letta) are cloud SDKs for *app builders*, not end-user tools, and they default to English-first embeddings.
- The cross-tool, local-first, end-user niche is occupied seriously only by **Pieces** — which positions on capture + local LLM and ships **no published Japanese tokenizer or JA-tuned embedding** (*Pieces, "Long-Term Memory"*).

So the persona has exactly one serious incumbent (Pieces) and we beat it on the two axes Pieces does not contest: **Japanese retrieval quality** and **measurement ownership**.

### Seamless UX vs named competitors

The UX wedge is not "more features," it is **zero-setup cross-tool capture that already speaks Japanese**. Concrete differentiators against named products:

- **Cross-tool by default.** Unlike Cursor/Windsurf/Cline (single-IDE, workspace-scoped), harness-mem captures coding *and* business logs across tools into one searchable local store via the launchd-managed daemon. The competitor category that even has the *data model* for rich memory (Zep/Graphiti, the official Anthropic MCP memory server) only exposes APIs/JSON — none ship a polished end-user surface (*GitHub, "modelcontextprotocol/servers — memory"*).
- **Local-first, no account, no egress.** Pieces is the only peer here; we match its local posture and add the JA retrieval it lacks.
- **Search that resolves a JA query against EN code and vice versa** — the everyday case for this user, and the thing every cloud competitor degrades on (see moat below).

### The JA-EN mixed-log moat — why competitors are structurally weak

This is the single most defensible wedge, and it is wide open. The weakness in competitors is **structural, at two layers**, not a missing toggle:

1. **The dense (embedding) leg.** mem0 and Supermemory default to OpenAI `text-embedding-3-small`; the rest use generic multilingual models. Non-English embeddings reach only roughly half to two-thirds of their English accuracy, and for Japanese specifically, string-similarity can beat dense embeddings outright due to script complexity (*Zilliz, "How do I select embedding models for non-English languages?"*; arXiv 2406.16892). Worse for *this* user: the **cross-lingual** case (JA query → EN doc, or the reverse) is the documented weakest spot — models strong at same-language multilingual retrieval are *not* the ones strong cross-lingual (*arXiv 2505.22118, "Multilingual vs Crosslingual Retrieval of Fact-Checked Claims"*).

2. **The keyword (BM25) leg.** Default full-text tokenizers (SQLite FTS5, fastembed BM25) **do not segment CJK at all**, so the keyword half of hybrid search silently collapses on Japanese unless a CJK-aware tokenizer is wired in. This is a documented bug class (*Tony Baloney, "Working with CJK text in GenAI pipelines"*; qdrant/fastembed #505).

**What harness-mem actually ships against both layers:**

- **Dense:** `granite-embedding-311m-r2` (native 768-dim, MRL-truncatable to 384), one of the strongest open sub-500M multilingual models — ~65.2 MTEB-multilingual (verify scope/date), Japanese among its 52 enhanced languages, Apache-2.0 — out-positioning the OpenAI-default cloud competitors on the JA axis (*IBM Granite Embedding R2 model card, Hugging Face* — pin the arXiv id to the card at implementation time). A granite index (~375k rows) is already built.
- **Keyword:** CJK-aware segmentation via `core-utils.tokenize` (Intl.Segmenter + CJK bigrams + NFKC normalization), fused with the dense leg through RRF plus a code-token dual query — current ranking is hybrid_v3 (FTS + vector).

> Correction to the research corpus, confirmed against our SSOT: harness-mem does **not** ship Sudachi. The "competitors" finding that claims "harness-mem already ships Sudachi" is false. We deliberately avoid a morphological analyzer and use Intl.Segmenter + CJK bigrams instead; BM25(Sudachi)+RRF is a *future* bet, not a shipped capability. External-facing copy must say "CJK-aware hybrid tokenization," never "Sudachi."

**Claim discipline (Constraint D2).** Public superiority messaging rests only on the *public* evidence above (granite's MTEB-multi result; the documented cross-lingual weakness of `text-embedding-3`). Our internal granite-beats-adaptive A/B — granite holds JA cross-lingual far above the e5 baseline — is **internal measurement only** and must never be quoted as validated external superiority. The externally defensible story is process: *we own a CodingMemory Bench and measure on real/neutral mixed corpora; the public position is that generic 95%-class English numbers fall to ~86–93% under a dev-workflow protocol* — measurement ownership, not a fixture screenshot.

### Dynamic memory-visualization UI — concrete design direction

**Do NOT ship a force-directed "galaxy graph" as the flagship.** The 2025–2026 consensus is that the auto network view is decorative past ~200–500 nodes — a hairball where you cannot tell a hub from a leaf, find a node without name search, or read any status/recency/importance signal (*Code Culture, "Obsidian's Graph View Is Beautiful and Almost Completely Useless"*). A ~375k-row index renders this view useless and would actively misrepresent the product. (Thresholds are community heuristics; link density matters as much as raw count.)

**Hero view: a semantic 2D map (the Nomic Atlas pattern), not a network.** Project the granite 384-dim embeddings into 2D (UMAP under ~50k items; an approximate/landmark projection above), color and cluster by metadata (tool, repo, session, decision-vs-pattern), with search-in-map fed by hybrid_v3 (*Nomic, "How to Visualize Embeddings with t-SNE, UMAP, and Nomic Atlas"*). This **weaponizes the moat visually**: because granite places a Japanese and an English statement of the same concept near each other, mixed logs form coherent bilingual clusters that English-only-embedding competitors physically cannot reproduce — the map *is* the proof.

**Second first-class view: a temporal timeline** (Zep/Graphiti bi-temporal pattern). Expose `valid_at` / superseded semantics so the user can scrub to "what did I decide on date X" and watch a decision be superseded rather than silently overwritten (*Zep, arXiv 2501.13956*). For a solo INTP this decision-lineage view is the genuinely useful dynamic UI, and it maps directly onto the decisions.md / patterns.md workflow the owner already lives in. We already have `graph` / `timeline` / `search_facets` MCP primitives to back it.

**Graph canvas: scoped to ego/local views only.** Reserve a node-link canvas for the *current* memory and its 1–2-hop neighbors — the one graph mode users agree stays useful at any size.

**Encode operational signal, not topology.** Node size = access frequency / hybrid-hit count; opacity = recency; halo = unresolved/orphan. This turns the surface from passive art into a dashboard (stale clusters, isolated decisions needing follow-up, hot recent work).

**Renderer choices (from the corpus):**
- Semantic map → **deck.gl `ScatterplotLayer`** (60fps to ~1M points; safe headroom for 375k) or **regl-scatterplot** (~20M in performance mode) (*deck.gl performance docs; regl-scatterplot README*). Hardware-dependent figures, so plan LOD.
- Ego/local graph → **sigma.js / react-flow / G6** where rich React nodes and labeled edges matter. **Do NOT** use sigma.js for the full set — its force layout stalls past ~50k edges (*sigma.js GitHub*).
- Full network (only if ever needed) → **cosmos.gl** (OpenJS, GPU force, 1M+ nodes), with the square-grid quantization caveat in dense regions (*OpenJS, "Introducing cosmos.gl"*; *Nightingale, "How to Visualize a Graph with a Million Nodes"*).

**Explicit anti-hairball strategy + node-count budget:**
- **On-screen budget: ~2,000 individual points max** before forcing aggregation; default the map to **~20–50 cluster blobs** (Louvain/Leiden community detection, collapsible — available in G6) rather than 375k points (*G6 GitHub*).
- **Open scoped, never to the universe:** default time-window (last 30 days) + repo/tool filter; re-project only the filtered subset.
- **Zoom-driven LOD:** cluster blobs when zoomed out, individual points on zoom-in.
- **Stable layout across sessions:** deterministic landmark/incremental projection — re-randomizing positions every load destroys spatial memory and is the silent killer of these tools.
- Consolidation/compress tooling (`harness_mem_compress`, `admin_consolidation`) feeds this: compressed memories become natural cluster centroids, tying the scale story to the viz.

**Human-in-the-loop curation as the premium differentiator** (the Heptabase lesson): let the user pin, group, and label edges on a saved board; auto-suggest edges from hybrid neighbors but let the human confirm/annotate, persisting via the existing `add_relation`. Contextual, human-placed relationships are what made Heptabase beat Obsidian's abstract graph (*Otio, "Heptabase vs Obsidian"*).

### What to build FIRST

**The semantic 2D map (deck.gl ScatterplotLayer) over the existing ~375k granite index, opened scoped (last 30 days / current repo), colored by metadata, with hybrid_v3 search-in-map.**

Rationale: (1) it is the single feature that turns the *already-built* granite index and the *already-existing* hybrid retrieval into something visible no competitor offers end users; (2) it makes the JA-EN moat literally legible — bilingual clusters are the demo; (3) it is lower risk than the graph/temporal work because it is points-not-edges (no force layout, no hairball failure mode) and the renderer ceiling sits comfortably above our data scale; (4) it reuses `search_facets` and the existing index rather than requiring new capture or schema. Build the temporal timeline second (decision lineage), and the ego-graph + curation board third. Demo the cluster-separation advantage on real/neutral mixed corpora only — never on self-seed fixtures.

## Technical Architecture

This section specifies the engineering for two problems the strategy depends on: keeping retrieval fast as memory grows, and delivering the three enterprise pillars without a rewrite. The guiding constraint is reuse — every recommendation lands on scaffolding that already exists in `memory-server/`, so the work is wiring and policy, not greenfield.

### 1. Large-capacity memory countermeasures

The trigger is concrete. A 375,142-row granite index is already built and sits in the exact zone where sqlite-vec's brute-force scan becomes user-visibly slow. sqlite-vec is brute-force only — no ANN index exists, and its own roadmap only aspires to "low millions." On the maintainer's own numbers a float query is ~75ms at 100k/384-dim but ~192ms even at 192-dim at 1M, and seconds at higher dimensions ("Introducing sqlite-vec v0.1.0," "The State of Vector Search in SQLite"). So at the current row count interactive search is already at risk, and pure accumulation makes it worse on both latency and quality (the forgetting literature is explicit that indiscriminate accumulation is misaligned with long-term reasoning — "Novel Memory Forgetting Techniques," arXiv 2604.02280).

The answer is two orthogonal axes that stack: shrink the index, and bound what enters it.

**1a. Two-pass vector index: binary coarse + float re-rank (stay on sqlite-vec).**
Current storage is `vec0(embedding float[N])` (`vector/providers.ts`, `db/schema.ts`); there is no bit-vector or quantized column yet. Add a binary-quantized companion column and make search a two-pass: a coarse Hamming scan over the bit vectors returns the top candidates, then re-rank that shortlist with the full float vectors. sqlite-vec supports bit vectors natively, giving roughly 32x space reduction and ~10x faster queries at ~5–10% quality loss; a 1M bit-vector query returns at ~124ms vs 8.52s for float at 3072-dim ("Introducing sqlite-vec v0.1.0"). Because the re-rank pass uses the original float vectors, hybrid_v3 ranking quality (BM25 + dense RRF + code-token) is preserved — the binary pass only narrows the candidate set the existing fusion sees. **Codex caveat:** scope the binary prefilter to the DENSE leg only — BM25/RRF must contribute its own candidates as a union, so keyword hits are never clipped by the dense bit-vector prefilter. This is the lowest-risk, highest-leverage move and it unblocks the 375k index without leaving the current stack.

**1b. MRL truncation as a stacked, near-free knob.**
granite-embedding-311m-multilingual-r2 is an MRL model; note the corpus correction that it is natively 768-dim with MRL truncation targets at 512/384/256/128 (the "311m is natively 384" framing is wrong — 384 is a truncation target). Quantization and MRL truncation are orthogonal and compose multiplicatively ("Matryoshka + Binary vectors," Vespa). Apply aggressive truncation only to the coarse pass and keep full dimensionality for re-rank, because the 2026 finding is that MRL's edge over plain truncation is large only under heavy truncation, not moderate ("To MRL or not to MRL," arXiv 2605.16608). Concretely: coarse = binary over a truncated MRL vector; re-rank = float at 384/768. Cite the public granite MTEB-multilingual figures for the JA story; do not present the internal granite-beats-adaptive A/B as validated external superiority (internal measurement only, per D2).

**1c. Consolidation + decay to bound the hot set — already half-built.**
Index size, not total history, is the thing to cap. The pieces exist and need policy and a schedule, not invention:
- `consolidation/worker.ts` + `extractor.ts` + `deduper.ts` already extract, dedupe, and supersede facts; `admin_consolidation_run` exposes it.
- `consolidation/forget-policy.ts` already implements a composite eviction score over three axes — access (a single retrieval is strong evidence of usefulness), `signal_score` (keyword importance), and age (protected under 30d, rising to full weight at 180d) — plus a TTL path that force-archives rows whose `expires_at` is in the past. This is exactly the semantic-relevance + recency-decay + access-frequency + importance composite the forgetting literature converges on ("Memory eviction and forgetting in AI agents," Mem0; arXiv 2604.02280).
- `current-value-compression.ts` already folds checkpoints into redacted summaries — the hierarchical-summarization lever (H-MEM / MemoryOS / TiMem) maps onto this directly.

What's missing is operational: `HARNESS_MEM_AUTO_FORGET` defaults off, so wire a scheduled consolidate+forget pass (the launchd-managed daemon is the natural host), and treat compressed summaries as cold-tier centroids.

**1d. Hot/cold tiering on existing columns.**
`mem_observations` already carries `memory_type`, `archived_at`, and `expires_at` with an index on `memory_type`. That is a hot/cold skeleton: hot = active rows in the live sqlite-vec index; cold = `archived_at`-stamped rows demoted out of the hot vector index into a cheaper store (and, for enterprise, the customer's BigQuery — see 3c). Hot/cold swapping under a fixed budget is the documented MemGPT/MemoryOS pattern ("Rethinking Memory in LLM-based Agents," arXiv 2505.00675). This is where consolidation pays for itself: archived/compressed rows leave the hot index, so coarse-pass size stays bounded regardless of total history.

**1e. Index-engine ceiling and the escape hatch.**
Binary + MRL + decay keeps the laptop default (sqlite-vec) viable well past today's 375k. But sqlite-vec has no ANN and a "low millions" ceiling. For a genuine 1M+ single-tenant case, the recommended local-first escape hatch is a LanceDB sidecar: disk-based IVF-PQ over the Lance columnar format, querying larger-than-RAM data directly off SSD, preserving the no-server / embedded property the moat depends on ("Best Vector Databases in 2026," Firecrawl; "LanceDB IVF-PQ index concepts"). Do **not** reach for Qdrant/pgvector for the local product — they contradict local-first and only belong inside the managed server tier. The design is therefore a two-tier vector engine: **sqlite-vec + binary** as the laptop default, **LanceDB** as the power-user / large-tenant sidecar, switched behind the existing vector-provider abstraction in `vector/providers.ts` so callers don't change. Cross the bridge only when a real tenant approaches ~1M; do not build it speculatively.

**Sequencing (leverage per risk):** (1) binary coarse + float re-rank — unblocks the existing index now; (2) scheduled consolidate+forget + cold-tier archival — caps growth and lifts quality together; (3) LanceDB sidecar — only when a tenant actually crosses the ceiling.

### 2. Enterprise pillar (a): OpenTelemetry → BigQuery

**Reuse:** `telemetry/otel.ts` already exists — a lightweight OTLP-compatible runtime honoring the standard env contract (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_TRACES_EXPORTER`, `OTEL_SDK_DISABLED`), with span/metric schema versioning and an `otlp_http` export mode that is off by default and never fails the recall path on flush error. The base plumbing is done.

**The honest scope: there is no native BigQuery exporter.** The OTel Collector feature request for one was closed "not planned" for lack of a sponsor (collector-contrib issue #34809), and the official Google Cloud exporter targets Cloud Trace/Logging/Monitoring, not BigQuery. So this is a Collector-config deliverable, not a one-line integration — market it as "OTLP out + a maintained Collector config," never as a native BQ sink.

**Recommended pipeline:** harness-mem (existing `otel.ts`, OTLP/HTTP out) → OTel Collector with the `googlecloudpubsub` exporter → Pub/Sub → BigQuery. The known failure mode is that Pub/Sub delivers OTLP protobuf as a single base64 blob and schema mapping fails (collector-contrib discussion #39074); the working fix is a thin Cloud Function (or Dataflow for scale) that decodes and reshapes into a queryable, versioned BigQuery schema. Ship this as an opinionated reference config, not a promise of magic.

**Adopt the GenAI semantic conventions for the embedding server.** Instrument the Pro embedding leg with the GenAI `embeddings` operation and `gen_ai.embeddings.dimension.count`, plus the token/cost/latency attributes (`gen_ai.request.model`, `gen_ai.usage.*`). These are an emerging cross-vendor standard (OpenLLMetry merged into OTel) — still in Development/experimental status, so pin `OTEL_SEMCONV_STABILITY_OPT_IN` and version the BQ schema, and tell enterprise buyers the schema may migrate ("How OpenTelemetry Traces LLM Calls," Greptime; "Inside the LLM Call," opentelemetry.io). The payoff: buyers get embedding telemetry in attribute names Datadog/Grafana/Google already consume — portable, no lock-in.

**Cost:** default to the cheap ingestion tier — micro-batch load from GCS is free, the Storage Write API gives 2 TiB/month free then $0.025/GB; reserve the Pub/Sub BigQuery subscription (~$50/TiB) for customers who explicitly want near-real-time, and avoid legacy streaming inserts entirely. For storage, recommend physical/compressed billing (60%+ cheaper on JSON-shaped telemetry), partition + cluster by `user_id`/`team_id` (matching the existing multi-tenant slot), and lean on the automatic 90-day long-term-storage 50% discount ("BigQuery Cost Optimization 2026," costimizer.ai). At low volume the enterprise tier's observability COGS is effectively zero.

**ZDR-consistency of the telemetry path:** the OTel export must carry spans/metrics/metadata only — never raw memory or prompt text. The GenAI conventions make this natural: content capture is off by default and opt-in only, with an external-storage-reference mode for sensitive data. That default-off content model *is* the ZDR seam at the observability layer, and it dovetails with pillar (b).

### 3. Enterprise pillar (b): Pro Embedding server with ZDR

**Reuse:** the billing seam exists. `embedding/pro-api-provider.ts` + the registry hook (`registry.ts`, the `adaptive` branch gated on `HARNESS_MEM_PRO_API_KEY` + `HARNESS_MEM_PRO_API_URL`) already upgrades the general embedding leg to a premium endpoint with automatic fallback to the free local model when unset. The provider already normalizes dimension and parses OpenAI-style responses, so it can point at any compatible endpoint.

**Recommendation: self-host granite as the default Pro endpoint, not a third-party provider.** This is the decisive move. ZDR from the big providers is gated — OpenAI and Anthropic require sales contact, approval, and per-org contracts; Azure requires an Enterprise Agreement; Cohere restricts it to enterprise customers (because ZDR disables their abuse monitoring) ("Data controls in the OpenAI platform"; "Enterprise Data Commitments," Cohere). Critically, provider ZDR is necessary-but-not-sufficient: it governs only what the model retains from the call, not what the surrounding system stores ("Zero Data Retention for Enterprise AI," CData). Because granite-embedding-311m runs on-device or on a customer-controlled VPS, harness-mem **grants** ZDR (text never leaves the box the customer controls) instead of **qualifying** for it through a sales motion. For a solo builder serving SMB/enterprise this is a cleaner, more auditable story than reselling a gated upstream guarantee — and it is the unfair advantage on this pillar.

**Architecture: stateless embedding endpoint, persistence stays in the customer's store.** Mirror OpenAI's own ZDR line — `/embeddings` can be ZDR but vector stores/files cannot, because they require state ("Data controls in the OpenAI platform"). harness-mem already separates the stateless embed call from the persistent sqlite-vec index. Enforce it: the Pro embedding service processes in-memory only — no request/response logging, no embedding-text disk cache (the provider's existing cache must be memory-bounded and content-free at rest), retention=0 as a documented boundary — while the vector index lives in the customer's own storage (their VPS / their BigQuery). That is exactly the boundary enterprise buyers audit.

**Seven controls the Enterprise tier audits (implemented 2026-06-19, S154-W2).** retention=0 is operationalized as an executable contract, not a slogan. Set `HARNESS_MEM_PRO_ZDR_ENFORCED=1` on the Pro provider to engage:

1. request/response ログ無し (input text never appears in log/error/health surfaces)
2. 埋め込みテキストのディスクキャッシュ無し (the in-memory cache is also disabled because keys carry text)
3. crash dump・metrics に payload を載せない (only HTTP status / latency / counts)
4. backup は payload 除外 (周辺 observation store の運用責任として明文化)
5. support-access 境界の明文化 (harness-mem 提供側は顧客 VPS / BigQuery の payload に到達経路を持たない)
6. subprocessor への no-train flow-down (自前ホスト構成では subprocessor list は空)
7. ZDR enforcement フラグ = 実行される契約 (cache 無効化 / error message サニタイズ / health 表記に `[zdr=enforced]` が unit test で検証される)

詳細と検証ポイント: `docs/pro-api-data-policy.md` §9。

**Third-party fallback, if ever used:** keep it optional and clearly labeled. Among the majors, Voyage AI appears to offer self-serve ZDR (assumption — verify against current Voyage docs; do not assert "only") (dashboard opt-out, payment method only, no sales gate — but irreversible via dashboard), making it the right overflow provider for a one-person shop ("FAQ — Voyage AI"). Do not headline "we don't train on your data" — every provider already guarantees that by default; it is table stakes, not a differentiator. Headline local-first / data-never-leaves plus a written no-training clause flowing down to sub-processors.

### 4. Enterprise pillar (c): log/data storage on VPS + BigQuery

**Reuse:** the serverization scaffolding is the delivery vehicle — `middleware/rate-limiter.ts`, Bearer-token remote auth, multi-tenant `user_id`/`team_id`, the `ManagedBackend` slot (`harness-mem-core.ts`, with `isManagedConnected` / `replicateManagedEvent` / `managedShadowRead` already stubbed), and Caddy/Docker. The `managed_backend` slot is where the heavy/regulated path connects.

**Two-tier storage matching the monetization model:**
- **Laptop / solo default:** local-first sqlite-vec + binary, nothing leaves the machine.
- **Enterprise:** VPS (the `ManagedBackend` target, fronted by Caddy/Docker with Bearer auth + rate limiting) for the hot, multi-tenant index, with BigQuery as the cold analytical/log store fed by the same OTel pipeline from pillar (a). Per-tenant isolation rides the existing `user_id`/`team_id` columns and the BQ partition/cluster keys.

**Frame it as data residency, the #1 procurement blocker.** "Your memory and telemetry land in *your* BigQuery / *your* VPS, never ours" is the enterprise headline, and it is something cloud-only memory vendors structurally cannot match. Offer JP-region VPS/BigQuery deployment as a first-class option — region pinning is the native residency mechanism enterprises expect (Vertex/Bedrock prove this), and a JP-resident deployment pairs with the granite JA-EN moat to reach Japanese enterprises with data-localization rules that rule out US-based memory SaaS. For air-gapped buyers who refuse GCP, offer self-hosted ClickHouse on the customer's VPS as the cold store (beta OTel-native exporter, auto-schema) instead of BigQuery — documented integration only, not a managed service a solo build can operate.

**Storage cost = the large-memory countermeasure, monetized.** The cold tier (section 1d) and BigQuery storage are the same surface: archived/compressed memory aged out of the hot index lands in the customer's BigQuery, offloading storage cost to them while a documented retention/compaction policy (the existing `forget-policy` TTL + `admin_consolidation_run`) doubles as a data-minimization / right-to-erasure feature — enterprise buyers ask for deletion SLAs. Retention length is itself a tier dimension the market already bills (Supabase 7/28/90-day; PostHog 12/60-month), so "memory grows large" is a paid axis, not a cost to absorb.

### Reuse summary

| Need | Existing component | Work required |
|---|---|---|
| Fast index at scale | `vector/providers.ts` (`vec0 float[N]`) | Add binary column; two-pass coarse+re-rank |
| Bound the hot set | `consolidation/worker.ts`, `forget-policy.ts`, `current-value-compression.ts` | Schedule auto-forget (off by default); flip cold rows to `archived_at` |
| Hot/cold tiering | `memory_type` / `archived_at` / `expires_at` columns | Demote archived rows out of hot vector index |
| 1M+ ceiling | vector-provider abstraction | LanceDB sidecar — only when a tenant nears the ceiling |
| OTel → BigQuery | `telemetry/otel.ts` (OTLP/HTTP, env contract) | GenAI conventions on embed leg; Collector→Pub/Sub→BQ reference config |
| Pro embedding + ZDR | `embedding/pro-api-provider.ts`, registry Pro hook | Self-host granite endpoint; enforce in-memory-only, retention=0 |
| VPS + BigQuery storage | `ManagedBackend` slot, rate-limiter, Bearer auth, multi-tenant, Caddy/Docker | Wire managed_backend to VPS; BQ cold tier per tenant; JP region option |

All seven land on code that already ships. None requires abandoning the local-first / sqlite-vec moat to reach the enterprise tier.

## Enterprise Billing & Packaging

### Recommendation in one line

Ship **open-core + hybrid pricing**: a permanently free local-first OSS core as the on-ramp, a flat-fee Pro for power features, and a **self-serve, productized Enterprise built from discrete flat add-ons** — never a sales-led platform sale. The three owner pillars (OTel→BigQuery, Pro Embedding ZDR, VPS/BigQuery storage) are all **data-residency / control features**, and the market sells those exclusively at the top tier. Use them as the Enterprise gate.

### Why open-core + hybrid (and not the alternatives)

- **Pure per-seat is the wrong meter and it's dying.** Seat-based share fell 21%→15% while hybrid rose 27%→41% in twelve months (*The AI pricing playbook for founders, Bessemer*). A memory runtime's value scales with data volume and query load, not headcount — a solo/SMB buyer rejects per-seat friction.
- **Pure cloud/usage has no floor and contradicts the moat.** The differentiation is local-first ownership; forcing everyone into a metered cloud throws that away. The discipline is base subscription + metered overage (*Bessemer*; *From seats to consumption, Flexera*).
- **Pure-Enterprise sales motion is fatal for a solo builder.** Sourcegraph killed its Free and Pro tiers on 2025-07-23 and became a ~$16K-start platform sale requiring a sales org (*Sourcegraph Software Pricing & Plans 2026, Vendr*). A one-person shop cannot run that. The on-ramp (JA-EN hybrid search, resume, local index) **must** stay self-serve.

The operable model is PostHog's: usage-based product + **stacked flat-rate platform add-ons** ($250 Boost = SSO-enforce; $750 Scale = SAML; $2,000 Enterprise = RBAC + dedicated + 60-month logs), each a discrete fee with no custom sale (*PostHog Pricing 2026, Schematic*). That is the only Enterprise shape a solo INTP builder can actually operate.

### Tier ladder

| Tier | Price posture | What you get | What GATES it (competitor precedent) |
|---|---|---|---|
| **Free / Local** | $0, OSS, self-host | Full moat: JA-EN hybrid_v3 search, resume, sqlite-vec local index, cross-tool capture, the dynamic memory-viz UI on local data | Nothing — this is the on-ramp. **Never kill it** (Sourcegraph's mistake, *Vendr*). |
| **Pro** | Flat **~$20-40/mo** + metered premium-embedding overage | Premium cloud embedding (standard retention), larger/longer memory retention, basic SSO, priority support | Product power, not compliance. Plain SSO belongs here, not behind a paywall jump — 68% of enterprise RFPs want SSO+MFA in base and `ssotax.org` names absurd gating (HubSpot +7,828%) (*Wall of Shame, SSOtax.org*). |
| **Team** | Flat **~$200-300/mo** (PostHog "Scale" analog) + usage | Multi-tenant (the existing `user_id`/`team_id` slot), SAML SSO, shared/team memory, RBAC-lite, longer log retention, 99.9% SLA | **SAML at ~3x the prior step** is the canonical mid-gate — Sentry Team $26 → Business $80 puts SAML there (*Sentry Pricing*; *Understanding Sentry Pricing, SigNoz*). SOC2/ISO evidence appears at the team tier (Supabase Team $599 = SOC2/ISO; *Supabase Pricing 2026, Schematic*). |
| **Enterprise** | Flat add-on stack (PostHog "Enterprise" analog, **~$2,000/mo**-class) + committed usage; self-serve via Stripe + click-through DPA | **The 3 pillars** + SCIM, full RBAC, audit-log long retention, data residency, signed DPA/SCCs, sub-processor list, BAA-on-request | Gated by a **compliance/control bundle, not more product** — the near-universal list across PostHog, Sentry, Supabase, Qdrant, Weaviate (*Hashorn; SSOJet; Qdrant Pricing; Weaviate Cloud pricing update*). BYOC/residency carries a hard floor everywhere (Weaviate BYOC ~$1,390/mo). |

Build order for the gates: RBAC → audit → SSO → SCIM (*Enterprise-Ready SaaS, Hashorn*). Reserve the steep price step for SAML/SCIM/RBAC/residency, **never** for plain SSO.

### Mapping the 3 pillars onto paid tiers

**Pillar (b) — Pro Embedding server with ZDR → split across Pro and Enterprise.** ZDR is the cleanest Enterprise gate available because the whole industry already gates it exactly this way: at both OpenAI and Anthropic, ZDR is sales-gated, per-organization, by-approval, and not default (*Data controls in the OpenAI platform; Anthropic Claude Data Retention Policy 2026, anarlog; ZDR Guide, CData*). So:
- **Standard premium embedding** (cloud compute, normal retention) = **Pro**.
- **ZDR premium embedding** (contractual no-persist; the customer's memory text never lands on harness-mem's disk) = **Enterprise**.

ZDR is also a posture harness-mem can *grant* rather than *qualify for*: because the embedding leg can run self-hosted granite on a customer-controlled VPS, the ZDR boundary is owned end-to-end. Architect the embedding service as **stateless** (in-memory only) while the vector index lives in the customer's own storage — this mirrors the exact line OpenAI draws (`/embeddings` is ZDR-eligible; vector stores/files are not).

**Pillar (a) — OTel export to BigQuery → Enterprise.** This is a data-egress/observability feature, sold at the top tier (*Supabase log-retention ladder; Qdrant/Weaviate residency*). Frame it as "your telemetry lands in **your** BigQuery, never ours" — that is data residency, the #1 procurement blocker, doubling as the customer's own audit trail. **Scope it honestly as a maintained pipeline, not a one-line sink:** there is no native OTel→BigQuery exporter; the path is OTLP → Collector (`googlecloudpubsub` exporter) → Pub/Sub → BigQuery subscription, with a thin (required, not optional) decode/transform step to avoid the base64-blob problem. Default the ingestion to free micro-batch / Storage Write API (2 TiB/mo free) and reserve the Pub/Sub subscription ($50/TiB) for customers wanting near-real-time. Instrument the embedding server with the GenAI `embeddings` operation (`gen_ai.embeddings.dimension.count`) so telemetry is portable across Datadog/Grafana/Google — anti-lock-in is the pitch. Keep telemetry to spans/metadata only, never raw memory text, so the OTel path is itself ZDR-consistent.

**Pillar (c) — VPS/BigQuery storage → Enterprise.** Same category as (a): data residency. "Your memory logs live on your VPS / in your BigQuery" closes a gap cloud-only memory vendors structurally cannot. The existing serverization scaffolding (Bearer auth, rate limiter, multi-tenant `user_id`/`team_id`, `managed_backend` slot, Caddy/Docker) is the delivery vehicle. Offer **JP-region** VPS/BigQuery as a first-class option — JP data-localization is a wedge US-based competitors can't easily match, and it pairs with the granite JA-EN strength. For air-gapped buyers who refuse GCP, offer self-hosted ClickHouse on their VPS as the documented (not managed) alternative.

**Retention as a billed axis simultaneously monetizes pillar (c) and answers "memory grows very large."** Every comparable vendor ladders retention (Supabase 7/28/90-day; PostHog 12/60-month; *Schematic*). Free = short window + aggressive consolidation/compaction (the existing `admin_consolidation_run` / `compress` tools); Pro = longer; Enterprise = long-horizon into the customer's own BigQuery (offloading storage cost to them). A documented retention/compaction policy doubles as a GDPR data-minimization / right-to-erasure feature — pitch consolidation + per-tenant delete as both scale control and compliance control with a deletion SLA.

### Reconciling with the existing Pro API hook (`memory-server/src/embedding/registry.ts:289-309`)

The billing seam exists and is the right place — but it currently points at the *wrong architecture*, and that gap must be closed before it can carry the Pro/Enterprise embedding SKU. As wired today (verified in source):

1. The hook only fires on the **`adaptive`** provider route, and upgrades **only the general (English/multilingual) leg** to a Pro cloud embedding — defaulting to OpenAI `text-embedding-3-large`. The Japanese leg stays local (`ruri-v3-30m`).
2. It requires **both** `HARNESS_MEM_PRO_API_KEY` and `HARNESS_MEM_PRO_API_URL`; if only one is set it warns and falls back to the free secondary model. Fallback-to-free when unset is already correct billing behavior (free local default, paid cloud upgrade).

The strategy's own moat decision is that **granite beats adaptive** (internal measurement; a 375,142-row granite index already built but not yet live — internal-only, not an external superiority claim). So the seam needs three changes to become the billing surface:

- **Re-point the Pro upgrade to sit behind the granite route**, not (or in addition to) the legacy `adaptive` route, so the paid tier improves the embedding the product actually ships on.
- **Default the Pro `baseUrl` to harness-mem's own self-hosted granite endpoint** (on the customer VPS), not a third-party provider. Only if text is ever forwarded to OpenAI/Voyage/Cohere does the upstream-ZDR-qualification burden get inherited — and if a third-party overflow path is ever needed, Voyage appears to offer self-serve ZDR (*assumption — verify against current Voyage docs*), making it the right fallback for a solo shop.
- **Add a ZDR enforcement flag on the Pro provider** (no request/response logging, no embedding-text disk cache, in-memory only, documented `retention=0`) so the Enterprise ZDR SKU is a verifiable boundary the seam owns, not an upstream promise.

Net: the hook is the correct billing seam (free-by-default, paid-cloud-upgrade, dual-env gate), but it must migrate from "upgrade the adaptive English leg to OpenAI" to "upgrade the granite route to a ZDR-owned self-hosted endpoint." That migration is the single concrete engineering prerequisite for monetizing pillar (b).

### Pricing the metered legs

Bill premium embedding by compute/tokens on top of the flat platform floor — the granite server's natural meter, following the vector-DB pattern (Qdrant bills vCPU/RAM/storage + inference tokens; *Qdrant Pricing*). Do **not** price the moat per-seat. Use BigQuery's pay-per-byte model deliberately to avoid the cost-blowup risks of event-priced (Honeycomb) or per-series (Grafana) backends — and lead the Enterprise pitch with BigQuery's real differentiator for this buyer: **SQL-joinability** ("your memory/embedding telemetry lands in the same warehouse as your revenue and product analytics"), which no dedicated observability backend offers (*Top 7 LLM Observability Tools 2026, Confident AI*).

### Guardrails

- Do **not** headline "we don't train on your data" — every provider already guarantees it by default; it's table stakes, not marketing (*Cohere Enterprise Data Commitments; OpenAI*). Headline local-first / data-never-leaves + a written no-training clause that flows down to sub-processors.
- ZDR is one line item among six. To be procurement-viable also ship: a SOC2 Type II path (start with a Trust Center page + DPA template pre-audit), GDPR DPA with SCCs, sub-processor list, data residency (*LLM Deployment in Regulated Industries, TrueFoundry*).
- Keep all JA-EN superiority framing scoped to public model evidence (granite-r2 MTEB-multilingual results; text-embedding-3 cross-lingual weakness). Internal CodingMemory Bench is citable only as process credibility ("we measure"), never as a quoted external superiority number (Constraint D2).
---

## 実装シーケンス（レバレッジ / リスク順）

1. **意味マップ MVP** — 既存 375k granite index を 2D 投影、scoped(直近 30 日 / 現 repo)で開く、メタデータ色分け、hybrid_v3 で map 内検索。points-not-edges でリスク最小。→ moat が目に見える最初の deliverable。
2. **binary 粗選別 + float 再ランク** — `vec0` に bit-vector 列を追加、2-pass 化。375k の検索を今すぐ高速化（hybrid_v3 の品質は再ランクで保持）。
3. **auto-forget + cold 階層の定期実行** — `HARNESS_MEM_AUTO_FORGET` を schedule、`archived_at` で hot index から降格。肥大化を上限化。
4. **Pro フック付け替え** — `registry.ts:289-309` を granite route + 自前 granite エンドポイント default + ZDR フラグへ。pillar(b) 収益化の前提。
5. **時間軸タイムライン（decision lineage）** → ego-graph + curation board。
6. **法人配管** — `managed_backend` を VPS へ、BigQuery cold tier(per-tenant)、JP-region option、OTel Collector reference config。

全 6 件が既存コードに着地する（greenfield ではなく配線とポリシー）。local-first / sqlite-vec の moat を捨てずに Enterprise に届く。

## owner が判断すべきこと

1. **flip（granite を live 化）** — index は構築済みだが launchd plist の env pin (`HARNESS_MEM_EMBEDDING_MODEL=adaptive`) で未反映。これは production Risk Gate（全 session + 4 兄弟 repo 影響）。viz も Pro 収益化も granite が live である前提なので、ここが全ての起点。
2. **viz の最初の的** — 意味マップ first（推奨）か、decision-lineage タイムライン first か。
3. **価格の具体値** — Pro 定額（~$20-40）と埋め込み従量メーター（per-token / per-1K）は granite serving COGS 計測後に確定。
4. **SOC2 Type II の着手時期** — Trust Center + DPA テンプレは今すぐ、監査本体は数ヶ月コスト。solo がいつ資金を当てるか。
5. **JP-region を launch から出すか** — 後追い Enterprise upsell か。1 人運用の負荷との兼ね合い。

## ソース規律（D2）

対外的な日英優位の主張は **public 証拠のみ**に依拠する: granite-r2 の MTEB-multilingual 値、`text-embedding-3` の cross-lingual 弱点（公開論文）。内部の granite-beats-adaptive A/B と self-seed fixture は **内部計測のみ**で、検証済み外部優位として引用しない。対外で言えるのは「我々は CodingMemory Bench を持ち、現実 / 中立コーパスで測る」という **測定の所有** であり、fixture のスクショではない。
