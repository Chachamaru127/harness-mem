# Breezing Session 再開ノート — 2026-04-14

このセッション (`session/breezing-20260414`) を中断した時点のスナップショット。
再開時はまずこのファイルを読んで context を復元すること。

## 一言サマリ

§80 Pro API 戦略の PR 化を完了（5 本の PR を main に向けて送付済み）。
次は Phase 1 MVP の **Pro API private repo 作成** だが、`canai-ops` org が
GitHub 上に存在しないことが判明し、org 選定でユーザー確認待ちで停止した。

## 環境（重要 — 守らないと別セッションを壊す）

- **本体 dir**: `/Users/tachibanashuuta/LocalWork/Code/CC-harness/harness-mem` で **別セッションが main branch で作業中**。触らない。
- **このセッション用 worktree**: `/Users/tachibanashuuta/LocalWork/Code/CC-harness/harness-mem-breezing-session` (branch: `session/breezing-20260414`)。
- **feature worktree**: `/Users/tachibanashuuta/LocalWork/Code/CC-harness/harness-mem-feature-pro-ja` (branch: `feature/pro-japanese-differentiation`、PR #49 と同一)。

**絶対ルール**: 本体 dir で `git checkout` / `git rebase` / `git stash` を**走らせない**。
どうしても branch を切り替えたい時は `git -C <worktree-path> checkout ...` で
worktree 側を対象にする。`cd worktree && git ...` も可（Bash tool の cwd reset で
本体 dir には戻るが、コマンドは worktree に届いている）。

Claude Code の primary cwd は起動時に本体 dir で固定されているので、公式推奨の
「worktree ごとに 1 セッション」にはなっていないが、本体 dir を `git checkout`
で動かさない限り別セッションとの衝突は起きない。

## 完了済み PRs（このセッションで作成）

すべて main に向けて origin に push、PR 発行済み。merge 順序は要検討。

| # | branch | 概要 | 備考 |
|---|--------|------|------|
| #45 | `docs/s81-agentmemory-cross-pollination` | main working dir にあった §80 agentmemory draft を §81 に renumber | 独立 commit |
| #46 | `chore/gitignore-mcp-bin-artifacts` | cross-build binary 4 pattern + `mcp-server-go/bin/` を gitignore | tracked `bin/harness-mcp-server` は保持 |
| #47 | `fix/s81-002-model-catalog-ruri-130m` | `ruri-v3-310m` dim 1024→768 訂正 + `ruri-v3-130m` 新規登録 | test 24/24 pass |
| #48 | `legal/refresh-can-ai-llc-2026-04` | CAN AI LLC licensor 確定 + §78 Legal Refresh → §82 にリネーム | rebase + renumber 2 commit |
| #49 | `feature/pro-japanese-differentiation` | §80 Pro API Concierge + Learning Loop design plan (137 行 + 設計書 4 本 + S79 調査 5 本) | rebase で archive link conflict 解消 |

## §セクション番号の最終割当

番号衝突を避けて以下に固定した。merge 順で番号が動かないことが前提。

- §77 = Retrieval Quality Regression 調査 (main)
- §78 = World-class Retrieval & Memory Architecture (main、2026-04-13 の pivot 後)
- §79 = Pro 日本語差別化 (PR #48 legal branch 内、legacy 設計、PR #49 の §80 に置き換えられる予定)
- §80 = Pro API Concierge + Learning Loop (PR #49)
- §81 = agentmemory Cross-Pollination (PR #45)
- §82 = Legal Refresh: CAN AI LLC + Open Core 整理 (PR #48)

## 次にやること（優先順）

### 優先度 1: Phase 1 MVP repo 作成の org 選定

ユーザー回答待ち。選択肢:

- **A. 個人 repo**: `gh repo create Chachamaru127/harness-mem-pro-api --private` 即作成、後で transfer
- **B. 既存 org**: `AI-Driven-R-D-Dept/harness-mem-pro-api` ブランド不一致
- **C. `canai-ops` 新規作成**: ブラウザで [github.com/organizations/new](https://github.com/organizations/new)、`admin:org` scope 追加要 (`gh auth refresh -h github.com -s admin:org`)
- **D. 別名 org (例: `canai-llc`)**: 同上

現在の gh 認証:
- user: `Chachamaru127`
- orgs: `AI-Driven-R-D-Dept` のみ
- scopes: `gist, read:org, repo, workflow` (`admin:org` 無し)

### 優先度 2: repo 作成後の初期 scaffold

`docs/launch/01-pro-api-concierge-spec.md` §6 のディレクトリ構成に従う:
- `app/main.py` — FastAPI entry
- `app/embed.py` — Ruri-130m wrapper
- `app/concierge.py` — 10 レイヤー pipeline
- `pyproject.toml` — Python deps
- `Dockerfile` + `fly.toml` — Fly.io NRT deploy
- `README.md` / `LICENSE` (proprietary?) / `.gitignore`

スコープは選択済み (前セッションの質問):
- (a) repo 作成のみ（README + LICENSE + .gitignore + empty FastAPI app）
- (b) S80-100〜S80-101（`/v1/embed` の Ruri-130m 最小動作まで）
- (c) Phase 1 全 7 task（Fly.io deploy まで、数週間規模）

ユーザー未回答。

### 優先度 3: merge 順の確定と PR #49 内の S80-002 を cc:完了 化

`fix/s81-002-model-catalog-ruri-130m` (PR #47) が merge された後、
`feature/pro-japanese-differentiation` (PR #49) 側の §80 S80-002 task を
`cc:完了` に更新する follow-up commit が必要。

## 付随して作った config 変更（ユーザー global 領域）

- `/Users/tachibanashuuta/.claude/statusline-command.sh` に linked worktree
  indicator `⎇` を追加。連結 worktree にいる時だけ branch の前に `⎇` が付く。
  検知ロジック: `git rev-parse --git-dir` と `--git-common-dir` の比較。

## 再開フロー

1. `cd /Users/tachibanashuuta/LocalWork/Code/CC-harness/harness-mem-breezing-session`
2. `cat .session-notes/2026-04-14-breezing-resume.md`（このファイル）を読む
3. `gh pr list --state open` で 5 PR の merge 状況を確認
4. ユーザーに Phase 1 MVP の org 選択 (A/B/C/D) を再度確認
5. 選択が決まったら `gh repo create ... --private` で開始
