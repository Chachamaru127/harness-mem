#!/bin/bash
# Read-only discovery: inspect executable/config presence without launching clients.
setup_app_present() {
  [ -d "/Applications/$1.app" ] || [ -d "${HOME}/Applications/$1.app" ]
}

setup_platform_evidence() {
  local platform="$1" config="" app=""
  if command -v "$platform" >/dev/null 2>&1; then
    printf 'command'
    return
  fi
  case "$platform" in
    codex) config="${HOME}/.codex/config.toml" ;;
    cursor) config="${HOME}/.cursor"; app="Cursor" ;;
    opencode) config="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json" ;;
    claude) config="${HOME}/.claude.json" ;;
    antigravity) config="${HOME}/.gemini/antigravity"; app="Antigravity" ;;
  esac
  if [ -e "$config" ]; then
    printf 'settings'
  elif [ -n "$app" ] && setup_app_present "$app"; then
    printf 'app'
  else
    printf 'unknown'
  fi
}

print_setup_discovery() {
  local platform evidence label index=0
  SETUP_RECOMMENDED_PLATFORMS=""
  if ui_is_en; then
    printf '[harness-mem] Checking this environment (no apps launched)\n'
    printf 'Found files/commands are candidates, not a connection health check.\n'
  else
    printf '[harness-mem] 利用環境を確認しています（アプリは起動しません）\n'
    printf '見つかったコマンドや設定から候補を出します。接続の正常性は導入後に確認します。\n'
  fi
  for platform in codex cursor opencode claude antigravity; do
    index=$((index + 1))
    evidence="$(setup_platform_evidence "$platform")"
    if ui_is_en; then
      case "$evidence" in
        command) label="command found" ;;
        settings) label="settings found; executable unverified" ;;
        app) label="app found; executable unverified" ;;
        *) label="not detected; manual selection available" ;;
      esac
    else
      case "$evidence" in
        command) label="コマンドあり" ;;
        settings) label="設定あり（実行環境は未確認）" ;;
        app) label="アプリあり（実行環境は未確認）" ;;
        *) label="未検出（使っている場合は選択可）" ;;
      esac
    fi
    case "$platform" in
      opencode|antigravity)
        if ui_is_en; then label="$label / experimental, opt-in"; else label="$label / 試験対応、手動選択"; fi
        ;;
      *)
        if [ "$evidence" != "unknown" ]; then
          SETUP_RECOMMENDED_PLATFORMS="$(csv_append_unique "$SETUP_RECOMMENDED_PLATFORMS" "$platform")"
        fi
        ;;
    esac
    printf '  %s) %-12s %s\n' "$index" "$platform" "$label"
  done
}

confirm_setup_selection() {
  local question
  if ui_is_en; then
    printf '[harness-mem] Install plan\n  Connect: %s\n' "$PLATFORM"
    printf '  Configure selected clients under your home; prepare dependencies/model; start memory server and UI; run checks.\n'
    printf '  Import Claude-mem: %s; stop after import: %s; automatic updates: %s; install Codex skill: %s\n' "$SETUP_IMPORT_CLAUDE_MEM" "$SETUP_STOP_CLAUDE_MEM_AFTER_IMPORT" "$SETUP_AUTO_UPDATE_OPT_IN" "$SETUP_INSTALL_CODEX_SKILL"
    question="Install with these choices?"
  else
    printf '[harness-mem] インストール内容\n  接続先: %s\n' "$PLATFORM"
    printf '  選んだ接続先のホーム配下設定を更新し、必要な実行環境とモデルを準備します。\n'
    printf '  記憶サーバーと確認画面を起動し、動作確認を行います。\n'
    printf '  旧Claude-mem取込: %s / 取込後の停止: %s / 自動更新: %s / Codex skill追加: %s（1=有効、0=無効）\n' "$SETUP_IMPORT_CLAUDE_MEM" "$SETUP_STOP_CLAUDE_MEM_AFTER_IMPORT" "$SETUP_AUTO_UPDATE_OPT_IN" "$SETUP_INSTALL_CODEX_SKILL"
    question="この内容でインストールを実行しますか?"
  fi
  prompt_yes_no_default_no "$question"
}
