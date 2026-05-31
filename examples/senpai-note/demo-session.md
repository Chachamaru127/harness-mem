# Demo Session Log

これは Senpai Note Agent のデモ用入力 fixture です。実際の非公開ログや固有名詞は
含みません。harness-mem の記憶が使えない / デモモードのときに、この雑な作業ログから
handoff pack が生成できることを示します。

## Goal

harness-mem の recall/search がなぜ遅くなることがあるのかを調べ、次の人が安全に
たどれる operator 手順を作る。

## Events

- 広域 recall は大きな local memory では高コストになり得ると確認した。
- `project` scope は分かるときは渡すべきだと確認した。
- `503` は「記憶なし」ではなく backpressure として扱うべきだと確認した。
- fallback では `safe_mode=true` を使うと決めた。
- 範囲を広げる前に `limit` を下げると決めた。
- fallback 時は source と degraded retrieval mode を明示すべきと確認した。

## Commands

- harness-mem doctor --platform codex
- harness-mem mcp-gateway status

## Decisions

- まず project-scoped search から始める。
- 明示的な forensic/admin 作業でない限り、unscoped 広域 search は避ける。
- 503 は retry/fallback の signal として扱う。
- memory search が degraded なときは SSOT ファイルで回答を続ける。

## Gotchas

- 503 を「記憶なし」と解釈しない。
- unscoped search から始めない。
- fallback mode を user に隠さない。
