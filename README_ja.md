# Harness-mem

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-logo-official.jpg" alt="Harness-mem official logo" width="560" />
</p>

<p align="center"><strong>Codex / OpenCode / Cursor / Claude で共通利用できるメモリランタイム。</strong></p>

<p align="center">
  <a href="README.md">English</a> | 日本語
</p>

Harness-mem は、複数の開発ツール間でメモリ挙動を一貫させるためのローカル実行ランタイムです。

## クイックスタート

### A) npx で実行（グローバルインストール不要）

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,cursor,claude
```

### B) グローバルインストール

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup --platform codex,cursor,claude
```

### セットアップ確認

```bash
harness-mem doctor --platform codex,cursor,claude
harness-mem doctor --fix --platform codex,cursor,claude
```

```bash
# Mem UI
open http://127.0.0.1:37901
```

## できること

| 機能 | 説明 |
|---|---|
| `setup` | Codex / OpenCode / Cursor / Claude の配線を自動セットアップ |
| `doctor` | 設定・配線・稼働状態を検査し、`--fix` で修復 |
| `versions` | 各ツールのローカル/上流バージョン差分を記録 |
| `smoke` | プライバシーと検索品質の最小E2E確認 |
| `import-claude-mem` ほか | Claude-mem からの安全移行 |

## Plans 運用ルール

`Plans.md` は実装管理のSSOT（Single Source of Truth）です。

- `cc:TODO`: 未着手
- `cc:WIP`: 作業中
- `cc:完了`: 実装完了
- `blocked`: ブロック中

基本フロー:

1. `Phase` 順で実行する
2. 着手時は `cc:TODO` -> `cc:WIP`
3. 完了時は `cc:完了` に更新し、理由を1-3行記録
4. ブロック時は原因/試行/次アクションを残す

## ドキュメント

- セットアップ詳細: `docs/harness-mem-setup.md`
- 変更履歴（英語）: `CHANGELOG.md`
- 変更履歴（日本語要約）: `CHANGELOG_ja.md`
- 英語README（デフォルト）: `README.md`

## トラブルシューティング

### `harness-mem: command not found`

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup
```

### `doctor` で依存不足が出る

`bun`, `node`, `curl`, `jq`, `ripgrep` をインストール後に再実行:

```bash
harness-mem doctor
```

### ワークスペースが `harness-mem` と絶対パスに分断される

```bash
harness-memd restart
```

## 公式マスコット

<p align="center">
  <img src="https://raw.githubusercontent.com/Chachamaru127/harness-mem/main/docs/assets/logos/harness-mem/official/harness-mem-mascot-official.jpg" alt="Harness-mem official mascot" width="360" />
</p>

## ライセンス

MIT. 詳細は [`LICENSE`](LICENSE) を参照。
