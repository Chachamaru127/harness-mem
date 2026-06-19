/**
 * S81-B03: Contradiction detection unit tests.
 *
 * DoD: fixture に矛盾 pair を 3 件注入、detection precision ≥ 0.95 /
 *      recall ≥ 0.8 が 3-run で PASS。
 *
 * Our fixture plants **3 true contradiction pairs** and **2 benign
 * similar-but-agreeing pairs**. A stub adjudicator simulates the LLM:
 *   - returns contradiction=true for pairs flagged in GROUND_TRUTH.
 *   - returns false for similar-but-agreeing pairs.
 *
 * The detector walks all pairs above the Jaccard threshold, asks the
 * adjudicator per pair, and emits a `superseded` link for each confirmed
 * contradiction. We then compute precision / recall and assert the DoD
 * thresholds across 3 independent runs (determinism check).
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema, migrateSchema } from "../../src/db/schema";
import {
  detectContradictions,
  type ContradictionAdjudicator,
} from "../../src/consolidation/contradiction-detector";

function makeDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  migrateSchema(db);
  return db;
}

function insertSession(db: Database, sessionId: string, project = "p") {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, 'test', ?, ?, ?, ?)`
  ).run(sessionId, project, now, now, now);
}

function insertObservation(
  db: Database,
  args: {
    id: string;
    session_id: string;
    content: string;
    concept: string;
    project?: string;
    created_at?: string;
  }
) {
  const now = args.created_at ?? new Date().toISOString();
  db.query(
    `INSERT INTO mem_observations(id, event_id, platform, project, session_id, title, content,
       content_redacted, observation_type, memory_type, tags_json, privacy_tags_json,
       user_id, team_id, created_at, updated_at)
     VALUES (?, NULL, 'test', ?, ?, 't', ?, ?, 'context', 'semantic', '[]', '[]', 'default', NULL, ?, ?)`
  ).run(args.id, args.project ?? "p", args.session_id, args.content, args.content, now, now);
  db.query(
    `INSERT INTO mem_tags(observation_id, tag, tag_type, created_at) VALUES (?, ?, 'concept', ?)`
  ).run(args.id, args.concept, now);
}

/**
 * Fixture:
 * - 3 TRUE contradiction pairs (different concepts, same project):
 *     (deploy-a, deploy-b)          newer contradicts older wrt deploy target
 *     (db-postgres, db-mysql)       newer contradicts older wrt db engine
 *     (rate-v1, rate-v2)            newer contradicts older wrt rate limit
 * - 2 FALSE similar-but-agreeing pairs:
 *     (deploy-a, deploy-agree)       high Jaccard, same facts
 *     (db-postgres, db-agree)        high Jaccard, same facts
 */
// Keys are sorted alphabetically (matches pairKey's sort).
const GROUND_TRUTH_PAIRS = new Set([
  "deploy-a|deploy-b",
  "db-mysql|db-postgres",
  "rate-v1|rate-v2",
]);

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function stubAdjudicator(): ContradictionAdjudicator {
  return (a, b) => {
    const key = pairKey(a.observation_id, b.observation_id);
    if (GROUND_TRUTH_PAIRS.has(key)) {
      return { contradiction: true, confidence: 0.95, reason: "ground truth" };
    }
    return { contradiction: false, confidence: 0.9 };
  };
}

