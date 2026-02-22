import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const README_PATH = join(process.cwd(), "README.md");
const README_JA_PATH = join(process.cwd(), "README_ja.md");

describe("README Plans workflow rules", () => {
  test("README.md (English default) documents Plans workflow status transitions", () => {
    const readme = readFileSync(README_PATH, "utf8");

    expect(readme).toContain("Plans.md");
    expect(readme).toContain("cc:TODO");
    expect(readme).toContain("cc:WIP");
    expect(readme).toContain("cc:完了");
    expect(readme).toContain("blocked");
    expect(readme).toContain("Phase");
    expect(readme).toContain("When starting");
    expect(readme).toContain("When complete");
    expect(readme).toContain("English |");
    expect(readme).toContain("README_ja.md");
  });

  test("README_ja.md exists and keeps Japanese plans guidance", () => {
    const readmeJa = readFileSync(README_JA_PATH, "utf8");

    expect(readmeJa).toContain("Plans.md");
    expect(readmeJa).toContain("cc:TODO");
    expect(readmeJa).toContain("cc:WIP");
    expect(readmeJa).toContain("cc:完了");
    expect(readmeJa).toContain("blocked");
    expect(readmeJa).toContain("着手時");
    expect(readmeJa).toContain("完了時");
    expect(readmeJa).toContain("README.md");
  });
});
