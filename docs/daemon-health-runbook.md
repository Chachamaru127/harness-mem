# daemon が degraded に見えるときの切り分け

`harness-memd status` が `degraded` を表示しても、その表示だけでは daemon を停止しない。
履歴 ingest が event loop を占有している種別 A と、graceful shutdown が返らない種別 B では対処が逆になる。

## 判定フロー

1. 現在の daemon endpoint の `/health` を直接確認する。
   既定 endpoint を使っている場合は次の request で確認できる。

   ```bash
   curl -i --connect-timeout 2 --max-time 5 http://127.0.0.1:37888/health
   ```

   JSON が返るなら HTTP server は応答している。
   `degraded` 表示だけを理由に kill しない。

2. `/health` が返らない場合は、対象 PID の CPU 使用率と process state を確認する。

   ```bash
   ps -p <pid> -o %cpu,state
   ```

3. 次の表で判定する。

| `/health` | CPU と state | daemon log | 判定 | 操作 |
|---|---|---|---|---|
| JSON が返る | 問わない | 問わない | HTTP 応答あり | `degraded` 表示だけでは kill しない |
| 返らない | CPU 数十%、`R` または `U` | slow tick が出ることがある | 種別 A | kill せず待つ |
| 返らない | CPU 0% 付近、`S` | 最終行が shutdown 受信ログ | 種別 B | 下記の停止手順を実行する |
| 返らない | 上記以外 | 上記以外 | 未確認 | この runbook を根拠に kill しない |

種別 A の実測では CPU が 46% → 110.9% と上がり、約 6 分後に `http=200`、CPU 0%、`state=S` へ自然回復した。
CPU と state の組み合わせが表に一致しない場合、この runbook では原因も kill 可否も確認できていない。

## 種別 A は kill せず待つ

種別 A は、60 秒周期の履歴 ingest が同期処理を実行している状態である。
`claude_code`、`codex`、`cursor`、`gemini`、`opencode` はいずれも `*_interval_ms: 60000` で動く。

同期処理中は HTTP server が event loop を使えないため、daemon process が生存していても `/health` が返らない。
DB 書き込みに使う `bun:sqlite` も同期 FFI であり、書き込み中は JavaScript が実行されない。

CPU が数十%で `state=R` または `state=U` なら、kill も restart もせず待つ。
数分待ってから `/health` と `ps` を再確認し、HTTP 200、CPU 0%、`state=S` への復帰を確認する。
実測した自然回復は約 6 分後だった。

## 種別 B は段階的に停止する

種別 B は、graceful shutdown の処理が返らず、daemon が listen socket を保持したまま停止しない状態である。
次の 3 条件がそろった場合に判定する。

- `/health` が返らない
- CPU が 0% 付近で `state=S` のまま
- 現在の instance に対応する daemon log の最終行が次の内容で止まっている

```text
[harness-memd] received SIGTERM, draining queue and shutting down
```

まず対象 PID に通常の `kill` を送る。

```bash
kill <pid>
```

送信後は 30 秒以上待つ。

**この 30 秒は手動手順専用の値であり、`HARNESS_MEM_STOP_TIMEOUT_SEC`(既定 5 秒)とは別物**。
env の 5 秒は `harness-memd stop` / `restart` / `offline-stop` が自動で SIGKILL へ切り替えるまでの待ち時間で、script が pid の生存を毎秒確認しながら待つ。
一方この手順は手で `kill` を送る経路なので、daemon 内 watchdog(`HARNESS_MEM_SHUTDOWN_TIMEOUT_MS`、既定 10 秒)が働く余地と、drain が長引く場合の余裕を見て長めに取っている。
script 経由で止めるなら待ち時間は env に従うので、この手順は不要。

同じ PID がまだ生存している場合に限り、強制終了する。

```bash
kill -9 <pid>
```

## 遅い tick の計測ログ

daemon は event loop を長時間占有した tick を自己申告する。
`HARNESS_MEM_SLOW_TICK_LOG_MS` の既定値 1000ms を超えた tick だけを記録するため、平常時はこのログが出ない。

