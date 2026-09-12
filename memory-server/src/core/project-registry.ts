import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

export type ProjectResolutionState = "confirmed" | "existing" | "explicit" | "unresolved" | "conflict";
export interface ProjectResolution {
  input: string;
  project: string;
  state: ProjectResolutionState;
  reason?: string;
  candidate?: string;
  checked_at?: string;
}

const PREFIX = "project_identity:v1:";

/** Identity syntax only. Never consults the filesystem or folds case/basenames. */
export function projectKey(input: string): string {
  const value = input.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!value) throw new Error("project name must not be empty");
  return value;
}

export function isProjectPath(input: string): boolean {
  return input.includes("/") && !input.includes("::");
}

function registryKey(input: string): string {
  return PREFIX + createHash("sha256").update(input).digest("hex");
}

/** SQLite is the sole owner of identities. Path discovery only proposes changes. */
export class ProjectRegistry {
  constructor(private readonly db: Database) {}

  private stored(input: string): boolean {
    return Boolean(this.db.query(`
      SELECT 1 FROM mem_observations WHERE project = ?
      UNION ALL SELECT 1 FROM mem_sessions WHERE project = ? LIMIT 1
    `).get(input, input));
  }

  private read(input: string): ProjectResolution | null {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM mem_meta WHERE key = ?")
      .get(registryKey(input));
    if (!row) return null;
    try {
      const value = JSON.parse(row.value) as ProjectResolution;
      if (value.input !== input || typeof value.project !== "string" || !value.project) return null;
      if (!["confirmed", "unresolved", "conflict"].includes(value.state)) return null;
      return value;
    } catch { return null; }
  }

  private write(value: ProjectResolution): ProjectResolution {
    this.db.query("INSERT INTO mem_meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
      .run(registryKey(value.input), JSON.stringify(value), new Date().toISOString());
    return value;
  }

  lookup(raw: string): ProjectResolution {
    const input = projectKey(raw);
    const saved = this.read(input);
    if (saved) return saved;
    if (this.stored(input)) return { input, project: input, state: "existing" };
    return { input, project: input, state: isProjectPath(input) ? "unresolved" : "explicit" };
  }

  /** Preserve the original key before an unresolved write becomes a legacy key. */
  retain(raw: string): ProjectResolution {
    const current = this.lookup(raw);
    if (current.state === "unresolved" && !this.read(current.input)) return this.write(current);
    return current;
  }

  accept(result: { input: string; canonical: string; kind: "confirmed" | "unresolved"; reason?: string }): ProjectResolution {
    const current = this.lookup(result.input);
    if (result.kind !== "confirmed") {
      // A timeout cannot invalidate an established identity or prove absence.
      if (current.state !== "unresolved") return current;
      return this.write({ ...current, reason: result.reason || "reference_unavailable", checked_at: new Date().toISOString() });
    }
    const canonical = projectKey(result.canonical);
    if (current.state === "conflict") return current;
    if (
      (current.state === "confirmed" && current.project !== canonical) ||
      (this.stored(current.input) && current.input !== canonical)
    ) {
      return this.write({
        input: current.input, project: current.project, state: "conflict", candidate: canonical,
        reason: "identity_change_requires_review", checked_at: new Date().toISOString(),
      });
    }
    return this.write({ input: current.input, project: canonical, state: "confirmed", checked_at: new Date().toISOString() });
  }
}
