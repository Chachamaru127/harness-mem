# VPS/チームデプロイ機能仕様書

作成日: 2026-03-02
ステータス: 計画中
関連: Plans.md §24

---

## 背景

AI顧問先企業（従業員62名、ITチーム4名+マーケチーム3名+役員2名）への導入。
複数メンバーの Claude Code セッションからの知見をリアルタイムに共有するニーズ。

### 前提条件

| 項目 | 値 |
|------|-----|
| クライアント環境 | Windows 11 + WSL2（IT4名）、Mac（マーケ3名、順次導入） |
| VPS | Ubuntu 22.04/24.04、2-4GB RAM |
| 接続元 | 固定IPなし（自宅/オフィス混在） |
| NDA制約 | 顧客PIIをそのまま外部サーバーに保存することは不可 |

---

## アーキテクチャ概要

```
┌─────────────────┐     ┌─────────────────┐
│ メンバーA (WSL2) │     │ メンバーB (Mac)  │
│ Claude Code      │     │ Claude Code      │
│   └─ MCP Server  │     │   └─ MCP Server  │
│      └─ PII Filter│    │      └─ PII Filter│
└────────┬─────────┘     └────────┬─────────┘
         │ HTTPS (Bearer Token)   │
         └──────────┬─────────────┘
                    ▼
         ┌─────────────────────┐
         │ VPS (Ubuntu)        │
         │ ┌─────────────────┐ │
         │ │ Caddy (TLS終端) │ │
         │ └────────┬────────┘ │
         │          ▼          │
         │ ┌─────────────────┐ │
         │ │ memory-server   │ │
         │ │ (Bun, 0.0.0.0) │ │
         │ └────────┬────────┘ │
         │          ▼          │
         │ ┌─────────────────┐ │
         │ │ PostgreSQL      │ │
         │ └─────────────────┘ │
         │ ┌─────────────────┐ │
         │ │ harness-mem-ui  │ │
         │ └─────────────────┘ │
         └─────────────────────┘
```

**PII フィルタはクライアント側（MCP Server）で実行。VPS には到達しない設計。**

---

## 1. ネットワークデプロイ対応

### 1.1 リモートバインド (TEAM-001)

**現状**: `HARNESS_MEM_HOST` 環境変数は存在するが、`0.0.0.0` バインド時の安全策がない。

**変更点**:
- `server.ts` の起動時チェック: `host !== "127.0.0.1"` かつ `HARNESS_MEM_ADMIN_TOKEN` 未設定 → エラー終了
- ログに「リモートモードで起動」を明示

### 1.2 TLS 対応

**方針**: (B) リバースプロキシ前提。memory-server 自体での TLS 終端は行わない。

提供するもの:
- Caddyfile サンプル（Let's Encrypt 自動更新付き）
- Nginx 設定例（certbot 連携）
- docker-compose.yml に Caddy コンテナを同梱

### 1.3 MCP Server リモート接続 (TEAM-002)

**現状**: `getBaseUrl()` が `HARNESS_MEM_HOST` + `HARNESS_MEM_PORT` を読み取り、`ensureDaemon()` でローカルデーモンを自動起動。

**変更点**:
```
新規環境変数:
  HARNESS_MEM_REMOTE_URL=https://vps.example.com:37888
  HARNESS_MEM_REMOTE_TOKEN=<bearer_token>

動作の切替:
  HARNESS_MEM_REMOTE_URL 設定時:
    → getBaseUrl() は REMOTE_URL を返す
    → ensureDaemon() はローカル起動をスキップ
    → 代わりに REMOTE_URL/v1/health を確認
    → Authorization ヘッダーに REMOTE_TOKEN を付与
```

**影響箇所**: `mcp-server/src/tools/memory.ts` の `getBaseUrl()`, `ensureDaemon()`, `buildApiHeaders()`

---

## 2. マルチユーザー対応

### 2.1 ユーザー識別 (TEAM-003)

**スキーマ変更**:

```sql
-- mem_sessions に追加
ALTER TABLE mem_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE mem_sessions ADD COLUMN team_id TEXT DEFAULT NULL;

-- mem_events に追加
ALTER TABLE mem_events ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE mem_events ADD COLUMN team_id TEXT DEFAULT NULL;

-- mem_observations に追加
ALTER TABLE mem_observations ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE mem_observations ADD COLUMN team_id TEXT DEFAULT NULL;

-- インデックス
CREATE INDEX idx_observations_user ON mem_observations(user_id);
CREATE INDEX idx_observations_team ON mem_observations(team_id);
CREATE INDEX idx_sessions_user ON mem_sessions(user_id);
```

