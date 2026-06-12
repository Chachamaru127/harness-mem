/**
 * S154-511: granite mrl-384 re-embed backfill CLI.
 *
 * Re-embeds every active observation into the Granite MRL-384 vector space
 * (`granite-embedding-311m-r2` truncated to 384) and writes the rows under a
 * distinct `model` value, leaving the incumbent `local:multilingual-e5` index —
 * and therefore live search — untouched while it runs. The job is resumable
 * (re-run picks up the rows still missing) and emits a verification artifact the
 * flag flip (154-512) consumes.
 *
 *   bun run scripts/s154-granite-backfill.ts [--db <path>] [--dry-run]
 *       [--batch <n>] [--verify-sample <n>] [--cosine-threshold <f>]
 *       [--artifact <path>]
 *
 * --dry-run reports the target/coverage counts without loading the model or
 * writing vectors, so it is the safe smoke check. A real run loads the local
 * ONNX provider (which the bun test runner cannot host in-process), so the
 * resumable batch core lives in memory-server and is unit-tested with a fake
 * provider; this script only wires the real provider and I/O.
 */

import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveHomePath } from "../memory-server/src/core/core-utils";
import {
  runGraniteBackfill,
  GRANITE_BACKFILL_DIMENSION,
  type BackfillEmbedBatch,
  type GraniteBackfillResult,
} from "../memory-server/src/core/granite-backfill";
import { createLocalOnnxEmbeddingProvider } from "../memory-server/src/embedding/local-onnx";
import { ModelManager } from "../memory-server/src/embedding/model-manager";
import { findModelById } from "../memory-server/src/embedding/model-catalog";
import type { EmbeddingProvider } from "../memory-server/src/embedding/types";
import { resolveSqliteVecExtensionPath } from "../memory-server/src/db/custom-sqlite-preflight";

const MODEL_ID = "granite-embedding-311m-r2";
const DEFAULT_DB_PATH = "~/.harness-mem/harness-mem.db";
const DEFAULT_BATCH = 64;
const DEFAULT_VERIFY_SAMPLE = 32;
const DEFAULT_COSINE_THRESHOLD = 0.999;
const DEFAULT_ARTIFACT = "docs/benchmarks/artifacts/s154-granite-backfill/verification.json";
const EMBED_CHUNK = 32;

interface Args {
  dbPath: string;
  dryRun: boolean;
  batch: number;
  verifySample: number;
  cosineThreshold: number;
  artifact: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dbPath: DEFAULT_DB_PATH,
    dryRun: false,
    batch: DEFAULT_BATCH,
    verifySample: DEFAULT_VERIFY_SAMPLE,
    cosineThreshold: DEFAULT_COSINE_THRESHOLD,
    artifact: DEFAULT_ARTIFACT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db" || arg === "--db-path") args.dbPath = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--batch") args.batch = Number(argv[++i]);
    else if (arg === "--verify-sample") args.verifySample = Number(argv[++i]);
    else if (arg === "--cosine-threshold") args.cosineThreshold = Number(argv[++i]);
    else if (arg === "--artifact") args.artifact = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: bun run scripts/s154-granite-backfill.ts [--db <path>] [--dry-run] " +
          "[--batch <n>] [--verify-sample <n>] [--cosine-threshold <f>] [--artifact <path>]\n",
      );
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

/** Granite MRL-384 provider, built directly (mirrors scripts/s154-embedding-shadow-ab.ts). */
function resolveGraniteProvider(): EmbeddingProvider {
  const entry = findModelById(MODEL_ID);
  if (!entry) throw new Error(`[s154-511] model missing from catalog: ${MODEL_ID}`);
  if (entry.matryoshka !== true) {
    throw new Error(`[s154-511] ${MODEL_ID} is not declared matryoshka; cannot truncate to ${GRANITE_BACKFILL_DIMENSION}`);
  }
  const manager = new ModelManager(process.env.HARNESS_MEM_LOCAL_MODELS_DIR);
  const modelPath = manager.getModelPath(MODEL_ID);
  if (!modelPath) {
    throw new Error(`[s154-511] ${MODEL_ID} is not installed (run 'harness-mem model pull ${MODEL_ID}')`);
  }
  return createLocalOnnxEmbeddingProvider({
    modelId: MODEL_ID,
    modelPath,
    dimension: GRANITE_BACKFILL_DIMENSION,
    nativeDimension: entry.nativeDimension ?? entry.dimension,
    matryoshka: entry.matryoshka,
    pooling: entry.pooling,
    appendText: entry.appendText,
    maxSeqLength: entry.maxSeqLength,
    queryPrefix: entry.queryPrefix,
    passagePrefix: entry.passagePrefix,
  });
}

