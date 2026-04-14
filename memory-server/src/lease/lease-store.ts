/**
 * S81-A02: Lease primitive for inter-agent coordination.
 *
 * A lease is an exclusive, time-bounded claim on a string `target`
 * (file path, action id, or arbitrary key). A second agent that tries
 * to acquire an already-active lease on the same target receives
 * `{ok:false, error:"already_leased", heldBy, expiresAt}`. After the
 * TTL elapses the lease becomes invisible to further acquires — the
 * next acquire transparently replaces it.
 *
 * Design constraints (see Plans.md §81 S81-A02):
 *   - default TTL 600_000 ms, max 3_600_000 ms
 *   - `(target, status='active', now<expires_at)` index backs contention
 *   - release/renew are idempotent and scoped to the acquirer's agent_id
 *   - no hard delete: expired leases are status='expired', renewed leases
 *     keep lease_id stable
 *
 * The store is intentionally Database-agnostic apart from the bun:sqlite
 * dialect used by the rest of memory-server. A separate `mem_leases`
 * table is initialized by `initSchema()` so tests can spin up an
 * in-memory DB and exercise contention without mocking.
 */

import { Database } from "bun:sqlite";

export const DEFAULT_LEASE_TTL_MS = 600_000;
export const MAX_LEASE_TTL_MS = 3_600_000;

