#!/usr/bin/env bash
# Harness Memory Server - デプロイ管理スクリプト
#
# 使い方:
#   ./scripts/deploy.sh init            # 設定ファイル生成（トークン自動生成）
#   ./scripts/deploy.sh check           # 環境チェック（Docker/Bun 等）
#   ./scripts/deploy.sh start           # docker compose up -d
#   ./scripts/deploy.sh client-config   # クライアント設定スニペット出力

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

# ─────────────────────────────────────────────────────────
# ユーティリティ
# ─────────────────────────────────────────────────────────

log()  { echo "[harness-mem deploy] $*"; }
warn() { echo "[harness-mem deploy] WARN: $*" >&2; }
die()  { echo "[harness-mem deploy] ERROR: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 が見つかりません。インストールしてください。"
}

generate_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import secrets; print(secrets.token_hex(32))"
  else
    # フォールバック: /dev/urandom
    head -c 32 /dev/urandom | xxd -p | tr -d '\n'
  fi
}

# ─────────────────────────────────────────────────────────
# サブコマンド: init
# ─────────────────────────────────────────────────────────

cmd_init() {
  log "初期設定ファイルを生成します..."

  if [[ -f "$ENV_FILE" ]]; then
    warn ".env ファイルが既に存在します。スキップします。"
    warn "再生成するには .env を削除してから再実行してください。"
    return
  fi

  local admin_token
  admin_token="hm_admin_$(generate_token)"
  local db_password
  db_password="$(generate_token)"

  cat > "$ENV_FILE" <<EOF
# Harness Memory Server 環境変数
# このファイルを VPS にコピーして docker compose up -d で起動してください

# 管理者トークン（クライアントの HARNESS_MEM_REMOTE_TOKEN に設定）
ADMIN_TOKEN=$admin_token

# PostgreSQL パスワード
DB_PASSWORD=$db_password

# Caddy: ドメイン名と TLS メールアドレス
HARNESS_MEM_DOMAIN=your-vps.example.com
HARNESS_MEM_TLS_EMAIL=admin@example.com
EOF

  chmod 600 "$ENV_FILE"
  log ".env を生成しました: $ENV_FILE"
  log "ADMIN_TOKEN: $admin_token"
  log ""
  log "次のステップ:"
  log "  1. $ENV_FILE の HARNESS_MEM_DOMAIN を実際のドメインに変更"
  log "  2. ./scripts/deploy.sh check で環境チェック"
  log "  3. ./scripts/deploy.sh start で起動"
}

# ─────────────────────────────────────────────────────────
# サブコマンド: check
# ─────────────────────────────────────────────────────────

cmd_check() {
  log "環境チェックを開始します..."
  local ok=true

  # Docker
  if require_cmd docker 2>/dev/null || command -v docker >/dev/null 2>&1; then
    log "  [OK] docker: $(docker --version 2>/dev/null | head -1)"
  else
    warn "  [NG] docker が見つかりません"
    ok=false
  fi

  # Docker Compose
  if docker compose version >/dev/null 2>&1; then
    log "  [OK] docker compose: $(docker compose version 2>/dev/null | head -1)"
  else
    warn "  [NG] docker compose が見つかりません"
    ok=false
  fi

  # .env
  if [[ -f "$ENV_FILE" ]]; then
    log "  [OK] .env ファイル: $ENV_FILE"
  else
    warn "  [NG] .env が見つかりません。先に ./scripts/deploy.sh init を実行してください"
    ok=false
  fi

  # Dockerfile
  if [[ -f "$PROJECT_ROOT/Dockerfile" ]]; then
    log "  [OK] Dockerfile"
  else
    warn "  [NG] Dockerfile が見つかりません"
    ok=false
  fi

  # docker-compose.yml
  if [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
    log "  [OK] docker-compose.yml"
  else
    warn "  [NG] docker-compose.yml が見つかりません"
    ok=false
  fi

  if [[ "$ok" == "true" ]]; then
    log "環境チェック完了: すべてOKです。"
  else
    die "環境チェックに問題があります。上記の警告を確認してください。"
  fi
}

# ─────────────────────────────────────────────────────────
# サブコマンド: start
# ─────────────────────────────────────────────────────────

cmd_start() {
  log "docker compose でサービスを起動します..."
  cd "$PROJECT_ROOT"
  docker compose up -d
  log "起動完了。ログを確認するには: docker compose logs -f"
}

# ─────────────────────────────────────────────────────────
# サブコマンド: client-config
# ─────────────────────────────────────────────────────────

cmd_client_config() {
  # CLI 引数パース（--user-id / --team-id / --remote-url）
  local user_id="${USER_ID:-default}"
  local team_id="${TEAM_ID:-}"
  local remote_url="${REMOTE_URL:-https://your-vps.example.com}"

  local args=("$@")
  local i=0
  while [[ $i -lt ${#args[@]} ]]; do
    case "${args[$i]}" in
      --user-id)
        i=$((i + 1))
        user_id="${args[$i]:-}"
        ;;
      --team-id)
        i=$((i + 1))
        team_id="${args[$i]:-}"
        ;;
      --remote-url)
        i=$((i + 1))
        remote_url="${args[$i]:-}"
        ;;
    esac
    i=$((i + 1))
  done

  # .env からトークンを読む
  local admin_token=""
  if [[ -f "$ENV_FILE" ]]; then
    admin_token=$(grep '^ADMIN_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '\n') || true
  fi

  log "クライアント設定スニペット（~/.harness-mem/.env に追加してください）:"
  echo ""
  echo "# MCP Server リモート接続設定"
  echo "HARNESS_MEM_REMOTE_URL=$remote_url"
  echo "HARNESS_MEM_REMOTE_TOKEN=${admin_token:-<ADMIN_TOKEN>}"
  echo "HARNESS_MEM_USER_ID=$user_id"
  [[ -n "$team_id" ]] && echo "HARNESS_MEM_TEAM_ID=$team_id"
  echo ""
  log "オプション: --user-id <id> --team-id <id> --remote-url <url>"
}

# ─────────────────────────────────────────────────────────
# エントリポイント
# ─────────────────────────────────────────────────────────

SUBCMD="${1:-help}"
shift || true

case "$SUBCMD" in
  init)           cmd_init ;;
  check)          cmd_check ;;
  start)          cmd_start ;;
  client-config)  cmd_client_config "$@" ;;
  help|--help|-h)
    echo "Harness Memory Server デプロイスクリプト"
    echo ""
    echo "使い方: $0 <subcommand>"
    echo ""
    echo "サブコマンド:"
    echo "  init           設定ファイル生成（トークン自動生成）"
    echo "  check          環境チェック（Docker/設定ファイル確認）"
    echo "  start          docker compose up -d でサービス起動"
    echo "  client-config  クライアント設定スニペット出力"
    ;;
  *)
    die "不明なサブコマンド: $SUBCMD。'$0 help' で使い方を確認してください。"
    ;;
esac