```text
[ingest] slow tick: codex blocked the event loop for 11876ms
[consolidation] slow sync segment: materialize_observations blocked the event loop for ...ms
```

`[ingest] slow tick` は、履歴 ingest の source と event loop を占有した時間を示す。
`[consolidation] slow sync segment` は、consolidation 内の同期区間と占有時間を示す。

本番では 1 回の tick で `codex` ingest が名指しされた。
job を止めて条件を比較する A/B テストより、所要時間ログで該当 tick を特定する方が速く、確実だった。
launchd の `KeepAlive` がある環境で job 単位の A/B テストを行うには plist の変更が必要になるが、この計測は restart 1 回で確認できる。

## 調整用の環境変数

| env | 既定 | 役割 |
|---|---:|---|
| `HARNESS_MEM_SLOW_TICK_LOG_MS` | 1000ms | 遅い tick の記録閾値。0 以下では記録しない |
| `HARNESS_MEM_INGEST_TICK_BUDGET_MS` | 200ms | 1 tick が event loop を占有してよい上限 |
| `HARNESS_MEM_INGEST_MAX_BYTES_PER_FILE` | 512KB | 1 tick で 1 ファイルから読む上限 |
| `HARNESS_MEM_INGEST_READ_SLICE_BYTES` | 64KB | 1 回の read + parse の幅。budget 判定はスライス境界でしか効かないので、ここを小さくすると 1 回のブロックが短くなる |
| `HARNESS_MEM_WAL_CHECKPOINT_INTERVAL_MS` | 300000ms | 明示 WAL checkpoint の間隔。同期 DB I/O なので DB が大きいほど重い。SQLite の autocheckpoint が commit 時に逐次実行するため、この明示実行は肥大化に対する保険 |
| `HARNESS_MEM_SHUTDOWN_TIMEOUT_MS` | 10000ms | graceful shutdown の強制終了までの猶予 |
| `HARNESS_MEM_STOP_TIMEOUT_SEC` | 5秒 | script 側が SIGTERM から SIGKILL まで待つ時間 |
| `HARNESS_MEM_BUSY_HEALTH_TIMEOUT_MS` | 10000ms | MCP client が busy daemon の回復を待つ上限 |

## probe 既定値の根拠

MCP client 側の health probe は現行値を据え置いている。2026-07-28 の本番実測 (300 サンプル、1 秒間隔) が根拠。

| 指標 | 実測 |
|---|---:|
| p50 | 1ms |
| p95 | 14ms |
| p99 | 0.97s |

- `healthTimeout` **2500ms** は p99 (0.97s) の 2.5 倍以上の余裕がある
- `startupHealthTimeout` **5s** は cold start (eager warm-up 実測 1.2〜7.0 秒) を単独では吸収しきれないが、生存 pid を検出したら busy として待つ経路が入っているため、起動失敗と誤認しない
- したがって probe 値を伸ばすのではなく、busy と unreachable を区別する側で対処する

## 落とし穴

### daemon log は 2 か所に分かれる

`~/.harness-mem/daemon.log` は `harness-memd` script が起動した instance の出力である。
`~/.harness-mem/daemon.launchd.log` は launchd が起動した instance の出力である。
片方だけを見ると、別 instance の過去ログを現在の状態として誤読する。
両方を確認し、現在の instance を起動した経路に対応するログで判定する。

### degraded 表示だけでは停止しない

種別 A の処理中は、`harness-memd status` が継続して `degraded` を表示する。
表示名ではなく、`/health` が JSON を返すか、CPU 使用率と process state がどの組み合わせかで判定する。

### launchd は daemon を即再起動する

launchd の `KeepAlive` が有効なら、`harness-memd stop` の後に新しい process が起動する。
新しい process を、停止に失敗した元の process と取り違えない。

### restart を繰り返さない

restart すると warm-up と 24 時間分の history backfill が最初から始まる。
warm-up の実測は 1.2〜7.0秒だった。
種別 A で restart を繰り返すと、event loop 飢餓を自分で再発させる。
