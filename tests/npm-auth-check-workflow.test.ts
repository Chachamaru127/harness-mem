import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("npm auth check workflow", () => {
  test("supports manual execution and validates publish credentials without publishing", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "npm-auth-check.yml");
    expect(existsSync(workflowPath)).toBe(true);

    const source = readFileSync(workflowPath, "utf8");
    expect(source).toContain("workflow_dispatch");
    expect(source).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(source).toContain("name: Show npm identity");
    expect(source).toContain("npm whoami");
    expect(source).toContain("name: Verify package collaborator access");
    expect(source).toContain("npm access list collaborators");
    expect(source).toContain("name: Verify package visibility");
    expect(source).toContain("npm access get status");
    expect(source).toContain("name: Verify package tarball can be prepared");
    expect(source).toContain("npm pack --dry-run");
    expect(source).not.toContain("npm publish");
  });
});
