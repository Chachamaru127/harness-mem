/**
 * entity-extractor.ts  (§78-C02 + §F-1 / S78-C02b)
 *
 * Regex-based entity + relation extraction for graph memory.
 * Intentionally lightweight — no NLP deps.
 * PG support is out of scope; this targets SQLite only.
 *
 * §F-1 (S78-C02b) extends each extracted entity with a semantic `type`
 * (person|technology|action|other) and each relation with a semantic
 * `kind` (is_a|uses|fixes|generic).  The `kind` field on entities is
 * preserved for backward-compat (file/symbol/tag — describes how the
 * token was detected, not what it means).
 */

import {
  classifyEntityType,
  classifyRelationKind,
  type EntityType,
  type RelationKind,
} from "./nlp-lite";

export interface ExtractedEntity {
  id: string;         // lowercased label, used as dedup key
  label: string;      // original form
  kind: string;       // detection-shape: "file" | "symbol" | "tag"
  /** §F-1 semantic class — person | technology | action | other */
  type: EntityType;
}

export interface ExtractedRelation {
  src: string;        // entity id
  dst: string;        // entity id
  /**
   * §F-1 semantic relation kind: is_a | uses | fixes | generic.
   *
   * Note: pre-§F-1 this field carried the literal string "co-occurs".
   * We now collapse the previous "co-occurs" semantics into "generic"
   * (any pair that co-occurred but did not match a stronger pattern)
   * and surface the three specific patterns when matched.
   */
  kind: RelationKind;
}

// Pattern 1 — file paths (likely extensions only)
const FILE_RE = /\b([\w.-]+\.(?:ts|js|py|go|rs|md|json|sh|toml|yaml|yml))\b/g;

// Pattern 2 — CamelCase identifiers 4+ chars
const CAMEL_RE = /\b([A-Z][a-zA-Z0-9]{3,})\b/g;

// Pattern 3 — snake_case identifiers (2+ segments, each 2+ chars)
const SNAKE_RE = /\b([a-z]{2,}(?:_[a-z]{2,})+)\b/g;

const MAX_ENTITIES = 20;

/**
 * Extract entities and co-occurrence relations from a single observation text.
 *
 * @param text     Observation content (already privacy-stripped)
 * @param existingTags  Tags from the event (become entities with kind "tag")
 */
export function extractEntitiesAndRelations(
  text: string,
  existingTags: string[] = [],
): { entities: ExtractedEntity[]; relations: ExtractedRelation[] } {
  const seen = new Map<string, ExtractedEntity>();

  function add(label: string, kind: string): void {
    if (seen.size >= MAX_ENTITIES) return;
    const id = label.toLowerCase();
    if (!seen.has(id)) {
      // §F-1: assign semantic type via heuristic. We pass `text` as
      // context so honorific/disambiguation rules can fire.
      const type = classifyEntityType(label, text);
      seen.set(id, { id, label, kind, type });
    }
  }

  // Pattern: files
  for (const m of text.matchAll(FILE_RE)) {
    if (m[1]) add(m[1], "file");
  }

  // Pattern: CamelCase symbols
  for (const m of text.matchAll(CAMEL_RE)) {
    if (m[1]) add(m[1], "symbol");
  }

  // Pattern: snake_case identifiers
  for (const m of text.matchAll(SNAKE_RE)) {
    if (m[1]) add(m[1], "symbol");
  }

  // Pattern: existing tags → entities
  for (const tag of existingTags) {
    const trimmed = tag.trim();
    if (trimmed) add(trimmed, "tag");
  }

  if (seen.size > MAX_ENTITIES) {
    console.warn(`[entity-extractor] entity cap hit (${seen.size}), truncating to ${MAX_ENTITIES}`);
  }

  const entities = [...seen.values()];

  // Co-occurrence relations: every pair of entities in the same observation,
  // each tagged with its §F-1 semantic kind.
  const relations: ExtractedRelation[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      // Use original labels (not ids) for classification — pattern matches
      // are case-insensitive but label form preserves token boundaries.
      const kind = classifyRelationKind(a.label, b.label, text);
      relations.push({ src: a.id, dst: b.id, kind });
    }
  }

  return { entities, relations };
}