**MCP Server からの付与**:
- `HARNESS_MEM_USER_ID` / `HARNESS_MEM_TEAM_ID` 環境変数
- トークンから自動解決（TEAM-004 で実装）した値を優先

### 2.2 マルチトークン認証 (TEAM-004)

**現状**: 単一の `HARNESS_MEM_ADMIN_TOKEN` で全操作を認証。

**拡張設計**:

```json
// ~/.harness-mem/config.json
{
  "auth": {
    "admin_token": "hm_admin_xxxxx",
    "tokens": {
      "hm_user_ohashi_xxxxx": {
        "user_id": "ohashi",
        "team_id": "it-team",
        "role": "member"
      },
      "hm_user_fujisaki_xxxxx": {
        "user_id": "fujisaki",
        "team_id": "it-team",
        "role": "member"
      },
      "hm_user_tanaka_xxxxx": {
        "user_id": "tanaka",
        "team_id": "marketing",
        "role": "member"
      }
    }
  }
}
```

**認証フロー**:
1. リクエストから Bearer Token を抽出
2. `admin_token` と一致 → admin 権限（全データアクセス可）
3. `tokens` マップから検索 → user_id + team_id を解決
4. 一致なし → 401 Unauthorized

### 2.3 データアクセス制御 (TEAM-005)

| スコープ | 読み取り | 書き込み |
|---------|---------|---------|
| 自分のセッション・観察 | OK | OK |
| 同じ team_id のメンバーのデータ | OK | NG |
| 別チームのデータ | NG（デフォルト） | NG |
| コンソリデーション後のファクト | OK（全チーム共有） | — |

**実装方針**:
- `observation-store.ts` の全クエリに `WHERE user_id = ? OR team_id = ?` 条件追加
- `mem_facts` の検索は team_id フィルタなし（全社共有）
- Admin トークンは全フィルタをバイパス

---

## 3. PII フィルタリング (TEAM-006)

### 実装場所

**MCP Server 側**（送信前）にフィルタモジュールを挟む。VPS には到達しない設計。

```
MCP Server 内:
  ユーザー入力 → PII Filter → HTTP Request → VPS
```

### フィルタパターン

| パターン | 置換先 | 正規表現例 | 精度 |
|---------|-------|-----------|------|
| 電話番号 | [PHONE] | `0\d{1,4}[-‐−]?\d{1,4}[-‐−]?\d{3,4}` | 高 |
| メールアドレス | [EMAIL] | `[\w.+-]+@[\w.-]+\.\w+` | 高 |
| 住所パターン | [ADDRESS] | `(東京都\|大阪府\|北海道\|.{2,3}県).{2,30}` | 中 |
| LINE ID | [LINE_ID] | `@[a-zA-Z0-9_.]{3,20}` | 高 |
| 日本語人名 | [PERSON] | 辞書ベース姓リスト照合 | best-effort |

### 設定

```bash
HARNESS_MEM_PII_FILTER=true
HARNESS_MEM_PII_RULES_PATH=~/.harness-mem/pii-rules.json
```

```json
// pii-rules.json
{
  "rules": [
    {"name": "phone", "pattern": "0\\d{1,4}[-‐−]?\\d{1,4}[-‐−]?\\d{3,4}", "replacement": "[PHONE]"},
    {"name": "email", "pattern": "[\\w.+-]+@[\\w.-]+\\.\\w+", "replacement": "[EMAIL]"},
    {"name": "line_id", "pattern": "@[a-zA-Z0-9_.]{3,20}", "replacement": "[LINE_ID]"}
  ],
  "surname_dict_path": "~/.harness-mem/surnames-ja.txt"
}
```

### 人名検出の限界と対策

正規表現だけでは日本語人名の検出は困難（「東京タワー」を誤検出、珍しい姓を見逃し）。

**初期リリース**: 構造パターン（電話/メール/住所/LINE ID）を正規表現で高精度に対応。人名は姓辞書（約10,000姓）との前方一致で best-effort 検出。

**将来拡張**: LLM ベースの NER（固有表現認識）をオプションで追加可能。

---

## 4. ローカル⇔リモート ハイブリッドモード (TEAM-008)

### 動作シーケンス

