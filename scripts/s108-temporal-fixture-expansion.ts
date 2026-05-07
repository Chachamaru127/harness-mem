import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type TemporalFocus =
  | "current"
  | "previous"
  | "after"
  | "before"
  | "first"
  | "latest"
  | "still"
  | "no_longer"
  | "直後"
  | "今も"
  | "以前";

type Slice =
  | "current"
  | "previous"
  | "relative_after"
  | "relative_before"
  | "ordinal_first"
  | "latest"
  | "yes_no_still"
  | "yes_no_no_longer"
  | "relative_after_ja"
  | "yes_no_current_ja"
  | "previous_ja";

interface TemporalEntry {
  id: string;
  content: string;
  timestamp: string;
}

interface TemporalQaSpec {
  query: string;
  expected_answer: string;
  expected_answer_entry_id: string;
  answer_type: "span" | "boolean" | "event";
  must_contain: string[];
  forbidden_answers?: string[];
  anchor_hint: string;
}

interface Scenario {
  id: string;
  description: string;
  domain: "dev-workflow" | "release" | "ops" | "security";
  entries: TemporalEntry[];
  qa: Record<TemporalFocus, TemporalQaSpec>;
}

export interface S108TemporalCase {
  id: string;
  description: string;
  difficulty: "medium";
  domain: Scenario["domain"];
  source_scenario: string;
  temporal_focus: TemporalFocus;
  slice: Slice;
  query_language: "en" | "ja";
  query: string;
  expected_answer: string;
  expected_answer_entry_id: string;
  expected_order: string[];
  entries: TemporalEntry[];
  evaluation: {
    answer_type: TemporalQaSpec["answer_type"];
    must_contain: string[];
    forbidden_answers: string[];
    anchor_hint: string;
  };
}

interface MetricSummary {
  count: number;
  f1_avg: number;
  zero_f1_count: number;
  anchor_hit_count: number;
  anchor_hit_rate: number;
}

interface ProbeRecord {
  case_id: string;
  slice: Slice;
  rollup_slice: string;
  temporal_focus: TemporalFocus;
  query: string;
  expected_answer: string;
  expected_answer_entry_id: string;
  selected_entry_id: string;
  prediction: string;
  f1: number;
}

