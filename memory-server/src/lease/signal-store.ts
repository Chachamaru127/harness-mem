/**
 * S81-A03: Signal primitive for inter-agent messaging.
 *
 * Signals are append-only messages routed between agents via the
 * `mem_signals` table. Each signal has:
 *   - `from_agent` / `to_agent` (null = broadcast)
 *   - optional `thread_id` (server-assigned if omitted; `reply_to` reuses
 *     the parent's thread_id so conversations stay linked)
 *   - `content` (opaque to the server, any JSON-serialisable string)
 *   - optional `expires_in_ms` → `expires_at`
 *
 * `_read` returns unacked signals addressed to the caller (plus unaddressed
 * broadcasts). `_ack` marks them read so `_read` never returns the same
 * message twice. This is the minimal contract required by the DoD.
 *
 * The store intentionally uses the same bun:sqlite Database handle as the
 * rest of memory-server so tests can rely on the single in-memory DB
 * configured in `initSchema()` without extra plumbing.
 */

import { Database } from "bun:sqlite";

export interface SignalRow {
  signalId: string;
  threadId: string;
  from: string;
  to: string | null;
  replyTo: string | null;
  content: string;
  project: string | null;
  sentAt: string;
  expiresAt: string | null;
  ackedAt: string | null;
  ackedBy: string | null;
}

export interface SendRequest {
  from: string;
  to?: string | null;
  threadId?: string | null;
  replyTo?: string | null;
  content: string;
  project?: string | null;
  expiresInMs?: number;
}

export type SendResponse =
  | { ok: true; signal: SignalRow }
  | { ok: false; error: "invalid_from" | "invalid_content" | "reply_target_missing" };

export interface ReadRequest {
  agentId: string;
  /** If provided, only return signals on this thread. */
  threadId?: string;
  /** If true, include broadcast (to=null) signals. Default: true. */
  includeBroadcast?: boolean;
  /**
   * S81-A03 scoping (Codex round 5 P2): when omitted, `read()` only
   * returns signals that were **also** sent without a project key (truly
   * global broadcasts). Signals tagged with any project are hidden until
   * the caller passes the matching project. This flips the default from
   * the previous "no filter ⇒ all projects" semantics that could leak
   * inbox contents across repos. Callers who really need the legacy
   * cross-project view must pass `all_projects: true`.
   */
  project?: string | null;
  /**
   * Escape hatch for audit / admin tooling that needs the old global
   * view. When true, no project filter is applied, matching pre-round-5
   * behavior.
   */
  all_projects?: boolean;
  limit?: number;
}

export interface AckRequest {
  signalId: string;
  agentId: string;
}

export type AckResponse =
  | { ok: true; signal: SignalRow }
  | { ok: false; error: "not_found" | "already_acked" | "not_recipient" };

export interface SignalStore {
  send(req: SendRequest): SendResponse;
  read(req: ReadRequest): SignalRow[];
  ack(req: AckRequest): AckResponse;
  get(signalId: string): SignalRow | null;
}

export interface SignalStoreOptions {
  now?: () => number;
  idGenerator?: () => string;
}

