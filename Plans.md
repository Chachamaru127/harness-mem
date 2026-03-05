# Harness-mem 実装マスタープラン

最終更新: 2026-03-05（§35 計画策定完了, 1355テスト）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32 17タスク完了 | §33 15タスク完了 | §34 20タスク完了（測定信頼性確立, 1355テスト）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

§35 Temporal tau + F1 — Phase A/B 実装完了、目標未達。§36 で根本対策が必要。（1358テスト）

§35 実装結果:
- Bootstrap CI 修正 ✅ (SD-001) — variance=0 解消、SE > 0
- F1 = 0.253（baseline 0.179 → +7.4pp改善）— 目標 CI下限 0.27 には F1>=0.34 必要で未達
- tau = 0.560 [CI: 0.507, 0.614] — temporal-100 の 80% がアンカーなしクエリ。検索パス変更では改善不可
- Freshness@K = 0.97 ✅ | bilingual = 0.72 (< 0.80 未達)

---

## §35 Temporal tau + F1 目標達成（20タスク, 4フェーズ）

### 背景

§34 で測定信頼性を確立したが、性能目標5条件中2条件が未達:
- **tau=0.572**: Bootstrap CI [0.572, 0.572] で variance=0（CI 崩壊）。freshness クエリが DESC ソートされず通常検索にフォールバックしている
- **F1 CI下限=0.221**: F1=0.287 だが SE=±3.4pp。N=180 では CI下限 0.27 に F1>=0.337 が必要。N=360 + F1>=0.317 の組合せが現実的

3専門家（IR研究者/評価専門家/プロダクトエンジニア）の合意:
1. Bootstrap CI のケースレベルリサンプリング修正が最優先
2. freshness DESC ソート実装で Hard 35件のスコアが劇的改善
3. F1 はサンプル拡充だけでは不可能。answer 抽出パイプライン改善が必須

### 依存グラフ

```
Phase 0: CI 修正（最優先）
├── [P] SD-001: Bootstrap CI ケースレベルリサンプリング修正
└── [P] SD-002: ドメイン別 tau 詳細ログ出力
         │
Phase A: Temporal tau 改善（構造修正）   ──並列──   Phase B: F1 改善（answer 抽出）
├── [P] SD-003: freshness DESC ソート実装            ├── [P] SD-009: F1 ボトルネック分析
├── [P] SD-004: hybrid anchor 特定                   ├── [P] SD-010: temporal 答え抽出改善
├──     SD-005: anchor フォールバック（SD-004後）     ├── [P] SD-011: factual extractCorePhrase 改善
├── [P] SD-006: bilingual anchor パターン追加         ├── [P] SD-012: yes_no 否定語改善
├──     SD-007: anchor スコア正規化                   ├──     SD-013: BM25 title weight 調整
└──     SD-008: tau 再計測（SD-001完了が前提）         └──     SD-014: F1 再計測 + N拡充判断
         │                                                     │
Phase C: 統合検証
├── [P] SD-015: locomo N拡充（180→360, 必要な場合）
├──     SD-016: 全ベンチマーク同時計測
├──     SD-017: 3層 CI ゲート閾値更新
├──     SD-018: 384次元 embedding 評価（導入判断のみ）
├──     SD-019: リグレッション確認 + 全テスト pass
└──     SD-020: §35 完了レポート + §36 提言
```

### Phase 0: CI 修正（2タスク, 最優先）

- [x] `cc:完了 [P]` **SD-001**: tau の Bootstrap CI 修正
  - 修正: `perSampleScores: weightedTauScores` に変更。CI幅 0.107, SE > 0 ✅

- [x] `cc:完了 [P]` **SD-002**: ドメイン別 tau 詳細ログ出力
  - `--verbose` で per-domain tau 出力 ✅ (dev-workflow:0.572, project-mgmt:0.570, personal:0.614, bilingual:0.478)

### Phase A: Temporal tau 改善（6タスク）

- [x] `cc:完了 [P]` **SD-003**: freshness クエリの temporal 分岐追加
  - 修正: `kind === "timeline" || kind === "freshness"` に拡張 ✅

- [x] `cc:完了 [P]` **SD-004**: hybrid anchor 特定（vector+lexical）
  - temporalAnchorSearch() の Phase 1 を vector 60% + lexical 40% の hybrid に変更
  - 変更ファイル: observation-store.ts（temporalAnchorSearch 内）
  - DoD: anchor 特定精度向上、既存24テスト pass ✅

- [x] `cc:完了` **SD-005**: anchor 未検出時の時間軸フォールバック（SD-004 完了後）
  - null 返却を廃止。direction から ASC/DESC フォールバック
  - 変更ファイル: observation-store.ts（temporalAnchorSearch 内）
  - DoD: null fallback 率 < 5% ✅

