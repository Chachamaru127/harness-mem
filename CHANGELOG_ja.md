## [0.1.7] - 2026-02-18

### 🎯 What's Changed for You

`npx` セットアップ時の設定先が永続パス化され、npm キャッシュ由来の一時パス消失で壊れなくなりました。

| Before | After |
|--------|-------|
| `npx ... harness-mem setup` 実行時に `~/.npm/_npx/...` の一時パスへ MCP 設定され、後で壊れる可能性があった。 | 実行時に `~/.harness-mem/runtime/harness-mem` へランタイムを同期し、その永続パスへ設定する。 |

### Fixed

- npm/npx インストール経路で生成される設定から `_npx` 一時パス依存を除去。

### Internal

- `scripts/harness-mem` に stable runtime root 同期処理を追加し、setup/doctor フローを安定化。

## [0.1.6] - 2026-02-18

### 🎯 What's Changed for You

OpenCode の setup/doctor が、起動不能になる不正キーを書き込まないようになりました。

| Before | After |
|--------|-------|
| `scripts/harness-mem doctor --fix --platform opencode` で、未対応の `plugins` や旧 `env` が書かれ、OpenCode が起動失敗することがあった。 | OpenCode の設定は `mcp.harness.environment` に正規化され、未対応キーは除去される。 |

### Fixed

- setup/doctor 後に `opencode` が正常起動できるよう、OpenCode 設定生成・修復フローを修正。

### Internal

- `scripts/harness-mem` の OpenCode JSON 正規化ロジックを更新し、旧 `plugins`/`env` パターンを除去。

## [0.1.5] - 2026-02-17

### 🎯 What's Changed for You

リリース自動化の安全性を強化し、タグ不整合や誤ブランチ起点の公開を防げるようにしました。

| Before | After |
|--------|-------|
| タグが `main` 由来かどうかを確認せずにリリースが走る可能性があった。 | タグコミットが `origin/main` に含まれていない場合はリリースを失敗させる。 |
| npm 公開前に十分な品質ゲートを通していなかった。 | `harness-mem-ui` / `memory-server` のテストと型チェックを通過しないと公開しない。 |

### Fixed

- 先行して存在したタグ不整合に対する是正リリースを `0.1.4` として準備。

### Internal

- GitHub Actions の release workflow に Bun セットアップと必須検証ステップを追加。
- release workflow で品質ゲート実行前に `harness-mem-ui` / `memory-server` の依存解決を必須化。

## [0.1.1] - 2026-02-17

### 🎯 What's Changed for You

harness-mem のセットアップとフィード閲覧が、迷わず進めやすくなりました。

| Before | After |
|--------|-------|
| `setup` 実行時は導入先ツールの選択のみ。 | `setup` で言語選択、導入先ツール選択、Claude-mem インポート有無、インポート後停止有無まで対話的に選べる。 |
| フィードカードをクリックすると暗転オーバーレイが開き、長いスクロール時に表示位置が分かりづらいことがあった。 | フィードカードクリックで、クリックしたカード位置で全文がアコーディオン展開される。 |

### Added

- 設定画面にデザインプリセット（`Bento Canvas` / `Liquid Glass` / `Night Signal`）を追加。
- フィードのプラットフォームバッジに `cursor` / `antigravity` の専用表示を追加。

### Changed

- UI の言語初期値と `document.lang` の挙動を整理し、英語デフォルト + 設定での言語切替を安定化。

### Internal

- カード内全文展開、設定永続化、プラットフォーム表示に関するUIテストを追加・更新。
