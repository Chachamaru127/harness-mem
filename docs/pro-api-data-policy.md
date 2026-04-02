# Pro API Data Policy

この文書は、Adaptive Retrieval Engine の Pro API 経路で扱うデータ方針をまとめたものです。

目的は 2 つです。

- 利用者が「どこまで外へ出るのか」を把握できること
- 実装者が「ここまではやってよく、ここからはやってはいけない」を共有できること

## 1. 前提

Pro API 経路は、`HARNESS_MEM_PRO_API_KEY` と `HARNESS_MEM_PRO_API_URL` の両方が設定されたときだけ有効です。

使われるのは、adaptive provider の汎用側ルートです。日本語側のローカルルートまで外部 API に置き換える設計ではありません。

## 2. 送るデータ

送信するのは埋め込み生成に必要な最小限の情報です。

- 入力テキスト
- モデル名
- mode（`query` または `passage`）

認証には API key を使います。

## 3. 送らないデータ

次は Pro API の契約上、送らない前提です。

- SQLite 本体
- 観察メタデータ一式の丸ごと転送
- 取得済みのベクトルキャッシュ全体
- ログ用に連結した大量の本文ダンプ

## 4. Zero-Retention 方針

Zero-Retention は「応答を返すために必要な瞬間以外は保持しない」という考え方です。

この経路では次を前提とします。

- in-memory only
  リクエスト本文は処理中メモリにのみ置く
- no-disk-write
  本文を永続ストレージへ保存しない
- response-returned-then-discard
  応答返却後は本文を保持し続けない

## 5. 通信要件

- TLS 1.3 以上を必須とする
- 認証は `Authorization: Bearer ...` または `x-api-key` のどちらか一方ではなく、現在実装互換のため両方を許容している
- タイムアウトは 5 秒

## 6. ログ方針

ログには本文を入れません。

残してよいのは次のような運用情報です。

- HTTP status
- timeout / degraded の発生有無
- fallback へ切り替えた時刻
- recovery した時刻

残してはいけないもの:

- 入力テキスト全文
- 連結した会話本文
- 秘密情報をそのまま含む例外メッセージ

## 7. 障害時の扱い

Pro API が失敗した場合、Adaptive Retrieval Engine は Free 経路へフォールバックします。

つまり障害時の基本方針は:

- 検索を止めない
- 品質だけを控えめに落とす
- 一定時間後に自動再試行する

## 8. 実装チェックポイント

コードレビュー時は、少なくとも次を確認します。

- `memory-server/src/embedding/pro-api-provider.ts` が 5 秒タイムアウトを持つ
- `health()` が失敗時に `degraded` を返す
- キャッシュはベクトルだけを持ち、原文ログ保存をしていない
- `memory-server/src/embedding/adaptive-provider.ts` が fallback/backoff を持つ
- 運用ログに本文が出ていない