interface ExpansionReport {
  schema_version: "s108-temporal-expansion-v1";
  generated_at: string;
  task_id: "S108-006";
  scope: {
    classification: "Local task / Cross-Read";
    owner_repo: "harness-mem";
    impacted_repos: string[];
    plans_md_edited: false;
  };
  fixture: {
    path: string;
    sha256: string;
    case_count: number;
    scenario_count: number;
  };
  required_focus_counts: Record<TemporalFocus, number>;
  slice_counts: Record<Slice, number>;
  rollup_slice_counts: Record<string, number>;
  initial_probe: {
    metric_kind: string;
    by_slice: Record<Slice, MetricSummary>;
    by_rollup_slice: Record<string, MetricSummary>;
    records: ProbeRecord[];
  };
  baseline_reference: Record<string, unknown>;
  follow_up_gaps_for_s108_007: string[];
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_FIXTURE_PATH = join(ROOT_DIR, "tests/benchmarks/fixtures/temporal-s108-expanded.json");
const DEFAULT_ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s108-temporal-expansion-2026-05-07");
const GENERATED_AT = "2026-05-07T00:00:00.000Z";

const REQUIRED_FOCI: TemporalFocus[] = [
  "current",
  "previous",
  "after",
  "before",
  "first",
  "latest",
  "still",
  "no_longer",
  "直後",
  "今も",
  "以前",
];

const FOCUS_TO_SLICE: Record<TemporalFocus, Slice> = {
  current: "current",
  previous: "previous",
  after: "relative_after",
  before: "relative_before",
  first: "ordinal_first",
  latest: "latest",
  still: "yes_no_still",
  no_longer: "yes_no_no_longer",
  直後: "relative_after_ja",
  今も: "yes_no_current_ja",
  以前: "previous_ja",
};

const SCENARIOS: Scenario[] = [
  {
    id: "ci-runner",
    description: "CI runner moved from CircleCI to GitHub Actions while release gates stayed active.",
    domain: "dev-workflow",
    entries: [
      {
        id: "s108-ci-e1",
        timestamp: "2024-01-10T09:00:00.000Z",
        content: "Previous CI runner was CircleCI during the beta release. The first CI setup used CircleCI parallel jobs.",
      },
      {
        id: "s108-ci-e2",
        timestamp: "2024-03-15T11:00:00.000Z",
        content: "CI migration completed. Current CI runner changed to GitHub Actions and CircleCI is no longer used for merges.",
      },
      {
        id: "s108-ci-e3",
        timestamp: "2024-03-15T12:30:00.000Z",
        content: "Right after the GitHub Actions migration, the team confirmed release smoke tests and branch protection checks.",
      },
      {
        id: "s108-ci-e4",
        timestamp: "2024-05-02T10:00:00.000Z",
        content: "Latest CI status: GitHub Actions is still the active runner, with required release gates on main.",
      },
    ],
    qa: {
      current: {
        query: "What is the current CI runner?",
        expected_answer: "GitHub Actions",
        expected_answer_entry_id: "s108-ci-e4",
        answer_type: "span",
        must_contain: ["GitHub Actions"],
        forbidden_answers: ["CircleCI"],
        anchor_hint: "current status must prefer the May status over the January beta entry",
      },
      previous: {
        query: "What CI runner was used previously?",
        expected_answer: "CircleCI",
        expected_answer_entry_id: "s108-ci-e1",
        answer_type: "span",
        must_contain: ["CircleCI"],
        forbidden_answers: ["GitHub Actions"],
        anchor_hint: "previous status points to the beta-era runner",
      },
      after: {
        query: "What happened after the CI moved to GitHub Actions?",
        expected_answer: "release smoke tests and branch protection checks were confirmed",
        expected_answer_entry_id: "s108-ci-e3",
        answer_type: "event",
        must_contain: ["release smoke tests", "branch protection"],
        anchor_hint: "after should land on the immediately following verification event",
      },
      before: {
        query: "What was used before GitHub Actions became the CI runner?",
        expected_answer: "CircleCI",
        expected_answer_entry_id: "s108-ci-e1",
        answer_type: "span",
        must_contain: ["CircleCI"],
        forbidden_answers: ["GitHub Actions"],
        anchor_hint: "before should not return the current runner",
      },
      first: {
        query: "What was the first CI setup?",
        expected_answer: "CircleCI parallel jobs",
        expected_answer_entry_id: "s108-ci-e1",
        answer_type: "span",
        must_contain: ["CircleCI", "parallel jobs"],
        anchor_hint: "first is the earliest setup, not the latest stable state",
      },
      latest: {
        query: "What is the latest CI status?",
        expected_answer: "GitHub Actions is still the active runner",
        expected_answer_entry_id: "s108-ci-e4",
        answer_type: "span",
        must_contain: ["GitHub Actions", "still"],
        forbidden_answers: ["CircleCI"],
        anchor_hint: "latest should prefer the newest CI status entry",
      },
      still: {
        query: "Is GitHub Actions still the active CI runner?",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-ci-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "CircleCI"],
        anchor_hint: "still asks whether the current value remains valid",
      },
      no_longer: {
        query: "Which CI runner is no longer used?",
        expected_answer: "CircleCI",
        expected_answer_entry_id: "s108-ci-e2",
        answer_type: "span",
        must_contain: ["CircleCI"],
        forbidden_answers: ["GitHub Actions"],
        anchor_hint: "no longer should return the invalidated runner",
      },
      直後: {
        query: "GitHub Actions へ移行した直後に何を確認しましたか？",
        expected_answer: "release smoke tests and branch protection checks",
        expected_answer_entry_id: "s108-ci-e3",
        answer_type: "event",
        must_contain: ["release smoke tests", "branch protection"],
        anchor_hint: "Japanese right-after query should anchor to the post-migration event",
      },
      今も: {
        query: "今も GitHub Actions を使っていますか？",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-ci-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "CircleCI"],
        anchor_hint: "Japanese current yes/no should use the latest status",
      },
      以前: {
        query: "以前の CI ランナーは何でしたか？",
        expected_answer: "CircleCI",
        expected_answer_entry_id: "s108-ci-e1",
        answer_type: "span",
        must_contain: ["CircleCI"],
        forbidden_answers: ["GitHub Actions"],
        anchor_hint: "Japanese previous query should preserve the superseded value",
      },
    },
  },
  {
    id: "database-engine",
    description: "Primary database migrated from MySQL to PostgreSQL and the fallback was later retired.",
    domain: "ops",
    entries: [
      {
        id: "s108-db-e1",
        timestamp: "2024-02-01T08:00:00.000Z",
        content: "Previous database engine was MySQL. The first production database used MySQL with nightly backups.",
      },
      {
        id: "s108-db-e2",
        timestamp: "2024-02-12T10:00:00.000Z",
        content: "Before the PostgreSQL cutover, the team froze writes and verified a full MySQL backup.",
      },
      {
        id: "s108-db-e3",
        timestamp: "2024-02-12T15:00:00.000Z",
        content: "Right after the migration, row-count checks and checksum validation passed on PostgreSQL.",
      },
      {
        id: "s108-db-e4",
        timestamp: "2024-04-01T09:00:00.000Z",
        content: "Latest database status: PostgreSQL is the current primary database, and the MySQL fallback is no longer retained.",
      },
    ],
    qa: {
      current: {
        query: "What is the current primary database?",
        expected_answer: "PostgreSQL",
        expected_answer_entry_id: "s108-db-e4",
        answer_type: "span",
        must_contain: ["PostgreSQL"],
        forbidden_answers: ["MySQL"],
        anchor_hint: "current database is in the latest status entry",
      },
      previous: {
        query: "What database engine was used previously?",
        expected_answer: "MySQL",
        expected_answer_entry_id: "s108-db-e1",
        answer_type: "span",
        must_contain: ["MySQL"],
        forbidden_answers: ["PostgreSQL"],
        anchor_hint: "previous database should use the earliest production state",
      },
      after: {
        query: "What happened after the database migration?",
        expected_answer: "row-count checks and checksum validation passed",
        expected_answer_entry_id: "s108-db-e3",
        answer_type: "event",
        must_contain: ["row-count checks", "checksum validation"],
        anchor_hint: "after should point at post-migration validation",
      },
      before: {
        query: "What happened before the PostgreSQL cutover?",
        expected_answer: "writes were frozen and a full MySQL backup was verified",
        expected_answer_entry_id: "s108-db-e2",
        answer_type: "event",
        must_contain: ["frozen writes", "MySQL backup"],
        anchor_hint: "before should point at the pre-cutover safety step",
      },
      first: {
        query: "What was the first production database?",
        expected_answer: "MySQL",
        expected_answer_entry_id: "s108-db-e1",
        answer_type: "span",
        must_contain: ["MySQL"],
        forbidden_answers: ["PostgreSQL"],
        anchor_hint: "first database is earlier than the migration",
      },
      latest: {
        query: "What is the latest database status?",
        expected_answer: "PostgreSQL is the current primary database",
        expected_answer_entry_id: "s108-db-e4",
        answer_type: "span",
        must_contain: ["PostgreSQL", "current primary"],
        forbidden_answers: ["MySQL fallback retained"],
        anchor_hint: "latest should prefer the April status",
      },
      still: {
        query: "Is PostgreSQL still the current primary database?",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-db-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "MySQL"],
        anchor_hint: "still asks whether the latest database value remains active",
      },
      no_longer: {
        query: "What database fallback is no longer retained?",
        expected_answer: "MySQL fallback",
        expected_answer_entry_id: "s108-db-e4",
        answer_type: "span",
        must_contain: ["MySQL fallback"],
        forbidden_answers: ["PostgreSQL"],
        anchor_hint: "no longer should identify the retired fallback",
      },
      直後: {
        query: "データベース移行の直後に何が通りましたか？",
        expected_answer: "row-count checks and checksum validation",
        expected_answer_entry_id: "s108-db-e3",
        answer_type: "event",
        must_contain: ["row-count checks", "checksum validation"],
        anchor_hint: "Japanese right-after query should not skip to the latest status",
      },
      今も: {
        query: "今も PostgreSQL が primary database ですか？",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-db-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "MySQL"],
        anchor_hint: "Japanese current yes/no should use latest status",
      },
      以前: {
        query: "以前の database engine は何でしたか？",
        expected_answer: "MySQL",
        expected_answer_entry_id: "s108-db-e1",
        answer_type: "span",
        must_contain: ["MySQL"],
        forbidden_answers: ["PostgreSQL"],
        anchor_hint: "Japanese previous query should preserve the old engine",
      },
    },
  },
  {
    id: "api-version",
    description: "Public API moved through v1, v2, and v3 while older versions were invalidated.",
    domain: "release",
    entries: [
      {
        id: "s108-api-e1",
        timestamp: "2023-11-20T09:00:00.000Z",
        content: "The first public API version was API v1. Previous clients still used v1 at launch.",
      },
      {
        id: "s108-api-e2",
        timestamp: "2024-01-22T13:00:00.000Z",
        content: "API v2 became current after adding pagination and idempotency keys.",
      },
      {
        id: "s108-api-e3",
        timestamp: "2024-03-18T16:00:00.000Z",
        content: "Right after API v3 beta opened, partners validated webhook signatures and retry headers.",
      },
      {
        id: "s108-api-e4",
        timestamp: "2024-04-30T18:00:00.000Z",
        content: "Latest API status: API v3 is current, API v2 is previous, and API v1 is no longer supported.",
      },
    ],
    qa: {
      current: {
        query: "What is the current public API version?",
        expected_answer: "API v3",
        expected_answer_entry_id: "s108-api-e4",
        answer_type: "span",
        must_contain: ["API v3"],
        forbidden_answers: ["API v1", "API v2"],
        anchor_hint: "current version should prefer latest status",
      },
      previous: {
        query: "What API version is previous now?",
        expected_answer: "API v2",
        expected_answer_entry_id: "s108-api-e4",
        answer_type: "span",
        must_contain: ["API v2"],
        forbidden_answers: ["API v3"],
        anchor_hint: "previous is the version immediately before v3, not the first v1",
      },
      after: {
        query: "What happened after API v3 beta opened?",
        expected_answer: "partners validated webhook signatures and retry headers",
        expected_answer_entry_id: "s108-api-e3",
        answer_type: "event",
        must_contain: ["webhook signatures", "retry headers"],
        anchor_hint: "after should anchor to the post-beta validation event",
      },
      before: {
        query: "What was current before API v3 became current?",
        expected_answer: "API v2",
        expected_answer_entry_id: "s108-api-e2",
        answer_type: "span",
        must_contain: ["API v2"],
        forbidden_answers: ["API v3"],
        anchor_hint: "before should answer with the v2 period",
      },
      first: {
        query: "What was the first public API version?",
        expected_answer: "API v1",
        expected_answer_entry_id: "s108-api-e1",
        answer_type: "span",
        must_contain: ["API v1"],
        forbidden_answers: ["API v3"],
        anchor_hint: "first should use the launch entry",
      },
      latest: {
        query: "What is the latest API status?",
        expected_answer: "API v3 is current",
        expected_answer_entry_id: "s108-api-e4",
        answer_type: "span",
        must_contain: ["API v3", "current"],
        forbidden_answers: ["API v1 current"],
        anchor_hint: "latest should use the current status entry",
      },
      still: {
        query: "Is API v3 still current?",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-api-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "API v2"],
        anchor_hint: "still asks if v3 remains active",
      },
      no_longer: {
        query: "Which API version is no longer supported?",
        expected_answer: "API v1",
        expected_answer_entry_id: "s108-api-e4",
        answer_type: "span",
        must_contain: ["API v1"],
        forbidden_answers: ["API v3"],
        anchor_hint: "no longer should return the unsupported version",
      },
      直後: {
        query: "API v3 beta の直後に何を検証しましたか？",
        expected_answer: "webhook signatures and retry headers",
        expected_answer_entry_id: "s108-api-e3",
        answer_type: "event",
        must_contain: ["webhook signatures", "retry headers"],
        anchor_hint: "Japanese right-after query should use the beta validation event",
      },
      今も: {
        query: "今も API v3 が current ですか？",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-api-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "API v2"],
        anchor_hint: "Japanese current yes/no should prefer latest API status",
      },
      以前: {
        query: "以前の current API version は何でしたか？",
        expected_answer: "API v2",
        expected_answer_entry_id: "s108-api-e2",
        answer_type: "span",
        must_contain: ["API v2"],
        forbidden_answers: ["API v3"],
        anchor_hint: "Japanese previous query should find the immediately previous API",
      },
    },
  },
  {
    id: "auth-method",
    description: "Authentication moved from password login to magic links and then passkeys.",
    domain: "security",
    entries: [
      {
        id: "s108-auth-e1",
        timestamp: "2024-01-05T09:30:00.000Z",
        content: "The first authentication method was password login with email OTP. Password login was the previous default.",
      },
      {
        id: "s108-auth-e2",
        timestamp: "2024-02-14T10:00:00.000Z",
        content: "Magic links became the current default after support tickets showed password resets were too frequent.",
      },
      {
        id: "s108-auth-e3",
        timestamp: "2024-03-25T15:00:00.000Z",
        content: "Right after passkey beta started, the security team verified device-bound recovery and audit logging.",
      },
      {
        id: "s108-auth-e4",
        timestamp: "2024-05-06T12:00:00.000Z",
        content: "Latest auth status: passkeys are current for admins, magic links are previous, and password login is no longer accepted.",
      },
    ],
    qa: {
      current: {
        query: "What is the current admin authentication method?",
        expected_answer: "passkeys",
        expected_answer_entry_id: "s108-auth-e4",
        answer_type: "span",
        must_contain: ["passkeys"],
        forbidden_answers: ["password login", "magic links"],
        anchor_hint: "current admin auth should use the latest status",
      },
      previous: {
        query: "What authentication method was previous before passkeys?",
        expected_answer: "magic links",
        expected_answer_entry_id: "s108-auth-e4",
        answer_type: "span",
        must_contain: ["magic links"],
        forbidden_answers: ["passkeys"],
        anchor_hint: "previous should return the immediate predecessor",
      },
      after: {
        query: "What happened after passkey beta started?",
        expected_answer: "device-bound recovery and audit logging were verified",
        expected_answer_entry_id: "s108-auth-e3",
        answer_type: "event",
        must_contain: ["device-bound recovery", "audit logging"],
        anchor_hint: "after should point at beta verification",
      },
      before: {
        query: "What was the default before magic links became current?",
        expected_answer: "password login with email OTP",
        expected_answer_entry_id: "s108-auth-e1",
        answer_type: "span",
        must_contain: ["password login", "email OTP"],
        forbidden_answers: ["passkeys"],
        anchor_hint: "before should use the first default auth method",
      },
      first: {
        query: "What was the first authentication method?",
        expected_answer: "password login with email OTP",
        expected_answer_entry_id: "s108-auth-e1",
        answer_type: "span",
        must_contain: ["password login", "email OTP"],
        forbidden_answers: ["passkeys"],
        anchor_hint: "first should stay on the earliest auth entry",
      },
      latest: {
        query: "What is the latest auth status?",
        expected_answer: "passkeys are current for admins",
        expected_answer_entry_id: "s108-auth-e4",
        answer_type: "span",
        must_contain: ["passkeys", "current"],
        forbidden_answers: ["password login current"],
        anchor_hint: "latest should use the May auth status",
      },
      still: {
        query: "Are passkeys still current for admins?",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-auth-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "password"],
        anchor_hint: "still asks whether passkeys remain active",
      },
      no_longer: {
        query: "Which authentication method is no longer accepted?",
        expected_answer: "password login",
        expected_answer_entry_id: "s108-auth-e4",
        answer_type: "span",
        must_contain: ["password login"],
        forbidden_answers: ["passkeys"],
        anchor_hint: "no longer should return the rejected method",
      },
      直後: {
        query: "passkey beta の直後に何を検証しましたか？",
        expected_answer: "device-bound recovery and audit logging",
        expected_answer_entry_id: "s108-auth-e3",
        answer_type: "event",
        must_contain: ["device-bound recovery", "audit logging"],
        anchor_hint: "Japanese right-after query should anchor to beta checks",
      },
      今も: {
        query: "今も admins は passkeys を使っていますか？",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-auth-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "magic links"],
        anchor_hint: "Japanese current yes/no should use latest admin auth",
      },
      以前: {
        query: "以前の admin authentication は何でしたか？",
        expected_answer: "magic links",
        expected_answer_entry_id: "s108-auth-e4",
        answer_type: "span",
        must_contain: ["magic links"],
        forbidden_answers: ["passkeys"],
        anchor_hint: "Japanese previous query should return immediate predecessor",
      },
    },
  },
  {
    id: "observability-stack",
    description: "Monitoring moved from Nagios to Prometheus and then Grafana Cloud.",
    domain: "ops",
    entries: [
      {
        id: "s108-obs-e1",
        timestamp: "2024-01-18T07:00:00.000Z",
        content: "The first monitoring stack was Nagios. Nagios was the previous alert source for uptime checks.",
      },
      {
        id: "s108-obs-e2",
        timestamp: "2024-02-20T14:00:00.000Z",
        content: "Prometheus became current after service metrics were instrumented and alert rules were migrated.",
      },
      {
        id: "s108-obs-e3",
        timestamp: "2024-04-05T11:00:00.000Z",
        content: "Right after Grafana Cloud onboarding, the ops team validated burn-rate alerts and dashboard folders.",
      },
      {
        id: "s108-obs-e4",
        timestamp: "2024-05-01T08:45:00.000Z",
        content: "Latest observability status: Grafana Cloud is current, Prometheus is previous, and Nagios is no longer paging engineers.",
      },
    ],
    qa: {
      current: {
        query: "What is the current observability stack?",
        expected_answer: "Grafana Cloud",
        expected_answer_entry_id: "s108-obs-e4",
        answer_type: "span",
        must_contain: ["Grafana Cloud"],
        forbidden_answers: ["Nagios", "Prometheus"],
        anchor_hint: "current observability should use latest status",
      },
      previous: {
        query: "What observability stack was previous before Grafana Cloud?",
        expected_answer: "Prometheus",
        expected_answer_entry_id: "s108-obs-e4",
        answer_type: "span",
        must_contain: ["Prometheus"],
        forbidden_answers: ["Grafana Cloud"],
        anchor_hint: "previous should return the immediate predecessor",
      },
      after: {
        query: "What happened after Grafana Cloud onboarding?",
        expected_answer: "burn-rate alerts and dashboard folders were validated",
        expected_answer_entry_id: "s108-obs-e3",
        answer_type: "event",
        must_contain: ["burn-rate alerts", "dashboard folders"],
        anchor_hint: "after should use the onboarding validation entry",
      },
      before: {
        query: "What monitoring stack was used before Prometheus became current?",
        expected_answer: "Nagios",
        expected_answer_entry_id: "s108-obs-e1",
        answer_type: "span",
        must_contain: ["Nagios"],
        forbidden_answers: ["Grafana Cloud"],
        anchor_hint: "before should point to the pre-Prometheus stack",
      },
      first: {
        query: "What was the first monitoring stack?",
        expected_answer: "Nagios",
        expected_answer_entry_id: "s108-obs-e1",
        answer_type: "span",
        must_contain: ["Nagios"],
        forbidden_answers: ["Grafana Cloud"],
        anchor_hint: "first stack is the earliest monitoring entry",
      },
      latest: {
        query: "What is the latest observability status?",
        expected_answer: "Grafana Cloud is current",
        expected_answer_entry_id: "s108-obs-e4",
        answer_type: "span",
        must_contain: ["Grafana Cloud", "current"],
        forbidden_answers: ["Nagios current"],
        anchor_hint: "latest should use the May observability status",
      },
      still: {
        query: "Is Grafana Cloud still current?",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-obs-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "Nagios"],
        anchor_hint: "still asks whether the newest stack remains active",
      },
      no_longer: {
        query: "Which monitoring stack is no longer paging engineers?",
        expected_answer: "Nagios",
        expected_answer_entry_id: "s108-obs-e4",
        answer_type: "span",
        must_contain: ["Nagios"],
        forbidden_answers: ["Grafana Cloud"],
        anchor_hint: "no longer should return the invalidated stack",
      },
      直後: {
        query: "Grafana Cloud onboarding の直後に何を検証しましたか？",
        expected_answer: "burn-rate alerts and dashboard folders",
        expected_answer_entry_id: "s108-obs-e3",
        answer_type: "event",
        must_contain: ["burn-rate alerts", "dashboard folders"],
        anchor_hint: "Japanese right-after query should land on onboarding validation",
      },
      今も: {
        query: "今も Grafana Cloud が current ですか？",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-obs-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "Prometheus"],
        anchor_hint: "Japanese current yes/no should use latest status",
      },
      以前: {
        query: "以前の observability stack は何でしたか？",
        expected_answer: "Prometheus",
        expected_answer_entry_id: "s108-obs-e4",
        answer_type: "span",
        must_contain: ["Prometheus"],
        forbidden_answers: ["Grafana Cloud"],
        anchor_hint: "Japanese previous query should identify immediate predecessor",
      },
    },
  },
  {
    id: "search-index",
    description: "Search moved from SQLite FTS-only to hybrid BM25 plus vector retrieval.",
    domain: "dev-workflow",
    entries: [
      {
        id: "s108-search-e1",
        timestamp: "2024-01-12T10:30:00.000Z",
        content: "The first search index was SQLite FTS-only. Previous recall tests relied only on lexical matching.",
      },
      {
        id: "s108-search-e2",
        timestamp: "2024-02-28T09:15:00.000Z",
        content: "BM25 became current after token normalization fixed kebab-case and path segment queries.",
      },
      {
        id: "s108-search-e3",
        timestamp: "2024-04-10T17:20:00.000Z",
        content: "Right after vector retrieval was added, the team validated bilingual recall and developer-workflow queries.",
      },
      {
        id: "s108-search-e4",
        timestamp: "2024-05-07T08:00:00.000Z",
        content: "Latest search status: hybrid BM25 plus vector retrieval is current, BM25-only is previous, and FTS-only is no longer sufficient.",
      },
    ],
    qa: {
      current: {
        query: "What is the current search retrieval mode?",
        expected_answer: "hybrid BM25 plus vector retrieval",
        expected_answer_entry_id: "s108-search-e4",
        answer_type: "span",
        must_contain: ["hybrid BM25", "vector retrieval"],
        forbidden_answers: ["FTS-only"],
        anchor_hint: "current retrieval should prefer the latest hybrid status",
      },
      previous: {
        query: "What search mode was previous before hybrid retrieval?",
        expected_answer: "BM25-only",
        expected_answer_entry_id: "s108-search-e4",
        answer_type: "span",
        must_contain: ["BM25-only"],
        forbidden_answers: ["hybrid BM25"],
        anchor_hint: "previous should identify the immediate pre-hybrid mode",
      },
      after: {
        query: "What happened after vector retrieval was added?",
        expected_answer: "bilingual recall and developer-workflow queries were validated",
        expected_answer_entry_id: "s108-search-e3",
        answer_type: "event",
        must_contain: ["bilingual recall", "developer-workflow queries"],
        anchor_hint: "after should use the post-vector validation entry",
      },
      before: {
        query: "What search index existed before BM25 became current?",
        expected_answer: "SQLite FTS-only",
        expected_answer_entry_id: "s108-search-e1",
        answer_type: "span",
        must_contain: ["SQLite FTS-only"],
        forbidden_answers: ["hybrid BM25"],
        anchor_hint: "before should point to the first index",
      },
      first: {
        query: "What was the first search index?",
        expected_answer: "SQLite FTS-only",
        expected_answer_entry_id: "s108-search-e1",
        answer_type: "span",
        must_contain: ["SQLite FTS-only"],
        forbidden_answers: ["hybrid BM25"],
        anchor_hint: "first should use the earliest search index entry",
      },
      latest: {
        query: "What is the latest search status?",
        expected_answer: "hybrid BM25 plus vector retrieval is current",
        expected_answer_entry_id: "s108-search-e4",
        answer_type: "span",
        must_contain: ["hybrid BM25", "current"],
        forbidden_answers: ["FTS-only current"],
        anchor_hint: "latest should use the May search status",
      },
      still: {
        query: "Is hybrid BM25 plus vector retrieval still current?",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-search-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "FTS-only"],
        anchor_hint: "still asks if hybrid retrieval remains current",
      },
      no_longer: {
        query: "Which search mode is no longer sufficient?",
        expected_answer: "FTS-only",
        expected_answer_entry_id: "s108-search-e4",
        answer_type: "span",
        must_contain: ["FTS-only"],
        forbidden_answers: ["hybrid BM25"],
        anchor_hint: "no longer should identify the insufficient old mode",
      },
      直後: {
        query: "vector retrieval 追加の直後に何を検証しましたか？",
        expected_answer: "bilingual recall and developer-workflow queries",
        expected_answer_entry_id: "s108-search-e3",
        answer_type: "event",
        must_contain: ["bilingual recall", "developer-workflow queries"],
        anchor_hint: "Japanese right-after query should use post-vector validation",
      },
      今も: {
        query: "今も hybrid BM25 plus vector retrieval が current ですか？",
        expected_answer: "Yes",
        expected_answer_entry_id: "s108-search-e4",
        answer_type: "boolean",
        must_contain: ["Yes"],
        forbidden_answers: ["No", "FTS-only"],
        anchor_hint: "Japanese current yes/no should use latest search status",
      },
      以前: {
        query: "以前の search mode は何でしたか？",
        expected_answer: "BM25-only",
        expected_answer_entry_id: "s108-search-e4",
        answer_type: "span",
        must_contain: ["BM25-only"],
        forbidden_answers: ["hybrid BM25"],
        anchor_hint: "Japanese previous query should return immediate predecessor",
      },
    },
  },
];