function seedFixture(db: Database): void {
  insertSession(db, "s1");

  // Concept: "deploy" — near-identical phrasing, small factual delta (aws→gcp).
  // 19 shared tokens / 1 differing token keeps Jaccard comfortably above 0.9.
  const deployCommon =
    "production deploy target runs on kubernetes cluster with four replicas autoscaling enabled behind load balancer using canary rollout strategy";
  insertObservation(db, {
    id: "deploy-a",
    session_id: "s1",
    concept: "deploy",
    content: deployCommon + " provider aws",
    created_at: "2026-01-01T00:00:00Z",
  });
  insertObservation(db, {
    id: "deploy-b",
    session_id: "s1",
    concept: "deploy",
    content: deployCommon + " provider gcp",
    created_at: "2026-02-01T00:00:00Z",
  });
  // Agreement — same concept and same provider.
  insertObservation(db, {
    id: "deploy-agree",
    session_id: "s1",
    concept: "deploy",
    content: deployCommon + " provider aws",
    created_at: "2026-02-05T00:00:00Z",
  });

  // Concept: "db" — postgres vs mysql contradicts; agreement restates postgres.
  const dbCommon =
    "primary datastore engine provides transactions indexing vectors wal replication backup recovery encryption at rest tooling monitoring migrations seeding pooling audit retention rotation snapshots";
  insertObservation(db, {
    id: "db-postgres",
    session_id: "s1",
    concept: "db",
    content: dbCommon + " kind postgres",
    created_at: "2026-01-05T00:00:00Z",
  });
  insertObservation(db, {
    id: "db-mysql",
    session_id: "s1",
    concept: "db",
    content: dbCommon + " kind mysql",
    created_at: "2026-02-05T00:00:00Z",
  });
  insertObservation(db, {
    id: "db-agree",
    session_id: "s1",
    concept: "db",
    content: dbCommon + " kind postgres",
    created_at: "2026-02-10T00:00:00Z",
  });

  // Concept: "ratelimit" — numeric contradiction, no agreement pair.
  const rateCommon =
    "api rate limit configuration applies globally to every tenant default policy enforced per token bucket algorithm counting requests within window";
  insertObservation(db, {
    id: "rate-v1",
    session_id: "s1",
    concept: "ratelimit",
    content: rateCommon + " threshold hundred",
    created_at: "2026-01-10T00:00:00Z",
  });
  insertObservation(db, {
    id: "rate-v2",
    session_id: "s1",
    concept: "ratelimit",
    content: rateCommon + " threshold thousand",
    created_at: "2026-02-10T00:00:00Z",
  });
}

function measure(result: {
  contradictions: Array<{ older_id: string; newer_id: string }>;
}): { precision: number; recall: number } {
  const tp = result.contradictions.filter((c) =>
    GROUND_TRUTH_PAIRS.has(pairKey(c.older_id, c.newer_id))
  ).length;
  const predicted = result.contradictions.length;
  const precision = predicted === 0 ? 1 : tp / predicted;
  const recall = tp / GROUND_TRUTH_PAIRS.size;
  return { precision, recall };
}

