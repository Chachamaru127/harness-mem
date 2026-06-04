# LoCoMo Official Dataset

## Source

- Repository: [snap-research/locomo](https://github.com/snap-research/locomo)
- File: `data/locomo10.json`
- Raw URL: `https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json`

## License

Follow the license in the upstream repository. Do not commit the raw dataset into this
repository.

## Local placement

Download to a gitignored path:

```bash
mkdir -p .tmp/locomo
curl -fsSL \
  https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json \
  -o .tmp/locomo/locomo10.json
```

`.tmp/` is already gitignored at repo root.

## Loader contract

`tests/benchmarks/locomo-loader.ts` accepts:

- Normalized `{ sample_id, conversation[], qa[] }` arrays
- Official raw shape with `session_N` conversation objects and `adversarial_answer` for cat-5

Smoke fixture: `tests/benchmarks/fixtures/locomo10.sample.json`
