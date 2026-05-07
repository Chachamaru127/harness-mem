# Harness-mem Release Process

This document is the maintainer-facing release contract for this repository.

The goal is simple: a release should land in the same shape whether you use the `harness-release` skill or run the steps manually.

## 1. What is the source of truth?

For normal day-to-day changes:

- add user-visible release notes to `CHANGELOG.md` under `## [Unreleased]`
- keep `CHANGELOG_ja.md` as a Japanese summary, not an independent contract

For a shipped release:

1. `CHANGELOG.md` contains the versioned entry
2. `package.json` contains the same version
3. the git tag matches that version (`vX.Y.Z`)
4. GitHub Release uses that same tag/version
5. npm publish exposes that same version

If any of those disagree, the release is not reproducible enough.

## 2. Skill path vs manual path

If your local workflow uses the `harness-release` skill, treat it as an automation wrapper around this checklist.

- The skill is allowed to save time.
- The skill is not allowed to change the release contract.
- If the skill output disagrees with this document, this document wins and the skill should be fixed.

In other words:

- **skill path** = convenience
- **repo docs + workflow contract** = policy

## 3. Pre-flight checks

Before starting a release, make sure all of these are true.

### Working tree

```bash
git diff --quiet && git diff --cached --quiet
```

Why this matters:
- a dirty tree makes it unclear what was actually released
- it becomes hard to reproduce the exact shipped state later

### Version planning

Choose the next version according to semantic versioning:

- `patch`: bug fix, no breaking change
- `minor`: new feature, backward compatible
- `major`: breaking change

### Changelog discipline

Check that user-visible changes are already written under `## [Unreleased]` in `CHANGELOG.md`.

Why this matters:
- release notes should be accumulated during normal work
- the release step should mostly reorganize and ship, not rediscover what changed

### npm auth preflight

If you have rotated `NPM_TOKEN`, changed npm ownership, or just recovered from a failed publish, run the manual auth check workflow before tagging the next release.

Workflow:

- GitHub Actions: `npm Auth Check`
- file: `.github/workflows/npm-auth-check.yml`

What it verifies:

- `NPM_TOKEN` exists in GitHub Actions secrets
- GitHub Actions can authenticate with `npm whoami`
- the token can read collaborator access for `@chachamaru127/harness-mem`
- the package is still marked `public`
- the current repo state can still produce the publish tarball with `npm pack --dry-run`

What it intentionally does **not** do:

- it does not run `npm publish`
- it does not create or modify tags
- it does not replace the real release workflow

Why this matters:

- it lets maintainers verify "the key still opens the door" before a real release
- it separates credential failures from code / package failures
- it prevents the frustrating case where the tag and all tests are green, but publish fails at the last step because the secret was stale or belonged to the wrong npm identity

## 4. Local quality gate

Run the quality checks that protect the published package.

Minimum expected checks:

```bash
bash scripts/harness-mem model pull multilingual-e5 --yes
npm test
npm pack --dry-run
```

Why the extra model bootstrap matters:

- the release workflow runs semantic benchmark suites such as `tests/benchmarks/memory-durability.test.ts`
- those suites assume the local ONNX embedding model `multilingual-e5` is available
- without that model, the runtime falls back to a lightweight hash embedding and the benchmark no longer measures the intended quality bar
- GitHub Actions now restores/downloads this model before `npm test`, so local maintainers should use the same precondition when validating a clean machine
- `npm test` itself also relies on the repo's Bun panic mitigation path, so maintainers should run the scripted command instead of replacing it with raw `bun test ...` one-liners

What `npm test` means in this repository:

- it is the maintainer-facing behavior gate
- it already includes the panic-mitigated root test path described in [`docs/TESTING.md`](./TESTING.md)
- it is intentionally different from "one huge `bun test` over everything", because that path can report `0 fail` and then die in Bun teardown

If you need the deeper background or want to report the Bun crash upstream, see [`docs/bun-test-panic-repro.md`](./bun-test-panic-repro.md).

Recommended additional checks when the touched area justifies them:

```bash
bash scripts/harness-mem doctor --json --platform codex --skip-version-check
bun test tests/session-start-parity-contract.test.ts tests/benchmarks/first-turn-continuity.test.ts
```

Why this matters:
- `npm test` protects behavior
- `npm pack --dry-run` protects package contents
- targeted contracts protect release-sensitive wiring claims

