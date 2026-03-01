# TLS リバースプロキシ設定ガイド

harness-mem は TLS 終端をリバースプロキシに委譲します。
memory-server 自体は HTTP で動作し、Caddy または Nginx が HTTPS を担います。

---

## Caddy（推奨）

Let's Encrypt 証明書の自動取得・更新に対応しています。

```
# Caddyfile
vps.example.com {
    reverse_proxy localhost:37888
}
```

### 起動

```bash
# Caddy インストール後
caddy run --config /etc/caddy/Caddyfile
```

---

## Nginx + certbot

```nginx
# /etc/nginx/sites-available/harness-mem
server {
    listen 443 ssl;
    server_name vps.example.com;

    ssl_certificate     /etc/letsencrypt/live/vps.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vps.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:37888;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name vps.example.com;
    return 301 https://$host$request_uri;
}
```

### 証明書取得

```bash
certbot --nginx -d vps.example.com
```

---

## memory-server 側の設定

リモートバインドには `HARNESS_MEM_ADMIN_TOKEN` が必須です。

```bash
# .env または環境変数として設定
HARNESS_MEM_HOST=0.0.0.0
HARNESS_MEM_PORT=37888
HARNESS_MEM_ADMIN_TOKEN=your-secret-token-here
```

> **注意**: `HARNESS_MEM_ADMIN_TOKEN` が未設定の場合、リモートバインドはエラーで拒否されます。

---

## Docker Compose 構成

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
    ports:
      - "127.0.0.1:37888:37888"
    depends_on: [db]

  db:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]

  caddy:
    image: caddy:latest
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data

  ui:
    build:
      context: .
      dockerfile: Dockerfile.ui
    environment:
      - HARNESS_MEM_API_URL=http://memory-server:37888

volumes:
  pgdata:
  caddy_data:
```

```
# Caddyfile（Docker Compose 用）
vps.example.com {
    reverse_proxy memory-server:37888
}
```

---

## クライアント側設定（MCP Server）

VPS に接続するクライアントは以下の環境変数を設定します（TEAM-002 実装後に有効）。

```bash
HARNESS_MEM_REMOTE_URL=https://vps.example.com
HARNESS_MEM_REMOTE_TOKEN=your-secret-token-here
```
