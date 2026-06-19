# harness-mem 北極星ロードマップ

> 策定: 2026-06-07 / 手法: 競合7角度のweb深掘り+懐疑検証(19エージェント) × 内部mem実像 × repo現状(ファイル実読) を3レンズ統合。数値は検証済み/manifest確定値のみ。未検証は明記。

## 1. 北極星(一文)

**harness-mem は、日英混在の開発〜ビジネス文脈を、ツール横断の1つのローカルSSOTに畳み込み、「今正しい値」を初手に返す continuity runtime になる。**

英語勢が構造的に入れない「日本語ファースト × cross-tool × dev+business」の交点を単独占有し、moat の本体は機能ではなく **measurement ownership(自分が評価軸を定義し測り続ける運用)** に置く。

---

## 2. 戦略仮説

**仮説: 英語勢は日本語が「弱い」のではなく「測ってすらいない」。だから手当てした者だけが勝てる。**

3本の独立リサーチが一致して確認した競合の空白:
- 上位スコア勢(OMEGA 95.4% / Mastra 94.87%)は全て**英語専用埋め込み(bge-small-en)で成立**。多言語化で実測1.3-3.3pt構造劣化。「英語で最適化したら日本語が落ちる」のではなく「彼らのSOTAは英語専用だから始められない」=**データセット不在そのものが参入障壁**。
- Mem0/Supermemory/Zep/Letta/Cognee は全社**日本語を一級市民にしていない**(基盤LLMのNER任せ)。OpenAI Dreaming(2026-06最新)も**多言語に言及ゼロ**。Claude/OpenAI native は**ツール横断しない**(自社エコシステム内に閉じる)。
- 「日本語ファースト × cross-tool × dev+business を同時に満たすプレイヤーは確認できず」。

**勝ち筋の論理(2行):** 単軸(cross-tool / ローカル / 日英 / dev+business)はそれぞれ誰かに侵食されるが、4軸の**積**は無風。最も模倣されやすいのは cross-tool(MCP標準化で参入コスト低下)、最も固いのは日英(参入障壁=日本語ベンチの不在)。よって**日英を盾に、4軸交点で立つ**。

---

## 3. 競合マップ

凡例: 記憶整理手法 / 日本語 / dev⇔business寄り。数値は検証済みのみ。

| プレイヤー | 強み | 記憶整理手法 | 日本語 | dev/business |
|---|---|---|---|---|
| **Mem0** | LoCoMo J 66.9%、p95 -91%(vs full-context)、$20M Series A | write-time ADD/UPDATE/DELETE/NOOP増分統合 + Mem0gグラフ | 入力言語で記録のみ(専用ベンチ無し) | business主軸、devは後発訴求(競合化中) |
| **Supermemory** | LoCoMo P@1 59.7%主張、Router drop-in(token -70%主張) | knowledge graph: Updates(isLatest上書き)/Extends/Derives | 明示記述なし | personal/business寄り、汎用API |
| **Letta** | sleep-time compute(test-time計算-5x、+13〜18%) | OS型3層ページング + idle時 memory block再整理 | LLM NER任せ | 汎用エージェント |
| **Zep/Graphiti** | DMR 94.8%、LongMemEval +18.5%、context 115k→1.6k | **bi-temporal失効グラフ**(4 timestamp、t_invalidで時間的失効=削除しない) | LLM NER任せ | 汎用、temporal先行 |
| **Cognee** | HotpotQA correctness 0.93 | remember/recall/forget/improve + Memify後処理 + temporal event node | LLM NER任せ | 汎用OSS |
| **OpenAI Dreaming** | 事実82.8% / 嗜好71.3% / 鮮度75.1%、計算1/5で無料展開 | idle時background合成、prose summary、時制書換、latest-value | **言及ゼロ(空白)** | 個人/業務寄り、**ツール横断しない** |
| **Claude memory** | memory+context editing +39%、auto-memory default ON | client-side memory tool + immutable version、CLAUDE.md/MEMORY.md | 明示なし | Claude内に閉じる、**ツール横断しない** |
| **📍harness-mem** | 3軸交点単独占有(Local-first 10/Project Scoping 10/Cold Start 10)、bilingual R@10 0.90、~5ms cold start | consolidation worker + contradiction(superseded link、削除しない) + archive-first forget(L0-L4) + adaptive decay | **adaptive Route A/B/C + JP span抽出 + query expander(日英特化、唯一の専用ベンチCodingMemory保有)** | **dev(実態100%)→business(Hermes、潜在)を1 SSOTで貫く唯一** |

