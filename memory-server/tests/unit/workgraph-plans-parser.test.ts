import { describe, expect, test } from "bun:test";
import { parseActivePlansMarkdown, parsePlansDryRun, toPlansSourceRef } from "../../src/workgraph/plans-parser";

const activePlansFixture = `
# Plans

## §125 WorkGraph Task Continuity MVP (2026-05-17) — cc:TODO

| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| S125-001 | **WorkGraph spec freeze** — lock purpose and non-goals | spec is merged | - | cc:TODO |
| S125-002 [P] | **Active Plans parser dry-run fixture** [tdd:required] — parse active rows without side effects | parser tests pass | S125-001 | cc:WIP |
| S125-003 | **Additive work schema + WorkStore MVP** [P] — preserve existing tables | schema tests pass | S125-001, S125-002 | blocked |
| S125-004 | **Plans dry-run import to WorkGraph model** — map parser output later | import fidelity passes | S125-002 | cc:完了 [abc123] |
| S78-A05.2 | **Dotted follow-up id** — keep non-numeric task ids parseable | parsed | S78-A03, S90-002-f1 | cc:TODO |
| S90-002-f1 | **Dashed follow-up id** — keep suffix task ids parseable | parsed | - | cc:TODO |
| S125-005 | Missing columns | only dod | cc:TODO |
| S125-006 | **Unknown state** — should be skipped | diagnostic emitted | - | paused |

## アーカイブ (完了 / 休止セクション)

| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| S1-001 | **Old archived work** — should not parse by default | archived | - | cc:TODO |
`;

function tasksById(markdown = activePlansFixture) {
  const result = parseActivePlansMarkdown(markdown, { source: "Plans.md" });
  return {
    result,
    byId: Object.fromEntries(result.tasks.map((task) => [task.id, task])),
  };
}

describe("workgraph Plans.md parser", () => {
  test("maps Plans task ids to stable source refs", () => {
    const { byId } = tasksById();
    expect(toPlansSourceRef("S125-002")).toBe("plans:S125-002");
    expect(byId["S125-002"].source_ref).toBe("plans:S125-002");
  });

  test("maps supported Plans statuses", () => {
    const { byId } = tasksById();
    expect(byId["S125-001"].status).toBe("open");
    expect(byId["S125-002"].status).toBe("in_progress");
    expect(byId["S125-003"].status).toBe("blocked");
    expect(byId["S125-004"].status).toBe("closed");
    expect(byId["S125-004"].raw_status).toBe("cc:完了 [abc123]");
  });

  test("detects parallel marker in task or content cells", () => {
    const { byId } = tasksById();
    expect(byId["S125-002"].metadata.parallel).toBe(true);
    expect(byId["S125-003"].metadata.parallel).toBe(true);
    expect(byId["S125-001"].metadata.parallel).toBe(false);
  });

  test("parses comma separated dependencies into source refs", () => {
    const { byId } = tasksById();
    expect(byId["S125-001"].depends_on).toEqual([]);
    expect(byId["S125-003"].depends_on).toEqual(["plans:S125-001", "plans:S125-002"]);
    expect(byId["S78-A05.2"].depends_on).toEqual(["plans:S78-A03", "plans:S90-002-f1"]);
  });

  test("parses non-numeric follow-up task ids", () => {
    const { byId } = tasksById();
    expect(byId["S78-A05.2"].source_ref).toBe("plans:S78-A05.2");
    expect(byId["S90-002-f1"].source_ref).toBe("plans:S90-002-f1");
  });

  test("attaches section heading metadata to parsed tasks", () => {
    const { byId } = tasksById();
    expect(byId["S125-002"].metadata.section).toMatchObject({
      id: "§125",
      number: "125",
      title: "WorkGraph Task Continuity MVP (2026-05-17)",
      level: 2,
      status: "open",
      raw_status: "cc:TODO",
    });
  });

  test("preserves title and description from the content cell", () => {
    const { byId } = tasksById();
    expect(byId["S125-002"].title).toBe("Active Plans parser dry-run fixture");
    expect(byId["S125-002"].description).toContain("parse active rows without side effects");
    expect(byId["S125-002"].dod).toBe("parser tests pass");
  });

  test("reports skipped malformed rows and unknown statuses", () => {
    const { result } = tasksById();
    expect(result.tasks.map((task) => task.id)).not.toContain("S125-005");
    expect(result.tasks.map((task) => task.id)).not.toContain("S125-006");
    expect(result.tasks.map((task) => task.id)).not.toContain("S1-001");
    expect(result.skipped.map((row) => row.reason)).toEqual(["malformed_table_row", "unknown_status"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("malformed_table_row");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unknown_status");
  });

  test("can include archive sections when explicitly requested", () => {
    const result = parseActivePlansMarkdown(activePlansFixture, { includeArchivedSections: true });
    expect(result.tasks.map((task) => task.id)).toContain("S1-001");
  });

  test("dry-run wrapper exposes only text/options input and parsed data output", () => {
    expect(parsePlansDryRun.length).toBe(1);

    const result = parsePlansDryRun(`
## §125 WorkGraph Task Continuity MVP — cc:TODO
| Task | 内容 | DoD | Depends | Status |
| --- | --- | --- | --- | --- |
| S125-010 | **Claim integration** — pure parse fixture | parsed | - | cc:TODO |
`);

    expect(Object.keys(result).sort()).toEqual(["diagnostics", "skipped", "tasks"]);
    expect(Object.keys(result).some((key) => /db|write/i.test(key))).toBe(false);
    expect(result.tasks).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });
});
