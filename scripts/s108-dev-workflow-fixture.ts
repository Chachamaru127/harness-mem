import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

type Difficulty = "easy" | "medium" | "hard";
type QueryFamily =
  | "file"
  | "branch"
  | "pr"
  | "issue"
  | "migration"
  | "deploy"
  | "failing_test"
  | "release"
  | "setup"
  | "doctor"
  | "companion";

type DevWorkflowEntry = {
  id: string;
  content: string;
  timestamp: string;
};

type DevWorkflowCase = {
  id: string;
  description: string;
  difficulty: Difficulty;
  entries: DevWorkflowEntry[];
  query: string;
  expected_answer: string;
  relevant_ids: string[];
  query_family?: QueryFamily;
  category?: QueryFamily;
};

type CaseDraft = {
  n: number;
  family: QueryFamily;
  description: string;
  difficulty: Difficulty;
  query: string;
  expected: string;
  entries: string[];
  relevant: number[];
};

const ROOT_DIR = resolve(import.meta.dir, "..");
const BASE_FIXTURE_PATH = join(ROOT_DIR, "tests/benchmarks/fixtures/dev-workflow-20.json");
const EXPANDED_FIXTURE_PATH = join(ROOT_DIR, "tests/benchmarks/fixtures/dev-workflow-60.json");
const ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s108-dev-workflow-2026-05-07");

const REQUIRED_FAMILIES: QueryFamily[] = [
  "file",
  "branch",
  "pr",
  "issue",
  "migration",
  "deploy",
  "failing_test",
  "release",
  "setup",
  "doctor",
  "companion",
];

