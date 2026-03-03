# Harness-mem 実装マスタープラン

最終更新: 2026-03-03（§30 アーキテクチャ改善 全19タスク完了）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-21 → [`docs/archive/Plans-2026-02-26.md`](docs/archive/Plans-2026-02-26.md)
> §22 → [`docs/archive/Plans-s22-2026-02-27.md`](docs/archive/Plans-s22-2026-02-27.md)
> §23-26 → [`docs/archive/Plans-s23-s26-2026-03-02.md`](docs/archive/Plans-s23-s26-2026-03-02.md)
> §27 → [`docs/archive/Plans-s27-2026-03-02.md`](docs/archive/Plans-s27-2026-03-02.md)
> §28P1 CQRS + ReviewR1 + FIX-001 + §27.1 → [`docs/archive/Plans-s28-review-2026-03-03.md`](docs/archive/Plans-s28-review-2026-03-03.md)
> §29 競合ベンチマーク改善 (10/10完了, 119→128/140) → [`docs/archive/Plans-s29-2026-03-03.md`](docs/archive/Plans-s29-2026-03-03.md)
> **テストケース設計**: [`docs/test-designs-s22.md`](docs/test-designs-s22.md) / [`docs/test-designs-s27.1.md`](docs/test-designs-s27.1.md)

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## §30. アーキテクチャ改善 — 保守性と拡張性の基盤構築

**背景**: §29 で機能面は 128/140（単独トップ）を達成。しかし構造的負債が残存:
- core.ts 2,043行（目標2,000行以下を43行超過）
- 生 SQL が6ファイルに約190箇所散在（Repository パターンなし）
- LangChain 実装が3箇所に重複
- MCP SDK 0.5.x（1.x 利用可能）
- CLI 3,721行 Bash（テスト不能）
- Ingester に共通インターフェースなし

**方針**: 機能は増やさず、同じ機能をより保守しやすい構造に入れ直す。
**テスト**: 788テスト全通過を維持すること。→ **結果: 908 pass / 0 fail（120テスト増）**

---

### Phase 0: クイックウィン（P0, 5タスク, 4並列可）

目的: §27.2 の残タスク完了 + CQRS Phase 1 の仕上げ。全て小規模で即効性が高い。

- [x] `cc:完了` **ARC-001**: SDK health() パスバグ修正（既に正しい状態を確認）
- [x] `cc:完了` **ARC-002**: Python SDK エンドポイントパリティ（searchFacets/feed +4テスト）
- [x] `cc:完了` **ARC-003**: core-split テストの core 依存除去（91テスト pass）
- [x] `cc:完了` **ARC-004**: core.ts setInterval→IngestCoordinator（core.ts 1,779行）
- [x] `cc:完了` **ARC-005**: LangChain 3重→1箇所統合（TS+Python 各1箇所）

---

### Phase 1: Repository パターン導入（P1, 6タスク, 3並列可）

目的: 生 SQL を Repository に閉じ込め、PostgreSQL async 対応の基盤を作る。
前提: Phase 0 完了

- [x] `cc:完了` **ARC-006**: Repository インターフェース定義（3インターフェース async-first）
- [x] `cc:完了` **ARC-007**: SQLite ObservationRepository（14テスト）
- [x] `cc:完了` **ARC-008**: SQLite SessionRepository（15テスト）
- [x] `cc:完了` **ARC-009**: VectorRepository + JS fallback（11テスト）
- [x] `cc:完了` **ARC-010**: ObservationStore timeline を Repository 経由に移行
- [x] `cc:完了` **ARC-011**: パフォーマンス回帰テスト（4ベンチマーク全て +10%以内）

---

### Phase 2: MCP + SDK 統合（P2, 4タスク, 2並列可）

目的: MCP SDK 1.x アップグレード + OpenAPI 仕様作成。
前提: Phase 0 完了（Phase 1 と並列実行可）

- [x] `cc:完了` **ARC-012**: MCP SDK 0.5.x → 1.27.1（コード変更ゼロ、20テスト pass）
- [x] `cc:完了` **ARC-013**: OpenAPI 3.1 スキーマ（56エンドポイント、26スキーマ）
- [x] `cc:完了` **ARC-014**: MCP-OpenAPI 整合性 CI（13テスト + ワークフロー）
- [x] `cc:完了` **ARC-015**: 環境変数リファレンス（86変数文書化）

---

### Phase 3: Ingester プラグイン化（P2, 4タスク, 2並列可）

目的: 14 ingester に共通インターフェースを与え、拡張性を確保。
前提: Phase 0 完了

- [x] `cc:完了` **ARC-016**: PlatformIngester インターフェース定義
- [x] `cc:完了` **ARC-017**: 13 ingester が implements PlatformIngester
- [x] `cc:完了` **ARC-018**: IngesterRegistry + createDefaultRegistry()
- [x] `cc:完了` **ARC-019**: IngestCoordinator polling 統合（registerIngester/startAll/stopAll）

---

### §30 完了判定

| Phase | タスク数 | 並列度 | 主な成果物 |
|-------|:-------:|:------:|-----------|
| Phase 0 | 5 | 4 | CQRS完結 + SDK統合 |
| Phase 1 | 6 | 3 | Repository パターン |
| Phase 2 | 4 | 2 | MCP 1.x + OpenAPI |
| Phase 3 | 4 | 2 | Ingester プラグイン |
| **合計** | **19** | | |

```
Phase 0 (4並列):
  ARC-001〜004 ──┬→ Phase 1 (3並列):        Phase 2 (2並列):
  ARC-005 ───────┤   ARC-006→007〜009→010   ARC-012→014
                 │   ARC-011                 ARC-013 [P]
                 │                           ARC-015 [P]
                 └→ Phase 3 (2並列):
                     ARC-016→017→018
                     ARC-019 [P]
```

**§30 DoD（全体完了条件）**:
1. core.ts が **2,000行以下**のファサード
2. LangChain 実装が **TS 1箇所 + Python 1箇所**
3. 生 SQL が **Repository 経由のみ**（observation-store.ts 範囲）
4. MCP SDK **1.x** + 全19ツール動作
5. `docs/openapi.yaml` が全エンドポイントをカバー
6. 14 ingester が **PlatformIngester** インターフェース実装
7. テスト **788件以上** 全 pass
