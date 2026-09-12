import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ProjectRegistry } from "../../src/core/project-registry";

function fixture() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE mem_meta(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT); CREATE TABLE mem_observations(project TEXT); CREATE TABLE mem_sessions(project TEXT)");
  return { db, registry: new ProjectRegistry(db) };
}

describe("project identity registry", () => {
  test("empty registry preserves legacy keys without guessing a basename", () => {
    const { db, registry } = fixture();
    try {
      db.query("INSERT INTO mem_observations VALUES(?)").run("/offline/customer/repo");
      expect(registry.lookup("/offline/customer/repo").state).toBe("existing");
      expect(registry.lookup("repo")).toMatchObject({ project: "repo", state: "explicit" });
      expect(registry.lookup("/another/repo")).toMatchObject({ project: "/another/repo", state: "unresolved" });
    } finally { db.close(); }
  });

  test("confirmed aliases persist across registry instances; a changed symlink does not merge", () => {
    const { db, registry } = fixture();
    try {
      registry.accept({ input: "/link", canonical: "/repo-a", kind: "confirmed" });
      const restarted = new ProjectRegistry(db);
      expect(restarted.lookup("/link")).toMatchObject({ project: "/repo-a", state: "confirmed" });
      restarted.accept({ input: "/link", canonical: "/repo-b", kind: "confirmed" });
      expect(restarted.lookup("/link")).toMatchObject({ project: "/repo-a", state: "conflict", candidate: "/repo-b" });
      expect(restarted.lookup("/repo-a").project).toBe("/repo-a");
      restarted.accept({ input: "/link", canonical: "/repo-a", kind: "confirmed" });
      expect(restarted.lookup("/link").state).toBe("conflict");
    } finally { db.close(); }
  });

  test("a saved unresolved identity cannot be silently merged when the filesystem recovers", () => {
    const { db, registry } = fixture();
    try {
      registry.retain("/unknown/alias");
      db.query("INSERT INTO mem_observations VALUES(?)").run("/unknown/alias");
      expect(registry.lookup("/unknown/alias").state).toBe("unresolved");
      registry.accept({ input: "/unknown/alias", canonical: "/known/repo", kind: "confirmed" });
      expect(registry.lookup("/unknown/alias")).toMatchObject({ project: "/unknown/alias", state: "conflict" });
    } finally { db.close(); }
  });

  test("timeouts retain confirmed mappings and unknown is never absence", () => {
    const { db, registry } = fixture();
    try {
      registry.accept({ input: "/link", canonical: "/real", kind: "confirmed" });
      registry.accept({ input: "/link", canonical: "/link", kind: "unresolved", reason: "timeout" });
      expect(registry.lookup("/link").project).toBe("/real");
      registry.accept({ input: "/unknown", canonical: "/unknown", kind: "unresolved", reason: "timeout" });
      expect(registry.lookup("/unknown")).toMatchObject({ state: "unresolved", reason: "timeout" });
    } finally { db.close(); }
  });
});
