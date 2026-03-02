# §27.1 品質強化 テストケース設計

> 品質監査で C/B 評価だった NEXT タスクの統合テスト設計。
> 各テストケースは TDD（テスト先行）で実装する。

---

## HARDEN-001: OCR 統合テスト

| テストケース | 入力 | 期待出力 | 備考 |
|-------------|------|---------|------|
| 英数字 PNG | `tests/fixtures/hello.png` | "Hello World" 部分一致 | 基本動作 |
| 空白画像 | `tests/fixtures/blank.png` | 空文字 or エラー | エッジケース |
| 日本語テキスト | `tests/fixtures/japanese.png` | 日本語テキスト部分一致 | lang=jpn |

---

## HARDEN-002: SDK 型互換テスト

| テストケース | 入力 | 期待出力 | 備考 |
|-------------|------|---------|------|
| LangChain save_context | `{input: "hi", output: "hello"}` | `recordEvent` 呼出 | 型安全に |
| LlamaIndex put/get | `{key: "k", messages: [...]}` | `search` 結果返却 | 型安全に |
| satisfies BaseMemory | コンパイル | エラーなし | 型互換性 |
| satisfies ChatStore | コンパイル | エラーなし | 型互換性 |

---

## HARDEN-003: Sync HTTP エンドポイント

| テストケース | 入力 | 期待出力 | 備考 |
|-------------|------|---------|------|
| push 正常 | POST /v1/sync/push + changeset JSON | 200 + merge result | 基本動作 |
| pull 正常 | GET /v1/sync/pull?since=... | 200 + changeset JSON | 基本動作 |
| push 認証なし | POST without token | 401 | セキュリティ |
| push コンフリクト | 2件の同一 ID 異タイムスタンプ | 200 + conflicts 配列 | LWW 検証 |
| push 冪等性 | 同一 changeset 2回送信 | 結果同一 | dedupe |
| pull since なし | GET /v1/sync/pull (全件) | 全レコード返却 | エッジケース |

---

## HARDEN-004: pgvector Docker CI 統合テスト

| テストケース | 入力 | 期待出力 | 備考 |
|-------------|------|---------|------|
| DDL 適用 | POSTGRES_INIT_SQL 実行 | エラーなし | スキーマ検証 |
| ベクトル INSERT + 検索 | 3件登録 → 類似検索 | 最近傍が先頭 | 精度検証 |
| 直交ベクトル | [1,0,0] vs [0,1,0] | distance ≈ 1.0 | コサイン距離 |
| 大量データ | 100件登録 → LIMIT 10 | 10件返却 | スケール |

---

## HARDEN-005: Reranker テスト閾値

現状の `< 0.8` を `< 0.3` に厳格化。日本語バイグラムテスト1件追加。

---

## HARDEN-006: LoCoMo maxSamples 伝播バグ

| テストケース | 入力 | 期待出力 | 備考 |
|-------------|------|---------|------|
| maxSamples=3 | 10件データ | 評価件数 ≤ 3 | 再現テスト |
| maxSamples 未指定 | 10件データ | 全件評価 | デフォルト動作 |
