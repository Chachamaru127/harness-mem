# Harness-mem 実装マスタープラン

最終更新: 2026-03-04（§31 全20タスク完了, 941+テスト）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-21 → [`docs/archive/Plans-2026-02-26.md`](docs/archive/Plans-2026-02-26.md)
> §22 → [`docs/archive/Plans-s22-2026-02-27.md`](docs/archive/Plans-s22-2026-02-27.md)
> §23-26 → [`docs/archive/Plans-s23-s26-2026-03-02.md`](docs/archive/Plans-s23-s26-2026-03-02.md)
> §27 → [`docs/archive/Plans-s27-2026-03-02.md`](docs/archive/Plans-s27-2026-03-02.md)
> §28P1 CQRS + ReviewR1 + FIX-001 + §27.1 → [`docs/archive/Plans-s28-review-2026-03-03.md`](docs/archive/Plans-s28-review-2026-03-03.md)
> §29 競合ベンチマーク改善 (10/10完了, 119→128/140) → [`docs/archive/Plans-s29-2026-03-03.md`](docs/archive/Plans-s29-2026-03-03.md)
> §30 アーキテクチャ改善 (19/19完了, 908テスト) → [`docs/archive/Plans-s30-2026-03-03.md`](docs/archive/Plans-s30-2026-03-03.md)
> §31 競合ベンチマーク首位奪還 (20/20完了, 941+テスト) → [`docs/archive/Plans-s31-2026-03-04.md`](docs/archive/Plans-s31-2026-03-04.md)
> **テストケース設計**: [`docs/test-designs-s22.md`](docs/test-designs-s22.md) / [`docs/test-designs-s27.1.md`](docs/test-designs-s27.1.md)

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

§31 まで完了。次のセクションの計画待ち。

### 達成済みマイルストーン

| セクション | 成果 | テスト数 |
|-----------|------|:-------:|
| §29 | 競合ベンチマーク 128/140 首位 | 788 |
| §30 | アーキテクチャ改善（Repository/Ingester/MCP/OpenAPI） | 908 |
| §31 | 4領域強化（Graph/PG/Team/LoCoMo）で 120+/140 目標 | 941+ |

### §31 で追加された主要機能

- **Graph**: 8種 relation 双方向 BFS + 設定可能 depth（1-5ホップ）
- **PostgreSQL**: Pg*Repository 3クラス + adapter-factory PG 自動検出 + E2E テスト
- **Team API**: 9エンドポイント（CRUD 5 + メンバー管理 4）+ member ロール適用
- **LoCoMo CI**: F1 回帰 -5% で CI fail + LOCOMO_F1_THRESHOLD 環境変数
- **SDK**: TS/Python に Team API 9メソッド追加 + OpenAPI スキーマ