**ピンの位置:** harness-mem は Zep の bi-temporal 失効 / Dreaming の prose+時制書換と**思想が同型だが未実装**(temporal はdiagnostic-only、prose再合成は無し)。技術は吸収対象、moat は日英×cross-tool×measurement に置く。

---

## 4. 4軸 × 3フェーズ ロードマップ

Dreaming 3軸の自前評価軸への翻訳を表内に明記。**現状の freshness 0.99 は「最新値が引けるか」の浅い鮮度であって、Dreaming が測る「時制書換(『行く予定』→『2026/7に行った』)の深い鮮度」ではない**。この自己診断が鮮度軸の出発点。

| 軸＼フェーズ | Now (0-3mo) | Next (3-9mo) | Later (9mo+) |
|---|---|---|---|
| **日本語特化** | BM25(Sudachi正規化)+dense の RRF hybrid を Route C に投入。型番/関数名/エラーコードの完全一致破綻を補う。JA R@10 0.000 を最優先で底上げ | Ruri v3 を JA重クエリの再ランク補助に併用(外部分かち書き不要)。JA companion gate の zero-F1 16/96 を slice別に潰す | 日本語ネイティブ記憶ベンチを業界標準として外部提唱(CodingMemory の JA拡張)。「日本語で測れる唯一」を地位化 |
| **英語パリティ** | README_ja実測値(0.59/0.65)を manifest(0.77/0.82)に同期(公開claimの乖離=技術債務返済)。**domain限定パリティ**を明文化(general-lifelogでは劣後を隠さない) | dev-workflow domain で対等以上を CodingMemory 3-system同条件で証明。MAB AR 0.281 を consolidation強化で改善 | LongMemEval/ConvoMem型(会話量レジーム別)で再現性ゲート公開。self-seed満点は対外優位に使わない(D2) |
| **日英混在正読** | 二重検索クエリ正規化: 日本語クエリから英語キーワード/コードトークンを抽出し原文+英語強調を両投げRRF。**固有表現/コードトークンは翻訳せず保持**(誤訳回避)。mixed R@10 0.372 を改善 | bge-reranker-v2-m3級の後段リランカで cross-lingual言語選好バイアス補正。query expander を synonym辞書から拡張 | BGE-M3(dense+sparse+multi-vector 1モデル)へ埋め込み移行を判断。14GB全reindex覚悟、Now/Nextで数値が出てから |
| **大規模記憶整理** | `consolidation/dreaming/` 新設(workerの中身を厚くする、新API化しない)。空ハンドオフ/unknown16%を dedupe段で吸収。entity NLP抽出(§78-C02b)着手=グラフ素材を生む | **鮮度軸の本体**: contradiction の superseded relation を**bi-temporal 4 timestamp化**(Zep準拠、t_invalidで失効、削除しない)。dreaming jobで時制書換 | 階層要約tree(RAPTOR/MemTree、O(n)→O(log n)、leaf原文保持でWhy維持)。temporal-graph-signal を A/B再測定し improved なら default ON(D25昇格条件) |

**Dreaming 3軸 → 自前KPI の翻訳:**
- 事実取得 41.5→82.8% → dev_workflow recall@10(現0.77)/ bilingual(0.90)。MAB AR 0.281 が要改善点。
- 嗜好順守 31.4→71.3% → **新規**: project内の確立方針(patterns.md的)の順守率。CR 0.263 が近い。
- 時間的鮮度 9.4→75.1%(最弱・最大改善8x) → **最重要・新規**: 時制書換正答率 / supersession精度 / bi-temporal整合の3指標を、浅い freshness 0.99 と**別立て**で定義。

---

