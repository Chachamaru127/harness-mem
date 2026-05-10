# Claude/Codex Upstream Update Snapshot — 2026-05-10

作成日: 2026-05-10 JST
対象 repo: `harness-mem`
目的: official release / changelog / PR を根拠に、「Codex 0.130.0 がこう変わったので、harness-mem 側はどう受けるか」を次回再開しやすい形で残す。

## 1. Executive Summary

- Codex latest stable は **`rust-v0.130.0`**
  - published: **2026-05-08 23:09:55 UTC**
  - JST: **2026-05-09 08:09:55 JST**
  - local verification: `codex --version` = `codex-cli 0.130.0`
- OpenAI Developers の Codex changelog は product / cloud / IDE 寄りで、CLI `0.130.0` の細目は GitHub release / PR が primary source。
- 今回の `A` は 3 点:
  1. Codex 0.130.0 の remote-control / selected environment / Bedrock auth method / apply-patch diff status 系 metadata を、payload に来た時だけ safe string meta として落とさない
  2. ThreadStore / app-server の paged thread view により `unloaded` / `summary` / `full` 風 item が混ざっても、harness-mem の Codex rollout ingest を壊さない
  3. README / CHANGELOG では「0.130.0 additive metadata と paged summary ingest に耐える」とだけ主張し、remote-control や plugin share metadata を harness-mem が実装するとは書かない

## 2. Review Baseline

前回 upstream review の基準点:

- Codex: `rust-v0.128.0`
- snapshot: `docs/upstream-update-snapshot-2026-05-03.md`

今回の確認は、`rust-v0.130.0` の stable release item を `A / C / P` へ分類する。

- `A`: harness-mem 側で受け口を直す
- `C`: Codex upstream 改善として自動継承し、harness-mem 変更は不要
- `P`: 将来候補として残すが、今回の §111 では実装しない

## 3. Official Sources

### Codex

- OpenAI Developers changelog: <https://developers.openai.com/codex/changelog>
- Releases index: <https://github.com/openai/codex/releases>
- `rust-v0.130.0`: <https://github.com/openai/codex/releases/tag/rust-v0.130.0>
- Compare (`0.128.0 -> 0.130.0`): <https://github.com/openai/codex/compare/rust-v0.128.0...rust-v0.130.0>
- Compare API (`0.128.0 -> 0.130.0`): <https://api.github.com/repos/openai/codex/compare/rust-v0.128.0...rust-v0.130.0>

### Key PR URLs

- `#21424` remote-control command: <https://github.com/openai/codex/pull/21424>
- `#21566` thread pagination / ThreadStore contract: <https://github.com/openai/codex/pull/21566>
- `#21447` plugin bundled hooks in details: <https://github.com/openai/codex/pull/21447>
- `#21495` plugin share metadata in shareContext: <https://github.com/openai/codex/pull/21495>
- `#21637` plugin share discoverability settings: <https://github.com/openai/codex/pull/21637>
- `#21623` Bedrock auth via `aws login`: <https://github.com/openai/codex/pull/21623>
- `#21143` `view_image` through selected environments: <https://github.com/openai/codex/pull/21143>
- `#21187` live app-server config refresh: <https://github.com/openai/codex/pull/21187>
- `#21180` operation-backed turn diff tracking: <https://github.com/openai/codex/pull/21180>
- `#21518` exact turn diffs after partial `apply_patch` failures: <https://github.com/openai/codex/pull/21518>
- `#21264` thread name edits to ThreadStore: <https://github.com/openai/codex/pull/21264>
- `#21265` ThreadManager rollout path reads through ThreadStore: <https://github.com/openai/codex/pull/21265>
- `#21266` pathless thread summaries: <https://github.com/openai/codex/pull/21266>
- `#21642` remote compaction v2 `response.processed`: <https://github.com/openai/codex/pull/21642>
- `#21676` omit `service_tier` on API-key compact requests: <https://github.com/openai/codex/pull/21676>
- `#21564` Windows sandbox runtime-bin access: <https://github.com/openai/codex/pull/21564>
- `#21556` configurable OpenTelemetry trace metadata: <https://github.com/openai/codex/pull/21556>

## 4. Version-by-version Action Table