function defaultId(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g?.randomUUID) return g.randomUUID();
  let out = "";
  for (let i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function parseRow(row: Record<string, unknown>): SignalRow {
  return {
    signalId: String(row.signal_id),
    threadId: String(row.thread_id ?? row.signal_id),
    from: String(row.from_agent),
    to: row.to_agent == null ? null : String(row.to_agent),
    replyTo: row.reply_to == null ? null : String(row.reply_to),
    content: String(row.content),
    project: row.project == null ? null : String(row.project),
    sentAt: String(row.sent_at),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    ackedAt: row.acked_at == null ? null : String(row.acked_at),
    ackedBy: row.acked_by == null ? null : String(row.acked_by),
  };
}

export function createSignalStore(db: Database, options: SignalStoreOptions = {}): SignalStore {
  const now = options.now ?? (() => Date.now());
  const id = options.idGenerator ?? defaultId;

  const send = (req: SendRequest): SendResponse => {
    const from = (req.from ?? "").trim();
    if (!from) return { ok: false, error: "invalid_from" };
    const content = typeof req.content === "string" ? req.content : "";
    if (!content) return { ok: false, error: "invalid_content" };

    let threadId = (req.threadId ?? "").trim();
    if (req.replyTo) {
      const parent = db
        .query(`SELECT thread_id FROM mem_signals WHERE signal_id = ?`)
        .get(req.replyTo) as Record<string, unknown> | null;
      if (!parent) {
        return { ok: false, error: "reply_target_missing" };
      }
      // Threaded replies always inherit the parent's thread_id.
      threadId = String(parent.thread_id);
    }

    const signalId = id();
    if (!threadId) threadId = signalId;

    const nowMs = now();
    const sentAt = toIso(nowMs);
    const expiresAt =
      typeof req.expiresInMs === "number" && req.expiresInMs > 0
        ? toIso(nowMs + req.expiresInMs)
        : null;

    db.run(
      `INSERT INTO mem_signals
         (signal_id, thread_id, from_agent, to_agent, reply_to, content,
          project, sent_at, expires_at, acked_at, acked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      [
        signalId,
        threadId,
        from,
        req.to ?? null,
        req.replyTo ?? null,
        content,
        req.project ?? null,
        sentAt,
        expiresAt,
      ]
    );

    return {
      ok: true,
      signal: {
        signalId,
        threadId,
        from,
        to: req.to ?? null,
        replyTo: req.replyTo ?? null,
        content,
        project: req.project ?? null,
        sentAt,
        expiresAt,
        ackedAt: null,
        ackedBy: null,
      },
    };
  };

  const read = (req: ReadRequest): SignalRow[] => {
    const agentId = (req.agentId ?? "").trim();
    if (!agentId) return [];
    const nowIso = toIso(now());
    const includeBroadcast = req.includeBroadcast !== false;
    const limit = typeof req.limit === "number" && req.limit > 0 ? Math.floor(req.limit) : 100;

    // Signals addressed directly to agentId OR (optionally) broadcasts.
    // Exclude acked and expired.
    const where: string[] = ["acked_at IS NULL"];
    where.push(`(expires_at IS NULL OR expires_at > ?)`);
    const params: unknown[] = [nowIso];
    if (includeBroadcast) {
      where.push(`(to_agent = ? OR to_agent IS NULL)`);
      params.push(agentId);
    } else {
      where.push(`to_agent = ?`);
      params.push(agentId);
    }
    if (req.threadId) {
      where.push(`thread_id = ?`);
      params.push(req.threadId);
    }
    // S81-A03 project scoping — Codex round 5 P2 hardening. Default now
    // isolates: no project arg means the inbox is reduced to null-project
    // broadcasts only, so an agent identity reused across repos cannot
    // accidentally see another repo's signals. Explicit opt-in via
    // `all_projects: true` restores the legacy global view for audit
    // and admin tools.
    if (!req.all_projects) {
      if (req.project === null || req.project === undefined) {
        where.push(`project IS NULL`);
      } else {
        where.push(`(project = ? OR project IS NULL)`);
        params.push(req.project);
      }
    }
    params.push(limit);
    const rows = db
      .query(
        `SELECT * FROM mem_signals
          WHERE ${where.join(" AND ")}
          ORDER BY sent_at ASC
          LIMIT ?`
      )
      .all(...(params as [])) as Record<string, unknown>[];
    return rows.map(parseRow);
  };

  const ack = (req: AckRequest): AckResponse => {
    const row = db
      .query(`SELECT * FROM mem_signals WHERE signal_id = ?`)
      .get(req.signalId) as Record<string, unknown> | null;
    if (!row) return { ok: false, error: "not_found" };
    if (row.acked_at != null) {
      return { ok: false, error: "already_acked" };
    }
    // S81-A03: ownership check. Direct signals (to_agent non-null) may
    // only be acked by the intended recipient — otherwise a sender could
    // self-ack and delete their own point-to-point message, or any caller
    // who learned the signalId could dismiss someone else's inbox entry.
    // Broadcast signals (to_agent IS NULL) remain acknowledgeable by any
    // caller (the semantics of "read receipt per agent" would need a
    // separate ack-log table and is out of scope).
    const toAgent = row.to_agent == null ? null : String(row.to_agent);
    if (toAgent !== null && toAgent !== req.agentId) {
      return { ok: false, error: "not_recipient" };
    }
    const nowIso = toIso(now());
    db.run(
      `UPDATE mem_signals
          SET acked_at = ?, acked_by = ?
        WHERE signal_id = ?`,
      [nowIso, req.agentId, req.signalId]
    );
    const updated = db
      .query(`SELECT * FROM mem_signals WHERE signal_id = ?`)
      .get(req.signalId) as Record<string, unknown>;
    return { ok: true, signal: parseRow(updated) };
  };

  const get = (signalId: string): SignalRow | null => {
    const row = db
      .query(`SELECT * FROM mem_signals WHERE signal_id = ?`)
      .get(signalId) as Record<string, unknown> | null;
    return row ? parseRow(row) : null;
  };

  return { send, read, ack, get };
}
