# agentmemory 再採点 — §81 (S81-A〜D 実装済) 状態

**策定日**: 2026-04-14
**対象**: `rohitg00/agentmemory` v0.8.6 (pushedAt 2026-04-13)
**ベースライン**: 2026-04-14 策定時点の 15 軸フラット採点 (§81 計画段階)

## 要約

| 採点 | §81 計画時 | §81 実装後 (本採点) | Δ |
|---|---:|---:|---:|
| **harness-mem** | **109 / 150** | **125 / 150** | **+16** |
| **agentmemory** | **121 / 150** | **121 / 150** | ±0 |
| 差分 | agm +12 | **mem +4** | 逆転 |

§81 Global DoD #4 (`mem ≥ 121` で agm と同点以上) **達成**。

## 再採点表

| 軸 | mem (計画時) | mem (本採点) | agm | Δ (mem) | 根拠 |
|---|:---:|:---:|:---:|:---:|---|
| 1. Performance & footprint | 9 | 9 | 6 | — | Go cold start ~5ms / 7MB binary 維持 |
| 2. MCP tool surface breadth | 7 | 8 | 9 | +1 | `harness_mem_verify` 追加で tool 数 52→53、citation trace 覆う |
| 3. Multi-agent coordination | 3 | **9** | 9 | **+6** | S81-A02 lease / A03 signal / A01 worktree unifier / A04 doctor で agm 同等 |
| 4. Retrieval quality (ドメイン内) | 8 | 8 | 8 | — | §81 では retrieval は直接触っていない |
| 5. Consolidation / lifecycle | 7 | **9** | 9 | **+2** | S81-B02 low-value eviction + B03 contradiction detection + B01 統合整理 |
| 6. Ingest source coverage | 9 | 9 | 5 | — | Claude/Codex/Cursor/Gemini/Antigravity/Notion/GDrive/URL/document/audio 維持 |
| 7. Local storage (SQLite + PG dual) | 9 | 9 | 7 | — | 不変 |
| 8. Privacy / Security | 8 | 8 | 8 | — | 不変 |
| 9. Provider fallback / resilience | 7 | **9** | 9 | **+2** | S81-D01 circuit breaker (cooldown + half-open probe) + S81-C02 Claude Agent SDK provider |
| 10. Benchmark rigor | 9 | 9 | 8 | — | committed JSON + 3-run PASS gate 維持 |
| 11. Observability / UI | 7 | 7 | 7 | — | §81 では UI 強化なし |
| 12. Installer UX | 8 | 8 | 8 | — | S81-C01 tool tiering は細目改善、大きな差は出ない |
| 13. Governance / audit | 7 | **8** | 8 | **+1** | S81-C03 verify で citation trace 公開、forget policy の audit log 追加 |
| 14. Developer workflow primitives | 3 | **7** | 9 | **+4** | S81-A02/A03 で lease/signal 導入。agm の actions/routines/sentinels/crystallize 水準 (9) には未達、lease+signal 基盤層まで (7) |
| 15. Documentation | 8 | 8 | 8 | — | README dual-agent 節追加だが採点変動なし |

**mem 合計**: 9+8+9+8+9+9+9+8+9+9+7+8+8+7+8 = **125**
**agm 合計**: 9+9+9+8+9+5+7+8+9+8+7+8+8+9+8 = **121**

## §81 による点上昇の内訳

| 軸 | 点 | 主な根拠コミット |
|---|---:|---|
| 3. Coordination | +6 | `b24f3a0` A01 / `0ff5b81` A02+A03 / `a70d587` A04 / `ddb22a4` fix |
| 14. Workflow primitives | +4 | `0ff5b81` lease + signal |
| 5. Lifecycle | +2 | `9d00084` eviction / `cebeffe` contradiction / `557fe37` 統合整理 |
| 9. Resilience | +2 | `8474c15` circuit breaker / `1cb7a3e` agent-sdk provider |
| 2. MCP surface | +1 | `575c477` verify tool |
| 13. Governance | +1 | `575c477` verify / `9d00084` forget policy audit |
| **合計** | **+16** | 11 本の §81 commit |

## 未採点で上げ切れなかった軸

### 14 軸 Workflow primitives (mem 7 / agm 9) — +2 ギャップ

agm が持つ以下の原子は mem にまだない:
- **Actions / Frontier** — 未解決タスクの priority queue と "次の一手" API
- **Crystallize** — 完了 action chain の narrative 要約
- **Sentinels** — webhook / threshold / pattern イベント watcher
- **Sketches** — ephemeral action graph
- **Routines** — 再利用可能 workflow テンプレート

取り込み候補として §82 以降で検討する価値あり。mem の "developer-workflow" ドメインと強い親和性。

### 11 軸 Observability / UI (両者 7) — 横並び

agm は port 3113 の realtime viewer、mem は `harness-mem-ui` (Vite app)。UX の方向性が違うので直接比較は難しいが、開発者向け内観ツールとしては両者 7 で妥当。§82 以降で viewer SSE ストリーム追加を検討可能。

## 採点方針の透明性

1. **ドメイン別評価を維持**: LoCoMo-style 汎用ライフログでの直接比較は意図的に除外 (§78-A02 pivot 準拠)。軸 4 の retrieval は各自ドメイン内評価
2. **自己採点なので加点保守的**: §81 で手が入った軸のみ上げる。手が入らない軸は維持
3. **コミット根拠を必須**: 各 +N は該当する git commit に紐付く。根拠なき加点は避ける

## Global DoD #4 達成確認

§81 Global DoD:
> 4. §81 全 task 完了後、agentmemory との 15 軸再採点で mem が ≥ 121 点 (agm と同点以上) に到達

**結果: mem 125 ≥ 121 ✓**

余裕度 +4。mem 内で次に攻めるべき軸は Workflow primitives (14, 現 7) と Observability (11, 現 7)。
