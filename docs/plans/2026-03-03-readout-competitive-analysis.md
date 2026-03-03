# Readout 競合分析レポート（2026-03-03）

## 結論

**Readout は直接競合ではないが、隣接領域の注目プレイヤー。** 脅威度は現時点で **中** 。

- Readout = **観察・可視化ダッシュボード**（読み取り専用）
- harness-mem = **記憶・永続化ランタイム**（読み書き + クロスツール共有）

コア課題が異なるため直接競合ではないが、「AI コーディングツールの companion アプリ」という市場カテゴリで隣接しており、機能拡張の方向次第では将来的に競合関係が強まる可能性がある。

---

## Readout プロファイル

| 項目 | 内容 |
|---|---|
| URL | <https://www.readout.org/> |
| 開発者 | Benji Taylor (@benjitaylor) |
| バージョン | v0.0.6（Beta） |
| サイズ | 19.8 MB |
| プラットフォーム | macOS のみ（ネイティブアプリ） |
| 価格 | 無料（Beta 期間） |
| アカウント | 不要、完全ローカル |
| 対応ツール | Claude Code（Codex サポート予定） |
| ステータス | 「growing extremely fast」（開発者談、2026-03-01） |
| 開発者背景 | Coinbase Head of Design (Base), Dip 共同創業者, agentation (GitHub 2,594 stars) 作者 |
| ソースコード | クローズドソース（GitHub リポジトリなし） |
| SNS 反響 | 初回発表: **366,400 views / 2,800 likes / 3,400 reposts**、Session Replay 発表: **288,600 views / 2,800 likes** |

### 主要機能

1. **Repos** — リポジトリ一覧・状態表示
2. **Costs** — 開発コスト追跡
3. **Sessions** — セッション監視
4. **Dependencies** — 依存関係の俯瞰
5. **Config** — Claude Code 設定の確認
6. **Session Replay** — 過去の Claude Code セッションをタイムライン再生（プロンプト、ツールコール、ファイル変更を可視化。再生速度変更・ステップ実行対応）

### Readout にないもの

- メモリの永続化・蓄積
- クロスツール記憶共有
- 検索エンジン（ハイブリッド検索、ベクトル検索）
- MCP サーバー
- SDK / API
- コンソリデーション（事実抽出）
- プライバシータグ制御
- Resume Pack
- マルチプラットフォーム（macOS 以外）

---

## 比較採点（10 点満点）

| 評価軸 | harness-mem | Readout | 備考 |
|---|---|---|---|
| **UI/UX（見た目・操作性）** | 6 | 9 | Readout はネイティブ macOS アプリで洗練された UX。Session Replay は特に秀逸。harness-mem は Web UI + CLI で機能的だが polish 度で劣る |
| **マルチツール対応** | 10 | 3 | harness-mem は 6 プラットフォーム対応済み。Readout は Claude Code のみ（Codex 予定） |
| **記憶・永続化** | 10 | 0 | Readout に記憶機能はない。harness-mem の中核機能 |
| **検索** | 10 | 1 | harness-mem は 6 シグナルハイブリッド検索 + クエリルーティング。Readout は基本的な UI フィルタのみ |
| **セッション管理** | 8 | 8 | 両者強い。harness-mem はライフサイクル管理 + Resume Pack。Readout はセッションリプレイが独自の強み |
| **環境可視化** | 7 | 9 | Readout の核心機能。repos, costs, deps, config を一画面で。harness-mem も Environment タブがあるが副次機能 |
| **コスト追跡** | 2 | 8 | Readout はコストダッシュボードが主要機能。harness-mem にはコスト追跡がほぼない |
| **拡張性（SDK/API/統合）** | 10 | 1 | harness-mem は TS SDK, Python SDK, LangChain, MCP, VS Code ext。Readout はスタンドアロンアプリ |
| **プライバシー制御** | 9 | 7 | 両者ローカルファースト。harness-mem は block/private/redact タグ + 監査ログで粒度が細かい |
| **プラットフォーム** | 9 | 4 | harness-mem はクロスプラットフォーム（Bun/Node）。Readout は macOS 限定 |
| **導入の簡単さ** | 7 | 10 | Readout はダウンロードして起動するだけ。harness-mem は `setup` コマンドがあるが daemon + MCP 設定が必要 |
| **成熟度** | 6 | 3 | harness-mem v0.2.1（286 テスト）。Readout v0.0.6（ベータ初期） |
| **成長速度・バズ** | 5 | 8 | Readout は「growing extremely fast」。ネイティブアプリの手軽さとセッションリプレイの visual appeal が話題に |