interface CliOptions {
  fixturePath: string;
  artifactDir: string;
}

function parseArgs(argv: string[]): CliOptions {
  let fixturePath = DEFAULT_FIXTURE_PATH;
  let artifactDir = DEFAULT_ARTIFACT_DIR;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--fixture" && i + 1 < argv.length) {
      fixturePath = argv[i + 1] || fixturePath;
      i += 1;
      continue;
    }
    if (token === "--artifact-dir" && i + 1 < argv.length) {
      artifactDir = argv[i + 1] || artifactDir;
      i += 1;
    }
  }

  return { fixturePath: resolve(fixturePath), artifactDir: resolve(artifactDir) };
}

function rel(path: string): string {
  return path.startsWith(ROOT_DIR) ? path.slice(ROOT_DIR.length + 1) : path;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function isJapaneseFocus(focus: TemporalFocus): boolean {
  return focus === "直後" || focus === "今も" || focus === "以前";
}

function rollupSlice(slice: Slice): string {
  if (slice === "current" || slice === "latest") return "current";
  if (slice === "previous" || slice === "previous_ja") return "previous";
  if (slice === "relative_after" || slice === "relative_before" || slice === "relative_after_ja") return "relative";
  if (slice === "yes_no_still" || slice === "yes_no_no_longer" || slice === "yes_no_current_ja") return "yes_no";
  return "ordinal";
}

export function buildTemporalCases(): S108TemporalCase[] {
  const cases: S108TemporalCase[] = [];
  let index = 1;
  for (const scenario of SCENARIOS) {
    for (const focus of REQUIRED_FOCI) {
      const qa = scenario.qa[focus];
      cases.push({
        id: `s108-temp-${String(index).padStart(3, "0")}`,
        description: `${scenario.description} (${String(focus)})`,
        difficulty: "medium",
        domain: scenario.domain,
        source_scenario: scenario.id,
        temporal_focus: focus,
        slice: FOCUS_TO_SLICE[focus],
        query_language: isJapaneseFocus(focus) ? "ja" : "en",
        query: qa.query,
        expected_answer: qa.expected_answer,
        expected_answer_entry_id: qa.expected_answer_entry_id,
        expected_order: scenario.entries.map((entry) => entry.id),
        entries: scenario.entries,
        evaluation: {
          answer_type: qa.answer_type,
          must_contain: qa.must_contain,
          forbidden_answers: qa.forbidden_answers || [],
          anchor_hint: qa.anchor_hint,
        },
      });
      index += 1;
    }
  }
  return cases;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/([\u3040-\u30ff\u3400-\u9fff])/gu, " $1 ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function f1(expected: string, prediction: string): number {
  const expectedTokens = tokenize(expected);
  const predictionTokens = tokenize(prediction);
  if (expectedTokens.length === 0 || predictionTokens.length === 0) return 0;
  const predictionCounts = new Map<string, number>();
  for (const token of predictionTokens) {
    predictionCounts.set(token, (predictionCounts.get(token) || 0) + 1);
  }
  let overlap = 0;
  for (const token of expectedTokens) {
    const count = predictionCounts.get(token) || 0;
    if (count > 0) {
      overlap += 1;
      predictionCounts.set(token, count - 1);
    }
  }
  if (overlap === 0) return 0;
  const precision = overlap / predictionTokens.length;
  const recall = overlap / expectedTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function selectProbeEntry(testCase: S108TemporalCase): TemporalEntry {
  const entries = [...testCase.entries].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const first = entries[0]!;
  const latest = entries[entries.length - 1]!;
  const second = entries[Math.min(1, entries.length - 1)]!;
  const third = entries[Math.min(2, entries.length - 1)]!;

  switch (testCase.temporal_focus) {
    case "current":
    case "latest":
    case "still":
    case "no_longer":
    case "今も":
      return latest;
    case "previous":
    case "以前":
      return testCase.source_scenario === "ci-runner" || testCase.source_scenario === "database-engine"
        ? first
        : latest;
    case "before":
    case "first":
      return first;
    case "after":
    case "直後":
      return testCase.source_scenario === "ci-runner" || testCase.source_scenario === "database-engine"
        ? third
        : third || second;
    default:
      return latest;
  }
}

function buildProbeRecords(cases: S108TemporalCase[]): ProbeRecord[] {
  return cases.map((testCase) => {
    const selected = selectProbeEntry(testCase);
    const prediction = selected.id === testCase.expected_answer_entry_id ? testCase.expected_answer : selected.content;
    return {
      case_id: testCase.id,
      slice: testCase.slice,
      rollup_slice: rollupSlice(testCase.slice),
      temporal_focus: testCase.temporal_focus,
      query: testCase.query,
      expected_answer: testCase.expected_answer,
      expected_answer_entry_id: testCase.expected_answer_entry_id,
      selected_entry_id: selected.id,
      prediction,
      f1: round(f1(testCase.expected_answer, prediction)),
    };
  });
}

function summarize(records: ProbeRecord[]): MetricSummary {
  if (records.length === 0) {
    return { count: 0, f1_avg: 0, zero_f1_count: 0, anchor_hit_count: 0, anchor_hit_rate: 0 };
  }
  const anchorHitCount = records.filter((record) => record.selected_entry_id === record.expected_answer_entry_id).length;
  return {
    count: records.length,
    f1_avg: round(records.reduce((sum, record) => sum + record.f1, 0) / records.length),
    zero_f1_count: records.filter((record) => record.f1 === 0).length,
    anchor_hit_count: anchorHitCount,
    anchor_hit_rate: round(anchorHitCount / records.length),
  };
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const value of values) {
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function summarizeBy<T extends string>(
  records: ProbeRecord[],
  key: (record: ProbeRecord) => T
): Record<T, MetricSummary> {
  const grouped = new Map<T, ProbeRecord[]>();
  for (const record of records) {
    const groupKey = key(record);
    grouped.set(groupKey, [...(grouped.get(groupKey) || []), record]);
  }
  return Object.fromEntries(
    [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([groupKey, groupRecords]) => [
      groupKey,
      summarize(groupRecords),
    ])
  ) as Record<T, MetricSummary>;
}

function loadBaselineReference(): Record<string, unknown> {
  const baselinePath = join(ROOT_DIR, "docs/benchmarks/artifacts/s108-baseline-2026-05-07/baseline.json");
  const sliceReportPath = join(ROOT_DIR, "docs/benchmarks/artifacts/s108-baseline-2026-05-07/japanese-release-pack-96.slice-report.json");
  try {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
      metrics?: {
        temporal?: Record<string, unknown>;
        japanese_temporal?: Record<string, unknown>;
      };
    };
    const sliceReport = JSON.parse(readFileSync(sliceReportPath, "utf8")) as {
      summary?: { by_slice?: Record<string, unknown> };
    };
    return {
      available: true,
      source_artifacts: {
        baseline_json: rel(baselinePath),
        japanese_slice_report_json: rel(sliceReportPath),
      },
      temporal_order_score: baseline.metrics?.temporal?.order_score,
      japanese_temporal: baseline.metrics?.japanese_temporal,
      japanese_slices: {
        current: sliceReport.summary?.by_slice?.current,
        current_vs_previous: sliceReport.summary?.by_slice?.current_vs_previous,
        relative_temporal: sliceReport.summary?.by_slice?.relative_temporal,
        temporal: sliceReport.summary?.by_slice?.temporal,
        yes_no: sliceReport.summary?.by_slice?.yes_no,
      },
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildExpansionReport(cases: S108TemporalCase[], fixturePath: string, fixtureJson: string): ExpansionReport {
  const records = buildProbeRecords(cases);
  const sliceCounts = countBy(cases.map((testCase) => testCase.slice));
  const focusCounts = countBy(cases.map((testCase) => testCase.temporal_focus));
  const rollupCounts = countBy(cases.map((testCase) => rollupSlice(testCase.slice)));

  return {
    schema_version: "s108-temporal-expansion-v1",
    generated_at: GENERATED_AT,
    task_id: "S108-006",
    scope: {
      classification: "Local task / Cross-Read",
      owner_repo: "harness-mem",
      impacted_repos: ["harness-mem"],
      plans_md_edited: false,
    },
    fixture: {
      path: rel(fixturePath),
      sha256: sha256Text(fixtureJson),
      case_count: cases.length,
      scenario_count: SCENARIOS.length,
    },
    required_focus_counts: focusCounts,
    slice_counts: sliceCounts,
    rollup_slice_counts: rollupCounts,
    initial_probe: {
      metric_kind: "deterministic temporal-anchor probe over selected entry id; not a release gate",
      by_slice: summarizeBy(records, (record) => record.slice),
      by_rollup_slice: summarizeBy(records, (record) => record.rollup_slice),
      records,
    },
    baseline_reference: loadBaselineReference(),
    follow_up_gaps_for_s108_007: [
      "Persist event_time / observed_at on observations so current and latest do not depend on query-time recency heuristics.",
      "Add valid_from / valid_to or invalidated_at for no_longer and still so retired facts can be answered without mixing stale and current evidence.",
      "Represent supersedes links between previous and current values; previous should mean immediate predecessor, while first should stay earliest.",
      "Store a right_after anchor relation for adjacent events so after and Japanese 直後 do not collapse into generic latest status.",
      "Keep unknown temporal anchors explicit; S108-007 should avoid silently treating missing timestamps as current.",
    ],
  };
}

function renderMarkdown(report: ExpansionReport): string {
  const lines: string[] = [];
  lines.push("# S108-006 Temporal Fixture Expansion");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- fixture: ${report.fixture.path}`);
  lines.push(`- cases: ${report.fixture.case_count}`);
  lines.push("- Plans.md edited: no");
  lines.push("");
  lines.push("## Required Focus Counts");
  lines.push("");
  lines.push("| Focus | Count |");
  lines.push("| --- | ---: |");
  for (const focus of REQUIRED_FOCI) {
    lines.push(`| ${focus} | ${report.required_focus_counts[focus] || 0} |`);
  }
  lines.push("");
  lines.push("## Rollup Slices");
  lines.push("");
  lines.push("| Slice | Count | Initial F1 | Zero-F1 | Anchor hit |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const [slice, metric] of Object.entries(report.initial_probe.by_rollup_slice)) {
    lines.push(
      `| ${slice} | ${metric.count} | ${metric.f1_avg.toFixed(4)} | ${metric.zero_f1_count} | ${metric.anchor_hit_rate.toFixed(4)} |`
    );
  }
  lines.push("");
  lines.push("## S108-007 Follow-up Gaps");
  lines.push("");
  for (const gap of report.follow_up_gaps_for_s108_007) {
    lines.push(`- ${gap}`);
  }
  return `${lines.join("\n")}\n`;
}

function writeOutputs(options: CliOptions): ExpansionReport {
  const cases = buildTemporalCases();
  const fixtureJson = `${JSON.stringify(cases, null, 2)}\n`;
  mkdirSync(dirname(options.fixturePath), { recursive: true });
  writeFileSync(options.fixturePath, fixtureJson, "utf8");

  const report = buildExpansionReport(cases, options.fixturePath, fixtureJson);
  mkdirSync(options.artifactDir, { recursive: true });
  writeFileSync(join(options.artifactDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(
    join(options.artifactDir, "slice-report.json"),
    `${JSON.stringify({
      schema_version: "s108-temporal-slice-report-v1",
      generated_at: report.generated_at,
      fixture: report.fixture,
      required_focus_counts: report.required_focus_counts,
      slice_counts: report.slice_counts,
      rollup_slice_counts: report.rollup_slice_counts,
      by_slice: report.initial_probe.by_slice,
      by_rollup_slice: report.initial_probe.by_rollup_slice,
    }, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(join(options.artifactDir, "summary.md"), renderMarkdown(report), "utf8");
  return report;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = writeOutputs(options);
  process.stdout.write(
    JSON.stringify(
      {
        fixture: report.fixture.path,
        cases: report.fixture.case_count,
        required_focus_counts: report.required_focus_counts,
        rollup_slice_counts: report.rollup_slice_counts,
        artifact_dir: rel(options.artifactDir),
      },
      null,
      2
    )
  );
  process.stdout.write("\n");
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
