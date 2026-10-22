# forget maintenance 運用（アーカイブ・purge・VACUUM）

対象: `~/.harness-mem/harness-mem.db`（local backend）。daemon は `scripts/harness-memd` 管理。

## 何が自動で、何が手動か

| 頻度 | 仕事 | 自動 | 内容 |
|---|---|---|---|
| 毎時 :05 | `hourly-archive` | する | triage が `compact` と判定した行を archive し、vector を削る。既にループが動いていれば何もしない。 |
| 週次 月 08:30 | `weekly-monitor` | する（読取のみ） | DB/WAL サイズ、archive 残、payload 欠落、freelist、health、purge 可能行数。閾値超えは exit 2。 |
| 月初 03:30 | `monthly-vacuum` | しない（計画のみ） | 回収可能バイト数と実行コマンドを出す。実行は人が backup を渡す。 |
| 随時 | `weekly-purge` | しない（計画のみ） | retention を満たす archive 済み行数と実行コマンドを出す。実行は不可逆なので承認後。 |

purge と VACUUM が自動で走らないのは設計。どちらも戻せない、またはサービスを止めるため、backup evidence を人が渡したときだけ実行する。

## 導入

```bash
# 何が入るか確認（変更なし）
scripts/install-maintenance-jobs.sh --print

# 3ジョブを入れる
scripts/install-maintenance-jobs.sh

# 一部だけ
scripts/install-maintenance-jobs.sh --jobs weekly-monitor

# 外す
scripts/install-maintenance-jobs.sh --uninstall
```

plist は `launchd/*.plist.template` を `bun` の絶対パスと repo パスで置換して `~/Library/LaunchAgents/` に書く。repo を移したら再実行する。

ログ: `~/.harness-mem/maintenance/launchd-*.log`
レポート JSON: `~/.harness-mem/maintenance/reports/`

## 手で回す

```bash
# 読取レポート（いつでも安全）
bun run scripts/maintenance-run.ts --job weekly-monitor

# archive ループを今すぐ開始（既に動いていれば skip）
bun run scripts/maintenance-run.ts --job hourly-archive --execute

# purge の計画（不可逆。まだ何も消さない）
bun run scripts/maintenance-run.ts --job weekly-purge --retention-days 7
```

## purge を実行する（不可逆）

前提: 対象行を含む backup があり、`sha256` を計算済みであること。daemon は止める（`--execute` は daemon が応答すると拒否する）。

```bash
# 1. backup（daemon 稼働中でも VACUUM INTO は走る。数分かかる）
harness-mem backup
# 2. sha256
shasum -a 256 ~/.harness-mem/backups/<file>.db

# 3. daemon を止める（DB ハンドルが残らないことを確認する）
scripts/harness-memd offline-stop

# 4. purge（既定 500 行/回。checkpoint で中断再開できる）
bun run scripts/maintenance-run.ts --job weekly-purge --execute \
  --backup-path ~/.harness-mem/backups/<file>.db \
  --backup-sha256 <sha256> \
  --retention-days 7 --limit 500

# 5. daemon を戻す
scripts/harness-memd start
```

`harness-mem backup` は 8 秒でタイムアウトして失敗を表示することがある。daemon 側の VACUUM INTO はそのまま完了しているので、ファイルサイズが増え続けていることと `sha256` が取れることを確認する（2026-10-20 の HG0 で観測）。

retention の日数は `mem_observations.archived_at`（archive した日）から数える。取り込み日ではないので、まとめて archive した直後は 0 行になる。既定は 7 日（2026-10-22 本人判断）。

`--execute` は内部で `scripts/forget-maintenance-offline.ts` を呼ぶ。1 行ごとに archive payload の sha256 と整合を検証し、合わない行は purge しない。件数が多いときは `--limit` を上げる（最大 5000）か、何回かに分ける。

## VACUUM を実行する（サービス停止）

```bash
bun run scripts/maintenance-run.ts --job monthly-vacuum --execute \
  --backup-path ~/.harness-mem/backups/<file>.db \
  --backup-sha256 <sha256>
```

順序は `offline-stop` → backup の restore drill → `VACUUM` → `start` → health 確認。VACUUM が失敗しても daemon は戻す。所要は DB サイズに比例する（20GB で数分）。

## アラートの見方

`weekly-monitor` は次のどれかで exit 2。purge 可能行数は 7 日を過ぎた archive 行の数。

- `daemon_not_ready`: `/health/ready` が 5 秒以内に 200 を返さない
- `archived_missing_payload`: archive 済みなのに復元用 payload が無い行がある（purge 禁止）
- `db_bytes_above_threshold`: 既定 24GiB 超（`HARNESS_MEM_MAINTENANCE_DB_MAX_BYTES`）
- `freelist_above_threshold`: 既定 4GiB 超（`HARNESS_MEM_MAINTENANCE_FREELIST_MAX_BYTES`）

freelist は「消したのにファイルが縮んでいない」量。VACUUM で回収する。`db_bytes` が増え続けるなら archive ループが止まっている。

## 戻し方

```bash
scripts/install-maintenance-jobs.sh --uninstall
```

launchd ジョブを外すだけで、DB・archive・backup は変更しない。purge は戻せない（archive payload も purge 時に空になる）。VACUUM は戻せないが、backup から復元できる。
