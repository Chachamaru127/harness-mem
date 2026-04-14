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
  limit?: number;
}

export interface AckRequest {
  signalId: string;
  agentId: string;
}

export type AckResponse =
  | { ok: true; signal: SignalRow }
  | { ok: false; error: "not_found" | "already_acked" };

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