### Developer-domain ranking gate (S108-005)

S108-004 selected the `code_token` tokenizer (camelCase / kebab-case / path / issue / PR / command) as the default ranking policy. The release gate is wired through:

- `docs/benchmarks/developer-domain-thresholds.json` — Layer 1 floors (recall@10 ≥ 0.70, bilingual recall@10 ≥ 0.88, search p95 ≤ 50ms)
- `scripts/check-developer-domain-gate.sh` — reads `mode` and the env override `HARNESS_MEM_DEVDOMAIN_GATE=warn|enforce`
- `.github/workflows/release.yml` — invokes the script before publish

Default mode stays `warn` until `ci-run-manifest-latest.json` emits a `dev_workflow_recall` field (tracked under §78-A05 follow-up). Maintainers can flip to enforce locally with `HARNESS_MEM_DEVDOMAIN_GATE=enforce bash scripts/check-developer-domain-gate.sh` and roll back with `HARNESS_MEM_DEVDOMAIN_GATE=warn`. CHANGELOG entry is required only on the manifest emit + enforce flip release; not on tokenizer-internal tweaks.

## 5. Versioning and release notes

When you are ready to ship:

1. move or rewrite `CHANGELOG.md [Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD`
2. add a matching summary entry to `CHANGELOG_ja.md`
3. update `package.json` version to `X.Y.Z`
4. update `package-lock.json` to the same version when it exists

The important part is not the exact editing style.
The important part is that all release surfaces agree on the same version and the same user-facing story.

## 6. Tag and publish contract

This repository's GitHub workflow publishes on `v*.*.*` tags and checks two important things:

1. the tag commit is contained in `main`
2. the tag version matches `package.json`

That means the preferred path is:

```bash
git add CHANGELOG.md CHANGELOG_ja.md package.json package-lock.json
git commit -m "chore: release vX.Y.Z"
git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
git push origin main --tags
```

After that, `.github/workflows/release.yml` is expected to:

- install the CLI prerequisites used by `harness-mem setup` / `doctor` on a fresh Linux runner (`jq`, `ripgrep`)
- build the MCP server runtime before the repository behavior gate, so setup/doctor contract tests do not spend their timeout budget bootstrapping `mcp-server/dist/index.js`
- restore or download the `multilingual-e5` local embedding model before the repository behavior gate
- run the same repository behavior gate as local maintainers (`npm test`)
- run quality gates
- run `npm pack --dry-run`
- publish to npm
- create a GitHub Release

When npm credentials were recently changed, run `.github/workflows/npm-auth-check.yml` manually first. Treat it as a preflight for registry identity, not as a substitute for the release workflow itself.

In practice today, the release workflow also keeps two extra checks separate:

- `harness-mem-ui` test / typecheck
- `memory-server` typecheck

That split is intentional. It keeps the local contract easy to explain while still protecting the UI and the strict TypeScript gate in CI.

## 7. Post-release verification

After the workflow or manual publish finishes, verify the public surfaces.

```bash
npm view @chachamaru127/harness-mem version
gh release view vX.Y.Z
```

What you are checking:

- npm version is the version you intended to ship
- GitHub Release exists for the same tag
- the release notes correspond to the same change set

## 8. If automation fails

Sometimes the release workflow can fail for reasons unrelated to product quality, such as billing issues or temporary registry problems.

When that happens:

1. keep the release contract intact
2. do not silently skip verification
3. if you must do a manual recovery, record that in `CHANGELOG.md` or the release notes

Examples of acceptable manual recovery:

- manually creating the GitHub Release after the tag already exists
- manually publishing to npm after confirming the package and version are correct

Examples of good pre-release diagnostics:

- running the manual `npm Auth Check` workflow after updating `NPM_TOKEN`
- confirming `npm whoami` and package collaborator access on the GitHub runner before tagging

Examples of unacceptable shortcuts:

- publishing a version that does not match `package.json`
- creating notes that do not match the shipped code
- skipping changelog updates because the skill or workflow failed

## 9. Short checklist

Use this when you want the shortest possible release checklist.

1. `CHANGELOG.md [Unreleased]` is up to date
2. `CHANGELOG_ja.md` summary will match the release
3. `package.json` version is correct
4. `npm test` passes
5. `npm pack --dry-run` passes
6. tag = `package.json` version
7. tag commit is on `main`
8. npm and GitHub Release both show the same version