### 総合スコア

| | harness-mem | Readout |
|---|---|---|
| **合計（130 点中）** | **99** | **71** |
| **平均** | **7.6** | **5.5** |

---

## SWOT 対比

### harness-mem の強み vs Readout

| 強み | 説明 |
|---|---|
| クロスツール記憶共有 | Readout にはない機能。6 ツール対応は業界唯一 |
| ハイブリッド検索 | FTS5 + ベクトル + 6 シグナルランキング |
| SDK / API エコシステム | プログラマティックアクセスが可能 |
| クロスプラットフォーム | macOS 限定ではない |
| claude-mem 移行パス | 既存ユーザー獲得の導線 |

### Readout の強み vs harness-mem

| 強み | 説明 |
|---|---|
| ネイティブ macOS UX | ダウンロード → 起動で完結。friction ゼロ |
| Session Replay | タイムライン再生は直感的で visual appeal が高い |
| コストダッシュボード | 開発コスト可視化は実務ニーズが強い |
| バズ / 成長速度 | 話題性が高く、ユーザー獲得が速い |
| 参入障壁の低さ | 「見るだけ」なので導入リスクゼロ |

---

## 脅威シナリオ

### 短期（0-3 ヶ月）: 脅威度 **低**

- Readout は read-only ダッシュボードであり、harness-mem のコア機能（記憶・検索・共有）と重複しない。
- 共存可能。harness-mem ユーザーが Readout も併用するシナリオは自然。

### 中期（3-6 ヶ月）: 脅威度 **中**

- Readout が Codex サポートを追加し、マルチツール対応に進む場合。
- セッションデータを蓄積・検索する機能を追加する場合、harness-mem の一部領域と競合。
- ネイティブ UX の優位性でユーザーの「最初の接点」を奪われる可能性。

### 長期（6 ヶ月以上）: 脅威度 **中〜高**

- Readout がメモリ永続化・クロスツール共有に進出すれば直接競合。
- ネイティブアプリ + 既存ユーザーベースの組み合わせは手強い。
- ただし、harness-mem の 6 シグナル検索・MCP サーバー・SDK エコシステムを追いつくのは容易ではない。

---

## 推奨アクション

### 学ぶべき点

1. **Session Replay 機能** — harness-mem の Mem UI にタイムライン再生を追加する価値がある。セッション詳細データは既に保持しており、UI 実装で差を埋められる。
2. **コストダッシュボード** — API コスト追跡は実務ニーズが高い。Environment タブの拡張として実装検討。
3. **導入 friction の最小化** — Readout の「ダウンロード → 起動」体験を意識し、`harness-mem setup` の UX をさらに磨く。
4. **Visual appeal** — ネイティブアプリ品質とまではいかなくても、Mem UI のデザイン品質向上は差別化に寄与。

### 守るべき優位性

1. **マルチツール対応** — Readout が 1-2 ツールの間に 6 ツール対応を完成・安定させる。
2. **検索品質** — LoCoMo ベンチマークでの品質証明を推進。Readout には検索がない。
3. **SDK / API** — 開発者が harness-mem のエコシステムに依存する構造を作る。
4. **MCP 標準** — MCP サーバーとしての存在感を固める。

---

## 参考リンク

- [Readout 公式サイト](https://www.readout.org/)
- [Benji Taylor / Readout 発表ツイート](https://x.com/benjitaylor/status/2027419120258683344)
- [Session Replay 機能発表](https://x.com/benjitaylor/status/2027902450049708385)
- [Codex サポート予定の言及](https://x.com/benjitaylor/status/2028177129721217524)
