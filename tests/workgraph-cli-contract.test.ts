import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  test("scripts/harness-mem exposes work commands without MCP work tools", () => {
    expect(HARNESS_MEM).toContain("work import-plans");
    expect(HARNESS_MEM).toContain("work ready");
    expect(HARNESS_MEM).toContain("work_impl()");
    expect(MCP_MEMORY).not.toContain("harness_work_");
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
});