## 5. 3つの主要ベット

### ベット1: 鮮度(深い temporal)を全社未解決の最高レバレッジ戦場として先取りする
- **なぜ(根拠):** Dreaming 自己申告で時間的鮮度が**全機構の最弱(2024=9.4%)かつ統合で最大改善(約8x)**。全社が未解決。harness-mem は Zep の bi-temporal失効 / Dreaming の時制書換と**思想が同型**で、D25の決定ノート自身が「Zep/Graphiti型 edge validity が主筋」と既に外部調査で同結論に到達している。current-value-compression / contradiction-detector が直接効く。
- **賭けが外れる条件:** (a) Dreaming/Claude が無料・default ON・計算1/5でツール横断まで提供してきた場合、native の鮮度がローカル実装を陳腐化。(b) 深い鮮度ベンチを作っても、temporal の neutral(現状A/B)が entity品質起因という仮説が外れ、bi-temporal化しても改善しない場合。
- **確信度: high**(方向性。D25が外部調査で同結論、Zep実績が裏付け)。

### ベット2: 日英混在の完全一致retrieval を実装で詰め、4軸交点の唯一の穴を塞ぐ
- **なぜ(根拠):** 4軸交点の中核は cross-lingual recall だが、MAB self-seed で **mixed R@10 0.372 / JA 0.000** と最弱。開発ログは型番/関数名/エラーコード/commit hashなど**完全一致が支配的**で dense単独は破綻。BM25(Sudachi)+RRF + コードトークン保持の二重クエリが直結する解で、新依存ほぼ不要・最小コストで最も確実に効く。ここが弱いと moat が空洞化する。
- **賭けが外れる条件:** (a) Mem0/Supermemory が資金で日本語データセットを作り日本語パリティを数ヶ月で達成(障壁が溶ける=スピード勝負)。(b) BM25 hybrid を入れても混在スコアが上がらず、埋め込み(BGE-M3/Ruri)移行=14GB reindex まで踏まないと改善しない場合(コスト膨張)。
- **確信度: high**(日本語RAG調査が機構を裏付け。ただし日英ペア固有の劣化数値は外挿、本番A/B未取得)。

### ベット3: measurement honesty を公開資産化し、相互論破で死にかけた市場で信頼を取る
- **なぜ(根拠):** ベンチは飽和・相互論破フェーズ(LoCoMo「ファイルシステムだけで74%」で弁別力崩壊、Mem0↔Zep が自称84%→58%に引き下げ合い)。harness-mem は self-seed満点を優位主張に使わない契約を Spec/scorecard/decisions 全層で明文化済み(D2)。弱い数値(MAB 0.147)を隠さず domain別に分離公開する透明性が、誇張で信頼を失った市場で**そのものGTM**になる。CodingMemory Bench(§153完了、HF dataset公開、3-system同条件)が外部再現性=moat。
- **賭けが外れる条件:** (a) 透明性が「弱さの自白」と受け取られ、数値インフレ勢にマーケで負ける(B2B採用は絶対精度ランキングで決まる場合)。(b) 自前ベンチが「業界標準」として採用されず、自社証明に留まる場合は差別化資産にならない。
- **確信度: medium**(透明性の価値は論理的に正しいが、市場が透明性で動く実証が無い)。

---

## 6. 今すぐ着手すべき3手

| 手 | 紐づく内部課題 | 内容 | 確信度 |
|---|---|---|---|
| **手1: BM25(Sudachi)+RRF を Route C に投入 + 二重クエリ(コードトークン保持)** | 日英混在の実retrieval品質(mixed 0.372 / JA 0.000) | 最小依存で最も確実に混在/JA recall を上げる。ベット2の着手。A/Bで効果計測 | high |
| **手2: `consolidation/dreaming/` 最小PoC(finalize_session発火、prose summary + 空ハンドオフ dedupe吸収)** | 空ハンドオフS/N + unknown16% + checkpoint57%偏重 + ビジネスログ先回り | 空ハンドオフ("No explicit decisions captured")を dedupe段で吸収、unknown を ingester監査で分類、checkpoint束ねを prose現在状態に畳む。prose summaryは**開発ログより業務ログ(Hermes)で効く**=ビジネス比率増の先回り設計 | medium |
| **手3: README_ja実測値を manifest に同期** | measurement honesty の前提条件 | 0.59→0.77 / 0.65→0.82 の乖離は公開claimと実態のズレ。透明性を掲げる以上、即返済すべき技術債務。低リスク、確認不要レベル | high |

