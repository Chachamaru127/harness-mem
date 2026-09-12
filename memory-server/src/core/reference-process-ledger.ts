import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export interface ReferenceProcessReservations {
  reserve(limit: number): string | null;
  attach(token: string, pid: number): void;
  release(token: string): void;
  status(): { reserved: number; unconfirmed: number };
}

interface Reservation { token: string; parent_pid: number; pid: number | null; created_at: string }

/** DB-owner reservations survive crashes. Only proven disappearance frees a slot. */
export class ReferenceProcessLedger implements ReferenceProcessReservations {
  private readonly prefix: string;

  constructor(
    private readonly db: Database,
    namespace: "project-resolver" | "source-reader",
    private readonly inspect: (pid: number) => "absent" | "present" | "unknown" = inspectPid,
  ) {
    this.prefix = `reference_process:v1:${namespace}:`;
  }

  private rows(): Array<{ key: string; value: string }> {
    return this.db.query<{ key: string; value: string }, [string]>(
      "SELECT key,value FROM mem_meta WHERE key LIKE ?",
    ).all(`${this.prefix}%`);
  }

  private reconcile(): void {
    for (const row of this.rows()) {
      let value: Reservation;
      try { value = JSON.parse(row.value); } catch { continue; }
      // No PID means the owner may have crashed between spawn and attach.
      // A live/reused PID or failed inspection cannot prove disappearance.
      if (!Number.isSafeInteger(value.pid) || (value.pid ?? 0) <= 1) continue;
      if (this.inspect(value.pid!) === "absent") {
        this.db.query("DELETE FROM mem_meta WHERE key = ? AND value = ?").run(row.key, row.value);
      }
    }
  }

  reserve(limit: number): string | null {
    try {
      return this.db.transaction(() => {
        this.reconcile();
        if (this.rows().length >= Math.max(1, Math.floor(limit))) return null;
        const token = randomUUID();
        const value: Reservation = { token, parent_pid: process.pid, pid: null, created_at: new Date().toISOString() };
        this.db.query("INSERT INTO mem_meta(key,value,updated_at) VALUES(?,?,?)")
          .run(this.prefix + token, JSON.stringify(value), value.created_at);
        return token;
      }).immediate();
    } catch { return null; } // Without a durable reservation no process may spawn.
  }

  attach(token: string, pid: number): void {
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("invalid reference process identity");
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM mem_meta WHERE key = ?").get(this.prefix + token);
    if (!row) throw new Error("missing reference process reservation");
    const value = JSON.parse(row.value) as Reservation;
    this.db.query("UPDATE mem_meta SET value = ?,updated_at = ? WHERE key = ?")
      .run(JSON.stringify({ ...value, pid }), new Date().toISOString(), this.prefix + token);
  }

  release(token: string): void {
    // During shutdown the DB may already be closed. The next owner then checks
    // process disappearance; an unsuccessful release never fabricates capacity.
    try { this.db.query("DELETE FROM mem_meta WHERE key = ?").run(this.prefix + token); } catch { /* retained */ }
  }

  status(): { reserved: number; unconfirmed: number } {
    this.reconcile();
    const rows = this.rows();
    return { reserved: rows.length, unconfirmed: rows.length };
  }
}

function inspectPid(pid: number): "absent" | "present" | "unknown" {
  try { process.kill(pid, 0); return "present"; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? "absent" : "unknown"; }
}
