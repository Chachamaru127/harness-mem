/**
 * NEXT-003: MCP API 全機能公開 テスト
 * compress / stats / ingest / graph の4ツールが MCP 経由でアクセス可能か検証する。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOOL_FILE = join(process.cwd(), "mcp-server", "src", "tools", "memory.ts");
const SERVER_FILE = join(process.cwd(), "memory-server", "src", "server.ts");

describe("NEXT-003: MCP API 全機能公開", () => {
  test("memory.ts に harness_mem_compress ツールが定義されている", () => {
    const source = readFileSync(TOOL_FILE, "utf8");
    expect(source).toContain("harness_mem_compress");
  });

  test("memory.ts に harness_mem_stats ツールが定義されている", () => {
    const source = readFileSync(TOOL_FILE, "utf8");
    expect(source).toContain("harness_mem_stats");
  });

  test("memory.ts に harness_mem_ingest ツールが定義されている", () => {
    const source = readFileSync(TOOL_FILE, "utf8");
    expect(source).toContain("harness_mem_ingest");
  });

  test("memory.ts に harness_mem_graph ツールが定義されており、graph/neighbors エンドポイントにルーティングされる", () => {
    const source = readFileSync(TOOL_FILE, "utf8");
    expect(source).toContain("harness_mem_graph");
    expect(source).toContain("/v1/graph/neighbors");
  });

  test("server.ts に /v1/graph/neighbors エンドポイントが実装されている", () => {
    const source = readFileSync(SERVER_FILE, "utf8");
    expect(source).toContain("/v1/graph/neighbors");
  });

  test("server.ts に /v1/ingest/document エンドポイントが実装されている", () => {
    const source = readFileSync(SERVER_FILE, "utf8");
    expect(source).toContain("/v1/ingest/document");
  });
});
