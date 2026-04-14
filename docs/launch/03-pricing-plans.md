# Pricing Plans 仕様書

策定日: 2026-04-14
対象: harness-mem の Free / Pro Learn / Pro Private / Enterprise プラン
関連: [01-pro-api-concierge-spec.md](./01-pro-api-concierge-spec.md) / [02-feedback-signal-collection.md](./02-feedback-signal-collection.md) / [04-weekly-benchmark-regression.md](./04-weekly-benchmark-regression.md)

## 1. 目的

harness-mem を **OSS + Pro サーバー + 契約体系** の三位一体で商業化するための **プラン設計と価格体系** を定義する。Open Core 戦略に沿い、コアは無料、差別化は Pro 以上で提供する。

価格は **たたき台** として設定している。市場調査と β 運用後に再調整する前提。

## 2. 4 段プラン体系

| プラン | 月額 (個人) | 月額 (チーム) | 学習参加 | Zero-Retention | SLA | サポート |
|---|---|---|---|---|---|---|
| Free | ¥0 | ¥0 | 該当なし (ローカル完結) | 該当なし | — | GitHub Discussions |
| Pro Learn | ¥980 | ¥1,480/seat | Yes (匿名化後) | — | 99.0% | Email (3 営業日) |
| Pro Private | ¥2,980 | ¥3,980/seat | No | Yes (完全) | 99.5% | Email (1 営業日) |
| Enterprise | 要見積 (¥500K〜/月 例示) | 契約 | 契約で決定 | Yes + 監査 | 99.9% | Slack Connect + Dedicated |

## 3. 機能境界マトリクス

| 軸 | Free | Pro Learn | Pro Private | Enterprise |
|---|---|---|---|---|
| Embedding モデル (日本語) | Ruri-v3-30m (local) | Ruri-v3-130m (Pro サーバー) | Ruri-v3-130m | fine-tuned 専用モデル |
| Embedding モデル (汎用) | multilingual-e5 (local) | multilingual-e5-large (Pro サーバー) | 同 | fine-tuned + OpenAI hybrid 可 |
| Reranker | 無し | 軽量 rerank (Ruri-reranker) | 同 | 高品質 rerank + cross-encoder |
| クエリ拡張 | ローカル同義語辞書 | サーバー版拡張 (大規模辞書) | 同 | + ドメイン辞書 |
| 検索精度 (期待値) | baseline | baseline + 3〜5% | 同 | + 5〜10% (長期) |
| レイテンシ SLA | — | p95 ≤ 500ms | 同 | p95 ≤ 250ms |
| 可用性 SLA | — | 99.0% | 99.5% | 99.9% |
| API レート制限 | 該当なし | 60 req/min | 60 req/min | カスタム |
| 監査ログ配信 | — | — | — | 有 (S3 export) |
| SSO / SAML | — | — | — | 有 |
| オンプレ配置 | — | — | — | 可 (+オプション料金) |
| 個別契約 (NDA) | — | — | 希望時可 | 標準 |
| Zero-Retention 証明書 | — | — | 発行 | 発行 + 第三者監査 |
| データ保持期間 | 該当なし | 信号 90 日 / 集約統計は永続 | 保持なし | 契約で決定 |

## 4. 価格の根拠

### Pro Learn ¥980 (個人) の計算

- OpenAI `text-embedding-3-large` 従量課金: 月 ¥20〜40 (個人利用)
- Fly.io インスタンス原価: 月 ¥3,000 (shared cost)
- キャッシュで cost-per-user は圧倒的に下がる
- ¥980 でマージン 90%+
- 日本の開発者向け SaaS の「気軽に試せる価格帯」 (Cursor Pro は $20/月)

### Pro Private ¥2,980 (個人) の計算

- Pro Learn の 3 倍
- 「プライバシー保証」のプレミアム価格
- 法務レビューが楽 (個人契約で Zero-Retention が成立)
- 規制業種の個人エンジニア (金融・医療・法務) 向け

### Team 価格の +50% 根拠

- seat 管理 / 招待 / 共有機能の開発コスト
- カスタマーサポート負荷増

### Enterprise ¥500K〜/月の想定

- 最小 10 seat 前提 (× ¥3,980 = ¥39,800) の 10 倍
- SSO / 監査 / 専任サポート / SLA 99.9% の付加価値
- 大企業の法務 / コンプライアンス対応コスト吸収

