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

## 9. ZDR Enforcement — 法人が監査する 7 統制

retention=0 を「標語」ではなく「実行される契約」にするための、Enterprise tier が監査する 7 つの統制点。`HARNESS_MEM_PRO_ZDR_ENFORCED=1` で Pro provider に強制した上で、以下が満たされていることをコード/運用の両面で確認する。

1. **request/response ログ無し**
   入力テキスト・応答 body をログに出さない。残してよいのは HTTP status / timeout / degraded のトリガー時刻のみ。`pro-api-provider.ts` の error message は入力テキストを混入させない (unit test で検証)。

2. **埋め込みテキストのディスクキャッシュ無し**
   `zdrEnforced=true` の Pro provider は in-memory cache も無効化する (キー = 入力テキスト)。プロセスメモリ上でも payload を蓄積しない。ディスクキャッシュは元から存在しない。

3. **crash dump / metrics に payload を載せない**
   exception スタック・OTel span・health.details すべてに入力テキストを含めない。metrics は HTTP status / latency / cache stats のみ (entries 数も payload-free)。

4. **backup は payload 除外**
   sqlite-vec 索引のバックアップ対象から `mem_observations.content` 系を除外する運用 (バックアップ取得側のチェックリスト)。Pro 経路は元々 stateless で content をディスクに書かないが、周辺 (observation store) 側の責任として明文化する。

5. **support-access 境界の明文化**
   harness-mem 提供側のサポート担当が顧客 DB / payload に到達できる経路を持たない (顧客 VPS / 顧客 BigQuery でホスト)。サポートで顧客 ID を必要とする場合は「メモリ本文を出さずに ID だけで操作可能」な手順を維持。

6. **subprocessor への no-train flow-down**
   オーバーフロー時に第三者 (Voyage 等) を使う場合、顧客契約と同等の「no training on customer data」条項を subprocessor 契約に明文で伝播する。第三者を使わない構成 (自前ホスト granite default) では subprocessor list は空。

7. **ZDR enforcement フラグ = 実行される契約**
   `HARNESS_MEM_PRO_ZDR_ENFORCED=1` を立てたとき、上記 1–3 がコード側で実行される (cache 無効化 / error message サニタイズ / health 表記に `[zdr=enforced]` 付与)。`docs/pro-api-data-policy.md` だけでなく、unit test で「at-rest で content が残らない」ことを検証する。

戦略上の位置付け: ZDR は競合 (OpenAI / Anthropic / Azure / Cohere) がほぼ全社「sales-gated・per-org・approval 必須」で売る Enterprise 統制軸。自前ホスト granite 構成では retention=0 を **資格** ではなく **付与** できる — その差を上の 7 統制で監査可能にする。

参照: `docs/strategy/server-product-strategy-2026-06-15.md` Enterprise pillar (b)。
