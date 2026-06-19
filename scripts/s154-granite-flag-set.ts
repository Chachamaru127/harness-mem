#!/usr/bin/env bun
/**
 * S154-512: audited embedding_default_model flag setter (execution-time only).
 *
 * Wraps ConfigManager.setEmbeddingDefaultModel (mem_meta upsert + audit log).
 * Default is --dry-run; pass --execute to write.
 *
 *   ~/.bun/bin/bun run scripts/s154-granite-flag-set.ts --dry-run --to granite-embedding-311m-r2@384
 *   ~/.bun/bin/bun run scripts/s154-granite-flag-set.ts --execute --to multilingual-e5
 */

import { Database } from "bun:sqlite";
import { resolveHomePath } from "../memory-server/src/core/core-utils";
import {
  getEmbeddingDefaultModel,
  setEmbeddingDefaultModel,
} from "../memory-server/src/core/config-manager";

const GRANITE_TARGET = "granite-embedding-311m-r2@384";
const E5_INCUMBENT = "multilingual-e5";

function parseArgs(argv: string[]): { dbPath: string; target: string; execute: boolean } {
  let dbPath = "~/.harness-mem/harness-mem.db";
  let target = "";
  let execute = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--db" && argv[i + 1]) {
      dbPath = argv[++i];
    } else if (token === "--to" && argv[i + 1]) {
      target = argv[++i];
    } else if (token === "--dry-run") {
      execute = false;
    } else if (token === "--execute") {
      execute = true;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write(
        "Usage: bun run scripts/s154-granite-flag-set.ts [--db PATH] --to MODEL[@DIM] [--dry-run|--execute]\n" +
          `  flip target:  --to ${GRANITE_TARGET}\n` +
          `  rollback:     --to ${E5_INCUMBENT}\n`,
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }

  if (!target) {
    throw new Error("--to is required");
  }

  return { dbPath: resolveHomePath(dbPath), target, execute };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  let previous: string;
  if (args.execute) {
    const db = new Database(args.dbPath);
    try {
      db.exec("PRAGMA busy_timeout = 30000");
      previous = setEmbeddingDefaultModel(db, args.target);
    } finally {
      db.close();
    }
  } else {
    const db = new Database(args.dbPath, { readonly: true });
    try {
      previous = getEmbeddingDefaultModel(db);
    } finally {
      db.close();
    }
  }

  const payload = {
    schema_version: "s154-512-granite-flag-set.v1",
    task_id: "S154-512",
    dry_run: !args.execute,
    db_path: args.dbPath,
    previous,
    next: args.target,
    executed: args.execute,
    restart_required: true,
    restart_command: "scripts/harness-memd restart",
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  if (!args.execute) {
    process.stderr.write(
      "[s154-512-flag-set] dry-run only — re-run with --execute after preflight + operator approval\n",
    );
  }
}
