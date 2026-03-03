# Archive: §28P1 CQRS + Review R1 + FIX-001 (2026-03-03)

## PERF-001〜003: Performance High 3件修正 `cc:完了`

- P-1: idx_mem_audit_log_action_target インデックス追加 (schema.ts migrateSchema)
- P-2: searchFacets() の tags を SQL GROUP BY で集計 (observation-store.ts)
- P-3: autoLinkObservation() の INSERT ループをバッチ化 (event-recorder.ts)
- 検証: bun test 811 pass / 0 fail

## SEC-001: Security High 2件の修正 `cc:完了`

- S-1: AccessFilter インターフェースに user_id / team_id フィールドを追加し、params 添字参照を排除
- S-2: server.ts の /v1/feed ハンドラで AuthConfig がない匿名モード時は user_id / team_id クエリパラメータを無視
- 検証: bun test 811 pass / 0 fail

## FIX-001: Bun並列テストSQLiteフラッキー修正 `cc:完了`

- 原因: バックグラウンドタイマーコールバックが shutdown 後もDBにアクセスし続ける race condition
- 修正: `startBackgroundWorkers()` の各タイマーコールバックに `shuttingDown` ガード + `try-catch` を追加
- 検証: `bun test memory-server/tests/` を3回実行、全600テストパス（0失敗）

## §27 + §27.1 結果サマリー

**§27 申告値**: 103 + 11 = 114/140 → §27.1 品質強化後: **118/140 (84.3%)**
→ §28P1 CQRS + ReviewR1 後: **119/140 (85.0%)**

### §27.1 品質ゲート修正（全6タスク完了）

- [x] HARDEN-001: OCR 統合テスト（Tesseract.js 実動作検証）
- [x] HARDEN-002: SDK 型互換テスト（`as never` 除去）
- [x] HARDEN-003: Sync HTTP エンドポイント実装
- [x] HARDEN-004: pgvector Docker CI 統合テスト
- [x] HARDEN-005: Reranker テスト閾値の厳格化
- [x] HARDEN-006: LoCoMo maxSamples 伝播バグ修正
