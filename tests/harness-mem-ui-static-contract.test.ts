import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("harness-mem UI static contract", () => {
  test("server uses only the parity static bundle", () => {
    const server = readFileSync(join(process.cwd(), "harness-mem-ui/src/server.ts"), "utf8");

    expect(server).toContain('const staticDir = join(import.meta.dir, "static-parity");');
    expect(server).toContain("UI static bundle missing:");
    expect(server).toContain("const server = Bun.serve");
    expect(server).toContain("idleTimeout: 255");
    expect(server).toContain("const keepAlive = setInterval");
    expect(server).toContain("server.stop(true)");
    expect(server).not.toContain("HARNESS_MEM_UI_PARITY_V1");
    expect(server).not.toContain('join(import.meta.dir, "static")');
  });

  test("feed and projects stats proxies apply default project scope before reaching core", () => {
    const server = readFileSync(join(process.cwd(), "harness-mem-ui/src/server.ts"), "utf8");

    expect(server).toContain("function withDefaultProjectScope");
    expect(server).toContain('scoped.searchParams.set("project", DEFAULT_PROJECT);');
    expect(server).toContain('return proxyJson(withDefaultProjectScope(`/v1/feed${url.search || ""}`), "GET");');
    expect(server).toContain('return proxyJson(withDefaultProjectScope(`/v1/projects/stats${url.search || ""}`), "GET");');
  });
});
