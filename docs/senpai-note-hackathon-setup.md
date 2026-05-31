# Senpai Note — 当日セットアップ確認手順（Claude Code）

対象: AI Ops Hackathon @関西。**開始前に**この手順で「Skill が発火する状態」を確認する。
所要 5 分。**harness-mem の記憶 daemon は無くてもデモは動く**（貼ったログだけで動く）
ので、ネットワークや daemon に依存しない確認を先に固める。

---

## 0. 前提（イベント必須要件）

- [ ] ノート PC（電源アダプタ）
- [ ] Claude Code が動作する（`claude` が起動する / IDE 拡張が動く）
- [ ] Anthropic API もしくは Claude サブスクリプションでサインイン済み
- [ ] （任意）GitHub アカウント / このリポジトリの clone

確認:

```bash
claude --version
```

## 1. Skill を Claude Code に認識させる（3 つの方法）

`skills/senpai-note/SKILL.md` を Claude Code が読める場所に置く。いずれか 1 つでよい。
**デモの安定性重視なら方法 A（プロジェクトskill）を推奨。**

### 方法 A: プロジェクト skill（推奨・このリポを開いて使う）

このリポを clone して作業ディレクトリにし、`.claude/skills/` に配置する
（`.claude/` は gitignore 済みなのでローカル配置でOK）:

```bash
git clone https://github.com/Chachamaru127/harness-mem.git
cd harness-mem
mkdir -p .claude/skills/senpai-note
cp skills/senpai-note/SKILL.md .claude/skills/senpai-note/SKILL.md
```

### 方法 B: 個人 skill（全プロジェクトで使えるようにする）

```bash
mkdir -p ~/.claude/skills/senpai-note
cp skills/senpai-note/SKILL.md ~/.claude/skills/senpai-note/SKILL.md
```

### 方法 C: プラグイン経由（harness-mem を丸ごと導入）

Claude Code 内で marketplace を追加し、`harness-mem` プラグインを入れる
（skills/ ごとバンドルされる）。社内ネットワーク次第では時間がかかるので、
当日は方法 A/B を第一候補にする。

> Windows は `cp` の代わりにエクスプローラでコピー、または
> `Copy-Item skills\senpai-note\SKILL.md .claude\skills\senpai-note\` 。

## 2. 発火確認（最重要チェック）

Claude Code を起動し、次のいずれかを話して **Skill が発火するか**を確認する:

- 「このセッションを Senpai Note にして」
- 「次の人に引き継げる形にして」
- 「作業ログを runbook にして」

期待動作:

- [ ] 応答が `source:` と `summary:` の 2 行で始まる
- [ ] `HANDOFF_CARD` / `RUNBOOK` / `REPLAY_PROMPT` の 3 セクションが出る
- [ ] 記憶が無い時は `source:` に user-provided と明記される

## 3. デモのドライラン（daemon 不要パス）

業務デモ fixture をそのまま使う。**記憶 daemon を起動しなくてよい。**

1. `examples/senpai-note/ops-demo-session.md`（返金対応の雑メモ）を Claude Code に渡す
   （ファイルを開く or 内容を貼る）。
2. 「このセッションを Senpai Note にして。次の人が30秒で引き継げる形に」と依頼。
3. 出力が `examples/senpai-note/ops-handoff-pack.md` の完成形に近いことを確認。
4. `REPLAY_PROMPT` を別の AI（または同じ Claude Code）に貼り、次の顧客返信の
   下書きが出るところまで確認（AI Agent への受け渡しを見せる）。

チェック:

- [ ] HANDOFF_CARD の「Do not repeat」に「注文番号を再度聞かない／未承認で返金しない」が出る
- [ ] REPLAY_PROMPT がそのまま別 AI に貼れる
- [ ] 30 秒で読めるカードになっている

## 4. （任意）フル記憶パスを使う場合

harness-mem の記憶 daemon を使い、過去セッションから自動で handoff を作る場合のみ:

```bash
harness-mem doctor --platform codex
harness-mem mcp-gateway status
```

- [ ] doctor が all green
- [ ] gateway が daemon に接続できている
- 検索が重い/`503` の時は backpressure。`project` を渡し `limit` を下げ、
  必要なら `vector_search=false` で 1 回だけ再試行する（Skill が自動でケア）。

> デモ本番は daemon 不要の「方法 A + 手順 3」で完結させるのが安全。フル記憶パスは
> 余裕があれば見せる上振れ要素。

## 5. 当日フォールバック（Skill が発火しない時）

- `skills/senpai-note/SKILL.md` の中身をそのまま Claude Code に貼り、「この指示に
  従って、次のログを handoff pack にして」と依頼する（skill 認識に失敗しても動く）。
- ライブ生成自体が不調なら、`examples/senpai-note/ops-handoff-pack.md`（完成形）を
  提示する。スクショ or 印刷を 1 枚持っておく。

## 開始前 最終チェックリスト

- [ ] `claude` 起動 OK / サインイン OK
- [ ] 方法 A or B で SKILL.md 配置済み
- [ ] トリガーフレーズで発火を確認済み
- [ ] ops-demo-session.md でドライラン成功
- [ ] フォールバック（SKILL.md 貼り付け / 完成形提示）を用意
- [ ] 発表構成 `docs/senpai-note-hackathon-pitch.md` を確認
