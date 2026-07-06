# Harness-mem 導入チェックリスト

新しく入れた環境が実運用に使えるかを確認したいときに使うチェックリストです。
合格条件: 下の項目がすべて `Yes` になること。

## 1. 経路の選択

- [ ] `npx` 経路を選んだ、または `npm install -g` を意図して選んだ、または repo checkout から実行している。
- [ ] セットアップや doctor で `sudo` を使っていない。
- [ ] Claude Code、Codex、Cursor、またはそれらの組み合わせのどれを検証するか把握している。

## 2. setup の実行

- [ ] 想定したクライアント一覧で `harness-mem setup` を実行した。
- [ ] path や権限のエラーなしで完了した。
- [ ] ユーザー単位の config ファイルにクライアント配線が書き込まれた。
- [ ] Granite model preparation が完了した、または skip warning の理由を理解し、後から `harness-mem model pull granite-embedding-311m-r2 --yes` を実行できる。

## 3. doctor の実行

- [ ] setup と同じクライアントに対して `harness-mem doctor` を実行した。
- [ ] 出力が green である、または残っている警告の理由を説明できる。
- [ ] `embedding_model` が `warn:granite_migration_available` の場合、移行手順を実行した、または意図して dismiss / defer した。
- [ ] 失敗した場合、どのクライアントとどの config ファイルかを特定できる。

## 4. 実際の初回セッション確認

- [ ] 新しい Claude Code セッションで、最初のターンに直近のプロジェクト文脈を復元できる。
- [ ] 新しい Codex セッションで、最初のターンに直近のプロジェクト文脈を復元できる。
- [ ] 復元された文脈が、古い別プロジェクトではなく現在のプロジェクトと一致している。

## 4b. Cursor を選んだ場合の確認

- [ ] `harness-mem setup --platform cursor` を実行した、または platform list に `cursor` を含めた。
- [ ] `harness-mem doctor --platform cursor --read-only --strict-exit` が green である。
- [ ] MCP server list がキャッシュされている場合、Cursor reload / restart または新しい Cursor セッションを開いた。
- [ ] `~/.cursor/mcp.json` に `mcpServers.harness-mem` があり、古い Cursor-only の `harness` entry が残っていない。
- [ ] 実際の Cursor prompt と assistant response の後、project-scoped search で両方の event が見つかる。
- [ ] Cursor は hook ingest と MCP search に対応しているが、Tier 1 continuity と同等の claim ではないことを理解している。

## 5. 安全境界の確認

- [ ] ローカルデータの保存場所を理解している。
- [ ] Cursor を使う場合、hook JSONL は override しない限り `~/.harness-mem/adapters/cursor/events.jsonl` にローカル spool されることを理解している。
- [ ] 非対応または実験的なクライアントでは、同じ first-turn continuity UX が保証されないことを理解している。
- [ ] setup の成功と first-turn continuity の成功は別物だと説明できる。

## 6. まだ `No` が残る場合

- [ ] `harness-mem doctor --fix` を実行する。
- [ ] hooks が古い checkout path を参照しているなら setup を再実行する。
- [ ] 2 回目の修復を試す前に、該当 config ファイルを確認する。
