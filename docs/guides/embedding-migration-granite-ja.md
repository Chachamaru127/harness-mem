# Granite 埋め込み移行ガイド

このガイドは、新規 install の `granite-embedding-311m-r2@384` default と、既存 installation 向けの opt-in 移行手順をまとめます。

## 新規 install

新しい `harness-mem setup` は dependency / runtime check の後、daemon start の前に Granite model preparation step を実行します。この step は次を行います。

- 約 1.2 GB の download と Hugging Face network requirement を事前に知らせる
- offline、CI、sandbox では warning を出して skip する
- `--skip-model-pull` で明示 opt-out できる
- LaunchAgent plist がある場合、embedding env を `HARNESS_MEM_EMBEDDING_PROVIDER=auto` に同期し、既定の `HARNESS_MEM_EMBEDDING_MODEL` pin を削除する。これにより seed 済みの `embedding_default_model` flag が Granite を選択できる

pull が skip されても daemon は fail-safe chain で動きます。優先順は Granite、既存の `multilingual-e5`、最後に synthetic fallback です。後から有効化するには次を実行します。

```bash
harness-mem model pull granite-embedding-311m-r2 --yes
```

raw daemon 起動では、`embedding_default_model` flag が効くのは provider が `auto`、`local`、`adaptive` のときだけです。`HARNESS_MEM_EMBEDDING_PROVIDER` 未設定の raw 起動は raw default の `fallback` になり、この flag は読まれません。

## 既存 installation

既存 installation は自動では切り替えません。観察がある既存 DB で、default flag が未設定または既存 incumbent の `multilingual-e5` の場合、daemon は移行 notice を出します。

- `/health` の `embedding_migration_notice`
- `harness-mem doctor --json` の `embedding_model` check
- daemon 起動ログ。ただし rate-limit あり

`openai` / `ollama` を使っている、明示 model pin がある、すでに Granite flag 済み、観察が 0 件、または `~/.harness-mem/config.json` に `notices.granite_migration_dismissed_at` がある場合は表示しません。

## 移行コマンド

vector backfill を行う準備ができたら、次を順に実行します。

```bash
harness-mem model pull granite-embedding-311m-r2 --yes
harness-mem admin-vector-backfill start --model granite-embedding-311m-r2 --dimension 384 --reset
bun run scripts/s154-granite-flag-set.ts --execute --to granite-embedding-311m-r2@384
scripts/harness-memd restart
```

rollback は incumbent model に戻します。

```bash
bun run scripts/s154-granite-flag-set.ts --execute --to multilingual-e5
scripts/harness-memd restart
```

## dismiss

移行せず既存 installation notice を消す場合:

```json
{
  "notices": {
    "granite_migration_dismissed_at": "2026-07-05T00:00:00.000Z"
  }
}
```

## license と artifact note

pin している upstream model revision は `44399559930365213510b1ee2eb15ded83374f0e` です。Hugging Face model card は `apache-2.0` を宣言しています。pin revision の tree inspection では、別個の `LICENSE` / `NOTICE` file は見つかりませんでした。harness-mem は download する ONNX artifact を revision と SHA-256 で pin し、checksum mismatch は fail-closed にします。
