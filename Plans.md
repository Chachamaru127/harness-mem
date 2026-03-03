# Harness-mem 実装マスタープラン

最終更新: 2026-03-03（§30 アーキテクチャ改善プラン策定）
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
**テスト**: 788テスト全通過を維持すること。

---

### Phase 0: クイックウィン（P0, 5タスク, 4並列可）

目的: §27.2 の残タスク完了 + CQRS Phase 1 の仕上げ。全て小規模で即効性が高い。

- [ ] `cc:TODO [P]` **ARC-001**: SDK health() パスバグ修正
  - TS SDK が `/v1/health` を叩いているが正しくは `/health`
  - DoD: SDK テスト 1件追加。health() が正しいパスを叩く

- [ ] `cc:TODO [P]` **ARC-002**: Python SDK エンドポイントパリティ
  - Python SDK に searchFacets / feed の2メソッドを追加
  - DoD: Python SDK が TS SDK と同等のカバレッジ + テスト 4件

- [ ] `cc:TODO [P]` **ARC-003**: core-split テストの core 依存除去
  - test-helpers.ts が harness-mem-core を型 import している
  - 目標: types.ts から直接 import に変更
  - DoD: core-split の87テストが core を import せず pass

- [ ] `cc:TODO [P]` **ARC-004**: core.ts setInterval 6本を IngestCoordinator に移譲
  - heartbeat + 5 ingest ポーリングを core から IngestCoordinator へ物理移動
  - DoD: core.ts に setInterval が0本。core.ts 2,000行以下達成

- [ ] `cc:TODO` **ARC-005**: LangChain 実装の3重→1箇所統合
  - `sdk/src/integrations.ts` / `sdk/src/langchain-memory.ts` / `python-sdk/harness_mem/langchain_memory.py`
  - TS: langchain-memory.ts を正本、integrations.ts の LangChain 部分を削除
  - Python: langchain_memory.py を正本、`integrations/langchain/` との関係を整理
  - DoD: LangChain 実装が TS 1箇所 + Python 1箇所のみ

---

### Phase 1: Repository パターン導入（P1, 6タスク, 3並列可）

目的: 生 SQL を Repository に閉じ込め、PostgreSQL async 対応の基盤を作る。
前提: Phase 0 完了

- [ ] `cc:TODO` **ARC-006**: Repository インターフェース定義
  - `db/repositories/` に IObservationRepository, ISessionRepository, IVectorRepository
  - 全メソッドが `Promise<T>` を返す（async-first）
  - DoD: TypeScript インターフェース定義完了 + typecheck 通過

- [ ] `cc:TODO [P]` **ARC-007**: SQLite ObservationRepository 実装
  - observation-store.ts の生 SQL を Repository に移動
  - DoD: unit テスト 10件以上

- [ ] `cc:TODO [P]` **ARC-008**: SQLite SessionRepository 実装
  - session-manager.ts + core.ts の session 関連 SQL を移動
  - DoD: unit テスト 5件以上

- [ ] `cc:TODO [P]` **ARC-009**: VectorRepository 実装
  - sqlite-vec / js-fallback の差異を Repository 内に閉じ込め
  - DoD: vector エンジン切り替えが外部から透過的

- [ ] `cc:TODO` **ARC-010**: ObservationStore を Repository 経由に移行
  - 生 SQL → Repository 呼び出しに変換
  - DoD: observation-store.ts が db.query() を直接呼ばない

- [ ] `cc:TODO` **ARC-011**: パフォーマンス回帰テスト
  - Repository 導入前後の検索レイテンシを計測
  - DoD: レイテンシが +10% 以内

---

### Phase 2: MCP + SDK 統合（P2, 4タスク, 2並列可）

目的: MCP SDK 1.x アップグレード + OpenAPI 仕様作成。
前提: Phase 0 完了（Phase 1 と並列実行可）

- [ ] `cc:TODO` **ARC-012**: MCP SDK ^0.5.0 → ^1.x アップグレード
  - DoD: 全19 MCP ツール動作 + mcp-runtime テスト pass

- [ ] `cc:TODO [P]` **ARC-013**: OpenAPI 3.1 スキーマ定義
  - `docs/openapi.yaml` に全 40+ エンドポイントをカバー
  - DoD: openapi-generator で lint エラーなし

- [ ] `cc:TODO [P]` **ARC-014**: MCP ツール定義の自動検証
  - OpenAPI との整合性を CI 自動チェック
  - DoD: CI ワークフロー追加

- [ ] `cc:TODO` **ARC-015**: 環境変数リファレンス作成
  - 55変数の全量を `docs/environment-variables.md` に文書化
  - DoD: 全変数のデフォルト値・説明・使用箇所を記載

---

### Phase 3: Ingester プラグイン化（P2, 4タスク, 2並列可）

目的: 14 ingester に共通インターフェースを与え、拡張性を確保。
前提: Phase 0 完了

- [ ] `cc:TODO` **ARC-016**: PlatformIngester インターフェース定義
  - `ingest/types.ts` に共通インターフェース
  - DoD: インターフェース定義完了

- [ ] `cc:TODO [P]` **ARC-017**: 既存 ingester をインターフェースに適合
  - 14 ingester が `implements PlatformIngester`
  - DoD: 全 ingester が適合 + 既存テスト pass

- [ ] `cc:TODO` **ARC-018**: IngesterRegistry 実装
  - ハードコード呼び出し → Registry 経由
  - DoD: 新 ingester 登録が Registry への1行追加で完了

- [ ] `cc:TODO [P]` **ARC-019**: ポーリング管理を IngestCoordinator に統合
  - ARC-004 で移譲した setInterval を IngestCoordinator が一括管理
  - DoD: 各 Ingester が自身のスケジュールを宣言

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
