/**
 * S108-014: temporal-graph-signal unit tests
 *
 * Verifies:
 *   1. env gate reads HARNESS_MEM_TEMPORAL_GRAPH correctly
 *   2. compute returns empty when no relations
 *   3. relation kinds map to expected polarity (updates/supersedes positive,
 *      contradicts negative)
 *   4. invalidated_at zeroes the freshness factor
 *   5. valid_to in the past gives the 0.5 freshness factor
 *   6. clamp range [-MAX_PENALTY, +MAX_BONUS] is enforced
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  computeTemporalGraphSignal,
  temporalGraphEnabled,
} from "../../src/core/temporal-graph-signal";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.query(`
    CREATE TABLE mem_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      kind TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 1.0,
      observation_id TEXT NOT NULL,
      event_time TEXT,
      observed_at TEXT,
      valid_from TEXT,
      valid_to TEXT,
      supersedes TEXT,
      invalidated_at TEXT,
      created_at TEXT NOT NULL
    )
  `).run();
  return db;
}

function insertRelation(
  db: Database,
  obsId: string,
  kind: string,
  opts: {
    strength?: number;
    valid_from?: string | null;
    valid_to?: string | null;
    invalidated_at?: string | null;
    supersedes?: string | null;
  } = {},
): void {
  db.query(
    `INSERT INTO mem_relations(src, dst, kind, strength, observation_id, valid_from, valid_to, invalidated_at, supersedes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "x",
    "y",
    kind,
    opts.strength ?? 1.0,
    obsId,
    opts.valid_from ?? null,
    opts.valid_to ?? null,
    opts.invalidated_at ?? null,
    opts.supersedes ?? null,
    "2026-05-01T00:00:00Z",
  );
}

describe("temporalGraphEnabled (env gate)", () => {
  test("default off when env var unset", () => {
    expect(temporalGraphEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  test("'1' enables", () => {
    expect(temporalGraphEnabled({ HARNESS_MEM_TEMPORAL_GRAPH: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  test("'true' (case-insensitive) enables", () => {
    expect(temporalGraphEnabled({ HARNESS_MEM_TEMPORAL_GRAPH: "TRUE" } as NodeJS.ProcessEnv)).toBe(true);
  });

  test("'0' disables", () => {
    expect(temporalGraphEnabled({ HARNESS_MEM_TEMPORAL_GRAPH: "0" } as NodeJS.ProcessEnv)).toBe(false);
  });

  test("empty string disables", () => {
    expect(temporalGraphEnabled({ HARNESS_MEM_TEMPORAL_GRAPH: "" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("computeTemporalGraphSignal — basic", () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  test("empty candidateIds returns empty map", () => {
    const result = computeTemporalGraphSignal(db, []);
    expect(result.size).toBe(0);
  });

  test("candidate with no relations returns empty map", () => {
    const result = computeTemporalGraphSignal(db, ["obs-no-rels"]);
    expect(result.size).toBe(0);
  });

  test("'updates' relation produces positive bonus", () => {
    insertRelation(db, "obs-1", "updates", { strength: 1.0 });
    const result = computeTemporalGraphSignal(db, ["obs-1"], "2026-05-09T00:00:00Z");
    expect(result.get("obs-1")).toBeGreaterThan(0);
  });

  test("'supersedes' relation produces positive bonus", () => {
    insertRelation(db, "obs-1", "supersedes", { strength: 1.0 });
    const result = computeTemporalGraphSignal(db, ["obs-1"], "2026-05-09T00:00:00Z");
    expect(result.get("obs-1")).toBeGreaterThan(0);
  });

  test("'contradicts' relation produces negative bonus", () => {
    insertRelation(db, "obs-1", "contradicts", { strength: 1.0 });
    const result = computeTemporalGraphSignal(db, ["obs-1"], "2026-05-09T00:00:00Z");
    expect(result.get("obs-1")).toBeLessThan(0);
  });
});

describe("computeTemporalGraphSignal — freshness factor", () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  test("invalidated_at zeroes the bonus", () => {
    insertRelation(db, "obs-1", "updates", {
      strength: 1.0,
      invalidated_at: "2026-04-01T00:00:00Z",
    });
    const result = computeTemporalGraphSignal(db, ["obs-1"], "2026-05-09T00:00:00Z");
    const bonus = result.get("obs-1") ?? 0;
    expect(bonus).toBe(0);
  });

  test("valid_to expired but not invalidated → half bonus", () => {
    insertRelation(db, "obs-live", "updates", { strength: 1.0 });
    insertRelation(db, "obs-expired", "updates", {
      strength: 1.0,
      valid_to: "2026-01-01T00:00:00Z",
    });
    const result = computeTemporalGraphSignal(
      db,
      ["obs-live", "obs-expired"],
      "2026-05-09T00:00:00Z",
    );
    const live = result.get("obs-live") ?? 0;
    const expired = result.get("obs-expired") ?? 0;
    expect(live).toBeGreaterThan(0);
    expect(expired).toBeGreaterThan(0);
    expect(expired).toBeCloseTo(live * 0.5, 3);
  });

  test("valid_to in future → live bonus", () => {
    insertRelation(db, "obs-future", "updates", {
      strength: 1.0,
      valid_to: "2027-01-01T00:00:00Z",
    });
    const result = computeTemporalGraphSignal(db, ["obs-future"], "2026-05-09T00:00:00Z");
    expect(result.get("obs-future")).toBeGreaterThan(0);
  });
});

describe("computeTemporalGraphSignal — confidence propagation", () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  test("strength scales bonus linearly", () => {
    insertRelation(db, "obs-strong", "updates", { strength: 1.0 });
    insertRelation(db, "obs-weak", "updates", { strength: 0.25 });
    const result = computeTemporalGraphSignal(
      db,
      ["obs-strong", "obs-weak"],
      "2026-05-09T00:00:00Z",
    );
    const strong = result.get("obs-strong") ?? 0;
    const weak = result.get("obs-weak") ?? 0;
    expect(strong).toBeGreaterThan(weak);
    expect(weak).toBeCloseTo(strong * 0.25, 3);
  });
});

describe("computeTemporalGraphSignal — clamp range", () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  test("many positive relations clamp to MAX_BONUS = 1.0", () => {
    for (let i = 0; i < 50; i++) {
      insertRelation(db, "obs-spam", "updates", { strength: 1.0 });
    }
    const result = computeTemporalGraphSignal(db, ["obs-spam"], "2026-05-09T00:00:00Z");
    expect(result.get("obs-spam")).toBeLessThanOrEqual(1.0);
    expect(result.get("obs-spam")).toBe(1.0);
  });

  test("many negative relations clamp to MAX_PENALTY = -0.5", () => {
    for (let i = 0; i < 50; i++) {
      insertRelation(db, "obs-bad", "contradicts", { strength: 1.0 });
    }
    const result = computeTemporalGraphSignal(db, ["obs-bad"], "2026-05-09T00:00:00Z");
    expect(result.get("obs-bad")).toBeGreaterThanOrEqual(-0.5);
    expect(result.get("obs-bad")).toBe(-0.5);
  });
});

describe("computeTemporalGraphSignal — graceful failure", () => {
  test("missing mem_relations table returns empty map without throwing", () => {
    const db = new Database(":memory:");
    try {
      const result = computeTemporalGraphSignal(db, ["obs-1"], "2026-05-09T00:00:00Z");
      expect(result.size).toBe(0);
    } finally {
      db.close();
    }
  });
});