## 5. データ利用条項 (Pro Learn 契約書の要点)

1. **収集する情報の範囲**
   - クエリテキスト (匿名化)
   - ルート判断結果、モデルスタック
   - クリック / チェックポイント等の暗黙シグナル
   - レイテンシ、エラーコード
2. **収集しない情報**
   - 個人識別情報 (氏名、メール、電話、社内 ID)
   - コード本文
   - 検索結果の snippet 本文
3. **利用目的の限定**
   - Ruri モデルの追加学習
   - 検索ルーティング パラメータの調整
   - ベンチマーク品質確認
4. **第三者提供なし**
5. **オプトアウト権**
   - 随時 Pro Private にアップグレード可能 (日割り精算)
   - 収集済みデータの削除請求可 (30 日以内対応)
6. **保持期間**
   - 90 日間のみ学習に利用
   - その後は集約統計のみ保持 (個別クエリは削除)

## 6. Pro Private の Zero-Retention 技術的担保

契約書だけでなく、**技術的に証明可能** である必要がある。

| 項目 | 担保方法 |
|---|---|
| 本文をログに書かない | `LOG_BODY=0` 環境変数で強制、CI で検証 |
| ディスク書き込みしない | /tmp 利用禁止、メモリのみ |
| プラン判定 | `X-CAN-AI-Plan: private` ヘッダで切替 |
| サーバー側の確認 | API key → plan mapping を都度検証 |
| client 側の事前 drop | [02-feedback-signal-collection.md §6 6-A](./02-feedback-signal-collection.md) の emitter が plan を見て disable |
| 将来の第三者監査 | SOC 2 Type II 取得を 1 年以内目標 |
| 顧客への証明 | 「Zero-Retention 監査証明書」を年次発行 |

## 7. プラン間の移行

| 移行 | 条件 | 精算 |
|---|---|---|
| Free → Pro Learn | API key 発行 + Stripe 契約 | 月末締め |
| Pro Learn → Pro Private | いつでも可 | 日割り追徴 |
| Pro Private → Pro Learn | 次月から | — |
| Pro → Enterprise | 個別契約 | 個別 |
| ダウングレード | 次月から (日割りなし) | 残日数は維持 |

### データ扱い

- Pro Learn → Pro Private: **既に収集済みの過去データは削除請求可** (30 日以内)
- Pro Private → Pro Learn: 切替時点以降のデータが収集対象 (過去に遡らない)

## 8. Enterprise 契約の標準構成

以下を含む個別契約:

- **NDA** (秘密保持契約)
- **Zero-Retention 条項** + 第三者監査証明書
- **監査ログ配信** (S3 bucket に日次 export)
- **SLA 99.9%** + 違反時の SLA クレジット
- **専任サポート** (Slack Connect チャンネル)
- **オンプレ / VPC 配置オプション** (追加料金)
- **SSO / SAML / SCIM** 対応
- **契約期間**: 年次更新、早期解約条項あり
- **データ移行支援**: 既存 memory system からの移行サポート

## 9. キャッチコピー (マーケティング素材)

- **Pro Learn**: 「**みんなで育てる、日本語コーディング記憶**」 — 安く、賢く、改善の恩恵を受ける
- **Pro Private**: 「**あなたの検索は学習に使われません**」 — 妥協しない
- **Enterprise**: 「**貴社専用のメモリ基盤**」 — フル契約

## 10. 運用上の注意

- **価格は β 期間中に再調整する前提**。競合 (Cursor, Windsurf 等) の動向を watch
- **Pro Learn と Pro Private の比率**: 最終的に 70:20:10 (Learn:Private:Enterprise) を目指す
- **年間契約割引**: 年払い 20% off を次フェーズで導入検討
- **教育機関 / OSS プロジェクト**: 100% 割引の特別枠を用意 (エコシステム投資)

## 11. 関連コンポーネント

- [01-pro-api-concierge-spec.md §3 API エンドポイント](./01-pro-api-concierge-spec.md) — プラン別のエンドポイント公開範囲
- [02-feedback-signal-collection.md §7 プライバシー契約](./02-feedback-signal-collection.md) — データ利用の client 側動作
- [04-weekly-benchmark-regression.md](./04-weekly-benchmark-regression.md) — SLA 担保のための週次ゲート
