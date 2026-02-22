import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const README_PATH = join(process.cwd(), "README.md");

describe("README Plans workflow rules", () => {
  test("documents Plans.md single-source workflow and status transitions", () => {
    const readme = readFileSync(README_PATH, "utf8");

    expect(readme).toContain("Plans.md");
    expect(readme).toContain("cc:TODO");
    expect(readme).toContain("cc:WIP");
    expect(readme).toContain("cc:完了");
    expect(readme).toContain("blocked");
    expect(readme).toContain("Phase");
    expect(readme).toContain("着手時");
    expect(readme).toContain("完了時");
  });
});
