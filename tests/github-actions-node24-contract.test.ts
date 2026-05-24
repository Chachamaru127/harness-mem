import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS_DIR = join(process.cwd(), ".github", "workflows");

describe("GitHub Actions Node 24 contract", () => {
  test("workflows do not pin known Node 20 action majors", () => {
    const deprecatedActionMajors = [
      "actions/checkout@v4",
      "actions/setup-node@v4",
      "actions/setup-python@v5",
      "actions/setup-go@v5",
      "actions/cache@v4",
      "actions/upload-artifact@v4",
      "actions/download-artifact@v4",
      "actions/upload-artifact@v6",
      "actions/download-artifact@v6",
      "softprops/action-gh-release@v2",
    ];

    const workflowSources = readdirSync(WORKFLOWS_DIR)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .map((file) => [file, readFileSync(join(WORKFLOWS_DIR, file), "utf8")] as const);

    for (const [file, source] of workflowSources) {
      for (const action of deprecatedActionMajors) {
        expect(source, `${file} still uses ${action}`).not.toContain(action);
      }
    }
  });
});
