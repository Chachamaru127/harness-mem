import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, openSync } from "node:fs";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { resolveHomePath } from "./core-utils";

const DEFAULT_MAX_INTENTS = 10_000;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const ALLOWED_AUDIT_ACTIONS = new Set(["read.search", "privacy_filter", "boundary_filter", "search_hit"]);
const ALLOWED_TARGET_TYPES = new Set(["project", "search", "observation"]);

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateAuditDetails(action: SearchAuditIntentRecord["action"], details: Record<string, unknown>): boolean {
  if (action === "read.search") {
    return hasOnlyKeys(details, [
      "query", "limit", "include_private", "count", "privacy_excluded_count", "boundary_excluded_count",
    ]) && typeof details.query === "string" && isCount(details.limit) &&
      typeof details.include_private === "boolean" && isCount(details.count) &&
      isCount(details.privacy_excluded_count) && isCount(details.boundary_excluded_count);
  }
  if (action === "privacy_filter") {
    return hasOnlyKeys(details, ["reason", "query", "returned_count", "excluded_count", "path", "ts"]) &&
      details.reason === "include_private_false" && typeof details.query === "string" &&
      isCount(details.returned_count) && isCount(details.excluded_count) &&
      typeof details.path === "string" && typeof details.ts === "string";
  }
  if (action === "boundary_filter") {
    return hasOnlyKeys(details, ["reason", "excluded_count", "project"]) &&
      details.reason === "workspace_boundary" && isCount(details.excluded_count) &&
      (details.project === undefined || typeof details.project === "string");
  }
  return hasOnlyKeys(details, ["query", "project"]) &&
    (details.query === undefined || typeof details.query === "string") &&
    (details.project === undefined || typeof details.project === "string");
}

export interface SearchAuditIntentRecord {
  action: "read.search" | "privacy_filter" | "boundary_filter" | "search_hit";
  target_type: "project" | "search" | "observation";
  target_id: string;
  details: Record<string, unknown>;
}

export interface SearchSideEffectIntent {
  audits: SearchAuditIntentRecord[];
  access_count_ids: string[];
  created_at: string;
}

interface StoredIntent extends SearchSideEffectIntent {
  intent_id: string;
  sequence: number;
}

export class SearchAuditBackpressureError extends Error {
  readonly code = "audit_backpressure";

  constructor() {
    super("search audit side-effect spool unavailable");
    this.name = "SearchAuditBackpressureError";
  }
}

export function searchSideEffectSpoolPath(dbPath: string): string {
  return `${resolveHomePath(dbPath)}.search-side-effects.sqlite`;
}

export function hasPendingSearchSideEffects(dbPath: string): boolean {
  const path = searchSideEffectSpoolPath(dbPath);
  if (!existsSync(path)) return false;
  let spool: SearchSideEffectSpool | null = null;
  try {
    spool = new SearchSideEffectSpool(dbPath);
    return spool.count() > 0;
  } catch {
    return true;
  } finally {
    spool?.close();
  }
}