| Version | Upstream item | Category | Harness surface | Action |
|---------|---------------|----------|-----------------|--------|
| Codex `0.130.0` | `codex remote-control` starts a headless, remotely controllable app-server | A / P | `hook-common.sh`, `tests/codex-future-session-contract.test.ts`, Plans | S111-002 で `source` / `session_source` / `remote_control` など additive metadata が来た時だけ保持。harness-mem は remote-control command を起動・制御しない |
| Codex `0.130.0` | App-server clients can page large threads with unloaded, summary, or full turn item views | A | `memory-server/tests/unit/codex-sessions-ingest.test.ts`, Codex session ingest | S111-003 で paged / summary view 耐性を追加。空 item は skip、summary item は safe checkpoint として扱う |
| Codex `0.130.0` | Plugin details show bundled hooks; plugin sharing exposes link metadata and discoverability controls | P | README / CHANGELOG claim ceiling | S111-004 で過剰 claim を避ける。harness-mem は plugin share metadata の発行・共有制御を実装しない |
| Codex `0.130.0` | Bedrock auth can use AWS console-login credentials from `aws login` profiles | A / C | `hook-common.sh`, privacy filter | S111-002 で `bedrock_auth_method` 風の非秘密ラベルだけ保持候補。AWS credential / profile secret は保存しない |
| Codex `0.130.0` | `view_image` resolves files through the selected environment for multi-environment sessions | A / P | `hook-common.sh`, future search facets | S111-002 で selected environment label が payload に来た時だけ保持。harness-mem は画像解決や環境選択を肩代わりしない |
| Codex `0.130.0` | Live app-server threads pick up config changes without restart | C | none | Codex upstream の runtime correction を自動継承。harness-mem daemon / DB contract 変更は不要 |
| Codex `0.130.0` | Turn diffs remain accurate across `apply_patch`, including partial failures that mutated files | A | `hook-common.sh`, future event meta | S111-002 で `apply_patch_status` / `diff_status` 風の safe status が来た時だけ保持。patch body や file content は保存しない |
| Codex `0.130.0` | Thread summaries, renames, resume, and fork paths work better through `ThreadStore`, including pathless threads | A / C | Codex session ingest | S111-003 で pathless / summary-oriented records に耐える。rename / fork UX 自体は Codex upstream 改善として自動継承 |
| Codex `0.130.0` | Remote compaction emits `response.processed` for v2 streams and omits `service_tier` on API-key compact requests | P / C | future trace / compact ingest | 現時点の harness-mem ingest contract は変更しない。将来 trace ingestion をやるなら event ordering と auth-mode redaction を見る |
| Codex `0.130.0` | Windows sandbox users gain access to desktop runtime binary cache | C | none | Windows sandbox reliability は upstream 側の修正。harness-mem の Windows hook non-blocking policy は既存方針を維持 |
| Codex `0.130.0` | `codex exec` startup bannerから stale “research preview” wording を削除 | C | docs claim hygiene | harness-mem 変更不要 |
| Codex `0.130.0` | Issue templates / `cargo install --locked` docs / Cargo profiling / CI hygiene / internal cleanup | C | none | upstream maintenance として記録のみ |
| Codex `0.130.0` | Configurable OpenTelemetry trace metadata and richer review / feedback analytics | P | Plans | 将来の trace ingestion 候補。S111 では additive hook meta と session ingest tolerance に絞る |

## 5. Planned Receiving Surfaces

### S111-002: Codex hook metadata extractor

0.130.0 の remote-control / selected environment / Bedrock / apply-patch 系 change は、harness-mem では「制御機能」ではなく「由来を失わないための metadata」として受ける。

保持候補:

- `source`, `session_source`, `remote_control`
- `selected_environment`, `environment_id`, `environment_name`
- `bedrock_auth_method`, `model_provider`
- `apply_patch_status`, `diff_status`
- `thread_view`, `item_view`

保存しないもの:

- AWS credential / token / profile secret
- plugin share URL の private link token
- patch body / file content
- remote-control 接続情報そのもの

### S111-003: Codex rollout ingest

0.130.0 の ThreadStore / app-server pagination により、過去の「全部ロード済み turn item」だけを前提にすると取り込みが割れる可能性がある。

受ける形:

- unloaded / notLoaded 風 item: observation にはしない。安全に skip する
- summary item: user prompt / assistant checkpoint の薄い observation として取り込む
- full item: 既存の compacted replacement history と同じ contract を維持する
- pathless thread: rollout path が無くても session id / thread id / timestamp で最低限の continuity を残す

### S111-004: README / CHANGELOG claim ceiling

user-facing claim は次の範囲に止める。

- OK: Codex 0.130.0 additive metadata を失いにくい
- OK: large / paged / summary thread view による ingest breakage を避ける
- NG: harness-mem が `codex remote-control` を実装した
- NG: harness-mem が plugin share metadata / discoverability controls を提供した
- NG: harness-mem が Bedrock auth や selected environment routing を代行する

## 6. Future Candidates

- Codex remote-control session の source / session_source が安定したら、search facet に出す
- ThreadStore summary item の observation rank を、full transcript と分けて調整する
- OpenTelemetry trace metadata を harness-mem event として取り込むか検討する
- Plugin bundled hooks / share metadata は、harness-mem skill bundle 配布の claim と衝突しない範囲でのみ docs に反映する
- Bedrock auth method は provider label としては有用だが、secret redaction test が先

## 7. Local Verification

Source verification:

- `gh release view rust-v0.130.0 --repo openai/codex --json name,tagName,isPrerelease,publishedAt,url,targetCommitish`
  - `name`: `0.130.0`
  - `tagName`: `rust-v0.130.0`
  - `isPrerelease`: `false`
  - `publishedAt`: `2026-05-08T23:09:55Z`
  - `url`: `https://github.com/openai/codex/releases/tag/rust-v0.130.0`
- `gh api repos/openai/codex/compare/rust-v0.128.0...rust-v0.130.0 --jq '{status:.status, ahead_by:.ahead_by, behind_by:.behind_by, total_commits:.total_commits, html_url:.html_url}'`
  - `status`: `diverged`
  - `ahead_by`: `268`
  - `behind_by`: `1`
  - `total_commits`: `268`

Local tool verification:

- `codex --version` = `codex-cli 0.130.0`

Doc-only verification:

- `git diff --check docs/upstream-update-snapshot-2026-05-10.md`
