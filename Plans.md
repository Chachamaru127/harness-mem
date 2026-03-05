# Harness-mem 実装マスタープラン

最終更新: 2026-03-06（§36 Retrieval Quality Reform 完了 — 15タスク, 1026テスト）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32 17タスク完了 | §33 15タスク完了 | §34 20タスク完了 | §35 18完了+2blocked（CI PASS, F1+7.4pp） | §36 15タスク完了（CI PASS, F1+1.43pp, cat-3+9.5pp）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

**§36 Retrieval Quality Reform — 完了**（2026-03-06, 1026テスト pass）

| 指標 | §35 ベースライン | §36 最終値 | 変化 |
|------|-----------------|------------|------|
| locomo F1 (overall) | 0.253 | 0.268 | +1.43pp ✅ |
| cat-3 F1 | 0.157 | 0.252 | +9.5pp ✅ (DoD 0.20 達成) |
| temporal tau | 0.560 | 0.567 | +0.7pp |
| Freshness@K | 0.97 | 0.96 | -1pp (許容範囲内) ✅ |
| bilingual recall@10 | 0.72 | 0.70 | -2pp（§37 継続） |
| CI Layer 1 | PASS | PASS | ✅ |

§36 性能目標達成: 5目標中2つ達成（Freshness + CI gate）、残3つは §37 継続

---

## §36 完了（全15タスク `cc:完了`）

**Phase A** (Embedding+Bilingual): RQ-001〜005 完了
**Phase B** (Recall+F1): RQ-006〜010 完了 — RRF実装, query expansion, cat-3強化
**Phase C** (Temporal+統合): RQ-011〜015 完了 — temporal 2段階検索, CI PASS

主要変更ファイル:
- `memory-server/src/core/observation-store.ts` — RRF (k=60), graphMaxHops 3→4
- `memory-server/src/core/core-utils.ts` — SYNONYM_MAP 50+エントリ追加
- `tests/benchmarks/locomo-harness-adapter.ts` — cat-3クエリバリアント修正

---

## §37 提言

### 優先度 HIGH

1. **本格的な multilingual embedding 導入**（bilingual 0.80+ 達成に必須）
   - 現在の64次元ランダム埋め込みから ONNX 実推論に切替
   - multilingual-e5 (384次元) または mGTE (256次元) を推奨
   - vector検索が機能すれば locomo F1 +5-10pp 期待

2. **embedding キャッシュ戦略**
   - ベンチマーク実行時の一貫性確保（毎回ランダム埋め込みが生成される問題）

### 優先度 MEDIUM

3. **locomo F1 0.30 突破** — vector検索有効化後に再計測
4. **bilingual floor 0.70→0.80** — multilingual embedding 導入後に再検討
5. **temporal tau 0.65** — アンカーパターン検出精度向上が有効
