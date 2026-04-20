# Session Handoff

harness-mem が同一プロジェクト内の複数 session 間で会話文脈を引き継ぐ仕組み。

## 2 系統の handoff

### 1. Session-close handoff (既存)

session が正常終了 (Stop / TaskCompleted / 明示 finalize) すると、`session_summary` observation が生成される。新 session 起動時の `/v1/resume-pack` がこの summary を `additionalContext` に注入する。

- 契機: Stop hook → `finalize_session`
- 対象 session 状態: `active` → `closed`
- 生成される observation: `session_summary` (metadata.is_partial は付かない)
- 新 session での露出: resume-pack の `items[].type === "session_summary"`

### 2. Live handoff via periodic partial finalize (§91, XR-004)

現 session を閉じずに並行して別 session を開いた場合でも直前会話が引き継がれるよう、daemon が定期的に partial summary を生成する。

- 契機: daemon 内 scheduler loop (opt-in、既定は無効)
- 対象 session 状態: `active` のまま維持
- 生成される observation: `session_summary` with `metadata.is_partial=true`
- 新 session での露出: resume-pack の `items[].type === "session_summary"` かつ `items[].is_partial === true`

## 設定

scheduler は既定 OFF。opt-in は **環境変数** と **config.json** の 2 経路、優先順は
`env var > ~/.harness-mem/config.json > default`。

### 1. config.json (永続化、配布向け推奨)

`~/.harness-mem/config.json` に 2 キーを追記:

```json
{
  "partialFinalizeEnabled": true,
  "partialFinalizeIntervalMs": 300000
}
```

daemon 再起動後に反映。どの経路で restart (shell / harness-mem-ui 経由 / crash
recovery 等) しても設定が落ちない。

### 2. 環境変数 (一時的 override / shell rc 固定向け)

| Env var | 既定 | 意味 |
|---|---|---|
| `HARNESS_MEM_PARTIAL_FINALIZE_ENABLED` | `""` | `true` or `1` で scheduler を有効化。未指定時は config.json を参照 |
| `HARNESS_MEM_PARTIAL_FINALIZE_INTERVAL_MS` | `""` | tick 間隔 (最小 5000ms、下回ると既定に丸め)。未指定時は config.json を参照 |

env var が空でない限り常に env が優先され、config.json の値は無視される。

有効化例:

```bash
HARNESS_MEM_PARTIAL_FINALIZE_ENABLED=true ./scripts/harness-memd restart
```

`harness_mem_health.features` で現在値が確認できる:

```json
{
  "features": {
    "partial_finalize_enabled": false,
    "partial_finalize_interval_ms": 300000
  }
}
```

## API

### `POST /v1/sessions/finalize` with `partial=true`

partial finalize を明示的に 1 回だけ実行する。scheduler を opt-out したまま、特定の瞬間に「ここまでの要約を保存して現 session は継続」したい場合に使う。

```json
{ "session_id": "sess-abc", "partial": true }
```

- session の `status` は `active` のまま
- `session_summary` observation が 1 件追加される (`metadata.is_partial=true`)
- 既に `status=closed` の session に対しては 200 応答で no-op (idempotent)
- 既存の `partial=false` (default) の挙動は変更なし

### `POST /v1/resume-pack` with `include_partial`

partial summary を含めるかを制御する (既定 `true`)。

```json
{ "session_id": "sess-new", "include_partial": true }
```

- `true` (default): partial / full 両方を採用。同一 session 内では `created_at` が新しい方が優先される
- `false`: 既存挙動 (partial を除外して full のみ採用)

### `POST /v1/resume-pack` with `summary_only` (§90-002)

shell hook 用軽量 mode (既定 `false`)。`true` 指定時は ranking / facts / continuity briefing などをスキップし、最新 summary 文字列を `meta.summary` に直載せする。

```json
{ "project": "example", "summary_only": true }
```

response:

```json
{
  "ok": true,
  "items": [{ "type": "session_summary", "session_id": "sess-abc", "summary": "…" }],
  "meta": {
    "summary_only": true,
    "summary": "…",
    "session_id": "sess-abc",
    "ended_at": "2026-04-20T00:00:00.000Z",
    "is_partial": false
  }
}
```

- shell 側は `jq -r '.meta.summary // empty'` 1 行で取り出せる (jq pipeline 不要)
- `include_partial` と併用可能
- JSON client は `items[]` の既存 shape から引き続き読める (後方互換)

## 運用

1. scheduler を有効化するまでは §90 (SessionStart hook) の挙動のみ: **前回 close した session** の summary が新 session に渡る
2. scheduler を有効化すると: **今も active な他 session** の最新 partial summary も新 session に渡る
3. DB 行数増加懸念がある場合は §89-002 (semantic dedup) の landed 後に opt-in する
