# Bun Test Panic Repro

> 更新日: 2026-03-30

この文書は、`harness-mem` のコード不具合と、`Bun` という JavaScript / TypeScript 実行環境の既知クラッシュを切り分けるためのメンテナ向けメモです。

ここでいう **panic** は、「テストの中身が落ちた」というより、**テスト実行の最後に Bun 本体が自分で落ちる現象** を指します。

## 1. まず何が事実なのか

### 事実

- この repo では、一部の `bun test` 実行が **`0 fail` のあとに** `panic(main thread): A C++ exception occurred` で終わることがあります。
- これは特に、benchmark 系や teardown が重い suite で観測しやすいです。
- `memory-server` は 1 本の巨大実行より、既存の chunked runner (`cd memory-server && bun run test`) の方が安定します。
- root `npm test` は現在、この現象を踏みにくい実行経路に変更済みです。
- その具体的な実行分解は `docs/TESTING.md` に残しています。

### 推測

- 根本原因は `harness-mem` 自身より、Bun の runtime / teardown 側にある可能性が高いです。
- 特に macOS / Apple Silicon で、`bun:test` 実行後の終了処理が不安定なケースに近いと見ています。

### この repo 側の対策

- `memory-server` は既存の chunked runner を使います。
- root / SDK / MCP のテストは `scripts/run-bun-test-batches.sh` で 1 ファイルずつ回します。
- `scripts/run-bun-test-safe.sh` は、**`0 fail` + 既知の Bun panic banner** のときだけ warning 扱いにします。
- 本当のテスト失敗は、これまで通り fail のままです。

## 2. 何が「最小再現」か

最小再現とは、**「この repo のロジック bug ではなく、Bun の終了時クラッシュらしい」と説明できる最小の実行手順** のことです。

この repo では、次の 2 つをセットで残します。

1. **raw 再現**
   - Bun をそのまま実行して panic を見せる
2. **mitigation 比較**
   - 同じ対象を repo 側の safe runner で実行し、どう扱いを変えているかを見せる

## 3. すぐ試せるコマンド

### まず環境を記録

```bash
bun --version
uname -a
git rev-parse --short HEAD
```

### 既定の再現候補を raw で実行

```bash
bash scripts/repro-bun-panic.sh --raw
```

### 特定ファイルだけ raw で実行

```bash
bash scripts/repro-bun-panic.sh --raw tests/benchmarks/cross-tool-transfer.test.ts
```

### 同じ対象を safe runner 経由でも比較

```bash
bash scripts/repro-bun-panic.sh --safe tests/benchmarks/cross-tool-transfer.test.ts
```

## 4. 期待する見え方

### raw 再現

- テストの本文は通る
- それでも最後に Bun が panic することがある

例:

```text
1 pass
0 fail
panic(main thread): A C++ exception occurred
oh no: Bun has crashed. This indicates a bug in Bun, not your code.
```

### safe runner 比較

- 同じ条件でも、repo 側では「既知の runtime noise」として warning に落とす
- ただし `1 fail` 以上あるときは warning にせず、そのまま fail する

## 5. release / CI との関係

- local maintainer contract の基本は `npm test` です
- release workflow も、この repo では local と同じ `npm test` を quality gate として使います
- UI は別系統なので、`harness-mem-ui` の test / typecheck は release workflow で別に流します
- `memory-server` の typecheck も release workflow で別に流します

つまり、

- **振る舞い検証** = `npm test`
- **UI 品質** = `harness-mem-ui` quality gates
- **型安全性** = `memory-server` typecheck

という役割分担です。

## 6. upstream に報告するときに添えるとよいもの

最低限、次を添えると切り分けしやすくなります。

1. `bun --version`
2. OS / CPU 情報
3. raw 再現コマンド
4. safe runner では warning 扱いになること
5. 「テスト失敗ではなく、`0 fail` のあとに runtime panic が起きる」こと

## 7. 注意点

- この文書は「panic を完全に直した」という意味ではありません
- ここで直しているのは、**repo の検証フローの再現性** です
- Bun 本体の crash が消えたわけではないので、将来 Bun 側で修正されたら safe runner は見直してよいです
