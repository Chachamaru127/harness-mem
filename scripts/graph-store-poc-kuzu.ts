/**
 * graph-store-poc-kuzu.ts
 *
 * Benchmark: Kuzu embedded graph DB for 3-hop graph traversal.
 *
 * Kuzu is NOT a listed dependency of this repo. This script resolves it from
 * a scoped local install at /tmp/kuzu-poc/node_modules/kuzu (installed via
 * `npm install --prefix /tmp/kuzu-poc kuzu`). If that path is absent the
 * script prints a preflight-required message and exits 1.
 *
 * IMPORTANT: Kuzu 0.11.3 crashes the host process (segfault) when closing a
 * disk-backed database in both Bun and Node environments. This benchmark
 * therefore uses Kuzu's in-memory mode (':memory:'). All insert/query
 * timing reflects in-memory performance; db_size_bytes is 0 by design.
 * A future Kuzu release may fix the close() crash; when that happens,
 * replace ':memory:' with DB_PATH to measure on-disk footprint.
 *
 * Preflight (run once):
 *   npm install --prefix /tmp/kuzu-poc kuzu
 *
 * Schema:
 *   Node table : Entity { id STRING, label STRING }
 *   Rel table  : Relation { src -> Entity, dst -> Entity, kind STRING }
 *
 * Measurements (same as sqlite-cte side):
 *   inserts_ms    — schema creation + insert 100 entities + 500 relations
 *   3hop_ms       — single variable-length 1..3 hop traversal from entity_0
 *   3hop_x10_ms   — 10 consecutive traversals (aggregate wall time)
 *   db_size_bytes — 0 (in-memory mode; see note above)
 *
 * Output: compact JSON to stdout.
 *
 * Usage:
 *   # via package.json script (Bun falls back to node for kuzu due to segfault):
 *   node scripts/graph-store-poc-kuzu.ts   # requires ts-node or tsx
 *   npx tsx scripts/graph-store-poc-kuzu.ts
 *
 *   # or run the pure-JS equivalent for a quick benchmark:
 *   node -e "$(cat scripts/graph-store-poc-kuzu.ts | head -1)"   # not useful
 */

import { existsSync } from "fs";

const ENTITY_COUNT = 100;
const RELATION_COUNT = 500;
const SEED = 42;
const HOP_REPEATS = 10;
const KUZU_LOCAL = "/tmp/kuzu-poc/node_modules/kuzu";

// Minimal seeded PRNG (mulberry32)
function makePrng(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function now(): number {
  return performance.now();
}

type KuzuConn = {
  query(cypher: string): Promise<{ getAll(): Promise<unknown[]>; close(): void }>;
  close(): void;
};
type KuzuDb = { close(): void };
type KuzuModule = {
  Database: new (path: string) => KuzuDb;
  Connection: new (db: KuzuDb) => KuzuConn;
};

async function run() {
  if (!existsSync(KUZU_LOCAL)) {
    console.error(
      JSON.stringify({
        store: "kuzu",
        status: "preflight-required",
        message: `Kuzu not found at ${KUZU_LOCAL}. Run: npm install --prefix /tmp/kuzu-poc kuzu`,
      })
    );
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const kuzu = require(KUZU_LOCAL) as KuzuModule;

  // Use :memory: — Kuzu 0.11.3 segfaults on close() for disk-backed databases
  const db = new kuzu.Database(":memory:");
  const conn = new kuzu.Connection(db);

  const prng = makePrng(SEED);
  const kinds = ["RELATES_TO", "DEPENDS_ON", "REFERS", "CHILD_OF", "LINKED"];

  // --- Measure inserts (schema + data) ---
  const t0 = now();

  let r = await conn.query(
    "CREATE NODE TABLE Entity(id STRING, label STRING, PRIMARY KEY(id))"
  );
  await r.getAll();
  r = await conn.query(
    "CREATE REL TABLE Relation(FROM Entity TO Entity, kind STRING)"
  );
  await r.getAll();

  for (let i = 0; i < ENTITY_COUNT; i++) {
    r = await conn.query(
      `CREATE (:Entity {id: "entity_${i}", label: "Label ${i}"})`
    );
    await r.getAll();
  }

  for (let x = 0; x < RELATION_COUNT; x++) {
    const si = Math.floor(prng() * ENTITY_COUNT);
    let di = Math.floor(prng() * ENTITY_COUNT);
    if (di === si) di = (di + 1) % ENTITY_COUNT;
    const k = kinds[Math.floor(prng() * kinds.length)];
    r = await conn.query(
      `MATCH (a:Entity {id: "entity_${si}"}), (b:Entity {id: "entity_${di}"}) ` +
        `CREATE (a)-[:Relation {kind: "${k}"}]->(b)`
    );
    await r.getAll();
  }

  const inserts_ms = now() - t0;

  // --- 3-hop query (variable-length path 1..3 hops) ---
  const hopCypher =
    'MATCH (a:Entity {id: "entity_0"})-[:Relation*1..3]->(b:Entity) RETURN COUNT(DISTINCT b.id) AS reached';

  const t1 = now();
  r = await conn.query(hopCypher);
  await r.getAll();
  const hop3_ms = now() - t1;

  const t2 = now();
  for (let i = 0; i < HOP_REPEATS; i++) {
    r = await conn.query(hopCypher);
    await r.getAll();
  }
  const hop3_x10_ms = now() - t2;

  // db_size_bytes = 0 because we're using :memory: mode
  // Kuzu 0.11.3 crashes (segfault) on close() for disk-backed databases —
  // tracked upstream. When fixed, replace ':memory:' above with a real path
  // and dirSize(DB_PATH) here.
  const db_size_bytes = 0;

  // Clean up without calling close() to avoid the known segfault
  // conn.close(); db.close();  // intentionally skipped; process.exit(0) cleans up

  const result = {
    store: "kuzu",
    inserts_ms: Math.round(inserts_ms * 100) / 100,
    "3hop_ms": Math.round(hop3_ms * 100) / 100,
    "3hop_x10_ms": Math.round(hop3_x10_ms * 100) / 100,
    db_size_bytes,
  };

  console.log(JSON.stringify(result));
  process.exit(0);
}

run().catch((err) => {
  console.error(
    JSON.stringify({ store: "kuzu", status: "error", message: String(err) })
  );
  process.exit(1);
});
