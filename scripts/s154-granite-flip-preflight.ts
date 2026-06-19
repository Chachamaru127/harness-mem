#!/usr/bin/env bun
/**
 * S154-512: read-only preflight for granite flag flip.
 *
 * Reads docs/benchmarks/artifacts/s154-granite-backfill/verification.json only.
 * Does NOT open ~/.harness-mem/harness-mem.db or any live database.
 *
 *   ~/.bun/bin/bun run scripts/s154-granite-flip-preflight.ts [--artifact PATH]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_ARTIFACT = "docs/benchmarks/artifacts/s154-granite-backfill/verification.json";

export interface GraniteFlipPreflightInput {
  verification: {
    passed?: boolean;
    sqlite_vec_available?: boolean;
    sidecar_rows?: number | null;
    granite_rows?: number;
    missing_rows?: number;
    stale_rows?: number;
    row_count_match?: boolean;
    min_cosine?: number | null;
    cosine_threshold?: number;
  };
  completed?: boolean;
  target_observations?: number;
  granite_rows?: number;
  generated_at?: string;
}

export interface GraniteFlipPreflightCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface GraniteFlipPreflightResult {
  schema_version: "s154-512-granite-flip-preflight.v1";
  task_id: "S154-512";
  artifact_path: string;
  generated_at: string;
  checks: GraniteFlipPreflightCheck[];
  authorized: boolean;
}

export function evaluateGraniteFlipPreflight(
  artifact: GraniteFlipPreflightInput,
  artifactPath: string,
  now = new Date(),
): GraniteFlipPreflightResult {
  const verification = artifact.verification ?? {};
  const graniteRows = verification.granite_rows ?? artifact.granite_rows;
  const sidecarRows = verification.sidecar_rows;

  const checks: GraniteFlipPreflightCheck[] = [
    {
      id: "verification.passed",
      ok: verification.passed === true,
      detail:
        verification.passed === true
          ? "verification.passed=true"
          : `verification.passed=${String(verification.passed)} (expected true)`,
    },
    {
      id: "verification.sqlite_vec_available",
      ok: verification.sqlite_vec_available === true,
      detail:
        verification.sqlite_vec_available === true
          ? "sqlite_vec_available=true"
          : `sqlite_vec_available=${String(verification.sqlite_vec_available)} (expected true)`,
    },
    {
      id: "verification.sidecar_rows==granite_rows",
      ok:
        typeof graniteRows === "number" &&
        typeof sidecarRows === "number" &&
        sidecarRows === graniteRows,
      detail:
        typeof graniteRows === "number" && typeof sidecarRows === "number"
          ? `sidecar_rows=${sidecarRows}, granite_rows=${graniteRows}`
          : `sidecar_rows=${String(sidecarRows)}, granite_rows=${String(graniteRows)}`,
    },
  ];

  return {
    schema_version: "s154-512-granite-flip-preflight.v1",
    task_id: "S154-512",
    artifact_path: artifactPath,
    generated_at: now.toISOString(),
    checks,
    authorized: checks.every((check) => check.ok),
  };
}

function parseArgs(argv: string[]): { artifact: string } {
  let artifact = DEFAULT_ARTIFACT;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--artifact" && argv[i + 1]) {
      artifact = argv[++i];
    } else if (token === "--help" || token === "-h") {
      process.stdout.write(
        "Usage: bun run scripts/s154-granite-flip-preflight.ts [--artifact PATH]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return { artifact: resolve(artifact) };
}

if (import.meta.main) {
  const { artifact } = parseArgs(process.argv.slice(2));
  let parsed: GraniteFlipPreflightInput;
  try {
    parsed = JSON.parse(readFileSync(artifact, "utf8")) as GraniteFlipPreflightInput;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[s154-512-preflight] failed to read artifact ${artifact}: ${message}\n`);
    process.exit(2);
  }

  const result = evaluateGraniteFlipPreflight(parsed, artifact);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.authorized) {
    process.stderr.write("[s154-512-preflight] flip is NOT authorized — fix backfill verification first\n");
    process.exit(1);
  }
}
