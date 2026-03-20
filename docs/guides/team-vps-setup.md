# VPS チーム環境セットアップガイド

harness-mem を VPS にデプロイしてチームで共有記憶を使う手順です。
コピペで動くことを目標に書いています。

---

## 目次

1. [前提条件](#1-前提条件)
2. [サーバーデプロイ](#2-サーバーデプロイ)
3. [systemd サービス設定](#3-systemd-サービス設定)
4. [リバースプロキシ（nginx + Let's Encrypt）](#4-リバースプロキシ)
5. [認証設定（マルチトークン）](#5-認証設定)
6. [チーム作成とメンバー追加](#6-チーム作成とメンバー追加)
7. [クライアント設定（各メンバー）](#7-クライアント設定)
8. [記憶の共有](#8-記憶の共有)
9. [動作確認](#9-動作確認)
10. [ファイアウォール設定](#10-ファイアウォール設定)

---

## 1. 前提条件

| 要件 | バージョン |
|------|-----------|
| OS | Ubuntu 22.04+ 推奨 |
| Bun | 1.1.0+ |
| Node.js | 20+ |
| Git | 2.34+ |
| ドメイン | DNS A レコードが VPS に向いていること |

```bash
# Bun インストール
curl -fsSL https://bun.sh/install | bash

# バージョン確認
bun --version
```

---

## 2. サーバーデプロイ

### 2-1. リポジトリのクローン

```bash
cd /opt
git clone https://github.com/your-org/harness-mem.git
cd harness-mem
```

### 2-2. 依存関係のインストール

```bash
bun install
```

### 2-3. データディレクトリの作成

```bash
mkdir -p /opt/harness-mem-data
```

### 2-4. 環境変数の設定

`/opt/harness-mem.env` を作成します。

```bash
cat > /opt/harness-mem.env << 'EOF'
# ネットワーク（リモートバインド必須設定）
HARNESS_MEM_HOST=0.0.0.0
HARNESS_MEM_PORT=37888

# データディレクトリ
HARNESS_MEM_HOME=/opt/harness-mem-data
HARNESS_MEM_DB_PATH=/opt/harness-mem-data/harness-mem.db

# 認証（本番環境では必ず設定する）
# 後のステップで config.json に切り替えることを推奨
HARNESS_MEM_ADMIN_TOKEN=your-strong-admin-token-here

# 設定ファイルのパス（マルチトークン認証用、セクション5で設定）
HARNESS_MEM_CONFIG_PATH=/opt/harness-mem-data/config.json
EOF

# パーミッションを制限
chmod 600 /opt/harness-mem.env
```

> `HARNESS_MEM_ADMIN_TOKEN` が未設定でリモートバインドすると起動が拒否されます。

### 2-5. 起動確認（手動テスト）

```bash
source /opt/harness-mem.env
cd /opt/harness-mem/memory-server
bun run src/index.ts
```

別ターミナルで動作確認します。

```bash
curl http://localhost:37888/health
# {"ok":true,...} が返れば OK
```

---

## 3. systemd サービス設定

```bash
cat > /etc/systemd/system/harness-mem.service << 'EOF'
[Unit]
Description=harness-mem memory server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/harness-mem/memory-server
EnvironmentFile=/opt/harness-mem.env
ExecStart=/root/.bun/bin/bun run src/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable harness-mem
systemctl start harness-mem

# ステータス確認
systemctl status harness-mem
journalctl -u harness-mem -f
```

---

## 4. リバースプロキシ

HTTPS は nginx と Let's Encrypt で終端します。

### 4-1. nginx + certbot のインストール

```bash
apt install -y nginx certbot python3-certbot-nginx
```

### 4-2. nginx 設定

```bash
cat > /etc/nginx/sites-available/harness-mem << 'EOF'
server {
    listen 80;
    server_name vps.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name vps.example.com;

    ssl_certificate     /etc/letsencrypt/live/vps.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vps.example.com/privkey.pem;

    # SSE（Server-Sent Events）のためにバッファリングを無効化
    proxy_buffering off;

    location / {
        proxy_pass         http://127.0.0.1:37888;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF

ln -s /etc/nginx/sites-available/harness-mem /etc/nginx/sites-enabled/
nginx -t
```

### 4-3. Let's Encrypt 証明書の取得

```bash
certbot --nginx -d vps.example.com
systemctl reload nginx
```

### 4-4. HTTPS 疎通確認

```bash
curl https://vps.example.com/health
```

---

## 5. 認証設定

チームで複数トークンを使うには `config.json` を使います。
これにより、各メンバーに固有のトークンを発行し `user_id` / `team_id` を自動関連付けできます。

### 5-1. config.json の作成

```bash
cat > /opt/harness-mem-data/config.json << 'EOF'
{
  "auth": {
    "admin_token": "your-strong-admin-token-here",
    "tokens": {
      "alice-personal-token-abc123": {
        "user_id": "alice",
        "team_id": "team-alpha",
        "role": "member"
      },
      "bob-personal-token-def456": {
        "user_id": "bob",
        "team_id": "team-alpha",
        "role": "member"
      }
    }
  }
}
EOF

chmod 600 /opt/harness-mem-data/config.json
```

**フィールド説明**:

| フィールド | 説明 |
|-----------|------|
| `auth.admin_token` | 管理者全権トークン。チーム作成・メンバー管理に使用 |
| `tokens.<token>` | メンバー用トークン。キーがトークン文字列 |
| `user_id` | メンバーの識別子（記憶の所有者として記録される） |
| `team_id` | 所属チームの識別子（チーム共有記憶のスコープ） |
| `role` | `admin` または `member`（通常は `member`） |

### 5-2. サービスを再起動

```bash
systemctl restart harness-mem
```

config.json が読み込まれると `HARNESS_MEM_ADMIN_TOKEN` 環境変数より config.json が優先されます。

---

## 6. チーム作成とメンバー追加

以下のコマンドはすべて管理者トークンを使います。

### 6-1. チームを作成

```bash
# SERVER_URL と ADMIN_TOKEN を実際の値に変更してください
SERVER_URL="https://vps.example.com"
ADMIN_TOKEN="your-strong-admin-token-here"

curl -s -X POST "${SERVER_URL}/v1/admin/teams" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Team Alpha", "team_id": "team-alpha", "description": "メインチーム"}' | jq .
```

レスポンス例:

```json
{
  "ok": true,
  "items": [
    {
      "team_id": "team-alpha",
      "name": "Team Alpha",
      "description": "メインチーム",
      "created_at": "2026-03-21T00:00:00.000Z"
    }
  ]
}
```

### 6-2. メンバーを追加

```bash
# alice を追加
curl -s -X POST "${SERVER_URL}/v1/admin/teams/team-alpha/members" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "alice", "role": "member"}' | jq .

# bob を追加
curl -s -X POST "${SERVER_URL}/v1/admin/teams/team-alpha/members" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "bob", "role": "member"}' | jq .
```

### 6-3. メンバー一覧確認

```bash
curl -s "${SERVER_URL}/v1/admin/teams/team-alpha/members" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .
```

### 6-4. チーム一覧確認

```bash
curl -s "${SERVER_URL}/v1/admin/teams" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .
```

---

## 7. クライアント設定

各メンバーのローカルマシンで以下の環境変数を設定します。

### 7-1. 環境変数

`~/.bashrc` または `~/.zshrc` に追記します（メンバーごとにトークンを変える）。

**alice の場合**:

```bash
# harness-mem リモート接続設定
export HARNESS_MEM_REMOTE_URL="https://vps.example.com"
export HARNESS_MEM_REMOTE_TOKEN="alice-personal-token-abc123"
export HARNESS_MEM_USER_ID="alice"
export HARNESS_MEM_TEAM_ID="team-alpha"
```

**bob の場合**:

```bash
export HARNESS_MEM_REMOTE_URL="https://vps.example.com"
export HARNESS_MEM_REMOTE_TOKEN="bob-personal-token-def456"
export HARNESS_MEM_USER_ID="bob"
export HARNESS_MEM_TEAM_ID="team-alpha"
```

環境変数を反映します。

```bash
source ~/.zshrc   # または ~/.bashrc
```

### 7-2. Claude Code での設定

`claude_desktop_config.json`（または Claude Code の MCP 設定）に追加します。

```json
{
  "mcpServers": {
    "harness-mem": {
      "command": "npx",
      "args": ["-y", "--package", "@chachamaru127/harness-mem", "harness-mem-mcp"],
      "env": {
        "HARNESS_MEM_REMOTE_URL": "https://vps.example.com",
        "HARNESS_MEM_REMOTE_TOKEN": "alice-personal-token-abc123",
        "HARNESS_MEM_USER_ID": "alice",
        "HARNESS_MEM_TEAM_ID": "team-alpha"
      }
    }
  }
}
```

### 7-3. Codex での設定

`~/.codex/config.json` または Codex の設定ファイルに追記します。

```json
{
  "mcp": {
    "harness-mem": {
      "env": {
        "HARNESS_MEM_REMOTE_URL": "https://vps.example.com",
        "HARNESS_MEM_REMOTE_TOKEN": "alice-personal-token-abc123",
        "HARNESS_MEM_USER_ID": "alice",
        "HARNESS_MEM_TEAM_ID": "team-alpha"
      }
    }
  }
}
```

---

## 8. 記憶の共有

### 8-1. 個人の記憶をチームに共有する

`harness_mem_share_to_team` MCP ツールを使って、自分の記憶（observation）をチームに公開します。

Claude Code / Codex のチャットで：

```
harness_mem_share_to_team を使って observation_id: "obs_abc123" を team_id: "team-alpha" に共有して
```

または MCP ツールを直接呼び出す場合：

```json
{
  "tool": "harness_mem_share_to_team",
  "input": {
    "observation_id": "obs_abc123",
    "team_id": "team-alpha"
  }
}
```

これにより、対象の observation の `team_id` フィールドが更新され、チームメンバーの検索に表示されるようになります。

### 8-2. チーム共有記憶を検索する

メンバートークンで認証されたリクエストは、自動的に自分の記憶とチームの共有記憶の両方を検索します。
追加操作は不要です。

```bash
# メンバートークンで検索（自分 + チームの記憶が返る）
curl -s -X POST "${SERVER_URL}/v1/search" \
  -H "Authorization: Bearer alice-personal-token-abc123" \
  -H "Content-Type: application/json" \
  -d '{"query": "API 設計の決定事項"}' | jq '.items[].content'
```

### 8-3. フィードで確認

```bash
curl -s "${SERVER_URL}/v1/feed?limit=20" \
  -H "Authorization: Bearer alice-personal-token-abc123" | jq .
```

---

## 9. 動作確認

### 9-1. ヘルスチェック

```bash
curl https://vps.example.com/health
curl https://vps.example.com/health/ready
```

### 9-2. メンバートークンで認証確認

```bash
# 正常: 200 OK
curl -s -X POST "${SERVER_URL}/v1/search" \
  -H "Authorization: Bearer alice-personal-token-abc123" \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}' | jq .ok

# 異常: 401 Unauthorized（トークンなし）
curl -s -X POST "${SERVER_URL}/v1/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}' | jq .error
```

### 9-3. チームメンバーシップ確認

```bash
curl -s "${SERVER_URL}/v1/admin/teams/team-alpha" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .

curl -s "${SERVER_URL}/v1/admin/teams/team-alpha/members" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .
```

---

## 10. ファイアウォール設定

サーバーへの直接 HTTP アクセスを拒否し、HTTPS のみ許可します。

```bash
# ufw を使う場合
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (certbot + redirect)
ufw allow 443/tcp   # HTTPS
ufw deny 37888/tcp  # memory-server への直接アクセスを拒否

ufw enable
ufw status
```

> ポート 37888 は localhost からのみアクセスできる状態にします。nginx 経由（HTTPS）でのみ外部に公開されます。

---

## トラブルシューティング

### サーバーが起動しない

```bash
journalctl -u harness-mem -n 50
```

よくある原因:

- `HARNESS_MEM_ADMIN_TOKEN` が未設定でリモートバインドしようとしている
- `HARNESS_MEM_HOST=0.0.0.0` にしているが認証設定がない
- ポート 37888 が既に使用中

### 401 Unauthorized が返る

- `config.json` の `admin_token` と環境変数 `HARNESS_MEM_ADMIN_TOKEN` が一致しているか確認
- `Authorization: Bearer <token>` ヘッダーが正しく設定されているか確認
- サービス再起動後に config.json が読み込まれているか確認（`journalctl -u harness-mem | grep "auth"`）

### メンバーがチームの記憶を見られない

- `config.json` の該当トークンに `team_id` が設定されているか確認
- チームに対象の `user_id` がメンバー登録されているか確認（セクション6-3）
- observation が `harness_mem_share_to_team` で共有済みか確認

---

## 関連ドキュメント

- [環境変数リファレンス](../environment-variables.md) — 全環境変数の詳細
- [TLS リバースプロキシ設定](../tls-reverse-proxy.md) — Caddy / nginx の詳細設定
- [セットアップガイド](../harness-mem-setup.md) — ローカル環境セットアップ
