import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const WORK_CLI = join(ROOT, "memory-server/src/workgraph/work-cli.ts");
const HARNESS_MEM = readFileSync(join(ROOT, "scripts/harness-mem"), "utf8");
const MCP_MEMORY = readFileSync(join(ROOT, "mcp-server/src/tools/memory.ts"), "utf8");

function writePlans(projectDir: string): void {
  writeFileSync(
    join(projectDir, "Plans.md"),
    `
## §125 WorkGraph Task Continuity MVP — cc:TODO

| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| S125-001 | **Spec** — frozen | done | - | cc:完了 [abc1234] |
| S125-002 | **Parser** — dry-run | done | S125-001 | cc:完了 [abc1234] |
| S125-006 | **CLI-only WorkGraph MVP surface** — expose dry-run CLI | cli contract passes | S125-002 | cc:TODO |
| S125-007 | **Work events** — later | events later | S125-006 | cc:TODO |
| S125-008 | **Leased follow-up** — should be hidden | lease hides it | S125-002 | cc:TODO |

## archive

| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| S1-001 | **Old work** — archive | old | - | cc:完了 [old] |
`
  );
}

function writePlansForProject(projectDir: string, series: string): void {
  writeFileSync(
    join(projectDir, "Plans.md"),
    `
## §1 Project ${series} — cc:TODO

| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| ${series}-001 | **First task** — ready | ready | - | cc:TODO |
| ${series}-002 | **Second task** — blocked | blocked | ${series}-001 | cc:TODO |
`
  );
}

function writeMixedIdPlans(projectDir: string): void {
  writeFileSync(
    join(projectDir, "Plans.md"),
    `
## §7 Existing Project Format — cc:TODO

| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| 7.1 | **Numeric dotted task** — support AISDR-style IDs | imported | - | cc:TODO |
| 9.B.3 | **Dotted alphanumeric task** — support phase letter IDs | dependency parsed | 7.1 | cc:TODO |
| GIFT-M1-03 | **Project prefixed task** — support non-S prefixes | imported | 9.B.3 | cc:WIP |
| DEP-02 | **Short project prefix** — support dependency chains | imported | GIFT-M1-03 | blocked |
`
  );
}

function runWorkCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync("bun", [WORK_CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

describe("WorkGraph CLI contract", () => {
  let tmpRoot = "";

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = "";
    }
  });

  test("scripts/harness-mem exposes work commands and MCP work tools are opt-in", () => {
    expect(HARNESS_MEM).toContain("work import-plans");
    expect(HARNESS_MEM).toContain("work ready");
    expect(HARNESS_MEM).toContain("work sync-plans");
    expect(HARNESS_MEM).toContain("work_impl()");
    expect(MCP_MEMORY).toContain("harness_work_query");
    expect(MCP_MEMORY).toContain("harness_work_update");
    expect(MCP_MEMORY).toContain("workGraphToolsEnabled");
  });

  test("work import-plans is dry-run by default and reports zero writes", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "harness-mem-work-cli-"));
    writePlans(tmpRoot);

    const result = runWorkCli(["import-plans", "--project", tmpRoot, "--json"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      writes: number;
      work_items: number;
      metrics: { plans_import_fidelity: number };
      diff: Array<{ kind: string }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.writes).toBe(0);
    expect(payload.work_items).toBe(5);
    expect(payload.metrics.plans_import_fidelity).toBeGreaterThanOrEqual(0.98);
    expect(payload.diff.some((entry) => entry.kind === "work_item")).toBe(true);
  });

  test("work import-plans accepts dotted numeric and project-prefixed task ids", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "harness-mem-work-mixed-ids-"));
    writeMixedIdPlans(tmpRoot);

    const result = runWorkCli(["import-plans", "--project", tmpRoot, "--json"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      work_items: number;
      dependencies: number;
      diff: Array<{ kind: string; workId?: string; fromWorkId?: string; toWorkId?: string }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.work_items).toBe(4);
    expect(payload.dependencies).toBe(3);
    expect(payload.diff).toContainEqual(expect.objectContaining({ kind: "work_item", workId: "7.1" }));
    expect(payload.diff).toContainEqual(expect.objectContaining({ kind: "work_item", workId: "9.B.3" }));
    expect(payload.diff).toContainEqual(expect.objectContaining({ kind: "work_item", workId: "GIFT-M1-03" }));
    expect(payload.diff).toContainEqual(expect.objectContaining({ kind: "work_item", workId: "DEP-02" }));
    expect(payload.diff).toContainEqual(
      expect.objectContaining({ kind: "dependency", fromWorkId: "9.B.3", toWorkId: "GIFT-M1-03" })
    );
  });

  test("work ready reads Plans.md and excludes actively leased work", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "harness-mem-work-ready-"));
    writePlans(tmpRoot);
    const dbPath = join(tmpRoot, "harness-mem.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE mem_leases (
        lease_id TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        project TEXT,
        status TEXT NOT NULL,
        ttl_ms INTEGER NOT NULL,
        acquired_at TEXT NOT NULL,
        renewed_at TEXT,
        expires_at TEXT NOT NULL,
        released_at TEXT,
        metadata_json TEXT
      );
      INSERT INTO mem_leases (
        lease_id, target, agent_id, project, status, ttl_ms, acquired_at, expires_at
      ) VALUES (
        'lease-1', 'work:S125-008', 'codex-worker', NULL, 'active', 600000,
        '2026-05-17T10:00:00.000Z', '2026-05-17T10:10:00.000Z'
      );
    `);
    db.close();

    const result = runWorkCli(
      ["ready", "--project", tmpRoot, "--now", "2026-05-17T10:01:00.000Z", "--json"],
      { HARNESS_MEM_DB_PATH: dbPath }
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      ready: string[];
      decisions: Array<{ workId: string; ready: boolean; reasons: Array<{ code: string }> }>;
      writes: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.writes).toBe(0);
    expect(payload.ready).toContain("S125-006");
    expect(payload.ready).not.toContain("S125-007");
    expect(payload.ready).not.toContain("S125-008");
    expect(payload.decisions.find((decision) => decision.workId === "S125-008")?.reasons).toContainEqual(
      expect.objectContaining({ code: "leased" })
    );
  });

  test("work import-plans --write is idempotent and export-plans prints generated markdown", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "harness-mem-work-write-"));
    writePlans(tmpRoot);
    const dbPath = join(tmpRoot, "harness-mem.db");

    for (let index = 0; index < 2; index += 1) {
      const result = runWorkCli(["import-plans", "--project", tmpRoot, "--db", dbPath, "--write", "--json"]);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        ok: boolean;
        mode: string;
        written_work_items: number;
        duplicate_work_rate: number;
      };
      expect(payload.ok).toBe(true);
      expect(payload.mode).toBe("write");
      expect(payload.written_work_items).toBe(5);
      expect(payload.duplicate_work_rate).toBeLessThanOrEqual(0.05);
    }

    const db = new Database(dbPath, { readonly: true });
    const workCount = Number((db.query(`SELECT COUNT(*) AS count FROM mem_work_items`).get() as { count: number }).count);
    const depCount = Number((db.query(`SELECT COUNT(*) AS count FROM mem_work_dependencies`).get() as { count: number }).count);
    db.close();
    expect(workCount).toBe(5);
    expect(depCount).toBe(4);

    const beforePlans = readFileSync(join(tmpRoot, "Plans.md"), "utf8");
    const exportResult = runWorkCli(["export-plans", "--project", tmpRoot, "--db", dbPath]);
    expect(exportResult.stderr).toBe("");
    expect(exportResult.status).toBe(0);
    expect(exportResult.stdout).toContain("# Plans.generated.md");
    expect(exportResult.stdout).toContain("S125-006");
    expect(readFileSync(join(tmpRoot, "Plans.md"), "utf8")).toBe(beforePlans);
  });

  test("work sync-plans safely scans projects and writes only with explicit --write", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "harness-mem-work-sync-"));
    const projectA = join(tmpRoot, "project-a");
    const projectB = join(tmpRoot, "nested", "project-b");
    const noPlans = join(tmpRoot, "no-plans");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    mkdirSync(noPlans, { recursive: true });
    writePlansForProject(projectA, "S901");
    writePlansForProject(projectB, "S902");
    const dbPath = join(tmpRoot, "harness-mem.db");

    const dryRun = runWorkCli(["sync-plans", "--root", tmpRoot, "--db", dbPath, "--json"]);
    expect(dryRun.stderr).toBe("");
    expect(dryRun.status).toBe(0);
    const dryPayload = JSON.parse(dryRun.stdout) as {
      ok: boolean;
      mode: string;
      writes: number;
      candidates: number;
      projects_synced: number;
    };
    expect(dryPayload.ok).toBe(true);
    expect(dryPayload.mode).toBe("dry-run");
    expect(dryPayload.writes).toBe(0);
    expect(dryPayload.candidates).toBe(2);
    expect(dryPayload.projects_synced).toBe(2);
    expect(existsSync(dbPath)).toBe(false);

    for (let index = 0; index < 2; index += 1) {
      const write = runWorkCli(["sync-plans", "--root", tmpRoot, "--db", dbPath, "--write", "--json"]);
      expect(write.stderr).toBe("");
      expect(write.status).toBe(0);
      const writePayload = JSON.parse(write.stdout) as {
        ok: boolean;
        mode: string;
        projects_synced: number;
        projects_skipped: number;
        work_items: number;
      };
      expect(writePayload.ok).toBe(true);
      expect(writePayload.mode).toBe("write");
      expect(writePayload.projects_synced).toBe(2);
      expect(writePayload.projects_skipped).toBe(0);
      expect(writePayload.work_items).toBe(4);
    }

    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .query(`SELECT work_id, project FROM mem_work_items ORDER BY work_id`)
      .all() as Array<{ work_id: string; project: string }>;
    db.close();
    expect(rows.map((row) => row.work_id)).toEqual(["S901-001", "S901-002", "S902-001", "S902-002"]);
    expect(rows.map((row) => row.project)).toEqual([projectA, projectA, projectB, projectB]);
  });

  test("work sync-plans skips cross-project work id collisions", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "harness-mem-work-sync-conflict-"));
    const projectA = join(tmpRoot, "project-a");
    const projectB = join(tmpRoot, "project-b");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    writePlansForProject(projectA, "S903");
    writePlansForProject(projectB, "S903");
    const dbPath = join(tmpRoot, "harness-mem.db");

    const result = runWorkCli(["sync-plans", "--root", tmpRoot, "--db", dbPath, "--write", "--json"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      projects_synced: number;
      projects_skipped: number;
      diagnostics: Array<{ code: string }>;
    };
    expect(payload.projects_synced).toBe(1);
    expect(payload.projects_skipped).toBe(1);
    expect(payload.diagnostics).toContainEqual(expect.objectContaining({ code: "work_id_project_conflict" }));
  });

  test("work sync-plans allows same-repo path aliases with matching project labels", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "harness-mem-work-sync-alias-"));
    const projectA = join(tmpRoot, "stable", "harness-mem");
    const projectB = join(tmpRoot, "worktrees", "8edc", "harness-mem");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    writePlansForProject(projectA, "S905");
    writePlansForProject(projectB, "S905");
    const dbPath = join(tmpRoot, "harness-mem.db");

    const result = runWorkCli(["sync-plans", "--root", tmpRoot, "--db", dbPath, "--write", "--json"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      projects_synced: number;
      projects_skipped: number;
      diagnostics: Array<{ code: string }>;
    };
    expect(payload.projects_synced).toBe(2);
    expect(payload.projects_skipped).toBe(0);
    expect(payload.diagnostics).not.toContainEqual(expect.objectContaining({ code: "work_id_project_conflict" }));
  });

  test("work sync-plans --all-projects discovers local projects from the DB", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "harness-mem-work-sync-all-"));
    const projectA = join(tmpRoot, "project-a");
    const noPlans = join(tmpRoot, "no-plans");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(noPlans, { recursive: true });
    writePlansForProject(projectA, "S904");
    const dbPath = join(tmpRoot, "harness-mem.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE mem_observations (project TEXT);
      INSERT INTO mem_observations (project) VALUES ('${projectA.replace(/'/g, "''")}');
      INSERT INTO mem_observations (project) VALUES ('${noPlans.replace(/'/g, "''")}');
    `);
    db.close();

    const result = runWorkCli(["sync-plans", "--all-projects", "--db", dbPath, "--json"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      candidates: number;
      projects_synced: number;
      writes: number;
      diagnostics: Array<{ code: string }>;
    };
    expect(payload.candidates).toBe(1);
    expect(payload.projects_synced).toBe(1);
    expect(payload.writes).toBe(0);
    expect(payload.diagnostics).toContainEqual(expect.objectContaining({ code: "plans_not_found" }));
  });
});