- [x] `cc:完了 [P]` **SD-006**: bilingual anchor 抽出パターン追加
  - 日英混在パターン（「API改修後」「after the API 改修」）を router.ts に追加
  - DoD: bilingual-50 のアンカー抽出ヒット率 > 80%

- [ ] `blocked` **SD-007**: anchor 検索結果のスコア正規化
  - anchorItems エントリに final スコアを付与し、リランカーが利用可能にする
  - **ブロック理由**: temporal-100 の 80% がアンカーなし。スコア正規化だけでは tau 改善不可。§36 でアーキテクチャ見直し要

- [x] `cc:完了` **SD-008**: tau 再計測 + 中間目標確認
  - 結果: tau=0.560 [CI: 0.507, 0.614]。SD-003〜006 の効果は限定的
  - **tau >= 0.70 未達**: 80% のクエリがアンカーなしで通常検索に落ちるため、検索パス変更のみでは達成不可能
  - timeline フォールバック（時間ソート）を試行したが recall を破壊するため撤回

### Phase B: F1 改善（6タスク）

- [ ] `blocked [P]` **SD-009**: F1 ボトルネック分析（検索 vs 抽出 vs 圧縮）
  - locomo-120 の失敗ケースを検索層/抽出層/圧縮層に分類
  - **ブロック理由**: F1=0.253 で CI下限 0.27 には F1>=0.34 が必要。抽出改善だけでは到達不可。§36 検討

- [x] `cc:完了 [P]` **SD-010**: temporal 答え抽出に duration pattern 優先化
  - extractDurationPhrase() を新設し extractTemporalPhrase() 内で最優先チェック
  - "about/around/roughly/approximately" prefix も対応
  - sentenceScore() でも duration ヒット時に +0.35 ボーナス（非 duration の +0.22 より高い）
  - DoD: cat-2 temporal の F1 が上昇

- [x] `cc:完了 [P]` **SD-011**: factual extractCorePhrase() 精度向上
  - ソート基準を「novelty優先 → novelty同値時: len降順」から「wordCount昇順 → len昇順」に変更
  - クエリ完全重複固有名詞も「最短」で返す fallback 追加
  - novelClause（新情報節）優先 → clauseWithOverlap → 先頭節 の順に変更
  - DoD: cat-1 factual の F1 が +2pp 以上

- [x] `cc:完了 [P]` **SD-012**: yes_no 判定の否定語コンテキスト改善
  - normalizeYesNo() で "not only/just/merely/simply/purely" を否定語チェック前に除去
  - DoD: yes_no カテゴリの F1 が改善

- [x] `cc:完了` **SD-013**: BM25 title weight 調整（2.0→3.0）
  - observation-store.ts の bm25() 引数変更のみ。計測は SD-014 に委ねる
  - DoD: 変更適用、既存テスト pass

- [x] `cc:完了` **SD-014**: F1 再計測 + N拡充判断
  - 結果: F1=0.2533 (baseline 0.1794 → +7.4pp改善)
  - CI下限 0.27 には F1>=0.34 が必要だが現在0.253。N拡充では解決不可
  - **判断**: N拡充は不要（効果なし）。根本的な検索精度改善が必要 → §36

### Phase C: 統合検証（6タスク）

- [x] `cc:完了 [P]` **SD-015**: locomo N拡充 → スキップ（SD-014 で不要と判断）
- [x] `cc:完了` **SD-016**: 全ベンチマーク同時計測
  - tau=0.560 [0.507,0.614] | F1=0.253 | Freshness=0.97 | bilingual=0.72 | dev-workflow=0.74
- [ ] `cc:TODO` **SD-017**: 3層 CI ゲート閾値更新（新目標値で Layer 1 更新）
- [ ] `cc:TODO` **SD-018**: 384次元 embedding 評価（bilingual N=20 で feasibility のみ, 非破壊）
- [x] `cc:完了` **SD-019**: リグレッション確認 + 全テスト pass（1358件 pass）
- [ ] `cc:WIP` **SD-020**: §35 完了レポート + §36 提言

### §35 完了判定

**性能目標（Bootstrap CI 下限で判定）:**
1. Temporal Weighted Kendall tau >= 0.70（CI 下限, ケースリサンプリング後）
2. locomo F1 CI 下限 >= 0.27（Bootstrap 95% CI）
3. Freshness@K >= 0.70（維持）
4. bilingual recall >= 0.85（Wilson CI 下限, 維持）
5. `bun test` 全 pass + 3層 CI ゲート全 pass

**追加条件:**
- bilingual ドメイン tau >= 0.55（現 0.478 からの改善）
- Bootstrap CI が全指標で SE > 0（variance=0 の解消）

### スコープ外（§36 以降）

- 384次元 embedding 導入（§35 では評価のみ）
- Multi-hop Graph traversal 強化
- LLM Judge 評価
- LoCoMo 200サンプル以上への拡充
