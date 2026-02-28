---
paths:
  - "scripts/hook-handlers/**"
  - "hooks/**"
---

# Hook ハンドラールール

- シェルスクリプトは `set +e` で開始 (フックの失敗でホストツールを中断させない)
- stdin からイベント JSON を読み取り、`jq` でパース
- harness-memd との通信は `harness-mem-client.sh` 経由 (HTTP, 8 秒タイムアウト)
- プライバシー検出: API キー、トークン、シークレットを `record-event` 前に自動リダクト
- リダクトパターン: `(api[_ -]?key|token|secret|password|sk_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})`
- プロジェクトコンテキスト解決は `lib/project-context.sh` を source して使用
- 状態ファイルは `${PROJECT_ROOT}/.claude/state/` に書き出し (gitignore 済み)
- Claude Code hooks.json のタイムアウト値を守る (SessionStart: 25s, PostToolUse: 15s, Stop: 40s)
- 新しい hook handler 追加時は `hooks/hooks.json` にエントリを登録
