# Retrospective A/B 評価ガイド（§34 FD-017）

## 概要

`retrospective-eval.ts` は、実際の使用ログ（`mem_audit_log` の `search_hit`）を
暗黙の肯定フィードバックとして活用し、旧アルゴリズム（§33）と新アルゴリズム（§34）を
オフラインで比較評価するフレームワークです。

## 評価方針

### 暗黙フィードバックの活用

`mem_audit_log` には、検索時に返された observation の ID が `search_hit` として記録されます。
これを「実際に有用だった結果」の近似として扱います。

```
search_hit エントリ = 過去に実際に返された（暗黙的に有用とみなされた）observation
```

**注意**: 返却されただけで「クリックされた」わけではありません。
Recall@K の値は上限として解釈してください。

### アルゴリズムバージョン

| バージョン | 説明 | 環境変数 |
|-----------|------|---------|
| `v33` | §33 設定（decay あり、reranker なし） | `DECAY_DISABLED=0`, `RERANKER=0` |
| `v34` | §34 設定（decay なし、reranker あり）| `DECAY_DISABLED=1`, `RERANKER=1` |

### 評価指標

- **Recall@5**: top-5 内に過去の hit が含まれる割合
- **Recall@10**: top-10 内に過去の hit が含まれる割合
- **Delta**: v34 - v33 の差（正 = 改善、負 = 回帰）

## 使用方法

### コマンドライン実行

```bash
# デフォルト: 最大100クエリをサンプリング、stdout に結果表示
bun memory-server/src/benchmark/retrospective-eval.ts ~/.harness-mem/harness-mem.db

# ファイルに出力
bun memory-server/src/benchmark/retrospective-eval.ts ~/.harness-mem/harness-mem.db \
  memory-server/src/benchmark/results/fd-017-retrospective-report.json
```

### TypeScript API

```typescript
import { runRetrospectiveEval, sampleSearchHits } from "./retrospective-eval";

// フル評価（v33 vs v34 の並列実行）
const report = await runRetrospectiveEval(
  "/path/to/harness-mem.db",
  100,  // max queries
  "/path/to/output.json"
);

console.log(`v34 recall@10: ${report.algo_v34.recall_at_10.toFixed(4)}`);
console.log(`delta: ${report.delta.recall_at_10.toFixed(4)}`);

// クエリのサンプリングのみ
import { Database } from "bun:sqlite";
const db = new Database(dbPath, { readonly: true });
const queries = sampleSearchHits(db, 50);
db.close();
```

## 出力フォーマット

```json
{
  "schema_version": "fd-017-retrospective-v1",
  "generated_at": "2026-03-05T...",
  "db_path": "/path/to/harness-mem.db",
  "algo_v33": {
    "recall_at_5": 0.45,
    "recall_at_10": 0.62,
    "n_queries": 87
  },
  "algo_v34": {
    "recall_at_5": 0.51,
    "recall_at_10": 0.68,
    "n_queries": 87
  },
  "delta": {
    "recall_at_5": 0.06,
    "recall_at_10": 0.06
  },
  "queries_sampled": 87,
  "per_query_results": [...]
}
```

## 制約と注意事項

1. **audit_log が空の場合**: `search_hit` が記録されていない場合は評価不可。
   事前に実際の検索操作が必要です。

2. **サンプルバイアス**: 過去の検索ヒットはアルゴリズム自身が返した結果のため、
   §33 アルゴリズムに有利なバイアスがあります（exploration bias）。

3. **DB コピーコスト**: 各アルゴリズムバージョンの評価で obs を一時 Core に再投入するため、
   大規模 DB ではメモリ・時間コストが増加します（上限 2000 obs）。

4. **決定論性**: v34 は reranker enabled のため、BM25 スコアが含まれ結果が安定します。
   v33 は decay が有効でタイムスタンプ依存のため、実行時刻により若干変動します。

## データフロー

```
mem_audit_log
  │ (search_hit, action='search_hit')
  ↓
sampleSearchHits()
  │ (group by query+project, max 100)
  ↓
queries: RetroQuery[]
  │
  ├─ evaluateAlgo(queries, "v33", dbPath)
  │    └─ HarnessMemCore (v33 config)
  │         └─ search(query) → recall@K
  │
  └─ evaluateAlgo(queries, "v34", dbPath)
       └─ HarnessMemCore (v34 config)
            └─ search(query) → recall@K
  │
RetroReport (delta, per_query_results)
```
