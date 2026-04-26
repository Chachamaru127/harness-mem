# Claude/Codex Upstream Update Snapshot — 2026-04-25

作成日: 2026-04-25 JST
対象 repo: `harness-mem`
目的: official release / changelog を根拠に、「Claude/Codex がこう変わったので、harness-mem 側はどう受けるか」を次回再開しやすい形で残す。

## 1. Executive Summary

- Claude Code latest stable は **`v2.1.119`** のまま
  - published: **2026-04-23 23:24:19 UTC**
  - JST: **2026-04-24 08:24:19 JST**
- Codex latest stable は **`rust-v0.124.0`** のまま
  - published: **2026-04-23 18:29:40 UTC**
  - JST: **2026-04-24 03:29:40 JST**
- 2026-04-25 JST 時点では、前回 review baseline 以降に **new stable release は無い**
- したがって今回の immediate action は **docs / plan 同期に加え、今すぐ安全に入れられる hook / doctor / contract test の先回り実装**
- watch 対象は 2 つ:
  - Claude Code: `v2.1.119` の `/config -> ~/.claude/settings.json` precedence と `duration_ms` additive field
  - Codex: `rust-v0.125.0-alpha.2` / `alpha.3` に見える permission profile / multi-environment / remote thread store

## 2. Review Baseline

前回 upstream review の基準点:

- Claude Code: `v2.1.117`, `v2.1.118`, `v2.1.119`
- Codex: `rust-v0.123.0`, `rust-v0.124.0`

今回の確認は「その後に stable が増えたか」と、「前回 review で見えた change を repo 側でどう受けるべきか」の整理である。

## 3. Official Sources

### Claude Code

- Releases index: <https://github.com/anthropics/claude-code/releases>
- `v2.1.117`: <https://github.com/anthropics/claude-code/releases/tag/v2.1.117>
- `v2.1.118`: <https://github.com/anthropics/claude-code/releases/tag/v2.1.118>
- `v2.1.119`: <https://github.com/anthropics/claude-code/releases/tag/v2.1.119>
- Official changelog docs: <https://code.claude.com/docs/en/changelog>
- Raw changelog: <https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md>

### Codex

- Releases index: <https://github.com/openai/codex/releases>
- `rust-v0.124.0`: <https://github.com/openai/codex/releases/tag/rust-v0.124.0>
- `rust-v0.125.0-alpha.3`: <https://github.com/openai/codex/releases/tag/rust-v0.125.0-alpha.3>
- Compare API (`0.124.0 -> 0.125.0-alpha.3`): <https://api.github.com/repos/openai/codex/compare/rust-v0.124.0...rust-v0.125.0-alpha.3>

## 4. Claude Code → harness-mem

| Claude Code update | Official fact | harness-mem response | Action bucket |
|---|---|---|---|
| `v2.1.119`: `/config` settings persist to `~/.claude/settings.json` and join project/local/policy precedence | release notes explicitly say `/config` now persists there | setup docs should stop reading like `~/.claude.json` is the only real home for Claude-side settings | docs update |
| `v2.1.119`: `PostToolUse` / `PostToolUseFailure` input adds `duration_ms` | additive field in hook input | `memory-post-tool-use.sh` で `payload.meta.duration_ms` を受け、contract test で invalid 値も安全に無視するようにした | implemented |
| `v2.1.118`: hooks can call MCP tools directly with `type: "mcp_tool"` | release notes explicitly mention direct MCP tool calls from hooks | current repo still uses command-based hooks; keep as-is for now, but re-evaluate whether read-only hook paths should move from shell to direct MCP | feature opportunity |
| `v2.1.117`–`v2.1.119`: plugin dependency install/update/doctor behavior improved | release notes mention dependency resolution, auto-update, doctor visibility | no repo-local change needed; harness-mem benefits automatically | no action |
| `v2.1.117`–`v2.1.119`: MCP connect, subagent, OAuth, UI, `/resume` improvements | release notes mention concurrent connect, stale-session handling, OAuth fixes | these are upstream UX/runtime improvements, not breakage against current harness-mem contracts | no action |

### Repo-local receiving surfaces

