# CHANGELOG_ja

## [0.1.9] - 2026-02-18

### 🎯 変更点（ユーザー向け）

検索精度を上げつつ、プロジェクト混入・privacy誤判定・ベクトル互換問題を同時に解消しました。

| Before | After |
|--------|-------|
| `hybrid_v1` でスコア情報が限定的 | `hybrid_v3` で `tag_boost` / `importance` / `graph` を利用 |
| link拡張時に他プロジェクトが混ざる可能性 | `strict_project` で同一プロジェクトのみ返却 |
| privacy判定が文字列一致ベース | JSONタグを厳密判定（`private` / `sensitive`） |
| 旧ベクトル混在でランキングがぶれる可能性 | model/dimension一致のみ比較し、coverage不足時は重み自動調整 |

### 追加

- `/v1/search` に `expand_links` / `strict_project` / `debug` を追加
- `/v1/search` レスポンスに `scores.graph` / `meta.candidate_counts` / `meta.vector_coverage` を追加
- entity抽出・観測リンク（`follows` / `shared_entity`）を検索シグナルに追加

### 変更

- ランキングを `hybrid_v1` から `hybrid_v3` へ更新
- デフォルト vector 次元を `256` へ変更
- vector model を `local-hash-v3` に更新

### 修正

- link拡張時のプロジェクト混入を防止
- privacyの誤除外/誤判定を防止
- vector model/dimension 混在による検索品質劣化を防止

### 検証

- `cd memory-server && bun test && bun run typecheck`