**並列性:** 手1と手2は独立。手3は単独で即実行可。3手とも待ち時間ゼロで並走できる。

---

## 7. 北極星KPI

LoCoMo等の飽和ベンチは北極星にしない。**自分が定義して測り続けられる指標**を据える。

**北極星(1つ): Bilingual Coding-Memory Freshness@k** — 日英混在の開発記憶で「今正しい値」を返せた率(時制が覆った後に旧値を返さない率)。CodingMemory Bench(§153)の主KPI化と整合、HF dataset公開で外部再現可能。

支える二次KPI(各指標の「何を測るか」を1行添付):

| KPI | 何を測るか | 現状値 |
|---|---|---|
| cross-lingual recall@10(日本語クエリ→英語記憶) | 4軸交点の本丸。日英混在で英語文脈を引けるか | mixed 0.372 / bilingual 0.90 |
| freshness / temporal accuracy(深い鮮度) | 時制が覆った後の正答率。Dreaming最弱軸=最大差別化 | 浅い freshness 0.99 / temporal order 0.82(深い鮮度は未計測) |
| cross-tool continuity rate | Claude→Codex first-turn で前文脈を resume できた率。native が構造的に出せない領域 | inject consumed_rate 0.60 |
| S/N(有効ハンドオフ率) | 取込のうち空でない=想起価値ある割合。取込量moatの裏のリスク管理 | 空ハンドオフ大量 / unknown 16% |

**北極星にしない(規律):** self-seed満点(D2)、LoCoMo full(弁別力崩壊)、取込obs総数(45,076 は vanity metric、S/N罠の入口)。

---

## 8. オーナーが判断すべき論点

1. **北極星の確定:** Bilingual Coding-Memory Freshness@k を旗艦KPIに据え、CodingMemory Bench(§153)を旗艦に昇格させるか。
2. **business拡張の順序と閾値:** 日本語×開発で何を達成したら Hermes business に進むか。実mem の business≈ゼロ・§112 Tier3 experimental・E2E未確認(§112-005)を踏まえ、**business実績を moat主張に「使わない」期限を自己契約に追加するか**(measurement honesty D2との整合)。
3. **mixed R@10 0.372 の改善ゲート:** いつまでに幾つに上げる release gate を敷くか(4軸交点の最大の穴)。
4. **埋め込み移行の今期スコープ判断:** BGE-M3/Ruri移行(14GB全reindex覚悟)を今期に入れるか、手1のBM25 hybridで粘るか。
5. **深い鮮度ベンチの位置づけ:** 3指標(時制書換/supersession/bi-temporal)を release gate に昇格させるか、当面diagnosticか。
6. **dreaming job のLLM:** ローカルONNX/小型モデル既定(local-firstコスト整合)か、高品質モデルopt-in profileか。
7. **CodingMemory Bench の対外プッシュ強度:** 「業界標準提唱」まで押すか(リソース要)、自社証明に留めるか(安全)。
8. **着手配分:** 手1(検索品質の即効)と手2(鮮度moatの基盤)を並列GOか、moat優先でどちらかに集中か。

---

**確信度総括:** 空白市場の存在と日本語ファーストの勝ち筋 = **high**(複数の独立した検証済み一次ソースが一致)。鮮度を最高レバレッジとする技術方向 = **high**(D25が外部調査で同結論、Zep/Letta実績が裏付け)。英語パリティのdomain限定戦略 = **high**(自社scorecardが裏付け)。Hermes business面拡大の規模感 = **medium-low**(Hermesユーザー基盤・per-message hook制約・E2E未確認)。measurement ownership がGTMとして機能する実証 = **medium**(論理は強いが市場が透明性で動く実証は無い)。

