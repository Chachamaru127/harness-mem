/**
 * §160-001 review fix (round 2): a bench/generator script pointed at an
 * arbitrary `--db` / `--out` path can corrupt or destroy a real DB.
 *
 * `new HarnessMemCore(config)` runs `initSchema()` on construction, which
 * (for the daemon-owning process) runs `reconcileAbandonedConsolidationJobs()`
 * — a *running* consolidation job would be flipped to `failed`. On top of
 * that, s160-001-recordevent-cost-by-db-size.ts inserts synthetic
 * observations and temporarily drops/recreates the FTS triggers, and
 * s160-001-gen-synthetic-db.ts bulk-inserts millions of synthetic rows.
 * None of that must ever touch a real/shared DB.
 *
 * This guard requires the target path to resolve under a known scratch
 * root (the OS temp dir, or `/tmp`) and explicitly rejects the production
 * data directory (`~/.harness-mem/`) even if some other path happens to
 * alias into it.
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

/** Walk up to the nearest existing ancestor so realpathSync doesn't throw on a not-yet-created file/dir. */
function nearestExistingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isUnderRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

/**
 * Throws if `rawPath` does not resolve under a scratch root, or if it
 * resolves under the production `~/.harness-mem/` data directory.
 * Safe to call before the target file/dir exists (used for `--out` paths).
 */
export function assertScratchDbPath(rawPath: string, argName: string): void {
  const resolvedInput = resolve(rawPath);
  const realResolved = realpathOrSelf(nearestExistingAncestor(resolvedInput));

  const harnessMemDir = resolve(homedir(), ".harness-mem");
  const realHarnessMemDir = realpathOrSelf(nearestExistingAncestor(harnessMemDir));
  if (isUnderRoot(resolvedInput, harnessMemDir) || isUnderRoot(realResolved, realHarnessMemDir)) {
    throw new Error(
      `refusing ${argName}=${rawPath}: resolves under the production data dir (~/.harness-mem/). ` +
        `This script mutates schema/state (consolidation-job reconcile, synthetic inserts, FTS trigger ` +
        `drop/recreate) and must only ever run against a scratch DB — never a real or shared one.`,
    );
  }

  const scratchRoots = new Set<string>();
  for (const candidate of ["/tmp", tmpdir()]) {
    const real = realpathOrSelf(nearestExistingAncestor(candidate));
    if (real) scratchRoots.add(real);
  }
  const isScratch = [...scratchRoots].some(
    (root) => isUnderRoot(resolvedInput, root) || isUnderRoot(realResolved, root),
  );
  if (!isScratch) {
    throw new Error(
      `refusing ${argName}=${rawPath}: must resolve under a scratch dir (one of: ${[...scratchRoots].join(", ")}). ` +
        `This script mutates schema/state and must only ever run against a scratch DB — never a real or shared one.`,
    );
  }
}
