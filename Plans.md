# Harness-mem 実装マスタープラン

最終更新: 2026-03-02
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-17, §18-20 → [`docs/archive/Plans-2026-02-26.md`](docs/archive/Plans-2026-02-26.md)
> §22 IMP-001〜011, W3-001〜004, §27.2 QH-001〜006, §28 CQRS-001〜007, Quality H1/M5, M4, H2 → [`docs/archive/Plans-2026-03-02.md`](docs/archive/Plans-2026-03-02.md)
> **テストケース設計**: [`docs/test-designs-s22.md`](docs/test-designs-s22.md)

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## Security Fix: CQRS decomposition security findings `cc:完了`

目的: Harness レビューで検出されたセキュリティ指摘（H2/M4/M3）を修正する。
- H2: timeline() センター観察のプライバシーフィルタ欠落（observation-store.ts）
- M4: Boolean("false")==true 問題（server.ts の include_private 3箇所）
- M3: importパス検証順序（harness-mem-core.ts — 別エージェント担当のため本タスクでは除外）
- Performance Fix: ObservationStoreDeps snapshot fields → getter functions, getMigrationProgress cache
- 結果: 279テスト全通過、型チェック通過

---

## Quality H1/H2/H3: 共有コードの重複排除 `cc:完了`

目的: `harness-mem-core.ts` と `ingest-coordinator.ts` に存在する重複定数・関数を `core-utils.ts` に集約し、冗長性を排除する。
対象: `core-utils.ts`, `harness-mem-core.ts`, `ingest-coordinator.ts`

- Fix 1: DEFAULT_* 定数 14 個を core-utils.ts へ移動
- Fix 2: workspace resolution 関数 3 個を core-utils.ts へ移動
- Fix 3: ensureSession を core-utils.ts の共有関数へ移動
- Fix 4: ObservationStore deps の値スナップショットをゲッターラムダに変更
- Fix 5: harness-mem-core.ts のローカルエイリアスを削除
