# docs/reports

operator 向けの判断材料レポート（一回もの）を置く。追記専用で、既存ファイルは上書きしない。

命名は `YYYY-MM-DD-<slug>.html`。CDN や外部フォントに依存しない自己完結の HTML とし、印刷（PDF 化）にも耐える形で書く。

Slack へ流すときは PDF に変換する。

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --print-to-pdf="out.pdf" --no-pdf-header-footer \
  "file:///absolute/path/to/report.html"
```

## 索引

| 日付 | レポート | 内容 |
|---|---|---|
| 2026-07-29 | [version-diff-explained](2026-07-29-version-diff-explained.html) | 旧版 (npm 0.29.1 / daemon 0.28.9) と今週の更新版の差分。毎分の health 無応答を解消した経緯と実測 (73/240 → 3/300、p95 14ms)、および 0.29.4 公開可否の判断材料 |
| 2026-07-30 | [s160-explained](2026-07-30-s160-explained.html) | §160 の理解用。記憶 1 件の保存が遅い原因 (auto-linker の索引列順) の特定と修正、本番ログで判明した真の主因 (取り込みの無制限ループ、最大 173 秒ブロック)、および PR #167 / 160-005 / 160-006 の判断材料 |
| 2026-08-17 | [recent-work-meta-review](2026-08-17-recent-work-meta-review.html) | 2026-08-05〜07 の作業のメタレビュー。実装ではなく自主張の検証に費やした 3 日間の内訳、誤り 6 件を捕まえた仕組みの対応表、本番実測 (173,528ms → 17,384ms、10 秒超 382 → 7 件、DoD 未達)、および 160-009 / 160-010 の優先順位と patterns.md 昇格候補 3 件の判断材料 |