**置いた主要仮定(未検証):** 日本語実コーパスでの cross-lingual 劣化幅が研究値と同等 / 日英ベンチ不在=参入障壁(競合が日本語データセットを作らない前提、資金次第で数ヶ月で溶ける) / Hermes business拡張が per-message hook無し等の制約下で技術的に成立 / 市場規模は数字材料が無く構造推定(コアは数千〜数万人規模、TAM本体はbusiness拡張側)。

---

## Appendix A: 現状の実力(ファイル根拠ベース, 2026-06-07時点)

SSOT優先順位: コード/テスト > Spec.md > Plans.md > 古いreport (`Spec.md:64`)。

### 実装済みの機構
| 軸 | 実装 | 根拠 |
|---|---|---|
| 統合 | fact dedupe + LLM diff抽出 + auto-reflection、worker駆動 | `consolidation/{deduper,extractor,worker,auto-reflection}.ts` |
| 矛盾解消 | tagグループ内Jaccard≥0.9→`adjudicate()`(opt-in)→古い側を`superseded` relationでlink。削除せずランク降下 | `contradiction-detector.ts`、§78-D02 |
| 忘却 | access_count/signal/age の決定的ランキング + `expires_at` TTL archive。Autonomy Ladder L0-L4 | `forget-policy.ts`、§129、`Spec.md:257` |
| decay | hot/warm/cold 3-tier、access時刻ベース乗数 | `adaptive-decay.ts` |
| 圧縮 | current-value最短span抽出(EN/JP)+filler除去+over-answer計測 | `current-value-compression.ts` |
| グラフ | entity共起グラフBFS多hop(3hop~0.15ms)、graph_proximity signal(weight 0.15)。SQLite recursive CTE採用、Kuzu却下 | `graph-reasoner.ts`、§78-C |
| temporal | relation signal(env-gated、**diagnostic-only**) + temporal anchor retrieval(§144)。D25/D26: anchorを先に直す方針 | `temporal-graph-signal.ts` |
| cross-tool取込 | 13 ingester(claude-code/codex/cursor/opencode/gemini/antigravity/hermes-state/notion-gdrive/url/audio/document) | `ingest/*.ts` |
| 多言語検索 | adaptive Route A(JA)/B(EN・code)/C(混在→両検索合成) + query expander(`本番反映`↔`deploy`) | `embedding/adaptive-provider.ts` 他 |

### release gate (manifest `eb88c96`, onnx multilingual-e5/384dim, all_passed:true)
LoCoMo F1 0.6138 / bilingual recall@10 **0.90**(≥0.90 PASS) / freshness 0.99 / temporal order 0.8213 / **dev_workflow recall@10 0.7708**(≥0.70 enforce PASS) / search p95 38.35ms(temporal 5.69ms) / inject consumed_rate 0.60 / WorkGraph fidelity 1.0。
注: README_ja実測表(dev 0.59 / temporal 0.65)は**manifestより古い**(0.77/0.82に未同期)。

### 内部MAB scorecard(self-seedでも低い域)
AR substring 0.281 / CR 0.263 / TTL 0.232 / LRU 0.119 / public R@10 **0.147** / JA R@10 **0.000** / mixed 0.372 / resume R@10 0.854。→ 英語百科domainで構造的に弱いことを自ら記録。

### Hermes(§112, Tier3 experimental)
完了: docs、Python plugin skeleton(15 pytest pass)、hook配線、state.db backfill(sessions=37/messages=1977/events=2038)。未完: §112-005 実HermesでのE2E。制約: per-message hook無し(turn粒度のみ)、`MEMORY.md`/`USER.md`置換は公式API不在で不可。opt-in固定。

### 最も埋めるべき穴3点
1. **§128 Recall Runtime未release** — 最大の差別化構想が local dogfoodで足踏み(D14)。
2. **graph/temporalが浅い** — entity抽出はregex+co-occurrenceのまま(§78-C02b TODO)、temporal signalはdiagnostic-only(D25)。
3. **混在/英語long-contextの実retrieval** — mixed 0.372 / public 0.147 / JA 0.000、README↔manifest乖離。