- Claude packaged hook definitions: [hooks/hooks.json](../hooks/hooks.json)
- SessionStart script: [memory-session-start.sh](../scripts/hook-handlers/memory-session-start.sh)
- UserPromptSubmit script: [userprompt-inject-policy.sh](../scripts/userprompt-inject-policy.sh)
- Shared helper layer: [hook-common.sh](../scripts/hook-handlers/lib/hook-common.sh)
- Setup docs: [harness-mem-setup.md](./harness-mem-setup.md), [harness-mem-setup-ja.md](./harness-mem-setup-ja.md)

## 5. Codex → harness-mem

| Codex update | Official fact | harness-mem response | Action bucket |
|---|---|---|---|
| `rust-v0.124.0` remains latest stable | releases index still marks `0.124.0` latest stable on 2026-04-25 JST | no new stable follow-up required today | no action |
| `rust-v0.125.0-alpha.2` / `alpha.3` appear after baseline | prerelease only; not stable | keep as watchlist, not implementation trigger | watch only |
| prerelease watch: permission profiles / untrusted project / shell escalation / sandbox profile propagation | compare API / release-related commit titles indicate these areas are moving | 今回は `requirements.toml` 起点の managed-config drift を先に doctor へ追加し、次 stable では trust / permission drift へ広げる | partially implemented |
| prerelease watch: sticky environment API / remote thread store / thread resume/fork behavior | compare API indicates thread / environment model is moving | `tests/codex-future-session-contract.test.ts` を追加し、`SessionStart` / `UserPromptSubmit` / `Stop` が additive field 付きでも attribution を維持することを先回りで固定した | implemented |
| `0.124.0`: hooks stable, config/requirements support, MCP tools in hooks | already in baseline review | keep current repo behavior; no new action today | no action |

### Repo-local receiving surfaces

- Codex SessionStart / prompt / stop hooks:
  - [codex-session-start.sh](../scripts/hook-handlers/codex-session-start.sh)
  - [codex-user-prompt.sh](../scripts/hook-handlers/codex-user-prompt.sh)
  - [codex-session-stop.sh](../scripts/hook-handlers/codex-session-stop.sh)
- Codex install / doctor / hook merge:
  - [scripts/harness-mem](../scripts/harness-mem)
  - [codex-hooks-merge-contract.test.ts](../tests/codex-hooks-merge-contract.test.ts)
- Codex skills:
  - [codex/skills/harness-mem/SKILL.md](../codex/skills/harness-mem/SKILL.md)
  - [codex/skills/harness-recall/SKILL.md](../codex/skills/harness-recall/SKILL.md)

## 6. Current Repo Judgement

### Immediate changes worth landing now

1. Claude setup docs precedence sync
2. `Plans.md §97` truth sync
3. Claude `duration_ms` hook hardening + contract test
4. Claude precedence drift doctor + contract test
5. Codex `requirements.toml` drift doctor + contract test
6. This snapshot doc itself
7. Codex future-session additive-field hardening + contract test

### Changes intentionally not landed now

1. No new MCP transport / remote thread implementation for Codex
2. No trust / permission profile doctor yet
3. No `version >= stable` live verification on a Codex `0.124.x` or newer local CLI yet

理由:

- stable が増えていないため、広い仕様変更より additive hardening を優先したため
- Codex 側の大きな論点は prerelease 段階で、仕様がまだ動く可能性があるため
- false-green を減らす doctor / contract test は、今の stable でも価値が高いため

## 7. Local Verification Gap

- `claude --version` = `2.1.119`
  - latest stable と一致
- `codex --version` = `0.116.0`
  - repo が掲げる最低サポート (`v0.116.0+`) は満たす
  - ただし `0.124.0` 固有挙動の live verification としては使えない

したがって、Codex `0.125` stable が出た時の follow-up では、**version >= stable の実環境で doctor / hook / resume-pack を再実測する**。

## 8. Next Review Checklist

次に official stable が更新されたら、以下の順で再確認する。

1. Claude / Codex の latest stable tag と published date を実測する
2. hook contract に additive ではない breaking change があるか確認する
3. Codex `requirements.toml` / trust / permission profile が doctor 対象に入るべきか判断する
4. multi-environment / remote thread changes が resume-pack attribution に影響するか判断する
5. 「upstream change -> harness-mem response」を `Plans.md` と `CHANGELOG` に反映する
