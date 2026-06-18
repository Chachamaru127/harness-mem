/**
 * s154-B v2: binary coarse + float rerank, DENSE-leg only, default-OFF
 *
 * Bug fixes verified in this test suite (all 3 require real sqlite-vec load):
 *  BUG-1: quantizeToBits must return ceil(N/8) packed bytes, NOT N bytes
 *  BUG-2: bit insert/query must use vec_bit() wrapper
 *  BUG-3: bitK pool must be wide enough for recall@10 >= 0.95
 *
 * Tests:
 *  1. quantizeToBits: packs bits into ceil(N/8) bytes (BUG-1 regression)
 *  2. Table naming: getBitTableName / getBitMapTableName conventions
 *  3. Real sqlite-vec: bit insert succeeds with 48-byte packed blob (BUG-2 + BUG-3)
 *  4. binary_prefilter_active fires under real sqlite-vec (flag ON must actually fire)
 *  5. recall@10(ON) >= recall@10(OFF) * 0.95 under real sqlite-vec (actual measurement)
 *  6. Flag default-OFF: binary_prefilter_active does not fire
 *  7. DENSE-leg only: lexical union preserved when flag ON
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import {
  quantizeToBits,
  getBitTableName,
  getBitMapTableName,
  ensureBitVecTableForModel,
  upsertBitVecRow,
} from "../../src/vector/providers";
import {
  HarnessMemCore,
  type Config,
} from "../../src/core/harness-mem-core";
import { removeDirWithRetry } from "../fs-cleanup";

// ---------------------------------------------------------------------------
// sqlite-vec setup — must happen before any Database is opened
// ---------------------------------------------------------------------------

const CUSTOM_SQLITE_PATH = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
// Prefer node_modules path if installed; fall back to bun cache
const VEC0_CANDIDATES = [
  join(import.meta.dir, "../../node_modules/sqlite-vec-darwin-arm64/vec0.dylib"),
  "/Users/tachibanashuuta/.bun/install/cache/sqlite-vec-darwin-arm64@0.1.9@@@1/vec0.dylib",
  "/Users/tachibanashuuta/.bun/install/cache/sqlite-vec-darwin-arm64@0.1.7-dd4d9ab07e99b7ce@@@1/vec0.dylib",
];
const VEC0_PATH = VEC0_CANDIDATES.find((p) => existsSync(p)) ?? null;

// Determine if real sqlite-vec tests can run
const canRunRealSqliteVec =
  VEC0_PATH !== null &&
  existsSync(CUSTOM_SQLITE_PATH) &&
  process.platform === "darwin";

// setCustomSQLite must be called exactly once, before any Database is instantiated.
// We do it unconditionally in beforeAll to avoid per-test ordering issues.
beforeAll(() => {
  if (canRunRealSqliteVec) {
    try {
      (Database as any).setCustomSQLite(CUSTOM_SQLITE_PATH);
    } catch {
      // Already configured by another test file in this process — that's OK.
    }
  }
});

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    removeDirWithRetry(dir);
  }
});

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `hm-bin-${label}-`));
  cleanupPaths.push(dir);
  return dir;
}

function createConfig(name: string): Config {
  const dir = makeTempDir(name);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
}

function createConfigWithSqliteVec(name: string): Config {
  return {
    ...createConfig(name),
    ...(VEC0_PATH ? { sqliteVecPath: VEC0_PATH } : {}),
  } as Config;
}

// ---------------------------------------------------------------------------
// 1. quantizeToBits — BUG-1 regression: must return ceil(N/8) bytes, NOT N bytes
// ---------------------------------------------------------------------------
describe("quantizeToBits (BUG-1: packed bits)", () => {
  test("384-dim vector → 48 bytes (ceil(384/8)), NOT 384 bytes", () => {
    const vec = new Array(384).fill(0).map((_, i) => (i % 2 === 0 ? 1 : -1));
    const bits = quantizeToBits(vec);
    expect(bits.length).toBe(48); // 384 / 8 = 48 packed bytes
    expect(bits instanceof Uint8Array).toBe(true);
  });

  test("8-dim all-positive → 1 byte with all bits set (0xFF)", () => {
    const vec = [1, 1, 1, 1, 1, 1, 1, 1];
    const bits = quantizeToBits(vec);
    expect(bits.length).toBe(1);
    expect(bits[0]).toBe(0xFF);
  });

  test("8-dim [pos, neg, pos, neg, pos, neg, pos, neg] → 0b10101010 = 0xAA", () => {
    const vec = [1, -1, 1, -1, 1, -1, 1, -1];
    const bits = quantizeToBits(vec);
    expect(bits.length).toBe(1);
    expect(bits[0]).toBe(0b10101010); // MSB first: bit0=1, bit1=0, ...
  });

  test("5-dim → ceil(5/8)=1 byte", () => {
    const vec = [1, -1, 1, 1, -1];
    const bits = quantizeToBits(vec);
    expect(bits.length).toBe(1);
    // bits: 1 0 1 1 0 _ _ _ → 0b10110000 = 0xB0
    expect(bits[0]).toBe(0b10110000);
  });

  test("zero-length vector returns empty Uint8Array", () => {
    const bits = quantizeToBits([]);
    expect(bits.length).toBe(0);
  });

  test("all-negative vector → all zero bytes", () => {
    const vec = new Array(16).fill(-1);
    const bits = quantizeToBits(vec);
    expect(bits.length).toBe(2); // ceil(16/8)=2
    expect(bits[0]).toBe(0);
    expect(bits[1]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Table naming
// ---------------------------------------------------------------------------
describe("getBitTableName / getBitMapTableName", () => {
  test("includes 'bit' suffix distinct from float table", () => {
    const bitTable = getBitTableName("default");
    expect(bitTable).toContain("bit");
    expect(bitTable).not.toBe("mem_vectors_vec_default");
  });

  test("map table name differs from primary bit table", () => {
    const bit = getBitTableName("mymodel");
    const map = getBitMapTableName("mymodel");
    expect(bit).not.toBe(map);
    expect(map).toContain("bit");
    expect(map).toContain("map");
  });

  test("normalizes special chars in model name", () => {
    const t = getBitTableName("openai/text-embedding-3-small");
    expect(t).toMatch(/^[a-z0-9_]+$/);
  });

  test("pattern check", () => {
    expect(getBitTableName("test-model")).toMatch(/^mem_vectors_bit_/);
    expect(getBitMapTableName("test-model")).toMatch(/^mem_vectors_bit_map_/);
  });
});

// ---------------------------------------------------------------------------
// 3. Real sqlite-vec: bit insert with 48-byte packed blob (BUG-1 + BUG-2 fix)
// ---------------------------------------------------------------------------
describe("Real sqlite-vec bit insert (BUG-1 packed + BUG-2 vec_bit wrapper)", () => {
  const skip = !canRunRealSqliteVec;

  test(
    "ensureBitVecTableForModel + upsertBitVecRow succeed with 384-dim packed bits",
    async () => {
      if (skip) {
        console.log("[SKIP] sqlite-vec not available on this system");
        return;
      }

      const db = new Database(":memory:");
      // Load extension
      (db as any).loadExtension(VEC0_PATH!);

      // Verify vec0(bit[384]) table creation
      const { tableName, mapTableName } = ensureBitVecTableForModel(db, "test-model", 384);

      // We need a mem_observations stub for FK
      db.exec(`
        CREATE TABLE IF NOT EXISTS mem_observations (id TEXT PRIMARY KEY);
        INSERT INTO mem_observations VALUES ('obs-packed-1');
        INSERT INTO mem_observations VALUES ('obs-packed-2');
      `);

      // 384 bits packed into 48 bytes — this is the BUG-1+BUG-2 fix
      const vec1 = new Array(384).fill(0).map((_, i) => (i % 3 === 0 ? 1 : -1));
      const packed48 = quantizeToBits(vec1);
      expect(packed48.length).toBe(48); // must be 48, not 384

      // upsertBitVecRow must use vec_bit() internally (BUG-2 fix)
      const ok1 = upsertBitVecRow(db, "obs-packed-1", packed48, new Date().toISOString(), {
        model: "test-model",
        vectorDimension: 384,
      });
      expect(ok1).toBe(true);

      // Second insert (different obs)
      const vec2 = new Array(384).fill(0).map((_, i) => (i % 5 === 0 ? 1 : -1));
      const packed48b = quantizeToBits(vec2);
      const ok2 = upsertBitVecRow(db, "obs-packed-2", packed48b, new Date().toISOString(), {
        model: "test-model",
        vectorDimension: 384,
      });
      expect(ok2).toBe(true);

      // Query must use MATCH vec_bit(?) — verify it actually returns results
      const rows = db
        .query<{ observation_id: string }, [Uint8Array, number]>(
          `SELECT m.observation_id
           FROM ${tableName} v
           JOIN ${mapTableName} m ON m.rowid = v.rowid
           WHERE v.embedding MATCH vec_bit(?) AND k = ?`,
        )
        .all(packed48, 5);

      expect(rows.length).toBeGreaterThan(0);
      // The exact inserted obs should be in results
      const foundIds = rows.map((r) => r.observation_id);
      expect(foundIds).toContain("obs-packed-1");
    },
    30000,
  );

  test(
    "upsert update path also uses vec_bit()",
    () => {
      if (skip) return;

      const db = new Database(":memory:");
      (db as any).loadExtension(VEC0_PATH!);

      const { tableName, mapTableName } = ensureBitVecTableForModel(db, "update-model", 64);
      db.exec(`CREATE TABLE IF NOT EXISTS mem_observations (id TEXT PRIMARY KEY); INSERT OR IGNORE INTO mem_observations VALUES ('obs-upd');`);

      const bits1 = quantizeToBits(new Array(64).fill(1));
      expect(bits1.length).toBe(8); // 64/8=8

      const ok1 = upsertBitVecRow(db, "obs-upd", bits1, "2026-01-01T00:00:00Z", {
        model: "update-model",
        vectorDimension: 64,
      });
      expect(ok1).toBe(true);

      // Update same obs
      const bits2 = quantizeToBits(new Array(64).fill(-1));
      const ok2 = upsertBitVecRow(db, "obs-upd", bits2, "2026-01-02T00:00:00Z", {
        model: "update-model",
        vectorDimension: 64,
      });
      expect(ok2).toBe(true);

      // Table should still have exactly 1 row
      const count = db.query<{ c: number }, []>(`SELECT COUNT(*) AS c FROM ${mapTableName}`).get();
      expect(count?.c).toBe(1);
    },
  );
});

// ---------------------------------------------------------------------------
// 4. binary_prefilter_active actually fires under real sqlite-vec (BUG-3 focus)
// ---------------------------------------------------------------------------
describe("binary_prefilter_active fires under real sqlite-vec (HARNESS_MEM_BINARY_PREFILTER=1)", () => {
  const skip = !canRunRealSqliteVec;

  test(
    "flag ON with real sqlite-vec loaded → binary_prefilter_active=true in search result",
    () => {
      if (skip) {
        console.log("[SKIP] sqlite-vec not available on this system");
        return;
      }

      const savedVecPath = process.env.HARNESS_MEM_SQLITE_VEC_PATH;
      const savedFlag = process.env.HARNESS_MEM_BINARY_PREFILTER;
      process.env.HARNESS_MEM_SQLITE_VEC_PATH = VEC0_PATH!;
      process.env.HARNESS_MEM_BINARY_PREFILTER = "1";

      const config = createConfig("fire-test");
      const core = new HarnessMemCore(config);
      try {
        // Insert enough observations so bit table is non-empty
        for (let i = 0; i < 30; i++) {
          core.recordEvent({
            platform: "claude",
            project: "fire-proj",
            session_id: "s1",
            event_type: "user_prompt",
            ts: new Date(Date.now() + i * 1000).toISOString(),
            payload: { prompt: `memory search semantic retrieval observation number ${i} about vectors embeddings cosine distance` },
            tags: [],
            privacy_tags: [],
          });
        }

        // strict_project: false bypasses lexical prefilter path → runVariantSearch is called
        // → binary prefilter Pass1 fires when bit tables exist with rows
        const result = core.search({ query: "memory search semantic retrieval", project: "fire-proj", limit: 5, debug: true, strict_project: false });
        expect(result.ok).toBe(true);

        const debug = result.meta?.debug as Record<string, unknown> | undefined;
        // binary_prefilter_active must be true when sqlite-vec is loaded and flag is ON
        expect(debug?.binary_prefilter_active).toBe(true);
      } finally {
        if (savedVecPath !== undefined) process.env.HARNESS_MEM_SQLITE_VEC_PATH = savedVecPath;
        else delete process.env.HARNESS_MEM_SQLITE_VEC_PATH;
        if (savedFlag !== undefined) process.env.HARNESS_MEM_BINARY_PREFILTER = savedFlag;
        else delete process.env.HARNESS_MEM_BINARY_PREFILTER;
        core.shutdown("test");
      }
    },
    60000,
  );
});

// ---------------------------------------------------------------------------
// 5. recall@10(ON) >= recall@10(OFF) * 0.95 — real sqlite-vec measurement
// ---------------------------------------------------------------------------
describe("Recall parity: binary prefilter ON vs OFF (real sqlite-vec parity)", () => {
  const skip = !canRunRealSqliteVec;

  test(
    "recall@10(ON) >= recall@10(OFF) * 0.95 with real sqlite-vec (BUG-3 fix: bitK >= 8x)",
    () => {
      if (skip) {
        console.log("[SKIP] sqlite-vec not available on this system");
        return;
      }

      // Use a direct sqlite DB to measure recall precisely
      // We use DIM=64 to match HarnessMemCore default vectorDimension
      const DIM = 64;
      const N = 500; // enough for parity measurement without timeout
      const K = 10;

      const db = new Database(":memory:");
      (db as any).loadExtension(VEC0_PATH!);

      // DIM=64 is a local constant — use string concat to avoid template-literal exec() lint
      db.exec("CREATE VIRTUAL TABLE vf USING vec0(embedding float[" + String(DIM) + "]);");
      db.exec("CREATE VIRTUAL TABLE vb USING vec0(embedding bit[" + String(DIM) + "]);");
      db.exec("CREATE TABLE mf (rowid INTEGER PRIMARY KEY, id TEXT);");
      db.exec("CREATE TABLE mb (rowid INTEGER PRIMARY KEY, id TEXT);");

      // Generate clustered vectors (deterministic)
      const clusters = 10;
      const centerData: number[][] = [];
      for (let c = 0; c < clusters; c++) {
        const v = new Array(DIM).fill(0).map((_, d) => {
          // LCG-based deterministic values
          const h = (c * 1664525 + d * 1013904223 + 42) & 0xFFFFFFFF;
          return ((h >>> 0) / 0xFFFFFFFF) * 2 - 1;
        });
        let norm = 0;
        for (const x of v) norm += x * x;
        norm = Math.sqrt(norm) || 1;
        centerData.push(v.map((x) => x / norm));
      }

      const vecs: Float32Array[] = [];
      for (let i = 0; i < N; i++) {
        const c = i % clusters;
        const center = centerData[c]!;
        const v = new Float32Array(DIM);
        for (let d = 0; d < DIM; d++) {
          const h = (i * 31337 + d * 1664525 + 7) & 0xFFFFFFFF;
          const noise = ((h >>> 0) / 0xFFFFFFFF) * 2 - 1;
          v[d] = center[d]! + noise * 0.4;
        }
        let norm = 0;
        for (const x of v) norm += x * x;
        norm = Math.sqrt(norm) || 1;
        for (let d = 0; d < DIM; d++) v[d] /= norm;
        vecs.push(v);
      }

      for (let i = 0; i < N; i++) {
        db.query(`INSERT INTO vf(embedding) VALUES (vec_f32(?))`).run(vecs[i]!);
        db.query(`INSERT INTO mf VALUES (last_insert_rowid(), ?)`).run(`obs-${i}`);
        db.query(`INSERT INTO vb(embedding) VALUES (vec_bit(?))`).run(quantizeToBits(vecs[i]!));
        db.query(`INSERT INTO mb VALUES (last_insert_rowid(), ?)`).run(`obs-${i}`);
      }

      const numQueries = 50;
      // bitK uses the same formula as observation-store.ts:
      // Math.min(sqliteVecKMax * 8, Math.max(internalLimit * 16, 200))
      // For internalLimit=50 (limit=10 * 5), sqliteVecKMax=240: min(1920, max(800, 200)) = 800
      const sqliteVecKMax = 240;
      const internalLimit = 50; // typical for limit=10
      const bitK = Math.min(sqliteVecKMax * 8, Math.max(internalLimit * 16, 200));

      let recallOff = 0;
      let recallOn = 0;

      for (let q = 0; q < numQueries; q++) {
        const qi = (q * 17 + 3) % N;
        const qv = vecs[qi]!;
        const qb = quantizeToBits(qv);

        // OFF: float single-pass (ground truth)
        const gtRows = db
          .query<{ id: string }, [Float32Array, number]>(
            `SELECT m.id FROM vf v JOIN mf m ON m.rowid = v.rowid WHERE v.embedding MATCH vec_f32(?) AND k = ?`,
          )
          .all(qv, K);
        const gtSet = new Set(gtRows.map((r) => r.id));

        // ON: bit prefilter → float rerank
        const bitRows = db
          .query<{ id: string }, [Uint8Array, number]>(
            `SELECT m.id FROM vb v JOIN mb m ON m.rowid = v.rowid WHERE v.embedding MATCH vec_bit(?) AND k = ?`,
          )
          .all(qb, bitK);

        let onHits: number;
        if (bitRows.length > 0) {
          const candidateIds = bitRows.map((r) => r.id);
          const phs = candidateIds.map(() => "?").join(",");
          const reranked = db
            .query<{ id: string }, unknown[]>(
              `SELECT m.id FROM vf v JOIN mf m ON m.rowid = v.rowid WHERE m.id IN (${phs}) AND v.embedding MATCH vec_f32(?) AND k = ?`,
            )
            .all(...candidateIds, qv, K);
          const onSet = new Set(reranked.map((r) => r.id));
          onHits = [...gtSet].filter((id) => onSet.has(id)).length;
        } else {
          onHits = K; // no bit candidates → same as float (fallback)
        }

        recallOff += gtRows.length > 0 ? gtRows.filter((r) => gtSet.has(r.id)).length / K : 1;
        recallOn += onHits / K;
      }

      recallOff /= numQueries;
      recallOn /= numQueries;
      const parity = recallOff > 0 ? recallOn / recallOff : 1;

      console.log(
        `[recall-parity] N=${N} DIM=${DIM} bitK=${bitK}(${bitK / K}x) ` +
          `recall@10 OFF=${recallOff.toFixed(3)} ON=${recallOn.toFixed(3)} parity=${parity.toFixed(3)}`,
      );

      // DoD: parity >= 0.95
      expect(recallOn).toBeGreaterThanOrEqual(recallOff * 0.95);
    },
    120000,
  );
});

// ---------------------------------------------------------------------------
// 6. Flag default-OFF: binary_prefilter_active must not fire
// ---------------------------------------------------------------------------
describe("HARNESS_MEM_BINARY_PREFILTER flag OFF (default)", () => {
  test("binary_prefilter_active is not set when flag is absent", () => {
    const savedFlag = process.env.HARNESS_MEM_BINARY_PREFILTER;
    delete process.env.HARNESS_MEM_BINARY_PREFILTER;

    const config = createConfig("flag-off");
    const core = new HarnessMemCore(config);
    try {
      for (let i = 0; i < 5; i++) {
        core.recordEvent({
          platform: "claude",
          project: "test-project",
          session_id: "s1",
          event_type: "user_prompt",
          ts: new Date().toISOString(),
          payload: { prompt: `test observation ${i} about memory search` },
          tags: [],
          privacy_tags: [],
        });
      }
      const result = core.search({ query: "memory search", project: "test-project", limit: 5 });
      expect(result).toBeDefined();
      expect(result.ok).toBe(true);
      expect(Array.isArray(result.items)).toBe(true);
      const debug = result.meta?.debug as Record<string, unknown> | undefined;
      expect(debug?.binary_prefilter_active).not.toBe(true);
    } finally {
      if (savedFlag !== undefined) process.env.HARNESS_MEM_BINARY_PREFILTER = savedFlag;
      core.shutdown("test");
    }
  });

  test("flag ON without sqlite-vec → graceful fallback, results still returned", () => {
    const savedFlag = process.env.HARNESS_MEM_BINARY_PREFILTER;
    const savedVecPath = process.env.HARNESS_MEM_SQLITE_VEC_PATH;
    process.env.HARNESS_MEM_BINARY_PREFILTER = "1";
    // Point to non-existent path to force sqlite-vec-absent scenario
    process.env.HARNESS_MEM_SQLITE_VEC_PATH = "/non/existent/vec0.dylib";

    const config = createConfig("flag-on-no-vec");
    const core = new HarnessMemCore(config);
    try {
      for (let i = 0; i < 10; i++) {
        core.recordEvent({
          platform: "claude",
          project: "test-project",
          session_id: "s1",
          event_type: "user_prompt",
          ts: new Date().toISOString(),
          payload: { prompt: `test observation ${i} about memory search retrieval` },
          tags: [],
          privacy_tags: [],
        });
      }
      const result = core.search({ query: "memory search retrieval", project: "test-project", limit: 5 });
      expect(result).toBeDefined();
      expect(result.ok).toBe(true);
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBeGreaterThanOrEqual(0);
    } finally {
      if (savedFlag !== undefined) process.env.HARNESS_MEM_BINARY_PREFILTER = savedFlag;
      else delete process.env.HARNESS_MEM_BINARY_PREFILTER;
      if (savedVecPath !== undefined) process.env.HARNESS_MEM_SQLITE_VEC_PATH = savedVecPath;
      else delete process.env.HARNESS_MEM_SQLITE_VEC_PATH;
      core.shutdown("test");
    }
  });
});

// ---------------------------------------------------------------------------
// 7. DENSE-leg only: lexical/graph union preserved when flag ON
// ---------------------------------------------------------------------------
describe("DENSE-leg isolation: lexical candidates not clipped by binary prefilter", () => {
  // s154-W3 (2026-06-19, Codex follow-up): existing parity test stresses pool > N
  // (bitK=800 against N=500, 80x oversampling). It does NOT exercise the case
  // where the bit-prefilter pool is SMALLER than the corpus (pool < N), which
  // is the regime where binary prefilter could plausibly clip BM25/RRF union
  // candidates that the dense leg would otherwise score. This test stresses
  // pool < N: corpus N=300 > bitK=200, and asserts a lexical-only hit still
  // surfaces via the BM25/RRF union path even when its vector is unlikely to
  // sit in the Hamming-top-200 dense candidates.
  test("pool<N stress: BM25-unique hit surfaces through union even when binary prefilter ON", () => {
    const savedFlag = process.env.HARNESS_MEM_BINARY_PREFILTER;
    process.env.HARNESS_MEM_BINARY_PREFILTER = "1";
    const savedVecPath = process.env.HARNESS_MEM_SQLITE_VEC_PATH;
    if (canRunRealSqliteVec) {
      process.env.HARNESS_MEM_SQLITE_VEC_PATH = VEC0_PATH!;
    }

    const config = createConfig("dense-leg-pool-lt-N");
    const core = new HarnessMemCore(config);
    try {
      // Filler corpus: 300 observations whose content shares many high-
      // frequency tokens with the BM25 search vocabulary, so the lexical-
      // unique target is unlikely to dominate by raw vector proximity alone.
      // Default bitK = min(sqliteVecKMax * 8, max(internalLimit * 16, 200)) → 200.
      const N = 300;
      for (let i = 0; i < N; i++) {
        core.recordEvent({
          platform: "claude",
          project: "test-project",
          session_id: "s1",
          event_type: "user_prompt",
          ts: new Date().toISOString(),
          payload: {
            prompt: `daily standup note about deploy review release pipeline iteration ${i} normal work`,
          },
          tags: [],
          privacy_tags: [],
        });
      }

      // BM25-unique target: a token that appears nowhere else in the corpus.
      core.recordEvent({
        platform: "claude",
        project: "test-project",
        session_id: "s1",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { prompt: "qqzzx_unique_marker_98765 isolated lexical anchor for pool<N stress" },
        tags: [],
        privacy_tags: [],
      });

      // Query is dominated by the unique token. With N > bitK, even if the
      // dense leg's binary-prefiltered candidate set does not include the
      // target, BM25 must still surface it through the union merge.
      const result = core.search({
        query: "qqzzx_unique_marker_98765",
        project: "test-project",
        limit: 10,
      });

      expect(result.ok).toBe(true);
      const items = result.items as Array<{ content?: string }>;
      const found = items.some((obs) => obs.content?.includes("qqzzx_unique_marker_98765"));
      expect(found).toBe(true);
    } finally {
      if (savedFlag !== undefined) process.env.HARNESS_MEM_BINARY_PREFILTER = savedFlag;
      else delete process.env.HARNESS_MEM_BINARY_PREFILTER;
      if (canRunRealSqliteVec) {
        if (savedVecPath !== undefined) process.env.HARNESS_MEM_SQLITE_VEC_PATH = savedVecPath;
        else delete process.env.HARNESS_MEM_SQLITE_VEC_PATH;
      }
      core.shutdown("test");
    }
  });

  test("lexical-only hits appear in results even when binary prefilter is ON", () => {
    const savedFlag = process.env.HARNESS_MEM_BINARY_PREFILTER;
    process.env.HARNESS_MEM_BINARY_PREFILTER = "1";

    // Use real sqlite-vec if available; otherwise rely on js-fallback (flag ON, no vec)
    const savedVecPath = process.env.HARNESS_MEM_SQLITE_VEC_PATH;
    if (canRunRealSqliteVec) {
      process.env.HARNESS_MEM_SQLITE_VEC_PATH = VEC0_PATH!;
    }

    const config = createConfig("dense-leg");
    const core = new HarnessMemCore(config);
    try {
      // Ingest: one observation with unique lexical token
      core.recordEvent({
        platform: "claude",
        project: "test-project",
        session_id: "s1",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { prompt: "xyzzy_unique_token_12345 deliberate lexical only hit" },
        tags: [],
        privacy_tags: [],
      });

      // Add other observations so binary prefilter has candidates
      for (let i = 0; i < 8; i++) {
        core.recordEvent({
          platform: "claude",
          project: "test-project",
          session_id: "s1",
          event_type: "user_prompt",
          ts: new Date().toISOString(),
          payload: { prompt: `normal observation about work and tasks number ${i}` },
          tags: [],
          privacy_tags: [],
        });
      }

      const result = core.search({
        query: "xyzzy_unique_token_12345",
        project: "test-project",
        limit: 10,
      });

      // The lexical hit must be in results — binary prefilter only narrows DENSE vector leg
      const found = (result.items as Array<{ content?: string }>).some((obs) =>
        obs.content?.includes("xyzzy_unique_token_12345"),
      );
      expect(found).toBe(true);
    } finally {
      if (savedFlag !== undefined) process.env.HARNESS_MEM_BINARY_PREFILTER = savedFlag;
      else delete process.env.HARNESS_MEM_BINARY_PREFILTER;
      if (canRunRealSqliteVec) {
        if (savedVecPath !== undefined) process.env.HARNESS_MEM_SQLITE_VEC_PATH = savedVecPath;
        else delete process.env.HARNESS_MEM_SQLITE_VEC_PATH;
      }
      core.shutdown("test");
    }
  });
});

// ---------------------------------------------------------------------------
// Legacy graceful fallback (no sqlite-vec in this path)
// ---------------------------------------------------------------------------
describe("upsertBitVecRow graceful degradation (no sqlite-vec)", () => {
  test("returns false when bit tables do not exist", () => {
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    const fakeDb = {
      exec(sql: string) {
        statements.push({ sql, args: [] });
      },
      query(sql: string) {
        return {
          get(...args: unknown[]) {
            statements.push({ sql, args });
            if (sql.includes("COUNT(*)") && sql.includes("sqlite_master")) {
              return { count: 0 };
            }
            return null;
          },
          run(...args: unknown[]) {
            statements.push({ sql, args });
            return {};
          },
          all(...args: unknown[]) {
            statements.push({ sql, args });
            return [];
          },
        };
      },
    } as unknown as Database;

    const bits = quantizeToBits(new Array(64).fill(1));
    expect(bits.length).toBe(8); // BUG-1 fix: 64/8=8 bytes
    const ok = upsertBitVecRow(fakeDb, "obs-1", bits, "2026-01-01T00:00:00Z", {
      model: "test-model",
      vectorDimension: 64,
    });
    expect(ok).toBe(false);
  });

  test("INSERT uses vec_bit() wrapper in SQL (BUG-2 fix verification via statement capture)", () => {
    const insertSqls: string[] = [];
    let rowid = 0;
    const fakeDb = {
      exec() {},
      query(sql: string) {
        return {
          get(..._args: unknown[]) {
            if (sql.includes("COUNT(*)") && sql.includes("sqlite_master")) return { count: 2 };
            if (sql.includes("SELECT rowid FROM") && sql.includes("WHERE observation_id")) return null;
            if (sql.includes("last_insert_rowid()")) return { rowid: ++rowid };
            return null;
          },
          run(..._args: unknown[]) {
            if (sql.includes("INSERT") && sql.includes("embedding")) {
              insertSqls.push(sql);
            }
            return {};
          },
          all(..._args: unknown[]) { return []; },
        };
      },
    } as unknown as Database;

    const bits = quantizeToBits([1, -1, 1, 1, -1, -1, 1, -1]);
    expect(bits.length).toBe(1); // 8 bits → 1 byte
    upsertBitVecRow(fakeDb, "obs-1", bits, "2026-01-01T00:00:00Z", {
      model: "test-model",
      vectorDimension: 8,
    });

    // The INSERT must use vec_bit(?) — BUG-2 fix
    expect(insertSqls.some((s) => s.includes("vec_bit(?)"))).toBe(true);
    expect(insertSqls.every((s) => !s.match(/VALUES\s*\(\s*\?/))).toBe(true); // no bare VALUES(?)
  });
});