function makeEmbedBatch(provider: EmbeddingProvider): BackfillEmbedBatch {
  const primeBatch = (provider as unknown as {
    primeBatch?: (texts: string[], mode: "passage" | "query") => Promise<number[][]>;
  }).primeBatch;
  if (typeof primeBatch !== "function") {
    throw new Error(`[s154-511] provider ${provider.model} does not expose primeBatch`);
  }
  return async (texts) => {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_CHUNK) {
      vectors.push(...(await primeBatch.call(provider, texts.slice(i, i + EMBED_CHUNK), "passage")));
    }
    return vectors;
  };
}

/**
 * Load the sqlite-vec (vec0) extension onto this CLI's standalone `Database`
 * handle, mirroring `resolveVectorEngine` in src/vector/providers.ts. Bun opens
 * its `Database` without extensions, so without this the core's
 * `upsertSqliteVecRow` → `ensureSqliteVecTableForModel` `CREATE VIRTUAL TABLE
 * ... vec0` throws and the sidecar write is a silent no-op on every row. We
 * return the load result so the caller passes it to `runGraniteBackfill` as
 * `sqliteVecAvailable`: only then is sidecar row-count parity enforced. When the
 * extension is genuinely unavailable (CI, unsupported platform) the run still
 * succeeds against mem_vectors and parity is not enforced — same graceful
 * degradation as the live server path.
 */
function loadSqliteVec(db: Database): boolean {
  const extensionPath = resolveSqliteVecExtensionPath();
  if (!extensionPath) return false;
  try {
    const dbAny = db as unknown as { loadExtension?: (path: string) => void };
    if (typeof dbAny.loadExtension !== "function") return false;
    dbAny.loadExtension(extensionPath);
    // Prove the extension is actually usable on this handle, not just loaded:
    // a vec0 virtual table is what every sidecar write depends on.
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS __s154_vec_probe USING vec0(embedding float[4]);");
    db.exec("DROP TABLE IF EXISTS __s154_vec_probe;");
    return true;
  } catch {
    return false;
  }
}

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "estimating";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const resolvedDbPath = args.dbPath === ":memory:" ? ":memory:" : resolve(resolveHomePath(args.dbPath));
  const db = new Database(resolvedDbPath, { readwrite: !args.dryRun, readonly: args.dryRun });

  let result: GraniteBackfillResult;
  try {
    if (args.dryRun) {
      // Dry-run never loads the model; the core short-circuits before embedding.
      const noopEmbed: BackfillEmbedBatch = async () => {
        throw new Error("[s154-511] dry-run must not embed");
      };
      result = await runGraniteBackfill({ db, embedBatch: noopEmbed, dryRun: true });
    } else {
      const provider = resolveGraniteProvider();
      const embedBatch = makeEmbedBatch(provider);
      // Load vec0 on this handle before any write so the sidecar tables actually
      // exist; the result gates sidecar-parity verification.
      const sqliteVecAvailable = loadSqliteVec(db);
      if (!sqliteVecAvailable) {
        process.stderr.write(
          "[s154-511] sqlite-vec extension not loadable on this handle — sidecar writes are no-ops " +
            "and sidecar parity will NOT be verified (mem_vectors is still backfilled)\n",
        );
      }
      // Warm the model so the first batch's throughput is representative.
      await embedBatch(["__warmup__"]);
      result = await runGraniteBackfill({
        db,
        embedBatch,
        sqliteVecAvailable,
        batchSize: args.batch,
        verifySampleSize: args.verifySample,
        cosineThreshold: args.cosineThreshold,
        onProgress: (p) => {
          const pct = p.total > 0 ? Math.round((p.processed / p.total) * 100) : 100;
          const tput = p.throughput_per_s ? `${p.throughput_per_s.toFixed(0)}/s` : "warming";
          process.stderr.write(
            `[granite-backfill] ${p.processed}/${p.total} (${pct}%) ${tput} eta=${formatEta(p.eta_seconds)}\n`,
          );
        },
      });
    }
  } finally {
    db.close();
  }

  if (!args.dryRun) {
    const artifactPath = resolve(resolveHomePath(args.artifact));
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    result = { ...result, artifact_path: artifactPath } as GraniteBackfillResult & { artifact_path: string };
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!args.dryRun && !result.verification.passed) {
    process.stderr.write("[s154-511] verification did not pass — flag flip (154-512) is not yet authorized\n");
    process.exit(2);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[s154-511] fatal:", err);
    process.exit(1);
  });
}
