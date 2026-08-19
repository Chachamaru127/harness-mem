import type { Database } from "bun:sqlite";

export type ContentDedupeClaimOutcome =
  | "claimed"
  | "duplicate"
  | "replacement"
  | "protected_expired"
  | "project_mismatch";

export interface ContentDedupeClaimResult {
  canonical_observation_id: string;
  displaced_observation_id: string | null;
  outcome: ContentDedupeClaimOutcome;
  generation: number;
}

export function contentDedupeProtectionMask(
  privacyTags: readonly string[],
  tags: readonly string[],
): number {
  const normalized = new Set([...privacyTags, ...tags].map((tag) => tag.trim().toLowerCase()));
  return (normalized.has("private") ? 1 : 0)
    | (normalized.has("secret") ? 2 : 0)
    | (normalized.has("sensitive") ? 4 : 0)
    | (normalized.has("legal_hold") ? 8 : 0);
}

/**
 * The claim row is deliberately narrow. Ordinary duplicates update only this
 * projection and return the canonical ID from the same PK statement; the
 * observation table and FTS triggers are not touched.
 */
export function arbitrateContentDedupeClaim(
  db: Database,
  input: {
    hash: string;
    observationId: string;
    project: string;
    expiresAt: string | null;
    protectionMask: number;
    now: string;
  },
): ContentDedupeClaimResult {
  const row = db.query<ContentDedupeClaimResult, [string, string, string, string | null, number, string]>(`
    INSERT INTO mem_content_dedupe_claims(
      content_dedupe_hash, canonical_observation_id, project, expires_at,
      protection_mask, generation, last_outcome, displaced_observation_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 'claimed', NULL, ?)
    ON CONFLICT(content_dedupe_hash) DO UPDATE SET
      displaced_observation_id = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.expires_at IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) <= julianday(excluded.updated_at)
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN mem_content_dedupe_claims.canonical_observation_id ELSE NULL END,
      canonical_observation_id = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.expires_at IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) <= julianday(excluded.updated_at)
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN excluded.canonical_observation_id
        ELSE mem_content_dedupe_claims.canonical_observation_id END,
      expires_at = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.expires_at IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) <= julianday(excluded.updated_at)
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN excluded.expires_at ELSE mem_content_dedupe_claims.expires_at END,
      protection_mask = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.expires_at IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) <= julianday(excluded.updated_at)
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN excluded.protection_mask ELSE mem_content_dedupe_claims.protection_mask END,
      generation = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.expires_at IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) <= julianday(excluded.updated_at)
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN mem_content_dedupe_claims.generation + 1
        ELSE mem_content_dedupe_claims.generation END,
      last_outcome = CASE
        WHEN mem_content_dedupe_claims.project <> excluded.project THEN 'project_mismatch'
        WHEN mem_content_dedupe_claims.expires_at IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) <= julianday(excluded.updated_at)
          AND mem_content_dedupe_claims.protection_mask <> 0 THEN 'protected_expired'
        WHEN mem_content_dedupe_claims.expires_at IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) IS NOT NULL
          AND julianday(mem_content_dedupe_claims.expires_at) <= julianday(excluded.updated_at)
          THEN 'replacement'
        ELSE 'duplicate' END,
      updated_at = excluded.updated_at
    RETURNING canonical_observation_id, displaced_observation_id,
      last_outcome AS outcome, generation
  `).get(
    input.hash,
    input.observationId,
    input.project,
    input.expiresAt,
    input.protectionMask,
    input.now,
  );
  if (!row) throw new Error("content dedupe claim arbitration returned no row");
  return row;
}

export function swapContentDedupeClaimForRestore(
  db: Database,
  input: {
    hash: string;
    observationId: string;
    project: string;
    expiresAt: string | null;
    protectionMask: number;
    now: string;
  },
): ContentDedupeClaimResult {
  const row = db.query<ContentDedupeClaimResult, [string, string, string, string | null, number, string]>(`
    INSERT INTO mem_content_dedupe_claims(
      content_dedupe_hash, canonical_observation_id, project, expires_at,
      protection_mask, generation, last_outcome, displaced_observation_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 'claimed', NULL, ?)
    ON CONFLICT(content_dedupe_hash) DO UPDATE SET
      displaced_observation_id = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN mem_content_dedupe_claims.canonical_observation_id ELSE NULL END,
      canonical_observation_id = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN excluded.canonical_observation_id
        ELSE mem_content_dedupe_claims.canonical_observation_id END,
      project = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN excluded.project ELSE mem_content_dedupe_claims.project END,
      expires_at = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN excluded.expires_at ELSE mem_content_dedupe_claims.expires_at END,
      protection_mask = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN excluded.protection_mask ELSE mem_content_dedupe_claims.protection_mask END,
      generation = CASE
        WHEN mem_content_dedupe_claims.project = excluded.project
          AND mem_content_dedupe_claims.protection_mask = 0
        THEN mem_content_dedupe_claims.generation + 1
        ELSE mem_content_dedupe_claims.generation END,
      last_outcome = CASE
        WHEN mem_content_dedupe_claims.project <> excluded.project THEN 'project_mismatch'
        WHEN mem_content_dedupe_claims.protection_mask <> 0 THEN 'protected_expired'
        ELSE 'replacement' END,
      updated_at = excluded.updated_at
    RETURNING canonical_observation_id, displaced_observation_id,
      last_outcome AS outcome, generation
  `).get(
    input.hash, input.observationId, input.project, input.expiresAt,
    input.protectionMask, input.now,
  );
  if (!row) throw new Error("content dedupe restore claim swap returned no row");
  return row;
}
