import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("harness-mem UI static contract", () => {
  test("server uses only the parity static bundle", () => {
    const server = readFileSync(join(process.cwd(), "harness-mem-ui/src/server.ts"), "utf8");

    expect(server).toContain('const staticDir = join(import.meta.dir, "static-parity");');
    expect(server).toContain("UI static bundle missing:");
    expect(server).not.toContain("HARNESS_MEM_UI_PARITY_V1");
    expect(server).not.toContain('join(import.meta.dir, "static")');
  });
});
