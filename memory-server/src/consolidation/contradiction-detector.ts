/**
 * S81-B03: Contradiction detection.
 *
 * Pipeline:
 *   1. Group active (non-archived) observations by "concept" — in this
 *      codebase a concept is expressed as a shared tag in mem_tags
 *      (tag_type='concept' if present, otherwise 'topic'/'category').
 *   2. For each pair inside a group, compute a token-level Jaccard
 *      similarity over the redacted content. Pairs above a threshold
 *      (default 0.9) become LLM candidates — they're similar *enough* that
 *      either one supersedes the other or they agree.
 *   3. An injectable `adjudicate(a, b)` callback returns
 *      { contradiction: bool, confidence }; when contradiction is true the
 *      **older** observation is linked to the newer one via a `superseded`
 *      relation in mem_links.
 *
 * The adjudicator is injected because:
 *   - Unit tests run offline (no provider calls).
 *   - §81-C02 lets consolidation opt into a Claude Agent SDK provider —
 *     contradiction adjudication is the first real caller of that path.
 *
 * Design constraints:
 *   - No mutation outside adding mem_links rows. We never delete or rewrite
 *     the older observation; downstream ranking is expected to prefer the
 *     newer row via the existing link-aware logic.
 *   - `INSERT OR IGNORE` on mem_links means re-running the detector is
 *     idempotent. The uniqueness of (from, to, relation) is already a
 *     schema-level unique index.
 */

import { type Database } from "bun:sqlite";

export interface ContradictionPair {
  older_id: string;
  newer_id: string;
  project: string;
  concept: string;
  jaccard: number;
  /** Set only when the adjudicator returned a verdict for this pair. */
  verdict?: AdjudicatorVerdict;
}

export interface AdjudicatorVerdict {
  contradiction: boolean;
  confidence: number;
  reason?: string;
}

export type ContradictionAdjudicator = (
  a: ContradictionInput,
  b: ContradictionInput
) => Promise<AdjudicatorVerdict> | AdjudicatorVerdict;

export interface ContradictionInput {
  observation_id: string;
  content: string;
  created_at: string;
}

export interface ContradictionDetectorOptions {
  jaccard_threshold?: number;
  /** Limit per project/concept group — protects against O(n²) blow-ups. */
  max_pairs_per_group?: number;
  /** Confidence floor; below this the verdict is ignored. Default 0.7. */
  min_confidence?: number;
  /** Injectable adjudicator; default returns `{contradiction:false}`. */
  adjudicator?: ContradictionAdjudicator;
  project?: string;
}

export interface ContradictionDetectorResult {
  scanned_groups: number;
  candidate_pairs: number;
  contradictions: ContradictionPair[];
  links_created: number;
  jaccard_threshold: number;
  min_confidence: number;
}

