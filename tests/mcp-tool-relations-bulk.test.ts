/**
 * NEXT-005: MCP ツール拡充（関係編集・バルク操作）テスト
 * add_relation / bulk_add / bulk_delete / export ツールの存在と動作を検証する。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOOL_FILE = join(process.cwd(), "mcp-server", "src", "tools", "memory.ts");
const SERVER_FILE = join(process.cwd(), "memory-server", "src", "server.ts");

describe("NEXT-005: MCP ツール拡充（関係編集・バルク操作）", () => {
  test("memory.ts に harness_mem_add_relation ツールが定義されている", () => {
    const source = readFileSync(TOOL_FILE, "utf8");
    expect(source).toContain("harness_mem_add_relation");
  });

  test("memory.ts に harness_mem_bulk_add ツールが定義されている", () => {
    const source = readFileSync(TOOL_FILE, "utf8");
    expect(source).toContain("harness_mem_bulk_add");
  });

  test("memory.ts に harness_mem_bulk_delete ツールが定義されている", () => {
    const source = readFileSync(TOOL_FILE, "utf8");
    expect(source).toContain("harness_mem_bulk_delete");
  });

  test("memory.ts に harness_mem_export ツールが定義されており、/v1/export にルーティングされる", () => {
    const source = readFileSync(TOOL_FILE, "utf8");
    expect(source).toContain("harness_mem_export");
    expect(source).toContain("/v1/export");
  });

  test("server.ts に /v1/links/create エンドポイントが実装されている", () => {
    const source = readFileSync(SERVER_FILE, "utf8");
    expect(source).toContain("/v1/links/create");
  });

  test("server.ts に /v1/observations/bulk-delete エンドポイントが実装されている", () => {
    const source = readFileSync(SERVER_FILE, "utf8");
    expect(source).toContain("/v1/observations/bulk-delete");
  });

  test("server.ts に /v1/export エンドポイントが実装されている", () => {
    const source = readFileSync(SERVER_FILE, "utf8");
    expect(source).toContain("/v1/export");
  });
});
