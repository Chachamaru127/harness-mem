import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { configureDatabase, initSchema } from "../../src/db/schema";
import {
  importPlansToWorkGraphDryRun,
  mapPlansTaskToWorkItem,
  plansSourceRefToWorkId,
} from "../../src/workgraph/plans-importer";
import { parsePlansDryRun } from "../../src/workgraph/plans-parser";

const importFixture = `
# Plans

## §125 WorkGraph Task Continuity MVP (2026-05-17) — cc:TODO

| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| S125-001 | **WorkGraph spec freeze** — lock purpose and non-goals | spec is merged | - | cc:完了 [fbf3431] |
| S125-002 [P] | **Active Plans parser dry-run fixture** [tdd:required] — parse active rows without side effects | parser tests pass | S125-001 | cc:完了 [fbf3431] |
| S125-003 | **Additive work schema + WorkStore MVP** [P] — preserve existing tables | schema tests pass | S125-001, S125-002 | cc:完了 [fbf3431] |
| S125-004 | **Plans dry-run import to WorkGraph model** — map parser output to WorkStore inputs | import fidelity passes | S125-002, S125-003 | cc:TODO |
| S125-005 | **Ready algorithm MVP** — evaluate blockers and leases | ready benchmark passes | S125-003, S125-004 | cc:TODO |

## アーカイブ (完了 / 休止セクション)

| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| S1-001 | **Old archived work** — should not import by default | archived | - | cc:完了 [old111] |
`;

function makeDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  return db;
}

function countRows(db: Database, table: string): number {
  return Number((db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe("Plans WorkGraph dry-run importer", () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  test("maps parser output to WorkStore work item inputs", () => {
    const result = importPlansToWorkGraphDryRun(importFixture, {
      project: "/repo/harness-mem",
      source: "Plans.md",
      expectedWorkItemCount: 5,
    });
    const byId = Object.fromEntries(result.workItems.map((item) => [item.workId, item]));

    expect(result.workItems).toHaveLength(5);
    expect(byId["S125-004"]).toMatchObject({
      workId: "S125-004",
      title: "Plans dry-run import to WorkGraph model",
      project: "/repo/harness-mem",
      status: "open",
      workType: "task",
      sourceType: "plans",
      sourceRef: "plans:S125-004",
      createdBy: "plans-importer",
    });
    expect(byId["S125-004"].metadata?.plans).toMatchObject({
      id: "S125-004",
      sourceRef: "plans:S125-004",
      dod: "import fidelity passes",
      dependsOn: ["plans:S125-002", "plans:S125-003"],
      rowLine: 11,
    });
    expect(byId["S125-001"].status).toBe("closed");
    expect(byId["S125-001"].closeReason).toBe("plans_status_closed");
  });

  test("maps dependencies as blocking edges from dependency to current work", () => {
    const result = importPlansToWorkGraphDryRun(importFixture, {
      project: "/repo/harness-mem",
    });

    expect(result.dependencies).toContainEqual(
      expect.objectContaining({
        fromWorkId: "S125-002",
        toWorkId: "S125-004",
        relation: "blocks",
      })
    );
    expect(result.dependencies).toContainEqual(
      expect.objectContaining({
        fromWorkId: "S125-003",
        toWorkId: "S125-004",
        relation: "blocks",
      })
    );
    expect(result.diff).toContainEqual({
      kind: "dependency",
      action: "ensure",
      fromWorkId: "S125-004",
      toWorkId: "S125-005",
      relation: "blocks",
    });
  });

  test("returns dry-run diff, diagnostics, and fidelity benchmark without writing rows", () => {
    const itemRowsBefore = countRows(db, "mem_work_items");
    const dependencyRowsBefore = countRows(db, "mem_work_dependencies");

    const result = importPlansToWorkGraphDryRun(importFixture, {
      project: "/repo/harness-mem",
      expectedWorkItemCount: 5,
    });

    expect(result.writes).toBe(0);
    expect(result.diff.filter((entry) => entry.kind === "work_item")).toHaveLength(5);
    expect(result.diff.filter((entry) => entry.kind === "dependency")).toHaveLength(7);
    expect(result.diagnostics).toEqual([]);
    expect(result.metrics).toEqual({
      plans_import_fidelity: 1,
      importedWorkItems: 5,
      expectedWorkItems: 5,
    });
    expect(result.metrics.plans_import_fidelity).toBeGreaterThanOrEqual(0.98);
    expect(countRows(db, "mem_work_items")).toBe(itemRowsBefore);
    expect(countRows(db, "mem_work_dependencies")).toBe(dependencyRowsBefore);
  });

  test("excludes completed historical archive by default and can include it explicitly", () => {
    const defaultResult = importPlansToWorkGraphDryRun(importFixture, {
      project: "/repo/harness-mem",
    });
    const archiveResult = importPlansToWorkGraphDryRun(importFixture, {
      project: "/repo/harness-mem",
      includeArchivedSections: true,
    });

    expect(defaultResult.workItems.map((item) => item.workId)).not.toContain("S1-001");
    expect(defaultResult.metrics.plans_import_fidelity).toBe(1);
    expect(archiveResult.workItems.map((item) => item.workId)).toContain("S1-001");
  });

  test("keeps missing dependency diagnostics visible while preserving the planned edge", () => {
    const result = importPlansToWorkGraphDryRun(`
## §125 WorkGraph Task Continuity MVP — cc:TODO
| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| S125-010 | **Depends on older row** — edge should stay visible | dry run only | S1-001 | cc:TODO |
`, {
      project: "/repo/harness-mem",
    });

    expect(result.dependencies).toEqual([
      expect.objectContaining({
        fromWorkId: "S1-001",
        toWorkId: "S125-010",
        relation: "blocks",
      }),
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing_dependency_work_item",
        taskId: "S125-010",
        sourceRef: "plans:S1-001",
      })
    );
  });

  test("exports small mapping helpers without DB write surface", () => {
    const parsed = parsePlansDryRun(importFixture).tasks[0];
    const item = mapPlansTaskToWorkItem(parsed, {
      project: "/repo/harness-mem",
      createdBy: "worker-s125-004",
    });

    expect(plansSourceRefToWorkId("plans:S125-004")).toBe("S125-004");
    expect(plansSourceRefToWorkId("github:#1")).toBeNull();
    expect(item.createdBy).toBe("worker-s125-004");
    expect(Object.keys(importPlansToWorkGraphDryRun(importFixture, { project: "proj" })).some((key) => /db|store/i.test(key))).toBe(false);
  });
});