const WORD_SPLIT = /[\s,.;:!?()\[\]{}"'`<>=/\\+*\-]+/u;

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(WORD_SPLIT)) {
    const t = raw.trim();
    if (t.length >= 2) out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  for (const x of smaller) if (larger.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

interface GroupRow {
  project: string;
  concept: string;
  observation_id: string;
  content: string;
  created_at: string;
}

/**
 * Load the concept groups. We match `tag_type='concept'` first; if none
 * exist we fall back to generic tags so existing installs benefit without
 * needing a migration.
 */
function loadConceptGroups(
  db: Database,
  projectFilter?: string
): Map<string, GroupRow[]> {
  const primary = db
    .query(
      `
        SELECT o.project AS project, t.tag AS concept, o.id AS observation_id,
               o.content_redacted AS content, o.created_at AS created_at
          FROM mem_observations o
          JOIN mem_tags t ON t.observation_id = o.id
         WHERE o.archived_at IS NULL
           AND t.tag_type = 'concept'
           ${projectFilter ? "AND o.project = ?" : ""}
      `
    )
    .all(...((projectFilter ? [projectFilter] : []) as never[])) as GroupRow[];

  const rows = primary.length > 0
    ? primary
    : (db
        .query(
          `
            SELECT o.project AS project, t.tag AS concept, o.id AS observation_id,
                   o.content_redacted AS content, o.created_at AS created_at
              FROM mem_observations o
              JOIN mem_tags t ON t.observation_id = o.id
             WHERE o.archived_at IS NULL
               ${projectFilter ? "AND o.project = ?" : ""}
          `
        )
        .all(...((projectFilter ? [projectFilter] : []) as never[])) as GroupRow[]);

  const groups = new Map<string, GroupRow[]>();
  for (const r of rows) {
    const key = `${r.project}::${r.concept}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  return groups;
}

export async function detectContradictions(
  db: Database,
  options: ContradictionDetectorOptions = {}
): Promise<ContradictionDetectorResult> {
  const threshold = options.jaccard_threshold ?? 0.9;
  const minConf = options.min_confidence ?? 0.7;
  const maxPairs = Math.max(1, options.max_pairs_per_group ?? 50);
  const adjudicate = options.adjudicator ?? (() => ({ contradiction: false, confidence: 0 }));

  const groups = loadConceptGroups(db, options.project);
  let scannedGroups = 0;
  let candidatePairs = 0;
  const confirmed: ContradictionPair[] = [];
  const pending: ContradictionPair[] = [];

  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    scannedGroups += 1;

    // Precompute tokens once per row.
    const tokenised = rows.map((r) => ({ row: r, tokens: tokenize(r.content) }));
    let seen = 0;
    for (let i = 0; i < tokenised.length && seen < maxPairs; i += 1) {
      for (let j = i + 1; j < tokenised.length && seen < maxPairs; j += 1) {
        const sim = jaccard(tokenised[i]!.tokens, tokenised[j]!.tokens);
        if (sim < threshold) continue;
        seen += 1;
        candidatePairs += 1;
        const a = tokenised[i]!.row;
        const b = tokenised[j]!.row;
        const [older, newer] = Date.parse(a.created_at) <= Date.parse(b.created_at) ? [a, b] : [b, a];
        pending.push({
          older_id: older.observation_id,
          newer_id: newer.observation_id,
          project: older.project,
          concept: rows[0]!.row?.concept ?? older.project, // placeholder, overwritten below
          jaccard: sim,
        });
        // Fix concept reference — rows share the same concept so use the first.
        pending[pending.length - 1]!.concept = (rows[0] as GroupRow).concept;
      }
    }
  }

  for (const pair of pending) {
    const aRow = (db
      .query(`SELECT id, content_redacted, created_at FROM mem_observations WHERE id = ?`)
      .get(pair.older_id) as { id?: string; content_redacted?: string; created_at?: string } | null);
    const bRow = (db
      .query(`SELECT id, content_redacted, created_at FROM mem_observations WHERE id = ?`)
      .get(pair.newer_id) as { id?: string; content_redacted?: string; created_at?: string } | null);
    if (!aRow || !bRow) continue;

    const verdict = await adjudicate(
      {
        observation_id: pair.older_id,
        content: aRow.content_redacted ?? "",
        created_at: aRow.created_at ?? "",
      },
      {
        observation_id: pair.newer_id,
        content: bRow.content_redacted ?? "",
        created_at: bRow.created_at ?? "",
      }
    );
    pair.verdict = verdict;
    if (verdict.contradiction && verdict.confidence >= minConf) {
      confirmed.push(pair);
    }
  }

  let linksCreated = 0;
  if (confirmed.length > 0) {
    const nowIso = new Date().toISOString();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
       VALUES (?, ?, 'superseded', 1.0, ?)`
    );
    for (const pair of confirmed) {
      const res = stmt.run(pair.newer_id, pair.older_id, nowIso) as { changes?: number };
      if ((res.changes ?? 0) > 0) linksCreated += 1;
    }
  }

  return {
    scanned_groups: scannedGroups,
    candidate_pairs: candidatePairs,
    contradictions: confirmed,
    links_created: linksCreated,
    jaccard_threshold: threshold,
    min_confidence: minConf,
  };
}
