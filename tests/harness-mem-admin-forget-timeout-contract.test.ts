import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("admin forget timeout contract", () => {
  test("forget admin requests get an explicit Bun idle timeout extension", () => {
    const source = readFileSync("memory-server/src/server.ts", "utf8");
    expect(source).toContain('url.pathname.startsWith("/v1/admin/forget/")');
    expect(source).toContain("server?.timeout(request, 255)");
  });
});
