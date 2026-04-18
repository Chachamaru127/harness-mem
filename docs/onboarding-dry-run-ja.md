# 導入 dry-run ノート

このノートは、ユーザー設定を変更する前に、どの導入経路を選ぶべきか判断するためのものです。
実行ログではなく、選択のためのメモです。

## 1. repo checkout 経路

向いている人:

- すでにこの repo の中で作業している contributor
- 再現性のあるローカル検証をしたい人
- Codex 専用の bootstrap を、現在の checkout で確実に試したい人

変更されるもの:

- 選んだクライアントの user-scoped config
- local memory data と hook 配線

代表コマンド:

```bash
bash scripts/setup-codex-memory.sh
npm run codex:doctor
```

dry-run の見方:

- これらのコマンドも user config を変更する
- checkout path は古い clone ではなく現在の repo である必要がある
- 直後の `doctor` で hook path と daemon の健全性を確認する

## 2. npm global install 経路

向いている人:

- PATH 上に永続的な `harness-mem` コマンドを置きたい人
- `sudo` なしで global install できる通常ユーザー shell を使っている人

変更されるもの:

- global npm package
- その後に他の経路と同じ user-scoped 配線

代表コマンド:

```bash
npm install -g @chachamaru127/harness-mem
harness-mem setup --platform codex,claude
```

dry-run の見方:

- 日常利用では repo checkout より扱いやすい
- ただし global install が不安定な環境では `npx` より安全とは限らない

## 3. npx 経路

向いている人:

- 初回評価
- 永続的な global install を作りたくない環境
- `sudo` を避けたい setup

変更されるもの:

- npm global state には永続的に残らない
- 他の経路と同じ user-scoped 配線は行う

代表コマンド:

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform codex,claude
```

dry-run の見方:

- clean start の既定として最も扱いやすい
- setup 経路を 1 回だけ通したいときに向いている

## 4. どれを選ぶか

- 最初の 1 回なら `npx`
- 永続 CLI が欲しくて global install が素直に通るなら `npm install -g`
- harness-mem 本体を開発しているなら repo checkout
- ownership の影響を理解していない限り `sudo` は避ける
