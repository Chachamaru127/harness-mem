import { describe, expect, test } from "vitest";
import {
  buildProjectDisplayNameMap,
  getBaseProjectDisplayName,
  getProjectDisplayName,
} from "../../src/lib/project-label";

describe("project-label", () => {
  test("uses basename for absolute paths", () => {
    const project = "/Users/tachibanashuuta/Context-Harness";
    expect(getBaseProjectDisplayName(project)).toBe("Context-Harness");
  });

  test("keeps plain project names unchanged", () => {
    expect(getBaseProjectDisplayName("Context-Harness")).toBe("Context-Harness");
  });

  test("uses parent/name when basename collides", () => {
    const map = buildProjectDisplayNameMap([
      "/Users/a/work/Context-Harness",
      "/Users/b/repo/Context-Harness",
    ]);
    expect(getProjectDisplayName("/Users/a/work/Context-Harness", map)).toBe("work/Context-Harness");
    expect(getProjectDisplayName("/Users/b/repo/Context-Harness", map)).toBe("repo/Context-Harness");
  });

  test("falls back to full path when parent/name also collides", () => {
    const first = "/Users/a/repo/Context-Harness";
    const second = "/opt/team/repo/Context-Harness";
    const map = buildProjectDisplayNameMap([first, second]);
    expect(getProjectDisplayName(first, map)).toBe(first);
    expect(getProjectDisplayName(second, map)).toBe(second);
  });
});
