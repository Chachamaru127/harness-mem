# §64 Contextual Recall Preflight

更新日: 2026-03-31

## 結論

### (a) 同一 UserPromptSubmit で複数 hook の `additionalContext` は結合されるか

- **結論: No を前提に扱う**
- 理由:
  - repo 内では結合保証を示す実装・コメントを確認できなかった
  - 既存 Claude hook は `additionalContext` を返す hook と `systemMessage` を返す hook を分けており、多重 `additionalContext` を前提にした構成ではない
- 採用設計:
  - Claude の contextual recall は新しい hook を増やさず、`scripts/userprompt-inject-policy.sh` の single additionalContext path に統合する

### (b) `hook_emit_codex_additional_context()` を Claude UserPromptSubmit でも使うか

- **結論: No**
- 理由:
  - helper 名の通り Codex 向け JSON 形式に寄っている
  - Claude は `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}` を直接返す方が repo-local に閉じる
- 採用設計:
  - Claude は `hook_emit_claude_additional_context()` を使う
  - Codex は既存の `hook_emit_codex_additional_context()` を使う

### (c) resume フラグ消費タイミング

- **結論: Yes, `.memory-resume-pending` は UserPromptSubmit 側で先に消費される**
- 理由:
  - Claude の `userprompt-inject-policy.sh` は `.memory-resume-pending` を `.memory-resume-processing` へ `mv` できたときだけ 1 回だけ resume context を読む
  - そのため recall 側は pending flag ではなく、「この prompt で resume を出したか」を見て同一ターンの二重注入を防ぐ必要がある
- 採用設計:
  - Claude は `.claude/state/session.json` の `resume_injected` / `resume_injected_prompt_seq` を更新する
  - Codex は SessionStart で `.harness-mem/state/whisper-budget.json` に `pending_resume_skip` を立て、最初の UserPromptSubmit で消費する

## State path の扱い

- Claude 固有の session 状態:
  - `.claude/state/session.json`
- Claude/Codex 共通の recall 予算・重複防止 state:
  - `.harness-mem/state/whisper-budget.json`

理由:
- Codex には Claude と同じ `session.json` 正本がない
- 番頭モードの budget / dedupe / cooldown を共通 helper で扱うには project-local shared state の方が自然
- Claude 固有の `resume_injected` だけは既存計画通り `session.json` に残す
