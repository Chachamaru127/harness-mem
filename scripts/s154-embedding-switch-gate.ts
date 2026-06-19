/**
 * S154-403: operational entry for the deterministic embedding switch decision.
 *
 * Reads the S154-402 shadow A/B artifact and prints one decision per candidate
 * (switch / keep / rollback / skip) using the S154-400 config constants. The
 * active model defaults to the incumbent; pass --active-model <id> to evaluate
 * the rollback branch of an already-switched deployment. Exit 0 on a clean
 * decision set; any malformed input throws (fail-closed).
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decideFromShadowAbArtifact } from "../memory-server/src/embedding/switch-decision";
import { INCUMBENT_EMBEDDING_MODEL } from "../memory-server/src/core/config-manager";

const ROOT = resolve(import.meta.dir, "..");
const DEFAULT_ARTIFACT = join(ROOT, "docs/benchmarks/artifacts/s154-embedding-shadow-ab/summary.json");

function parseArgs(argv: string[]): { artifactPath: string; activeModel: string } {
  let artifactPath = DEFAULT_ARTIFACT;
  let activeModel = INCUMBENT_EMBEDDING_MODEL;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--artifact" && argv[i + 1]) artifactPath = resolve(argv[++i]);
    else if (argv[i] === "--active-model" && argv[i + 1]) activeModel = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return { artifactPath, activeModel };
}

if (import.meta.main) {
  const { artifactPath, activeModel } = parseArgs(process.argv.slice(2));
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const decisions = decideFromShadowAbArtifact(artifact, activeModel);
  process.stdout.write(
    `${JSON.stringify({ schema_version: "s154-403-switch-decision.v2", active_model: activeModel, decisions }, null, 2)}\n`,
  );
}
