# Doctor UX スコープ

このノートは、`harness-mem doctor` の現在の分かりにくさと、次フェーズで欲しい CLI 改善を定義するものです。
実装計画ではなく、スコープノートです。

## doctor の役割

`doctor` は次の 3 点にすぐ答えられるべきです。

1. daemon は healthy か
2. client wiring は最新か
3. 問題があるなら次に何をすべきか

## 現在の分かりにくさ

- 出力の中で、診断と修復ヒントが混ざっていて、最初の一行で状態が掴みにくい。
- 複数クライアントを同時に診ると、どのクライアントが落ちたかがすぐ見えないことがある。
- setup 成功、hook 成功、first-turn continuity 成功の違いが、ひと目では分かりにくい。
- `--fix` が何を変えたのかが見えないと、ユーザーには少し opaque に感じられる。
- platform 別の案内はあるが、欲しいアクションにたどり着くまでの情報量が多い。

## 次フェーズの CLI 改善

- 先頭に `healthy` / `degraded` / `broken` のような短い要約を出す。
- daemon、hook wiring、client config、version drift のように concern ごとにまとまった出力にする。
- 最初に失敗した項目について、次に取るべき action をその場で出す。
- `--fix` が何を直したかを、ユーザーが説明できる程度に明示する。
- 英語と日本語の文言をそろえ、同じ失敗が両方の surface で同じ意味になるようにする。

## このノートの対象外

- 実際の repair ロジック変更
- setup flow の再設計
- 新しい client への対応追加
- `doctor` を別コマンドに置き換えること
