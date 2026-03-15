# ADR-001: Claude Code Auto Memory (MEMORY.md) と harness-mem の棲み分け方針

作成日: 2026-03-15
ステータス: 採用
関連: Plans.md S52-006

---

## 背景

Claude Code v2.1.59+ で Auto Memory 機能がデフォルト有効になった。この機能は `MEMORY.md` ファイルにセッション中の学習内容を自動保存する。harness-mem は同様にセッション横断のメモリ機能を提供しており、機能重複の可能性がある。

### 両システムの比較

| 特性 | Auto Memory (MEMORY.md) | harness-mem |
|------|------------------------|-------------|
| 保存形式 | Markdown ファイル (ローカル) | 構造化 DB (SQLite / PostgreSQL) |
| 検索 | テキストマッチ (Claude のコンテキスト読み込み) | ベクトル検索 + 全文検索 |
| スコープ | プロジェクトごと | プロジェクト横断 + セッション横断 |
| セッション連携 | 同一プロジェクト内のみ | マルチセッション + マルチクライアント |
| 自動記録 | Claude が自動判断して保存 | フックイベント + MCP ツール経由 |
| データ型 | 自由形式テキスト | 型付き observation (event, decision, insight 等) |
| タイムライン | なし | セッション/イベントのタイムライン表示 |
| グラフ構造 | なし | エンティティ間のリレーション |
| 設定 | `autoMemoryDirectory` で保存先変更可 | daemon + MCP サーバー構成 |

---

## 決定

**共存方式を採用する。** 両システムの役割を明確に分離し、相互補完的に運用する。

### 役割分離

- **Auto Memory (MEMORY.md)**: プロジェクトローカルの短期知識メモ
  - プロジェクト固有の規約、パターン、注意点
  - Claude が自動的に学習・参照する軽量な知識ベース
  - ファイルベースのため git 管理可能

- **harness-mem**: セッション横断の長期記憶 + 構造化データ
  - 複数プロジェクト・複数セッションにまたがる知見
  - タイムライン、イベント追跡、チェックポイント
  - ベクトル検索による関連記憶の自動引き出し
  - マルチクライアント (Claude Code, Codex, Gemini CLI 等) 間の共有

### 実装方針

1. **Auto Memory を無効化しない**
   - `autoMemoryEnabled: false` は設定しない
   - MEMORY.md は Claude Code ネイティブの学習機能として活用する

2. **harness-mem は MEMORY.md を参照しない**
   - MEMORY.md を harness-mem にインポート/同期する仕組みは作らない
   - 理由: データモデルが異なり、同期の複雑さに見合う利点がない

3. **harness-mem は構造化データに特化する**
   - セッションイベント、タイムライン、エンティティグラフは harness-mem の独自価値
   - フリーテキストメモは MEMORY.md に任せる

4. **ユーザーへのガイダンス**
   - セットアップ時に両システムの役割を説明する
   - 「MEMORY.md = このプロジェクトのメモ帳」「harness-mem = 全プロジェクトの長期記憶」と案内する

---

## 検討した代替案

### A. Auto Memory を無効化して harness-mem に一本化

- 却下理由: Auto Memory は Claude Code の標準機能であり、無効化するとユーザー体験が劣化する。MEMORY.md は起動時に自動読み込みされるため、プロジェクト固有の知識保持に最も効率的。

### B. MEMORY.md を harness-mem に自動取り込み

- 却下理由: MEMORY.md はフリーテキストで、harness-mem の構造化データモデルとの変換コストが高い。同期タイミングの管理も複雑になる。

### C. harness-mem の記憶を MEMORY.md にエクスポート

- 却下理由: MEMORY.md には行数制限があり (200行で切り詰め)、harness-mem の豊富なデータを収めきれない。

---

## 影響

- harness-mem のセットアップドキュメントに棲み分けの説明を追加する
- harness-mem の MCP ツール説明で「セッション横断の長期記憶」という位置づけを明示する
- Auto Memory の `autoMemoryDirectory` 設定は harness-mem 側で変更しない
