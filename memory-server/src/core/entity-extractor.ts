/**
 * entity-extractor.ts  (§78-C02)
 *
 * Regex-based entity + relation extraction for graph memory.
 * Intentionally lightweight — no NLP deps.
 * PG support is out of scope; this targets SQLite only.
 * (PG upgrade path: migrate mem_relations to a partitioned PG table in a future §78-C02b spike.)
 */

export interface ExtractedEntity {
  id: string;      // lowercased label, used as dedup key
  label: string;   // original form
  kind: string;    // "file" | "symbol" | "tag"
}

export interface ExtractedRelation {
  src: string;     // entity id
  dst: string;     // entity id
  kind: string;    // "co-occurs"
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
      seen.set(id, { id, label, kind });
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

  // Co-occurrence relations: every pair of entities in the same observation
  const ids = entities.map((e) => e.id);
  const relations: ExtractedRelation[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      relations.push({ src: ids[i], dst: ids[j], kind: "co-occurs" });
    }
  }

  return { entities, relations };
}