export interface LeaseRow {
  leaseId: string;
  target: string;
  agentId: string;
  project: string | null;
  status: "active" | "released" | "expired";
  ttlMs: number;
  acquiredAt: string;
  renewedAt: string | null;
  expiresAt: string;
  releasedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface AcquireRequest {
  target: string;
  agentId: string;
  project?: string | null;
  ttlMs?: number;
  metadata?: Record<string, unknown> | null;
}

export type AcquireResponse =
  | {
      ok: true;
      lease: LeaseRow;
    }
  | {
      ok: false;
      error: "already_leased";
      heldBy: string;
      expiresAt: string;
      leaseId: string;
    }
  | {
      ok: false;
      error: "invalid_target" | "invalid_agent_id" | "invalid_ttl";
      details?: string;
    };

export interface ReleaseResponse {
  ok: boolean;
  lease?: LeaseRow;
  error?: "not_found" | "not_owner";
}

export interface RenewResponse {
  ok: boolean;
  lease?: LeaseRow;
  error?: "not_found" | "not_owner" | "expired" | "invalid_ttl";
}

export interface LeaseStore {
  acquire(req: AcquireRequest): AcquireResponse;
  release(leaseId: string, agentId: string): ReleaseResponse;
  renew(leaseId: string, agentId: string, ttlMs?: number): RenewResponse;
  get(leaseId: string): LeaseRow | null;
  listActive(target?: string): LeaseRow[];
}

export interface LeaseStoreOptions {
  /** Clock hook for deterministic tests. Default: Date.now. */
  now?: () => number;
  /** Optional override for the random id generator. Default: crypto-based. */
  idGenerator?: () => string;
}

function defaultId(): string {
  // Prefer Node's randomUUID when available, otherwise roll a hex id.
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g?.randomUUID) {
    return g.randomUUID();
  }
  // Fallback: 32-char hex (good enough for tests; production always has crypto).
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function parseRow(row: Record<string, unknown>): LeaseRow {
  return {
    leaseId: String(row.lease_id),
    target: String(row.target),
    agentId: String(row.agent_id),
    project: row.project == null ? null : String(row.project),
    status: (row.status as LeaseRow["status"]) ?? "active",
    ttlMs: Number(row.ttl_ms),
    acquiredAt: String(row.acquired_at),
    renewedAt: row.renewed_at == null ? null : String(row.renewed_at),
    expiresAt: String(row.expires_at),
    releasedAt: row.released_at == null ? null : String(row.released_at),
    metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : null,
  };
}

export function createLeaseStore(db: Database, options: LeaseStoreOptions = {}): LeaseStore {
  const now = options.now ?? (() => Date.now());
  const id = options.idGenerator ?? defaultId;

  /**
   * Lazily expire leases whose expires_at has passed. This is called at the
   * start of acquire/get/listActive so callers never see a stale "active"
   * row. Using now() from the injectable clock keeps tests deterministic.
   */
  const sweepExpired = (currentIso: string): void => {
    db.run(
      `UPDATE mem_leases
          SET status = 'expired',
              released_at = COALESCE(released_at, ?)
        WHERE status = 'active'
          AND expires_at <= ?`,
      [currentIso, currentIso]
    );
  };

  const acquire = (req: AcquireRequest): AcquireResponse => {
    const target = (req.target ?? "").trim();
    if (!target) {
      return { ok: false, error: "invalid_target", details: "target must be a non-empty string" };
    }
    const agentId = (req.agentId ?? "").trim();
    if (!agentId) {
      return { ok: false, error: "invalid_agent_id", details: "agent_id must be a non-empty string" };
    }
    const ttlMs = typeof req.ttlMs === "number" && req.ttlMs > 0 ? req.ttlMs : DEFAULT_LEASE_TTL_MS;
    if (ttlMs > MAX_LEASE_TTL_MS) {
      return { ok: false, error: "invalid_ttl", details: `ttl_ms must be ≤ ${MAX_LEASE_TTL_MS}` };
    }

    const nowMs = now();
    const nowIso = toIso(nowMs);
    sweepExpired(nowIso);

    // S81-A02 project scoping: exclusivity is per (project, target). Two
    // different repos with the same relative `target` must NOT collide.
    // Null project matches only other null-project leases (global scope).
    const project = req.project ?? null;
    const existing = db
      .query(
        `SELECT * FROM mem_leases
          WHERE target = ?
            AND status = 'active'
            AND expires_at > ?
            AND ((project IS NULL AND ? IS NULL) OR project = ?)
          ORDER BY acquired_at DESC
          LIMIT 1`
      )
      .get(target, nowIso, project, project) as Record<string, unknown> | null;

    if (existing) {
      const held = parseRow(existing);
      return {
        ok: false,
        error: "already_leased",
        heldBy: held.agentId,
        expiresAt: held.expiresAt,
        leaseId: held.leaseId,
      };
    }

    const leaseId = id();
    const expiresAt = toIso(nowMs + ttlMs);
    db.run(
      `INSERT INTO mem_leases
         (lease_id, target, agent_id, project, status, ttl_ms,
          acquired_at, renewed_at, expires_at, released_at, metadata_json)
       VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, ?, NULL, ?)`,
      [
        leaseId,
        target,
        agentId,
        project,
        ttlMs,
        nowIso,
        expiresAt,
        req.metadata ? JSON.stringify(req.metadata) : null,
      ]
    );

    return {
      ok: true,
      lease: {
        leaseId,
        target,
        agentId,
        project,
        status: "active",
        ttlMs,
        acquiredAt: nowIso,
        renewedAt: null,
        expiresAt,
        releasedAt: null,
        metadata: req.metadata ?? null,
      },
    };
  };

  const release = (leaseId: string, agentId: string): ReleaseResponse => {
    const row = db
      .query(`SELECT * FROM mem_leases WHERE lease_id = ?`)
      .get(leaseId) as Record<string, unknown> | null;
    if (!row) {
      return { ok: false, error: "not_found" };
    }
    if (String(row.agent_id) !== agentId) {
      return { ok: false, error: "not_owner" };
    }
    const nowIso = toIso(now());
    db.run(
      `UPDATE mem_leases
          SET status = 'released',
              released_at = ?
        WHERE lease_id = ?`,
      [nowIso, leaseId]
    );
    const updated = db
      .query(`SELECT * FROM mem_leases WHERE lease_id = ?`)
      .get(leaseId) as Record<string, unknown>;
    return { ok: true, lease: parseRow(updated) };
  };

  const renew = (leaseId: string, agentId: string, ttlMs?: number): RenewResponse => {
    const row = db
      .query(`SELECT * FROM mem_leases WHERE lease_id = ?`)
      .get(leaseId) as Record<string, unknown> | null;
    if (!row) return { ok: false, error: "not_found" };
    if (String(row.agent_id) !== agentId) return { ok: false, error: "not_owner" };
    const parsed = parseRow(row);
    const nowMs = now();
    const nowIso = toIso(nowMs);
    if (parsed.status !== "active" || parsed.expiresAt <= nowIso) {
      return { ok: false, error: "expired" };
    }
    const effectiveTtl = typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : parsed.ttlMs;
    if (effectiveTtl > MAX_LEASE_TTL_MS) {
      return { ok: false, error: "invalid_ttl" };
    }
    const expiresAt = toIso(nowMs + effectiveTtl);
    db.run(
      `UPDATE mem_leases
          SET renewed_at = ?,
              expires_at = ?,
              ttl_ms = ?
        WHERE lease_id = ?`,
      [nowIso, expiresAt, effectiveTtl, leaseId]
    );
    return {
      ok: true,
      lease: {
        ...parsed,
        renewedAt: nowIso,
        expiresAt,
        ttlMs: effectiveTtl,
      },
    };
  };

  const get = (leaseId: string): LeaseRow | null => {
    const nowIso = toIso(now());
    sweepExpired(nowIso);
    const row = db
      .query(`SELECT * FROM mem_leases WHERE lease_id = ?`)
      .get(leaseId) as Record<string, unknown> | null;
    return row ? parseRow(row) : null;
  };

  const listActive = (target?: string): LeaseRow[] => {
    const nowIso = toIso(now());
    sweepExpired(nowIso);
    const rows = target
      ? (db
          .query(
            `SELECT * FROM mem_leases
              WHERE status = 'active'
                AND target = ?
              ORDER BY acquired_at DESC`
          )
          .all(target) as Record<string, unknown>[])
      : (db
          .query(
            `SELECT * FROM mem_leases
              WHERE status = 'active'
              ORDER BY acquired_at DESC`
          )
          .all() as Record<string, unknown>[]);
    return rows.map(parseRow);
  };

  return { acquire, release, renew, get, listActive };
}