function openPrivateSpool(path: string): Database {
  const fd = openSync(path, "a", 0o600);
  closeSync(fd);
  chmodSync(path, 0o600);
  const db = new Database(path, { create: true, readwrite: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=250;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_side_effect_intents (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      intent_id TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  chmodSync(path, 0o600);
  return db;
}

function validateIntent(value: unknown): SearchSideEffectIntent {
  const intent = value as Partial<SearchSideEffectIntent> | null;
  if (!intent || !Array.isArray(intent.audits) || !Array.isArray(intent.access_count_ids)) {
    throw new SearchAuditBackpressureError();
  }
  if (intent.audits.length > 128 || intent.access_count_ids.length > 100) {
    throw new SearchAuditBackpressureError();
  }
  for (const audit of intent.audits) {
    if (!audit || !ALLOWED_AUDIT_ACTIONS.has(audit.action) ||
      !ALLOWED_TARGET_TYPES.has(audit.target_type) || typeof audit.target_id !== "string" ||
      !audit.details || typeof audit.details !== "object") {
      throw new SearchAuditBackpressureError();
    }
    const expectedTarget = audit.action === "read.search"
      ? "project"
      : audit.action === "search_hit"
        ? "observation"
        : "search";
    if (audit.target_type !== expectedTarget || Array.isArray(audit.details)) {
      throw new SearchAuditBackpressureError();
    }
    if (!validateAuditDetails(audit.action, audit.details as Record<string, unknown>)) {
      throw new SearchAuditBackpressureError();
    }
  }
  if (intent.access_count_ids.some((id) => typeof id !== "string" || id.length === 0 || id.length > 512)) {
    throw new SearchAuditBackpressureError();
  }
  if (typeof intent.created_at !== "string") throw new SearchAuditBackpressureError();
  return intent as SearchSideEffectIntent;
}

export class SearchSideEffectSpool {
  private readonly db: Database;
  private appendCount = 0;

  constructor(
    dbPath: string,
    private readonly maxIntents = DEFAULT_MAX_INTENTS,
  ) {
    try {
      this.db = openPrivateSpool(searchSideEffectSpoolPath(dbPath));
    } catch {
      throw new SearchAuditBackpressureError();
    }
  }

  append(intent: SearchSideEffectIntent): { intent_id: string; pending: number } {
    try {
      const validated = validateIntent(intent);
      const payload = JSON.stringify(validated);
      if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new SearchAuditBackpressureError();
      if (process.env.NODE_ENV === "test") {
        const delayMs = Number(process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_APPEND_DELAY_MS || 0);
        const delayAfterCount = Number(process.env.HARNESS_MEM_TEST_SEARCH_AUDIT_SPOOL_DELAY_AFTER_COUNT || 0);
        this.appendCount += 1;
        if (Number.isFinite(delayMs) && delayMs > 0 && this.appendCount > Math.max(0, delayAfterCount)) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(5_000, Math.floor(delayMs)));
        }
      }
      const intentId = randomUUID();
      const append = this.db.transaction(() => {
        const row = this.db.query("SELECT COUNT(*) AS count FROM search_side_effect_intents").get() as { count: number };
        if (Number(row.count) >= this.maxIntents) throw new SearchAuditBackpressureError();
        this.db.query(`
          INSERT INTO search_side_effect_intents(intent_id, payload_json, created_at)
          VALUES (?, ?, ?)
        `).run(intentId, payload, validated.created_at);
        return Number(row.count) + 1;
      });
      return { intent_id: intentId, pending: append() };
    } catch (error) {
      if (error instanceof SearchAuditBackpressureError) throw error;
      throw new SearchAuditBackpressureError();
    }
  }

  count(): number {
    const row = this.db.query("SELECT COUNT(*) AS count FROM search_side_effect_intents").get() as { count: number };
    return Number(row.count);
  }

  loadBatch(limit: number): StoredIntent[] {
    const rows = this.db.query(`
      SELECT sequence, intent_id, payload_json
      FROM search_side_effect_intents
      ORDER BY sequence ASC
      LIMIT ?
    `).all(Math.max(1, Math.min(100, Math.floor(limit)))) as Array<{
      sequence: number;
      intent_id: string;
      payload_json: string;
    }>;
    try {
      return rows.map((row) => ({
        ...validateIntent(JSON.parse(row.payload_json)),
        sequence: Number(row.sequence),
        intent_id: row.intent_id,
      }));
    } catch {
      throw new SearchAuditBackpressureError();
    }
  }

  delete(intentId: string): void {
    this.db.query("DELETE FROM search_side_effect_intents WHERE intent_id = ?").run(intentId);
  }

  deleteBatch(intentIds: string[]): void {
    if (intentIds.length === 0) return;
    const placeholders = intentIds.map(() => "?").join(",");
    this.db.transaction(() => {
      this.db.query(`DELETE FROM search_side_effect_intents WHERE intent_id IN (${placeholders})`)
        .run(...(intentIds as SQLQueryBindings[]));
    })();
  }

  close(): void {
    this.db.close();
  }
}

function ensureClaimsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mem_search_side_effect_claims (
      intent_id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function applyIntentInTransaction(db: Database, intent: StoredIntent): boolean {
  const claim = db.query(`
      INSERT OR IGNORE INTO mem_search_side_effect_claims(intent_id, applied_at)
      VALUES (?, ?)
    `).run(intent.intent_id, new Date().toISOString());
  if (Number(claim.changes) === 0) return false;

  if (intent.access_count_ids.length > 0) {
    const placeholders = intent.access_count_ids.map(() => "?").join(",");
    db.query(`
        UPDATE mem_observations
        SET access_count = COALESCE(access_count, 0) + 1, last_accessed_at = ?
        WHERE id IN (${placeholders})
      `).run(intent.created_at, ...(intent.access_count_ids as SQLQueryBindings[]));
  }
  if (intent.audits.length > 0) {
    const values = intent.audits.map(() => "(?, 'system', ?, ?, ?, ?)").join(",");
    const params: SQLQueryBindings[] = [];
    for (const audit of intent.audits) {
      params.push(audit.action, audit.target_type, audit.target_id, JSON.stringify(audit.details), intent.created_at);
    }
    db.query(`
        INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
        VALUES ${values}
      `).run(...params);
  }
  return true;
}

export function flushSearchSideEffectSpool(
  mainDb: Database,
  dbPath: string,
  limit = 100,
  options: { afterApply?: (intentId: string) => void } = {},
): { intents_applied: number; intents_replayed: number; intents_remaining: number } {
  const spool = new SearchSideEffectSpool(dbPath);
  let applied = 0;
  let replayed = 0;
  try {
    ensureClaimsTable(mainDb);
    const intents = spool.loadBatch(limit);
    mainDb.transaction(() => {
      for (const intent of intents) {
        if (applyIntentInTransaction(mainDb, intent)) applied += 1;
        else replayed += 1;
      }
    })();
    for (const intent of intents) {
      options.afterApply?.(intent.intent_id);
    }
    const intentIds = intents.map((intent) => intent.intent_id);
    spool.deleteBatch(intentIds);
    if (intentIds.length > 0) {
      const placeholders = intentIds.map(() => "?").join(",");
      mainDb.transaction(() => {
        mainDb.query(`DELETE FROM mem_search_side_effect_claims WHERE intent_id IN (${placeholders})`)
          .run(...(intentIds as SQLQueryBindings[]));
      })();
    }
    return {
      intents_applied: applied,
      intents_replayed: replayed,
      intents_remaining: spool.count(),
    };
  } finally {
    spool.close();
  }
}
