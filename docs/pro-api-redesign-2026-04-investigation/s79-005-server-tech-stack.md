# S79-005: Pro API Server Tech Stack Evaluation

**Scope**: Pick a tech stack + deployment target for `canai-ops/harness-mem-pro-api`, a small HTTPS server that serves Japanese embeddings from `cl-nagoya/ruri-v3-310m` (~315M params, ~1.2GB on disk) to harness-mem clients.
**Status**: Research only. No implementation.
**Date**: 2026-04-11.

---

## 1. Tech stack comparison

All latency/cold-start numbers are **rough estimates** for a 2 vCPU / 4GB shared-CPU machine unless otherwise noted. Benchmark on real hardware before locking in.

| Dimension | Node.js + `@huggingface/transformers` (transformers.js) | Python + HF Transformers (PyTorch) | Go + `onnxruntime-go` |
|---|---|---|---|
| Cold start (process up + model loaded) | ~8–15s (est.) — v8 startup fast, but WASM/ORT-web init + 1.2GB load is the bottleneck | ~10–20s (est.) — interpreter + torch import is ~2–4s, then model load | ~3–6s (est.) — static binary + mmap-friendly ONNX load |
| Inference latency per request (single short JP sentence, CPU) | ~300–800ms (est., likely slowest; ort-web backend ~2–4x slower than native ORT for mid-size transformers) | ~150–400ms (est., PyTorch CPU reference) | ~100–250ms (est., native ORT CPU, typically fastest) |
| Ops complexity | Low — single-language with rest of harness-mem, `bun`/`pnpm`, one Dockerfile | Medium — separate runtime, `uv`/`pip`, needs its own CI path; torch wheels are large (~800MB image layer) | Medium-high — must export ONNX first, maintain ONNX pipeline, tokenizer story is awkward (no first-class JP tokenizer in Go) |
| Team familiarity | High — Node/TS is primary stack | Low-medium — team can read Python but has less ops experience | Medium — team ships one Go MCP server, but not ML-in-Go |
| GPU support | Limited (WebGPU experimental; no CUDA on server) | Excellent (CUDA/ROCm/MPS) | Good (CUDA EP), but adds deploy complexity |
| HF ecosystem compatibility | Medium — covers most encoder models; ruri-v3 is ModernBERT-Ja, **needs verification that transformers.js supports it** | Highest — reference implementation, any HF model "just works" | ONNX-only — community ONNX exports of ruri-v3-310m already exist on HF (`sirasagi62`, `khaangnguyeen`, `mochiya98`, `keitokei1994`), reducing export risk |
| Pros | Same language as harness-mem core; trivial to share types/config with clients | Reference quality, easiest to swap models, best quantization toolchain (bitsandbytes, optimum) | Fastest cold start, smallest image (~50–80MB + model), ideal for scale-to-zero |
| Cons | Slowest inference on CPU; ModernBERT-Ja support unverified; harder to profile | Heaviest image; team has least ops muscle here; overkill for one endpoint | JP tokenizer (sentencepiece / ModernBERT-Ja tokenizer) in Go is not turnkey; another language to maintain |

---

## 2. Deployment target comparison

Cost estimates assume a single always-on instance sized to hold ruri-310m (~1.5–2GB RAM headroom needed) serving a few QPS. Prices in USD, **rough**, based on April 2026 public pricing pages.

| Target | Monthly cost (est.) | JP region | Cold start story | Ops burden |
|---|---|---|---|---|
| **Fly.io** (`performance-2x`, 2 CPU / 4GB, NRT) | ~$40–60 (est.; ~$0.0000258/s CPU + $5/GB RAM/mo + bandwidth) | Yes — NRT (Tokyo) | Keep 1 machine running; mini-scale-to-zero via `auto_stop_machines` but wake = full reload (~10s+) | Low — `fly deploy`, persistent volume for model, familiar Docker workflow |
| **Google Cloud Run** | ~$25–70 (est.) if always-warm (`min-instances=1`); ~$5–15 if scale-to-zero but painful UX | Yes — `asia-northeast1` (Tokyo) | Cold start with 1.2GB model in-memory is ~8–30s+. Startup CPU Boost helps but doesn't eliminate | Low — fully managed, but request-scoped CPU model mismatches a long-lived embedding server |
| **Railway** | ~$20–40 (est.; $5 base + usage, 2GB RAM plan) | No JP region (closest: US-West or EU) — adds ~120–180ms RTT to JP users | Similar to Fly — keep instance warm | Lowest — pushes closest to Heroku-style UX, but region pain is a dealbreaker |
| **Self-hosted VPS** (Hetzner CPX21, 3 vCPU / 4GB) | ~$8–10 (€7.99/mo post-April-2026 adjustment, est.) | No JP region (closest: Singapore → ~70–90ms to Tokyo; EU → ~230ms) | No cold start (always on) | High — OS patching, TLS, fail2ban, monitoring all manual. Sakura Internet has a Tokyo region but ops story is Japanese-only |

---

## 3. MVP recommendation

