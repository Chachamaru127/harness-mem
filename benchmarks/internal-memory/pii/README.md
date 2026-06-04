# Real-Data Benchmark Pipeline (§140 Pilot)

PII masking for the real-data benchmark uses Microsoft Presidio when installed,
with a regex fallback in `mask.py` for CI/minimal environments.

## Setup

```bash
cd benchmarks/internal-memory/pii
python3 -m pip install -r requirements.txt
python3 -m spacy download en_core_web_sm  # optional, for Presidio NER
pytest
```

Bulk export uses TypeScript inline masking (`lib/pii-mask-inline.ts`) for speed;
Python Presidio validates masking rules in unit tests.

## Run pipeline

```bash
bun run benchmark:internal-memory:real-data-pipeline
# With OpenRouter judge:
bun run benchmark:internal-memory:real-data-pipeline -- --use-openrouter --env-file /path/to/.env
```

Outputs:
- `datasets/coding-memory-real-ja-mixed-v1.jsonl` — gold benchmark cases (50-100 pilot)
- `datasets/real-data-pilot/masked-corpus.jsonl` — masked corpus rounds
- `datasets/real-data-pilot/review-log.json` — human review log
- `datasets/real-data-pilot/pipeline-manifest.json` — filter/judge stats
