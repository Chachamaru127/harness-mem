# Granite Embedding Migration

This guide covers the `granite-embedding-311m-r2@384` default for new installs and the opt-in migration path for existing installations.

## Fresh Installs

New `harness-mem setup` runs a Granite model preparation step after dependency/runtime checks and before daemon start. The step:

- announces the ~1.2 GB download and Hugging Face network requirement;
- skips with a warning when offline or in CI/sandbox;
- can be disabled with `--skip-model-pull`;
- syncs the LaunchAgent embedding environment to `HARNESS_MEM_EMBEDDING_PROVIDER=auto` and clears the default `HARNESS_MEM_EMBEDDING_MODEL` pin when a plist exists, so the seeded `embedding_default_model` flag can select Granite.

If setup skipped the pull, the daemon can still run through the fail-safe chain: Granite when installed, incumbent `multilingual-e5` when present, then synthetic fallback. Pull later with:

```bash
harness-mem model pull granite-embedding-311m-r2 --yes
```

Raw daemon starts only honor the `embedding_default_model` flag when the provider is `auto`, `local`, or `adaptive`. If `HARNESS_MEM_EMBEDDING_PROVIDER` is unset in a raw launch, the raw default remains `fallback` and the flag is ignored.

## Existing Installs

Existing installs are not flipped automatically. When the daemon sees an existing DB with observations and the current default is unset or the incumbent `multilingual-e5`, it reports a migration notice in:

- `/health` as `embedding_migration_notice`;
- `harness-mem doctor --json` as the `embedding_model` check;
- daemon startup logs, rate-limited.

The notice is silent when you use `openai` or `ollama`, set an explicit model pin, already flipped the flag to Granite, have no observations, or set `notices.granite_migration_dismissed_at` in `~/.harness-mem/config.json`.

## Migration Command

Run the steps when you are ready to backfill vectors:

```bash
harness-mem model pull granite-embedding-311m-r2 --yes
harness-mem admin-vector-backfill start --model granite-embedding-311m-r2 --dimension 384 --reset
bun run scripts/s154-granite-flag-set.ts --execute --to granite-embedding-311m-r2@384
scripts/harness-memd restart
```

Rollback keeps the incumbent model available:

```bash
bun run scripts/s154-granite-flag-set.ts --execute --to multilingual-e5
scripts/harness-memd restart
```

## Dismiss

To hide the existing-install notice without migrating:

```json
{
  "notices": {
    "granite_migration_dismissed_at": "2026-07-05T00:00:00.000Z"
  }
}
```

## License And Artifact Note

The pinned upstream model revision is `44399559930365213510b1ee2eb15ded83374f0e`. The Hugging Face model card declares `apache-2.0`; the pinned tree inspection found no separate `LICENSE` or `NOTICE` file. Harness-mem pins the downloaded ONNX artifact by revision and SHA-256, and fails closed on checksum mismatch.