const BASE_FAMILIES: Record<string, QueryFamily> = {
  "dw-001": "file",
  "dw-002": "failing_test",
  "dw-003": "failing_test",
  "dw-004": "migration",
  "dw-005": "setup",
  "dw-006": "failing_test",
  "dw-007": "setup",
  "dw-008": "issue",
  "dw-009": "release",
  "dw-010": "failing_test",
  "dw-011": "file",
  "dw-012": "setup",
  "dw-013": "issue",
  "dw-014": "pr",
  "dw-015": "setup",
  "dw-016": "migration",
  "dw-017": "release",
  "dw-018": "pr",
  "dw-019": "failing_test",
  "dw-020": "issue",
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function rel(path: string): string {
  return relative(ROOT_DIR, path);
}

function caseId(n: number): string {
  return `dw-${String(n).padStart(3, "0")}`;
}

function timestamp(n: number, entryIndex: number): string {
  const dayOffset = n - 21;
  const hour = 9 + entryIndex * 2;
  return new Date(Date.UTC(2026, 2, 1 + dayOffset, hour, 0, 0)).toISOString();
}

function makeCase(draft: CaseDraft): DevWorkflowCase {
  const id = caseId(draft.n);
  const entries = draft.entries.map((content, index) => ({
    id: `${id}-e${index + 1}`,
    content,
    timestamp: timestamp(draft.n, index),
  }));
  return {
    id,
    description: draft.description,
    difficulty: draft.difficulty,
    query_family: draft.family,
    category: draft.family,
    entries,
    query: draft.query,
    expected_answer: draft.expected,
    relevant_ids: draft.relevant.map((entryNumber) => `${id}-e${entryNumber}`),
  };
}

const ADDITIONS: DevWorkflowCase[] = [
  makeCase({
    n: 21,
    family: "file",
    description: "changed file for failure notifications",
    difficulty: "easy",
    query: "Which file did we edit for failure notifications?",
    expected: "scripts/notify-on-failure.ts",
    entries: [
      "Updated scripts/notify-on-failure.ts to include the failed job name and retry URL in Slack messages.",
      "Kept .github/workflows/ci.yml unchanged after confirming the notification script already receives GITHUB_RUN_ID.",
      "Verified the failure notification payload locally with HARNESS_MEM_NOTIFY_DRY_RUN=1.",
    ],
    relevant: [1],
  }),
  makeCase({
    n: 22,
    family: "file",
    description: "feature flag cleanup file",
    difficulty: "easy",
    query: "Where did we put the feature flag cleanup logic?",
    expected: "src/flags/cleanup.ts",
    entries: [
      "Created src/flags/cleanup.ts to remove expired feature flags after release promotion.",
      "Left src/flags/index.ts as a thin export surface for cleanupFeatureFlags and readFeatureFlagState.",
      "Added a note that cleanup runs only in maintenance mode, not during user prompt handling.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 23,
    family: "file",
    description: "webhook signature verification file",
    difficulty: "medium",
    query: "Which file has the new Stripe webhook signature verification?",
    expected: "api/webhooks/stripe.ts",
    entries: [
      "Added Stripe signature verification in api/webhooks/stripe.ts before JSON parsing.",
      "Rejected a helper in api/webhooks/shared.ts because raw body access is route-specific.",
      "Regression test posts a bad stripe-signature header and expects HTTP 400.",
    ],
    relevant: [1, 3],
  }),
  makeCase({
    n: 24,
    family: "file",
    description: "workspace isolation fix file",
    difficulty: "medium",
    query: "What file should I inspect for the workspace isolation fix?",
    expected: "memory-server/src/core/project-scope.ts",
    entries: [
      "Fixed strict project filtering in memory-server/src/core/project-scope.ts by canonicalizing worktree paths.",
      "Did not touch memory-server/src/core/privacy-filter.ts; privacy behavior stayed unchanged.",
      "Added a regression note: sibling worktrees must not share observations when strict_project=true.",
    ],
    relevant: [1, 3],
  }),
  makeCase({
    n: 25,
    family: "branch",
    description: "current S108 dev workflow branch",
    difficulty: "easy",
    query: "What branch was used for the S108 developer-workflow fixture work?",
    expected: "codex/s108-dev-workflow-fixture",
    entries: [
      "Started branch codex/s108-dev-workflow-fixture for S108-002 fixture expansion.",
      "Kept Plans.md untouched because the parent integrator owns final S108 status updates.",
      "Scoped writes to dev-workflow fixtures, S108 dev-workflow artifacts, and validation tests.",
    ],
    relevant: [1, 3],
  }),
  makeCase({
    n: 26,
    family: "branch",
    description: "Windows doctor path branch",
    difficulty: "easy",
    query: "Which branch contains the Windows doctor path fix?",
    expected: "codex/windows-doctor-paths",
    entries: [
      "Opened codex/windows-doctor-paths to fix stale absolute path detection on Git Bash.",
      "The branch adds checks for ~/.codex/config.toml and ~/.codex/hooks.json path drift.",
      "Follow-up branch codex/windows-doctor-docs is only for README wording.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 27,
    family: "branch",
    description: "abandoned graph spike branch",
    difficulty: "medium",
    query: "Which branch did we abandon for the graph signal spike?",
    expected: "codex/graph-signal-spike",
    entries: [
      "Paused codex/graph-signal-spike after the prototype required a second graph database.",
      "Decision: keep graph signal work behind HARNESS_MEM_TEMPORAL_GRAPH=1 until SQLite-only design is clear.",
      "New branch codex/local-graph-signal should start from the design note, not the abandoned spike.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 28,
    family: "branch",
    description: "companion contract branch",
    difficulty: "medium",
    query: "What branch carried the companion doctor JSON contract?",
    expected: "codex/companion-doctor-json",
    entries: [
      "Implemented doctor JSON fields on codex/companion-doctor-json.",
      "The branch exposes contract_version and harness_mem_version for the managed companion.",
      "Merged after claude-code-harness verified it did not depend on internal DB paths.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 29,
    family: "pr",
    description: "PR number for Bun runner fix",
    difficulty: "easy",
    query: "Which PR fixed the Bun runner panic wrapper?",
    expected: "PR #214",
    entries: [
      "PR #214 added a safe Bun runner wrapper around benchmark smoke tests.",
      "The fix catches Bun panic output and exits with a clear diagnostic instead of hanging.",
      "PR #214 was merged after rerank-quality-gate.test.ts passed locally.",
    ],
    relevant: [1, 3],
  }),
  makeCase({
    n: 30,
    family: "pr",
    description: "PR for cache invalidation",
    difficulty: "medium",
    query: "Which PR fixed cache invalidation after observation writes?",
    expected: "PR #218",
    entries: [
      "PR #218 changed the search cache key to include the latest observation sequence.",
      "Before PR #218, repeated queries could return stale results after recordEvent.",
      "The PR added a focused test in memory-server/tests/core-split/search-cache.test.ts.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 31,
    family: "pr",
    description: "review request for contract tests",
    difficulty: "medium",
    query: "What did the reviewer request on PR #221?",
    expected: "contract tests for include_private=false",
    entries: [
      "Opened PR #221 for privacy filter cleanup in the MCP search path.",
      "Reviewer requested contract tests for include_private=false before approval.",
      "Added tests proving private observations are excluded from MCP and HTTP search responses.",
    ],
    relevant: [2, 3],
  }),
  makeCase({
    n: 32,
    family: "pr",
    description: "docs blocker PR",
    difficulty: "medium",
    query: "Why was PR #223 blocked?",
    expected: "README_ja.md was not updated",
    entries: [
      "PR #223 changed setup flags for --skip-smoke and --skip-quality.",
      "CI passed on PR #223, but review blocked merge because README_ja.md was not updated.",
      "Follow-up commit synchronized README.md, README_ja.md, and docs/harness-mem-setup.md.",
    ],
    relevant: [2, 3],
  }),
  makeCase({
    n: 33,
    family: "issue",
    description: "duplicate session_end issue",
    difficulty: "easy",
    query: "Which issue tracks duplicate session_end observations?",
    expected: "issue #71",
    entries: [
      "Opened issue #71 for duplicate Codex session_end observations from repeated finalize calls.",
      "The issue labels are bug, ingest, and codex-parity.",
      "Proposed fix is semantic dedup by session_id, observation_type, and content_hash.",
    ],
    relevant: [1, 3],
  }),
  makeCase({
    n: 34,
    family: "issue",
    description: "privacy leak issue",
    difficulty: "medium",
    query: "What is issue #75 about?",
    expected: "private observations appearing when include_private=false",
    entries: [
      "Issue #75 reports private observations appearing when include_private=false.",
      "Reproduction uses one public note and one privacy_tags=['private'] note in the same project.",
      "Root cause is an HTTP search path bypassing applyPrivacyFilter after rerank.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 35,
    family: "issue",
    description: "stale resume pack issue",
    difficulty: "medium",
    query: "Which issue covers stale resume packs on new sessions?",
    expected: "issue #82",
    entries: [
      "Issue #82 covers stale resume packs being injected after a new session starts.",
      "The stale artifact was .claude/state/memory-resume-pack.json from 12 days earlier.",
      "Fix direction: validate generated_at and upstream session identity before suppressing recall.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 36,
    family: "issue",
    description: "package manifest issue",
    difficulty: "medium",
    query: "What was the package manifest issue number?",
    expected: "issue #88",
    entries: [
      "Issue #88 tracks npm package payload drift after mcp-server/dist was omitted.",
      "The issue requires npm pack --dry-run --json evidence before release promotion.",
      "Resolution criterion: package includes scripts, mcp-server/dist, sdk, and docs.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 37,
    family: "migration",
    description: "content hash migration",
    difficulty: "easy",
    query: "Which migration added observations.content_hash?",
    expected: "20260501_add_content_hash.sql",
    entries: [
      "Created migration 20260501_add_content_hash.sql to add observations.content_hash.",
      "Backfill computes sha256 of normalized observation content for semantic dedup.",
      "Rollback drops the content_hash index before dropping the column.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 38,
    family: "migration",
    description: "vector status backfill migration",
    difficulty: "medium",
    query: "Which migration backfills vector_status?",
    expected: "20260502_backfill_vector_status.sql",
    entries: [
      "Prepared 20260502_backfill_vector_status.sql for rows missing vector_status.",
      "Dry-run found 418 observations with embeddings but null vector_status.",
      "The migration is idempotent and updates only rows where vector_status is null.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 39,
    family: "migration",
    description: "semantic dedup migration command",
    difficulty: "medium",
    query: "What command runs the semantic dedup migration plan?",
    expected: "bun run scripts/migrate-db.ts --plan semantic-dedup",
    entries: [
      "Documented semantic dedup dry-run command: bun run scripts/migrate-db.ts --plan semantic-dedup --dry-run.",
      "Execute mode removes --dry-run after the duplicate count matches the migration preflight.",
      "The plan writes a backup under .harness-mem/backups before mutating the database.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 40,
    family: "migration",
    description: "fact edge temporal migration",
    difficulty: "hard",
    query: "Which temporal graph migration is still pending?",
    expected: "fact_edges.valid_from",
    entries: [
      "Deferred migration adding fact_edges.valid_from and fact_edges.valid_to until temporal contract review.",
      "Do not add temporal graph columns before S108-007 defines event_time and valid_from semantics.",
      "Current S108-002 fixture work must not touch temporal migration files.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 41,
    family: "deploy",
    description: "staging deploy target",
    difficulty: "easy",
    query: "What is the staging deploy target for harness-mem?",
    expected: "harness-mem-staging",
    entries: [
      "Staging deploy target is harness-mem-staging for smoke testing daemon API changes.",
      "Production deploy is intentionally skipped for fixture-only benchmark work.",
      "Health check path remains /health after staging deploy.",
    ],
    relevant: [1, 3],
  }),
  makeCase({
    n: 42,
    family: "deploy",
    description: "local runtime deploy command",
    difficulty: "medium",
    query: "What command updates the local runtime and restarts it?",
    expected: "node scripts/harness-mem.js update --restart",
    entries: [
      "Recommended local runtime update command: node scripts/harness-mem.js update --restart.",
      "The command syncs the stable runtime copy and restarts harness-memd if it is running.",
      "After update, run node scripts/harness-mem.js doctor --json --platform codex --skip-version-check.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 43,
    family: "deploy",
    description: "deploy asset failure",
    difficulty: "medium",
    query: "Why did the release deploy fail?",
    expected: "darwin-arm64 asset was missing",
    entries: [
      "Release deploy failed because the darwin-arm64 asset was missing from the upload set.",
      "The linux-x64 and darwin-x64 assets uploaded successfully.",
      "Re-ran the build matrix and verified all four platform assets before publishing.",
    ],
    relevant: [1, 3],
  }),
  makeCase({
    n: 44,
    family: "deploy",
    description: "deployed commit tracking",
    difficulty: "medium",
    query: "Which commit was deployed to staging?",
    expected: "a1b2c3d",
    entries: [
      "Staging deploy completed for commit a1b2c3d with health status healthy.",
      "The deploy included doctor JSON contract changes but no database migration.",
      "Post-deploy smoke checked /health, /stats, and /v1/sessions.",
    ],
    relevant: [1, 3],
  }),
  makeCase({
    n: 45,
    family: "failing_test",
    description: "doctor JSON contract failure",
    difficulty: "easy",
    query: "Which test failed because contract_version was missing?",
    expected: "doctor-json-contract.test.ts",
    entries: [
      "doctor-json-contract.test.ts failed because doctor --json did not include contract_version.",
      "Added contract_version to the JSON payload with value claude-harness-companion.v1.",
      "The focused test passed after adding harness_mem_version and contract_version.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 46,
    family: "failing_test",
    description: "dev workflow recall regression",
    difficulty: "medium",
    query: "Why was dev-workflow recall stuck around 0.54?",
    expected: "BM25 tokenization",
    entries: [
      "dev-workflow recall stayed around 0.54 after manifest emission work.",
      "Failure taxonomy points to BM25 tokenization missing camelCase, kebab-case, path, and PR tokens.",
      "S108-004 should tune code-aware lexical normalization after S108-003 ablation.",
    ],
    relevant: [2, 3],
  }),
  makeCase({
    n: 47,
    family: "failing_test",
    description: "UI memory list failure",
    difficulty: "medium",
    query: "Why did the UI memory list Playwright test fail?",
    expected: "stale fixture seed",
    entries: [
      "Playwright memory list test failed because the stale fixture seed still expected 6 rows.",
      "The UI correctly rendered 7 rows after adding the new resume-pack observation.",
      "Fixed by updating the fixture seed and keeping the selector unchanged.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 48,
    family: "failing_test",
    description: "contextual recall pending skip failure",
    difficulty: "hard",
    query: "Which test covered stale pending_resume_skip behavior?",
    expected: "tests/contextual-recall-contract.test.ts",
    entries: [
      "tests/contextual-recall-contract.test.ts failed when stale pending_resume_skip suppressed a fresh recall.",
      "Fix clears pending_resume_skip after the upstream resume identity no longer matches.",
      "Regression proves the next Codex prompt still emits harness-recall guidance.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 49,
    family: "release",
    description: "latest release tag",
    difficulty: "easy",
    query: "What was the latest release tag in the release note?",
    expected: "v0.18.0",
    entries: [
      "Prepared release note for v0.18.0 after doctor and setup contracts turned green.",
      "v0.18.0 includes Codex wiring repair, companion doctor JSON, and package payload checks.",
      "No README claim changes were included in the release tag.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 50,
    family: "release",
    description: "npm pack blocker",
    difficulty: "medium",
    query: "What blocked the npm release?",
    expected: "mcp-server/dist was missing",
    entries: [
      "npm release blocked because npm pack --dry-run showed mcp-server/dist was missing.",
      "package.json files list was corrected to include the built MCP server output.",
      "Release resumed only after npm pack --dry-run --json showed the expected payload.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 51,
    family: "release",
    description: "Japanese changelog requirement",
    difficulty: "medium",
    query: "Which changelog needed the companion doctor note?",
    expected: "CHANGELOG_ja.md",
    entries: [
      "Added the companion doctor JSON contract note to CHANGELOG.md.",
      "Release review required the same note in CHANGELOG_ja.md before tagging.",
      "Both changelogs mention contract_version and harness_mem_version fields.",
    ],
    relevant: [2, 3],
  }),
  makeCase({
    n: 52,
    family: "release",
    description: "RC promotion source",
    difficulty: "medium",
    query: "Which RC was promoted to the stable release?",
    expected: "v0.18.0-rc.2",
    entries: [
      "v0.18.0-rc.1 failed package payload verification.",
      "v0.18.0-rc.2 passed npm pack, doctor, and focused Codex wiring tests.",
      "Stable v0.18.0 was promoted from v0.18.0-rc.2 without retagging history.",
    ],
    relevant: [2, 3],
  }),
  makeCase({
    n: 53,
    family: "setup",
    description: "Codex setup command",
    difficulty: "easy",
    query: "What setup command should I run for Codex wiring?",
    expected: "harness-mem setup --platform codex --skip-version-check",
    entries: [
      "For Codex wiring, run node scripts/harness-mem.js setup --platform codex --skip-version-check.",
      "The command updates ~/.codex/config.toml and installs the harness-mem skills.",
      "Use --skip-smoke only when daemon startup is intentionally out of scope.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 54,
    family: "setup",
    description: "Codex config destinations",
    difficulty: "medium",
    query: "Which Codex files does setup update?",
    expected: "~/.codex/config.toml and ~/.codex/hooks.json",
    entries: [
      "Codex setup updates ~/.codex/config.toml with the harness MCP server entry.",
      "Codex setup also merges ~/.codex/hooks.json for notification and prompt hooks.",
      "The setup command must preserve unrelated user-defined Codex MCP entries.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 55,
    family: "setup",
    description: "Windows setup shell requirement",
    difficulty: "medium",
    query: "What does Windows setup require?",
    expected: "Git Bash path normalization",
    entries: [
      "Windows setup requires Git Bash path normalization before writing hook command paths.",
      "Without normalization, doctor reports stale absolute paths after moving the repo.",
      "The setup test runs under a simulated Git Bash home directory.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 56,
    family: "setup",
    description: "setup smoke skip flag",
    difficulty: "easy",
    query: "Which flag skips setup smoke checks?",
    expected: "--skip-smoke",
    entries: [
      "Added --skip-smoke for setup runs where daemon health checks are intentionally skipped.",
      "--skip-quality skips benchmark quality checks but still allows daemon smoke checks.",
      "Docs warn that release verification should not use --skip-smoke.",
    ],
    relevant: [1, 3],
  }),
  makeCase({
    n: 57,
    family: "doctor",
    description: "multi DB doctor warning",
    difficulty: "easy",
    query: "What doctor warning appears for multiple databases?",
    expected: "multi_db_warning",
    entries: [
      "doctor --json reports multi_db_warning when plugin-scoped and stable DB files both exist.",
      "The warning does not fail doctor because migration may be pending.",
      "The suggested fix is scripts/migrations/merge-plugin-scoped-dbs.sh --dry-run first.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 58,
    family: "doctor",
    description: "healthy Codex doctor status",
    difficulty: "easy",
    query: "What should Codex doctor report when wiring is healthy?",
    expected: "codex_wiring: ok",
    entries: [
      "Healthy Codex doctor output has status=healthy and all_green=true.",
      "The codex_wiring check reports ok when config.toml, hooks.json, and notify script paths are valid.",
      "failed_count should be 0 in the same JSON response.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 59,
    family: "doctor",
    description: "stale path doctor fix",
    difficulty: "medium",
    query: "How did we fix stale Codex hook paths?",
    expected: "remove old repo paths from ~/.codex/hooks.json",
    entries: [
      "Doctor found stale Codex hook paths pointing at an archived worktree.",
      "Fix was to remove old repo paths from ~/.codex/hooks.json and rerun setup.",
      "After setup, doctor confirmed notify script and MCP entrypoint paths point at the current repo.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 60,
    family: "doctor",
    description: "doctor failed count field",
    difficulty: "medium",
    query: "Which doctor JSON field counts failed checks?",
    expected: "failed_count",
    entries: [
      "Added failed_count to doctor --json so automation can decide whether to block setup.",
      "The field is numeric and counts only failed checks, not warnings.",
      "Warnings remain available under warnings[] for human-readable diagnostics.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 61,
    family: "companion",
    description: "companion contract version",
    difficulty: "easy",
    query: "What is the managed companion contract version?",
    expected: "claude-harness-companion.v1",
    entries: [
      "The managed companion contract version is claude-harness-companion.v1.",
      "harness-mem doctor --json exposes the contract_version field for Claude-harness.",
      "Claude-harness must not inspect harness-mem internal database paths.",
    ],
    relevant: [1, 2, 3],
  }),
  makeCase({
    n: 62,
    family: "companion",
    description: "companion auto setup state",
    difficulty: "medium",
    query: "Where is companion auto-setup state stored?",
    expected: ".claude/state/harness-mem-companion-setup.json",
    entries: [
      "Companion auto-setup state is stored in .claude/state/harness-mem-companion-setup.json.",
      "The state file prevents repeating setup on every Setup:init run.",
      "Deleting the state file forces Claude-harness to evaluate companion setup again.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 63,
    family: "companion",
    description: "turning companion off",
    difficulty: "medium",
    query: "What command turns the managed companion off?",
    expected: "harness mem off",
    entries: [
      "Claude-harness exposes harness mem off to disable the managed companion path.",
      "The command should not delete the harness-mem database.",
      "Users can re-enable the path with harness mem setup after confirming doctor output.",
    ],
    relevant: [1, 2],
  }),
  makeCase({
    n: 64,
    family: "companion",
    description: "companion runtime owner",
    difficulty: "hard",
    query: "Who owns the companion runtime implementation?",
    expected: "harness-mem",
    entries: [
      "harness-mem owns the companion runtime implementation, including setup, doctor, update, and uninstall.",
      "claude-code-harness owns the developer UX wrapper and calls only stable companion commands.",
      "Do not reimplement memory storage or search inside claude-code-harness.",
    ],
    relevant: [1, 2, 3],
  }),
];

function familyForCase(dwCase: DevWorkflowCase): QueryFamily {
  if (dwCase.query_family) return dwCase.query_family;
  const family = BASE_FAMILIES[dwCase.id];
  if (!family) throw new Error(`Missing query family classification for ${dwCase.id}`);
  return family;
}

function emptyFamilyCounts(): Record<QueryFamily, number> {
  return Object.fromEntries(REQUIRED_FAMILIES.map((family) => [family, 0])) as Record<QueryFamily, number>;
}

function validateCases(cases: DevWorkflowCase[], baseCases: DevWorkflowCase[]): void {
  if (cases.length < 60) throw new Error(`Expected at least 60 cases, got ${cases.length}`);
  const ids = new Set<string>();
  const entryIds = new Set<string>();
  for (const dwCase of cases) {
    if (ids.has(dwCase.id)) throw new Error(`Duplicate case id ${dwCase.id}`);
    ids.add(dwCase.id);
    if (dwCase.entries.length < 2) throw new Error(`${dwCase.id} has fewer than 2 entries`);
    for (const entry of dwCase.entries) {
      if (entryIds.has(entry.id)) throw new Error(`Duplicate entry id ${entry.id}`);
      entryIds.add(entry.id);
    }
    for (const relevantId of dwCase.relevant_ids) {
      if (!dwCase.entries.some((entry) => entry.id === relevantId)) {
        throw new Error(`${dwCase.id} references missing entry ${relevantId}`);
      }
    }
  }

  const exactSubsetMatches = baseCases.every((baseCase, index) => {
    return JSON.stringify(baseCase) === JSON.stringify(cases[index]);
  });
  if (!exactSubsetMatches) throw new Error("The first 20 expanded cases must preserve dev-workflow-20 exactly");

  const presentFamilies = new Set(cases.map(familyForCase));
  const missingFamilies = REQUIRED_FAMILIES.filter((family) => !presentFamilies.has(family));
  if (missingFamilies.length > 0) {
    throw new Error(`Missing required query families: ${missingFamilies.join(", ")}`);
  }
}

function buildMarkdown(args: {
  generatedAt: string;
  expandedCount: number;
  baseCount: number;
  distribution: Record<QueryFamily, number>;
  additionsByFamily: Record<QueryFamily, number>;
  backwardMatched: number;
  fixtureSha: string;
}): string {
  const rows = REQUIRED_FAMILIES.map((family) => {
    return `| ${family} | ${args.distribution[family]} | ${args.additionsByFamily[family]} |`;
  }).join("\n");
  return [
    "# S108 Developer Workflow Fixture Expansion",
    "",
    `- task_id: S108-002`,
    `- generated_at: ${args.generatedAt}`,
    `- fixture: ${rel(EXPANDED_FIXTURE_PATH)}`,
    `- fixture_sha256: ${args.fixtureSha}`,
    `- qa_count: ${args.expandedCount}`,
    `- base_subset: ${args.baseCount} cases from ${rel(BASE_FIXTURE_PATH)}`,
    `- backward_comparison: ${args.backwardMatched}/${args.baseCount} exact base cases preserved`,
    "",
    "## Category Distribution",
    "",
    "| query_family | total_cases | new_cases |",
    "|---|---:|---:|",
    rows,
    "",
    "## Notes",
    "",
    "- The first 20 cases are copied from dev-workflow-20 without object-level changes.",
    "- New cases cover file, branch, PR, issue, migration, deploy, failing test, release, setup, doctor, and companion query families.",
    "- This task writes only developer-workflow fixture and artifact surfaces; temporal fixtures, competitive audit docs, and Plans.md are intentionally untouched.",
    "",
  ].join("\n");
}

const generatedAt = new Date().toISOString();
const baseCases = readJson<DevWorkflowCase[]>(BASE_FIXTURE_PATH);
const expandedCases = [...baseCases, ...ADDITIONS];
validateCases(expandedCases, baseCases);

writeJson(EXPANDED_FIXTURE_PATH, expandedCases);

const families = expandedCases.map(familyForCase);
const newFamilies = ADDITIONS.map(familyForCase);
const distribution = emptyFamilyCounts();
for (const family of families) distribution[family] += 1;
const additionsByFamily = emptyFamilyCounts();
for (const family of newFamilies) additionsByFamily[family] += 1;

const backwardCases = baseCases.map((baseCase, index) => {
  const expandedCase = expandedCases[index];
  const matched = JSON.stringify(baseCase) === JSON.stringify(expandedCase);
  return {
    id: baseCase.id,
    matched,
    query: baseCase.query,
    expected_answer: baseCase.expected_answer,
    relevant_ids: baseCase.relevant_ids,
  };
});

const backwardComparison = {
  task_id: "S108-002",
  generated_at: generatedAt,
  base_fixture: {
    path: rel(BASE_FIXTURE_PATH),
    sha256: sha256(BASE_FIXTURE_PATH),
    cases: baseCases.length,
  },
  expanded_fixture: {
    path: rel(EXPANDED_FIXTURE_PATH),
    sha256: sha256(EXPANDED_FIXTURE_PATH),
    cases: expandedCases.length,
  },
  exact_prefix_match: backwardCases.every((item) => item.matched),
  matched_cases: backwardCases.filter((item) => item.matched).length,
  compared_cases: backwardCases.length,
  cases: backwardCases,
};

const categoryDistribution = {
  task_id: "S108-002",
  generated_at: generatedAt,
  required_families: REQUIRED_FAMILIES,
  total_cases: expandedCases.length,
  base_cases: baseCases.length,
  new_cases: ADDITIONS.length,
  distribution,
  additions_by_family: additionsByFamily,
};

const summary = {
  task_id: "S108-002",
  generated_at: generatedAt,
  fixture: {
    path: rel(EXPANDED_FIXTURE_PATH),
    sha256: sha256(EXPANDED_FIXTURE_PATH),
    qa_count: expandedCases.length,
  },
  source_subset: {
    path: rel(BASE_FIXTURE_PATH),
    sha256: sha256(BASE_FIXTURE_PATH),
    qa_count: baseCases.length,
    exact_prefix_match: backwardComparison.exact_prefix_match,
  },
  required_families_present: REQUIRED_FAMILIES.every((family) => distribution[family] > 0),
  category_distribution: distribution,
  artifacts: {
    category_distribution: "category-distribution.json",
    backward_comparison: "backward-comparison.json",
    summary_markdown: "summary.md",
  },
};

mkdirSync(ARTIFACT_DIR, { recursive: true });
writeJson(join(ARTIFACT_DIR, "category-distribution.json"), categoryDistribution);
writeJson(join(ARTIFACT_DIR, "backward-comparison.json"), backwardComparison);
writeJson(join(ARTIFACT_DIR, "summary.json"), summary);
writeFileSync(
  join(ARTIFACT_DIR, "summary.md"),
  buildMarkdown({
    generatedAt,
    expandedCount: expandedCases.length,
    baseCount: baseCases.length,
    distribution,
    additionsByFamily,
    backwardMatched: backwardComparison.matched_cases,
    fixtureSha: summary.fixture.sha256,
  })
);

console.log(
  JSON.stringify(
    {
      task_id: "S108-002",
      fixture: rel(EXPANDED_FIXTURE_PATH),
      qa_count: expandedCases.length,
      artifacts: rel(ARTIFACT_DIR),
      backward_matched: `${backwardComparison.matched_cases}/${backwardComparison.compared_cases}`,
    },
    null,
    2
  )
);
