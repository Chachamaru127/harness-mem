# Granite 埋め込み — ホスト型 serving COGS モデル (2026-06-16)

Pro ZDR 埋め込み endpoint（自前ホスト granite-311m, CPU/VPS, ZDR=in-memory only）の serving COGS を実測値から試算し、Pro 価格($20-40/月)の粗利健全性を判定する。

## 結論

- **共有マルチテナント endpoint なら、Pro $20-40 の serving COGS は全 volume で <6% = 健全**（granite の per-embed 限界費が安い）。
- **専有 VPS をテナントに割り当てた瞬間に破綻**（最小 VPS $12 でも Pro $20 の 60%、L tier 専有なら赤字）。→ **専有 ZDR は Enterprise gate に限定**、Pro には付けない。
- **価格の確信度は medium-low**。理由は throughput 実測が 2 値に大きく乖離し（下記）、concurrency 未実測のため共有 VPS の収容密度が確定しない。

## 測定インプット（実値）

出所: `docs/benchmarks/artifacts/s154-embedding-shadow-ab/operational-cost.json`（154-505, schema `s154-505-operational-cost.v1`）。granite-embedding-311m-r2 / mrl-384（Pro 実構成）:

| 指標 | 実測値 | 注記 |
|---|---|---|
| query p50 / p95 | 10.37ms / 14.63ms | CPU / Apple Silicon, fp32 ONNX |
| throughput (short-obs A/B) | 73.1 /s | 短文 obs 外挿。**過信禁止** |
| throughput (live full-corpus) | **約 5 /s** | 374,660 obs backfill 実測, maxSeqLength=512 raw_text |
| reembed | 22.8分/10万(73/s換算) / **約333分/10万(5/s実測)** | 実測は後者 |
| index size | 14.0 GB (384 dim) | — |

**最大の不確実性**: 同一 artifact 内で throughput が **73/s(短文外挿) と 5/s(live実測) で 14.6倍乖離**。実テナントの平均 obs 長で実効単価が 1桁以上振れる。両前提で COGS を併記する。

## 単価モデル（$/1M embeds）

VPS は時間課金 = 「コア秒の希少性」がコスト。`$/1M = (VPS時給/vCPU) ÷ (throughput × 3600) × 1e6`。代表時給 $0.02/vCPU/h（ASSUMPTION）:

| throughput 前提 | $/1M embeds |
|---|---|
| 5 /s（live・保守） | 約 $1.11 / 1M |
| 73 /s（短文・楽観） | 約 $0.076 / 1M |

→ 純コンピュート限界費は両前提とも安い。**COGS を支配するのは VPS 常時確保の固定費**で、per-embed 限界費ではない。

## VPS tier × 収容（ASSUMPTION）

> VPS 月額・throughput スケールは仮定（2026 JP-region CPU VPS 相場感）。実測ではない。

| tier | 構成 | 月額(仮) | 単一プロセス上限 | 注記 |
|---|---|---|---|---|
| S | 2 vCPU / 4 GB | $12 | 5-73 /s | — |
| M | 4 vCPU / 8 GB | $24 | 5-73 /s(1proc) | index 14GB は載らない |
| L | 8 vCPU / 16 GB | $48 | 5-73 /s(1proc) | hot index 同居なら実下限 |

保守注記:
- **単一 ONNX プロセスは vCPU を増やしても throughput が上がらない**。tier 上げの意味は並列プロセス/テナント収容数のみ。
- **concurrency 線形外挿(×vCPU)は楽観**。intra-op スレッド競合・メモリ帯域・fp32 演算密度で sublinear。実効は下振れ。
- ZDR は disk cache 禁止だが、embed は stateless（index は顧客ストレージ）なので embed プロセス常駐 RAM は数百MB〜1GB級想定。同一 VPS に hot index を置くなら L tier が下限。

## $/テナント/月（ASSUMPTION volume）

テナント月間 embed 量を低=15k / 中=130k / 高=1.15M（ingest+query）と仮定。共有 VPS(S tier $12)を収容数で按分:

| volume | コア時/月(@5/s) | 1VPS 収容(保守) | $/テナント/月 |
|---|---|---|---|
| 低 15k | 0.83h | 約50 | 約 $0.24 |
| 中 130k | 7.2h | 約100 | 約 $0.12 |
| 高 1.15M | 63.9h | 約11 | 約 $1.09 |

専有が必要な高負荷テナントを L tier $48 に隔離した最悪ケース: $48/テナント/月。

## Pro 粗利判定（@$20 下限）

| シナリオ | serving COGS/月 | COGS% | 判定 |
|---|---|---|---|
| 低/中/高 volume・共有VPS・@5/s | $0.12-1.09 | 0.6-5.5% | 健全 |
| 中 volume・専有 S tier | $12.00 | 60% | 警戒(境界) |
| 高 volume・専有 L tier | $48.00 | 240% | **赤字** |

含意:
- **Pro tier は必ず共有マルチテナント endpoint で出す**。専有 VPS は ZDR/residency を売る **Enterprise($2,000級)でのみ**コスト正当化。
- 月100万 embed 超のヘビーユーザーは共有 VPS の収容を圧迫（@5/s で 11テナント/VPS）。**premium-embedding overage メーター**で固定費按分の増分を回収。overage 単価は原価 $1.11/1M(@5/s)にマージン乗せ $5-10/1M が叩き台。

## 未計測で残る不確実性

1. **concurrency 実測（最大の穴）**: ×vCPU 線形は楽観。共有 VPS 収容数=COGS の生命線が未確定。**価格確信度を縛る最大要因**。
2. **73/s vs 5/s の 14.6倍乖離**: 実テナントの token 分布実測が必要。
3. **GPU/int8 量子化 未比較**: throughput 1桁改善で専有黒字化の可能性、ただし mrl-384 quality 影響 + GPU VPS コスト未計測。
4. **JP-region 割増**: residency を売る Enterprise で顕在化。Pro が JP 強制なら按分分母が上がる。
5. **in-memory only RAM フットプリント**: 高 concurrency 時の tier 選択(8GB vs 16GB)に影響。

## 確信度: medium-low

- measured: query p50/p95, throughput 2値(73/5), index 14GB, reembed, ZDR制約, Pro価格帯。
- assumption: VPS 月額, テナント embed 量, concurrency 線形, 共有収容数, JP割増。
- 一行: per-embed 限界費は安い（measured）が、$/テナント/月を決める共有 VPS 収容密度は assumption（concurrency 実測待ち）で、ここが粗利判定の振れ幅を支配する。

## 次アクション（価格確定の前提工事）

1. granite serving の **concurrency 実測**（並列リクエストでの実効 throughput）。
2. 実テナント obs の **token 長分布**サンプリング（73/s 寄りか 5/s 寄りか確定）。
3. 上記2点が揃えば Pro overage 単価と Enterprise 専有 VPS 価格を確信度 high で確定可能。
