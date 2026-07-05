# S156-006 Embedding Migration E2E Verification

Date: 2026-07-05

Scope:

- fresh setup online path, using `HARNESS_MEM_SETUP_MODEL_PULL_MOCK=success` so CI/sandbox never performs a real 1.2 GB download
- fresh setup offline path, using `HARNESS_MEM_SETUP_MODEL_PULL_MOCK=offline`
- existing DB non-regression through unit/CLI notice suites

## Fresh Online

Command shape:

```bash
HOME="$online_home" HARNESS_MEM_HOME="$online_home" \
  HARNESS_MEM_SETUP_MODEL_PULL_MOCK=success HARNESS_MEM_NON_INTERACTIVE=1 \
  bash scripts/harness-mem setup --platform codex --skip-start --skip-smoke --skip-quality --skip-version-check
```

Result:

- `models/granite-embedding-311m-r2/onnx/model.onnx`: present
- `config.json.embedding_provider`: `auto`
- stdout contained `Granite default model ready`
- fresh core health with a fake installed Granite model reported `embedding_provider=local`, `features.embedding_model=granite-embedding-311m-r2`, and `embedding_migration_notice.required=false` because the seeded flag was already `granite-embedding-311m-r2@384`

## Fresh Offline

Command shape:

```bash
HOME="$offline_home" HARNESS_MEM_HOME="$offline_home" \
  HARNESS_MEM_SETUP_MODEL_PULL_MOCK=offline HARNESS_MEM_NON_INTERACTIVE=1 \
  bash scripts/harness-mem setup --platform codex --skip-start --skip-smoke --skip-quality --skip-version-check
```

Result:

- `models/granite-embedding-311m-r2/onnx/model.onnx`: absent
- stderr contained the later activation command `harness-mem model pull granite-embedding-311m-r2`
- setup exit code was `0`

## Existing DB Non-Regression

Covered by:

```bash
TMPDIR="$PWD/.tmp" bun test \
  tests/harness-mem-model-config.test.ts \
  tests/harness-mem-setup-granite.test.ts \
  tests/harness-mem-doctor-embedding-notice.test.ts \
  memory-server/tests/unit/granite-migration-notice.test.ts
```

Result: 10 pass / 0 fail.

Coverage:

- existing DB with observations and incumbent default gets `embedding_migration_notice.required=true`
- health warning is rate-limited while structured notice remains visible
- notice is silent for openai provider, env model pin, dismissed config, obs=0, and already-granite flag
- doctor JSON records `embedding_model.status="warn:granite_migration_available"` on every run
- `model use` now syncs LaunchAgent embedding provider/model env