describe("contradiction-detector S81-B03", () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
    seedFixture(db);
  });

  test("3-run precision ≥ 0.95 / recall ≥ 0.8", async () => {
    for (let run = 0; run < 3; run += 1) {
      const fresh = makeDb();
      seedFixture(fresh);
      const result = await detectContradictions(fresh, {
        adjudicator: stubAdjudicator(),
        jaccard_threshold: 0.9,
      });
      const { precision, recall } = measure(result);
      expect(precision).toBeGreaterThanOrEqual(0.95);
      expect(recall).toBeGreaterThanOrEqual(0.8);
    }
  });

  test("writes a `superseded` link from newer → older for each confirmed pair", async () => {
    const result = await detectContradictions(db, { adjudicator: stubAdjudicator() });
    expect(result.links_created).toBeGreaterThanOrEqual(3);
    const links = db
      .query(
        `SELECT from_observation_id, to_observation_id, weight, valid_from, supersedes, invalidated_at
           FROM mem_links WHERE relation = 'superseded'`
      )
      .all() as Array<{
        from_observation_id: string;
        to_observation_id: string;
        weight: number;
        valid_from: string | null;
        supersedes: string | null;
        invalidated_at: string | null;
      }>;
    const keys = links.map((l) => pairKey(l.from_observation_id, l.to_observation_id));
    for (const k of GROUND_TRUTH_PAIRS) {
      expect(keys).toContain(k);
    }
    for (const link of links) {
      expect(link.weight).toBe(1);
      expect(link.valid_from).toBeTruthy();
      expect(link.supersedes).toBe(link.to_observation_id);
      expect(link.invalidated_at).toBeNull();
    }
  });

  test("writes valid_to and invalidated_at to older observations without rewriting content", async () => {
    const deployEventTime = "2026-01-20T12:00:00Z";
    const deployValidFrom = "2026-01-25T09:00:00Z";
    db.query(`UPDATE mem_observations SET event_time = ?, valid_from = ? WHERE id = 'deploy-b'`).run(
      deployEventTime,
      deployValidFrom
    );

    const contentBefore = new Map<string, string>();
    for (const id of ["deploy-a", "db-postgres", "rate-v1"]) {
      const row = db
        .query(`SELECT content_redacted FROM mem_observations WHERE id = ?`)
        .get(id) as { content_redacted: string };
      contentBefore.set(id, row.content_redacted);
    }

    const result = await detectContradictions(db, { adjudicator: stubAdjudicator() });
    expect(result.contradictions.length).toBeGreaterThanOrEqual(3);

    for (const pair of result.contradictions) {
      const newer = db
        .query(`SELECT event_time, valid_from, observed_at, created_at FROM mem_observations WHERE id = ?`)
        .get(pair.newer_id) as {
          event_time: string | null;
          valid_from: string | null;
          observed_at: string | null;
          created_at: string;
        };
      const expectedValidTo = newer.valid_from ?? newer.event_time ?? newer.observed_at ?? newer.created_at;
      const row = db
        .query(`SELECT content_redacted, valid_to, invalidated_at FROM mem_observations WHERE id = ?`)
        .get(pair.older_id) as { content_redacted: string; valid_to: string | null; invalidated_at: string | null };
      expect(row.content_redacted).toBe(contentBefore.get(pair.older_id));
      expect(row.valid_to).toBe(expectedValidTo);
      expect(row.invalidated_at).toBeTruthy();
      expect(row.invalidated_at).not.toBe(row.valid_to);
    }
  });

  test("future-effective replacements set valid_to and deferred link but defer invalidated_at", async () => {
    const fresh = makeDb();
    insertSession(fresh, "s-future");
    const common =
      "scheduled deploy target runs on kubernetes cluster with four replicas autoscaling behind load balancer using rollout strategy";
    insertObservation(fresh, {
      id: "future-old",
      session_id: "s-future",
      concept: "future-deploy",
      content: common + " provider aws",
      created_at: "2026-01-01T00:00:00Z",
    });
    insertObservation(fresh, {
      id: "future-new",
      session_id: "s-future",
      concept: "future-deploy",
      content: common + " provider gcp",
      created_at: "2026-02-01T00:00:00Z",
    });
    const futureValidFrom = "2999-01-01T00:00:00Z";
    fresh.query(`UPDATE mem_observations SET valid_from = ? WHERE id = 'future-new'`).run(futureValidFrom);

    const result = await detectContradictions(fresh, {
      adjudicator: () => ({ contradiction: true, confidence: 0.95 }),
      jaccard_threshold: 0.9,
    });

    expect(result.contradictions).toHaveLength(1);
    expect(result.links_created).toBe(1);
    const oldRow = fresh
      .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE id = 'future-old'`)
      .get() as { valid_to: string | null; invalidated_at: string | null };
    expect(oldRow.valid_to).toBe(futureValidFrom);
    expect(oldRow.invalidated_at).toBeNull();
    const link = fresh
      .query(`SELECT valid_from, invalidated_at FROM mem_links WHERE relation = 'superseded'`)
      .get() as { valid_from: string | null; invalidated_at: string | null };
    expect(link.valid_from).toBe(futureValidFrom);
    expect(link.invalidated_at).toBeNull();
  });

  test("multiple replacements keep the earliest valid_to cutoff on the older observation", async () => {
    const fresh = makeDb();
    insertSession(fresh, "s-earliest-cutoff");
    const common =
      "database engine runs production workloads with backups read replicas migration checks failover drills and connection pooling";
    insertObservation(fresh, {
      id: "cutoff-old",
      session_id: "s-earliest-cutoff",
      concept: "cutoff-db",
      content: common + " provider mysql",
      created_at: "2026-01-01T00:00:00Z",
    });
    insertObservation(fresh, {
      id: "cutoff-late",
      session_id: "s-earliest-cutoff",
      concept: "cutoff-db",
      content: common + " provider postgres",
      created_at: "2026-01-02T00:00:00Z",
    });
    insertObservation(fresh, {
      id: "cutoff-early",
      session_id: "s-earliest-cutoff",
      concept: "cutoff-db",
      content: common + " provider sqlite",
      created_at: "2026-01-03T00:00:00Z",
    });
    fresh.query(`UPDATE mem_observations SET valid_from = ? WHERE id = 'cutoff-late'`).run("2999-02-01T00:00:00Z");
    fresh.query(`UPDATE mem_observations SET valid_from = ? WHERE id = 'cutoff-early'`).run("2999-01-01T00:00:00Z");

    const result = await detectContradictions(fresh, {
      adjudicator: () => ({ contradiction: true, confidence: 0.95 }),
      jaccard_threshold: 0.85,
    });

    expect(result.contradictions.length).toBeGreaterThanOrEqual(2);
    const oldRow = fresh
      .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE id = 'cutoff-old'`)
      .get() as { valid_to: string | null; invalidated_at: string | null };
    expect(oldRow.valid_to).toBe("2999-01-01T00:00:00Z");
    expect(oldRow.invalidated_at).toBeNull();
  });

  test("backfilled historical observations do not expire temporally newer current observations", async () => {
    const fresh = makeDb();
    insertSession(fresh, "s-backfill");
    const common =
      "database engine runs production workloads with backups read replicas migration checks failover drills and connection pooling";
    insertObservation(fresh, {
      id: "backfill-current",
      session_id: "s-backfill",
      concept: "backfill-db",
      content: common + " provider postgres",
      created_at: "2026-03-01T00:00:00Z",
    });
    insertObservation(fresh, {
      id: "backfill-history",
      session_id: "s-backfill",
      concept: "backfill-db",
      content: common + " provider mysql",
      created_at: "2026-04-01T00:00:00Z",
    });
    fresh.query(`UPDATE mem_observations SET event_time = ? WHERE id = 'backfill-current'`).run("2026-03-01T00:00:00Z");
    fresh.query(`UPDATE mem_observations SET event_time = ? WHERE id = 'backfill-history'`).run("2025-01-01T00:00:00Z");

    const result = await detectContradictions(fresh, {
      adjudicator: () => ({ contradiction: true, confidence: 0.95 }),
      jaccard_threshold: 0.85,
    });

    expect(result.contradictions).toHaveLength(1);
    expect(result.links_created).toBe(0);
    const currentRow = fresh
      .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE id = 'backfill-current'`)
      .get() as { valid_to: string | null; invalidated_at: string | null };
    expect(currentRow.valid_to).toBeNull();
    expect(currentRow.invalidated_at).toBeNull();
  });

  test("same-effective-time corrections still supersede the earlier ingested observation", async () => {
    const fresh = makeDb();
    insertSession(fresh, "s-same-effective");
    const common =
      "database engine runs production workloads with backups read replicas migration checks failover drills and connection pooling";
    insertObservation(fresh, {
      id: "same-effective-old",
      session_id: "s-same-effective",
      concept: "same-effective-db",
      content: common + " provider mysql",
      created_at: "2026-03-01T00:00:00Z",
    });
    insertObservation(fresh, {
      id: "same-effective-correction",
      session_id: "s-same-effective",
      concept: "same-effective-db",
      content: common + " provider postgres",
      created_at: "2026-03-02T00:00:00Z",
    });
    const effectiveAt = "2026-03-01T00:00:00Z";
    fresh.query(`UPDATE mem_observations SET event_time = ? WHERE id IN ('same-effective-old', 'same-effective-correction')`).run(effectiveAt);

    const result = await detectContradictions(fresh, {
      adjudicator: () => ({ contradiction: true, confidence: 0.95 }),
      jaccard_threshold: 0.85,
    });

    expect(result.contradictions).toHaveLength(1);
    expect(result.links_created).toBe(1);
    const oldRow = fresh
      .query(`SELECT valid_to, invalidated_at FROM mem_observations WHERE id = 'same-effective-old'`)
      .get() as { valid_to: string | null; invalidated_at: string | null };
    expect(oldRow.valid_to).toBe(effectiveAt);
    expect(oldRow.invalidated_at).toBeTruthy();
  });

  test("no contradictions / no links when adjudicator always disagrees", async () => {
    const result = await detectContradictions(db, {
      adjudicator: () => ({ contradiction: false, confidence: 0.9 }),
    });
    expect(result.contradictions).toHaveLength(0);
    expect(result.links_created).toBe(0);
    const links = db
      .query(`SELECT COUNT(*) AS c FROM mem_links WHERE relation = 'superseded'`)
      .get() as { c: number };
    expect(links.c).toBe(0);
    const invalidated = db
      .query(`SELECT COUNT(*) AS c FROM mem_observations WHERE valid_to IS NOT NULL OR invalidated_at IS NOT NULL`)
      .get() as { c: number };
    expect(invalidated.c).toBe(0);
  });

  test("rejects verdicts below min_confidence", async () => {
    const result = await detectContradictions(db, {
      min_confidence: 0.99,
      adjudicator: (a, b) => ({
        contradiction: GROUND_TRUTH_PAIRS.has(pairKey(a.observation_id, b.observation_id)),
        confidence: 0.7, // deliberately below 0.99
      }),
    });
    expect(result.contradictions).toHaveLength(0);
  });

  test("is idempotent: re-running does not create duplicate superseded links", async () => {
    await detectContradictions(db, { adjudicator: stubAdjudicator() });
    const firstCount = (
      db
        .query(`SELECT COUNT(*) AS c FROM mem_links WHERE relation = 'superseded'`)
        .get() as { c: number }
    ).c;
    await detectContradictions(db, { adjudicator: stubAdjudicator() });
    const secondCount = (
      db
        .query(`SELECT COUNT(*) AS c FROM mem_links WHERE relation = 'superseded'`)
        .get() as { c: number }
    ).c;
    expect(secondCount).toBe(firstCount);
  });

  test("skips groups of size < 2 (no pairs to compare)", async () => {
    const fresh = makeDb();
    insertSession(fresh, "s-solo");
    insertObservation(fresh, {
      id: "solo",
      session_id: "s-solo",
      concept: "only",
      content: "lonely fact with no peers",
    });
    const result = await detectContradictions(fresh, { adjudicator: stubAdjudicator() });
    expect(result.scanned_groups).toBe(0);
    expect(result.candidate_pairs).toBe(0);
  });

  test("low Jaccard (<0.9) pairs are not candidates", async () => {
    const fresh = makeDb();
    insertSession(fresh, "s-low");
    insertObservation(fresh, {
      id: "lo-a",
      session_id: "s-low",
      concept: "lo",
      content: "alpha beta gamma delta epsilon",
      created_at: "2026-01-01T00:00:00Z",
    });
    insertObservation(fresh, {
      id: "lo-b",
      session_id: "s-low",
      concept: "lo",
      content: "zeta eta theta iota kappa",
      created_at: "2026-02-01T00:00:00Z",
    });
    const calls: string[] = [];
    await detectContradictions(fresh, {
      adjudicator: (a, b) => {
        calls.push(pairKey(a.observation_id, b.observation_id));
        return { contradiction: true, confidence: 1.0 };
      },
    });
    expect(calls).toHaveLength(0);
  });

  test("project filter scopes detection", async () => {
    // Add a "foreign-proj" contradiction pair that must NOT be surfaced.
    insertSession(db, "s-foreign", "other");
    const common =
      "production deploy target runs on kubernetes cluster with four replicas autoscaling enabled behind load balancer using canary rollout strategy";
    insertObservation(db, {
      id: "other-x",
      session_id: "s-foreign",
      concept: "deploy",
      project: "other",
      content: common + " provider aws",
      created_at: "2026-01-01T00:00:00Z",
    });
    insertObservation(db, {
      id: "other-y",
      session_id: "s-foreign",
      concept: "deploy",
      project: "other",
      content: common + " provider gcp",
      created_at: "2026-02-01T00:00:00Z",
    });

    const result = await detectContradictions(db, {
      adjudicator: () => ({ contradiction: true, confidence: 0.95 }),
      project: "p",
    });
    const surfaced = result.contradictions.map((c) => pairKey(c.older_id, c.newer_id));
    expect(surfaced).not.toContain(pairKey("other-x", "other-y"));
  });
});