**Stack**: **Python + HuggingFace Transformers (PyTorch CPU)**, served via FastAPI + uvicorn, packaged as a Docker image.
**Deployment**: **Fly.io `performance-2x` in NRT (Tokyo)**, with a persistent volume holding the model weights and `min_machines_running = 1`.

Rationale (4 sentences): (1) ruri-v3-310m is a ModernBERT-Ja model and the **reference PyTorch path is the only one guaranteed to work today** without doing an ONNX export or validating transformers.js ModernBERT support — we remove one entire risk axis for the MVP. (2) Fly.io NRT gives us sub-20ms RTT from JP harness-mem users, a persistent volume so the 1.2GB model loads from local disk (not cold-pulled from HF every boot), and a Docker UX the team already knows. (3) The cost difference vs. a Hetzner VPS (~$40 vs. ~$10) is negligible at MVP scale and buys us full managed TLS, metrics, and rolling deploys. (4) If CPU inference proves too slow under real load (>500ms p95), we have a clear optimization ramp: switch to a pre-exported ONNX model behind the same Python API (community ONNX exports already exist on HF), then later to `onnxruntime-go` if we need to push further.

---

## 4. Rejected options (brief)

- **Node.js + transformers.js**: Rejected because (a) ModernBERT-Ja support in transformers.js is unverified as of April 2026, (b) transformers.js CPU inference on 300M+ encoders is widely reported as materially slower than native PyTorch/ONNX, and (c) the single-language argument is weaker than it looks — this is an isolated HTTPS server, not an in-process library. Revisit if we ever need to run ruri *in the browser / in a Worker*.
- **Go + onnxruntime-go**: Rejected for MVP because (a) we must first produce or trust a third-party ONNX export of ruri-v3-310m, (b) the JP tokenizer story in Go (ModernBERT-Ja tokenizer / sentencepiece) is not production-grade, and (c) the cold-start advantage is mostly wasted on an always-on instance. Strong candidate for **v2** once the MVP has real load numbers and we want to optimize latency/footprint.
- **Google Cloud Run**: Rejected because a 1.2GB in-memory model is an anti-pattern for request-scoped scale-to-zero; keeping `min-instances=1` removes Cloud Run's main advantage and the cost converges on Fly.io anyway.
- **Railway**: Rejected purely on region — no JP presence, and ~120–180ms extra RTT kills the user-perceived win from using a higher-quality embedding model.
- **Self-hosted VPS (Hetzner / Sakura)**: Rejected for MVP on ops burden. Hetzner has no JP region; Sakura has Tokyo but requires Japanese-only ops tooling that the team hasn't used. Revisit if monthly costs become a concern at scale.

---

## 5. Open questions to measure before locking in

1. **ruri-v3-310m output dimension**: Task brief says 1024-dim, but the HF model card (`cl-nagoya/ruri-v3-310m`) specifies **768-dim**. Confirm which is correct — this changes downstream vector schema in harness-mem.
2. **Real CPU inference latency** on a Fly.io `performance-2x` in NRT, measured on: (a) single short JP sentence (~30 tokens), (b) batch of 8, (c) long context (~2000 tokens). Target: p95 < 500ms for single-sentence.
3. **Cold start on real hardware** — how long from `fly machine start` to first 200 OK? Need this to decide whether to run `min_machines_running = 1` or accept a ~10s wake penalty on first request after idle.
4. **transformers.js ModernBERT-Ja support** — is it actually viable? A single afternoon of benchmarking would tell us whether the Node option is genuinely dead or just underrated.
5. **Memory headroom** — does ruri-v3-310m stay under 2.5GB RSS in PyTorch CPU mode with FP32? If not, we need `performance-4x` or FP16/quantization, which affects both cost and latency estimates above.
6. **Egress cost** — for harness-mem Pro users calling the API at moderate volume, how much of the Fly.io monthly bill ends up being bandwidth vs. compute? Not modeled above.

---

## Sources

- [cl-nagoya/ruri-v3-310m - Hugging Face](https://huggingface.co/cl-nagoya/ruri-v3-310m)
- [Fly.io Resource Pricing](https://fly.io/docs/about/pricing/)
- [Fly.io Pricing 2026 breakdown (costbench.com)](https://costbench.com/software/developer-tools/flyio/)
- [Google Cloud Run general tips (cold start guidance)](https://docs.cloud.google.com/run/docs/tips/general)
- [Cloud Run startup CPU Boost announcement](https://cloud.google.com/blog/products/serverless/announcing-startup-cpu-boost-for-cloud-run--cloud-functions)
- [Hetzner Cloud Review 2026 (Better Stack)](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/)
- [Hetzner price adjustment (April 2026)](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)
- [CPX21 plan (VPSBenchmarks)](https://www.vpsbenchmarks.com/hosters/hetzner/plans/cpx21)
- [Community ONNX export: sirasagi62/ruri-v3-310m-ONNX](https://huggingface.co/sirasagi62/ruri-v3-310m-ONNX)
- [Ruri paper (arXiv:2409.07737)](https://arxiv.org/abs/2409.07737)
