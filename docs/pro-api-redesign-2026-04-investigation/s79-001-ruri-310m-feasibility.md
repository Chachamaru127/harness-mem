# S79-001: ruri-v3-310m ローカル実行可能性調査

Date: 2026-04-11
Scope: harness-mem が `cl-nagoya/ruri-v3-310m` (310M / 1024-dim / ~1.2GB) をローカル ONNX
で実際にロード・推論できるか、既存コード経路で現実的かを読み取り調査する。

## What I verified

1. **Catalog エントリは登録済みだがテスト通過レベル**
   - `memory-server/src/embedding/model-catalog.ts:26-35` に
     `id=ruri-v3-310m, onnxRepo=cl-nagoya/ruri-v3-310m, dimension=1024, sizeBytes=1.2GB,
     queryPrefix="query: ", passagePrefix="passage: "` が定義済み。
   - `memory-server/tests/unit/embedding-provider.test.ts:126-131` は catalog entry の存在
     / dimension=1024 のみ検証。実モデルロードテストは無し。

2. **ダウンローダは `onnx/model.onnx` 固定パスに依存**
   - `memory-server/src/embedding/model-manager.ts:22` で `ONNX_FILE = join("onnx", "model.onnx")`。
   - `pullModel()` (`model-manager.ts:118-147`) は `onnxRepo` から `onnx/model.onnx` を1ファイル
     だけ取得、`tokenizerRepo` から `config.json / tokenizer.json / special_tokens_map.json /
     tokenizer_config.json` を取得する (`model-manager.ts:15-20, 128-144`)。
   - 30M の設計上は `WariHima/ruri-v3-30m-onnx` が ONNX 本体、`cl-nagoya/ruri-v3-30m` が
     正しい tokenizer という非対称を吸収するために `onnxRepo` と `tokenizerRepo` が分離
     されている (`Plans-2026-02-26.md:1510-1511`)。
   - 310m は `onnxRepo = tokenizerRepo = cl-nagoya/ruri-v3-310m` と同一 repo に設定。
     **公式 repo に `onnx/model.onnx` が実在する前提**で動く。実在しなければ `pullModel`
     が 404 で失敗する (`model-manager.ts:62`)。

3. **推論ランタイム (transformers.js v3.8.1) は ModernBert 対応済み**
   - `memory-server/src/embedding/local-onnx.ts:199-226` で `AutoTokenizer` + `AutoModel`
     を local_files_only で読み込み、手動 mean pooling + L2 normalize。
   - `extractHiddenStates()` (`local-onnx.ts:81-117`) は `[seq, hidden]` / `[batch, seq, hidden]`
     両対応。出力キーは `last_hidden_state | output | token_embeddings` を順に試す
     (`local-onnx.ts:293`)。30m (Ruri) が `output` キーで動いた実績あり → 310m も同じ
     ModernBert 系なら互換の公算大。
   - 依存は `@huggingface/transformers@^3.8.1` (`memory-server/bun.lock:8,25`)、
     runtime は `onnxruntime-node@1.21.0`。

4. **CLI の `harness-mem model pull` は bash 側の独立カタログで弾く**
   - `scripts/harness-mem:4303-4310` の `MODEL_CATALOG_IDS` に **`ruri-v3-310m` が無い**。
   - `scripts/harness-mem:4400-4412` の `pull` subcommand がこの配列で validate しており、
     `harness-mem model pull ruri-v3-310m` は `fail "Unknown model id"` で即終了する。
   - 一方 bash は内部で `ModelManager.pullModel` を bun --eval 経由で呼ぶ
     (`scripts/harness-mem:4441-4450`)。ランタイム実装自体は TS catalog を参照するので、
     bash 配列を拡張すれば CLI 経由の DL は動く見込み。

## Unknowns / risks

- **公式 `cl-nagoya/ruri-v3-310m` の ONNX 変換が存在するかは未確認**（本 SOW は DL 禁止）。
  `Plans.md:685` 自身が「HuggingFace 公式 ONNX がなければ Pro API のみで提供、ローカルは
  30m を維持」をリスク緩和策として明記している。これは未解決のまま残っている。
- **Tokenizer 互換性**: 30m で既知の `WariHima/ruri-v3-30m-onnx` の `tokenizer.json` が
  WordPiece 誤変換だった前例 (`Plans-2026-02-26.md:1510`) がある。310m 公式 repo の
  `tokenizer.json` がコミュニティ ONNX 変換物ではなく元の sentencepiece/BPE フォーマット
  であることを事前確認する必要がある。
- **Opset / onnxruntime-node 1.21 互換性**: 310m が opset>=20 やカスタム op を使っていた
  場合、1.21.0 では `InvalidGraph` で落ちる。30m で検証済みのパスなので ModernBert 標準
  なら通る見込み。
- **メモリフットプリント**: 1.2GB の重みを fp32 で載せると推論時 RSS は ~1.5GB+、fp16
  量子化版があれば ~600MB。harness-mem は常駐 server なので現行 30m (~200MB RSS) との
  差は体感できる。現状の cache (`local-onnx.ts:125-196`) は埋め込みベクトルキャッシュで
  あって重み共有ではないため、Worker や MCP 子プロセスが複数起動するとメモリ消費が線形
  増加する。
- **Sync embed interface の warm-up 時間**: 30m は 0.3 秒ロード / 2.5ms/件推論
  (`Plans-2026-02-26.md:1512`)。310m は経験的に 10x 前後 (30ms/件) + ロード 2-3 秒が見込
  まれ、`embedSync` の prime_required フォールバック経路
  (`local-onnx.ts:228-257`) のヒット率が悪化する可能性がある。

## Next actions

1. (read-only) HF hub API で `cl-nagoya/ruri-v3-310m` の `onnx/` ディレクトリと
   `tokenizer.json` フォーマットを確認する。→ 存在しなければ `onnxRepo` を別途用意する
   (cl-nagoya 非公式 ONNX / 自前変換) 必要あり。
2. 310m の ONNX が存在する場合、`scripts/harness-mem:4303-4342` の bash 配列に 310m
   エントリを追加し、`harness-mem model pull ruri-v3-310m --yes` を手動で 1 度だけ
   走らせて RSS と推論レイテンシを計測する。
3. 存在しない場合は `Plans.md:685` の決定に従い、**ローカル 310m は諦めて Pro API
   経由のみ**にし、catalog エントリに `localAvailable: false` 相当のフラグを立てるか、
   catalog から外すかを S79 オーナーに提案する。
4. 実ロードが通った段階で、embedding-provider.test.ts に 310m の実ロード / 1024-dim
   ベクトル生成 smoke テストを `describe.skipIf(!installed)` で追加する。
