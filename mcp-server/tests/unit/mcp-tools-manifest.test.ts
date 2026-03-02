/**
 * COMP-010: MCP サーバー公開 ツール一覧テスト
 *
 * テストケース:
 * 1. 正常: memoryTools に search ツールが含まれる
 * 2. 正常: memoryTools に add (record_event) ツールが含まれる
 * 3. 正常: memoryTools に list (sessions_list) ツールが含まれる
 * 4. 正常: memoryTools に get (get_observations) ツールが含まれる
 * 5. 正常: memoryTools に delete ツールが含まれる
 * 6. 正常: memoryTools に health ツールが含まれる
 * 7. 正常: 全ツールが name, description, inputSchema を持つ
 * 8. 正常: inputSchema がすべて有効な JSON Schema 形式である
 */

import { describe, expect, test } from "bun:test";
import { memoryTools } from "../../src/tools/memory.js";

const REQUIRED_TOOLS = [
  "harness_mem_search",
  "harness_mem_record_event",
  "harness_mem_sessions_list",
  "harness_mem_get_observations",
  "harness_mem_delete_observation",
  "harness_mem_health",
];

describe("COMP-010: MCP ツール一覧", () => {
  test("正常: memoryTools に search ツールが含まれる", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_search");
    expect(tool).toBeDefined();
    expect(tool?.description).toBeTruthy();
  });

  test("正常: memoryTools に add (record_event) ツールが含まれる", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_record_event");
    expect(tool).toBeDefined();
    expect(tool?.description).toBeTruthy();
  });

  test("正常: memoryTools に list (sessions_list) ツールが含まれる", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_sessions_list");
    expect(tool).toBeDefined();
    expect(tool?.description).toBeTruthy();
  });

  test("正常: memoryTools に get (get_observations) ツールが含まれる", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_get_observations");
    expect(tool).toBeDefined();
    expect(tool?.description).toBeTruthy();
  });

  test("正常: memoryTools に delete ツールが含まれる", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_delete_observation");
    expect(tool).toBeDefined();
    expect(tool?.description).toBeTruthy();
  });

  test("正常: memoryTools に health ツールが含まれる", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_health");
    expect(tool).toBeDefined();
    expect(tool?.description).toBeTruthy();
  });

  test("正常: 全ツールが name, description, inputSchema を持つ", () => {
    for (const tool of memoryTools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  test("正常: inputSchema は properties を持つ有効な JSON Schema である", () => {
    for (const tool of memoryTools) {
      // inputSchema.type が "object" であること
      expect(tool.inputSchema.type).toBe("object");
      // properties が undefined か object であること
      if (tool.inputSchema.properties !== undefined) {
        expect(typeof tool.inputSchema.properties).toBe("object");
      }
    }
  });
});