```
通常時:
  MCP Server → HTTP POST → VPS memory-server
  (成功) → 完了

VPS ダウン時:
  MCP Server → HTTP POST → VPS memory-server
  (失敗: timeout / 5xx) → ローカル SQLite に退避書き込み
  ローカルキュー: { event_json, retry_count, queued_at }

VPS 復旧後:
  MCP Server 定期チェック（60秒間隔）→ VPS /health OK を検出
  → ローカルキューを順次フラッシュ
  → dedupe_hash で重複排除（VPS 側で既に受信済みのイベントはスキップ）
```

### 既存アセットの活用

- `mem_retry_queue` テーブルが既に存在（リトライ機構の土台）
- `shadow-sync` / `managed-backend` モジュールの概念を逆方向に適用
- `mem_events.dedupe_hash` による冪等性保証

### 整合性モデル

**最終的整合性（Eventual Consistency）**。harness-mem はイベントソーシング的な追記専用設計のため、VPS ダウン中のローカル書き込みと他メンバーの VPS 直接書き込みが競合しても、最終的に全データが VPS に集約される。

---

## 5. チームダッシュボード (TEAM-009)

### 初期リリース（P2）

| ビュー | 内容 | 既存アセット |
|-------|------|-------------|
| チームフィード | 全メンバーのアクティビティをリアルタイム表示 | SSE `/v1/feed/stream` 既存 |
| ユーザーフィルター | user_id / team_id でフィルタリング | `FeedPanel.tsx` のプラットフォームタブを拡張 |

### 後続リリース（P3）

| ビュー | 内容 |
|-------|------|
| ナレッジマップ | コンソリデーション後のファクトをカテゴリ別に可視化 |
| 利用統計 | メンバー別のセッション数・イベント数・アクティブ時間 |

---

## 6. デプロイ支援 (TEAM-007)

### Docker 構成

```yaml
# docker-compose.yml
services:
  memory-server:
    build: .
    environment:
      - HARNESS_MEM_HOST=0.0.0.0
      - HARNESS_MEM_ADMIN_TOKEN=${ADMIN_TOKEN}
      - HARNESS_MEM_DB_BACKEND=postgres
      - HARNESS_MEM_PG_URL=postgres://user:pass@db:5432/harness_mem
    depends_on: [db]

  db:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]

  caddy:
    image: caddy:latest
    ports: ["443:443", "80:80"]
    volumes: [./Caddyfile:/etc/caddy/Caddyfile]

  ui:
    build:
      context: .
      dockerfile: Dockerfile.ui
    environment:
      - HARNESS_MEM_API_URL=http://memory-server:37888
```

### セットアップコマンド

```bash
harness-mem deploy init          # 設定ファイル生成（トークン自動生成）
harness-mem deploy check         # 環境チェック（Bun/Node/Docker/PostgreSQL）
harness-mem deploy start         # docker-compose up -d
harness-mem deploy client-config # クライアント設定スニペット出力
  --user-id ohashi
  --team-id it-team
  --remote-url https://vps.example.com
```

---

## 7. 想定スケジュール

| 優先度 | Phase | 内容 | 目標 |
|:------:|:-----:|------|------|
| P0 | Phase 1 | VPS基盤（リモートバインド + MCP接続） | PoC 検証可能 |
| P1 | Phase 2-3 | マルチユーザー + PII + Docker | 本番導入前に完了 |
| P2 | Phase 4 | 耐障害性 + チーム UI | 運用開始後に順次追加 |
| P3 | Phase 5 | ナレッジマップ + 統計 | 運用安定後 |

---

## 実現可能性評価

| 要件 | 既存アセット | 実現可能性 |
|------|-------------|:----------:|
| リモートバインド | `HARNESS_MEM_HOST` env var 既存 | HIGH |
| TLS | リバースプロキシ方式（コード変更なし） | HIGH |
| MCP リモート接続 | `getBaseUrl()` 拡張 | HIGH |
| ユーザー識別 | スキーマ追加 + フィルタ追加 | HIGH |
| マルチトークン | `timingSafeEqual` 認証既存 | MEDIUM-HIGH |
| アクセス制御 | クエリフィルタ追加 | MEDIUM-HIGH |
| PII フィルタ | MCP 送信前ミドルウェア | HIGH |
| Docker | PostgreSQL アダプター既存 | HIGH |
| ハイブリッドモード | `mem_retry_queue` + `shadow-sync` 既存 | MEDIUM |
| チームフィード | SSE ストリーム既存 | HIGH |

**全項目で技術的ブロッカーなし。**
