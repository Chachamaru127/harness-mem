/**
 * ARC-014: MCP ツール定義と OpenAPI スキーマの整合性テスト
 *
 * テストケース:
 * 1. 各 MCP ツールに対応する OpenAPI エンドポイントが存在すること
 * 2. MCP ツールの必須パラメータと OpenAPI の required フィールドが一致すること
 * 3. MCP ツールのパラメータ名が OpenAPI のプロパティ名と一致すること
 * 4. MCP ツール名→エンドポイントのマッピングが正しいこと
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { parse as parseYaml } from "yaml";
import { readFileSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { memoryTools } from "../../src/tools/memory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = resolve(__dirname, "../../../docs/openapi.yaml");

// MCP ツール名 → OpenAPI エンドポイント & メソッドのマッピング
const TOOL_ENDPOINT_MAP: Record<string, { path: string; method: string }> = {
  harness_mem_resume_pack: { path: "/v1/resume-pack", method: "post" },
  harness_mem_search: { path: "/v1/search", method: "post" },
  harness_mem_timeline: { path: "/v1/timeline", method: "post" },
  harness_mem_get_observations: { path: "/v1/observations/get", method: "post" },
  harness_mem_sessions_list: { path: "/v1/sessions/list", method: "get" },
  harness_mem_session_thread: { path: "/v1/sessions/thread", method: "get" },
  harness_mem_search_facets: { path: "/v1/search/facets", method: "get" },
  harness_mem_record_checkpoint: { path: "/v1/checkpoints/record", method: "post" },
  harness_mem_finalize_session: { path: "/v1/sessions/finalize", method: "post" },
  harness_mem_record_event: { path: "/v1/events/record", method: "post" },
  harness_mem_health: { path: "/health", method: "get" },
  harness_mem_admin_import_claude_mem: { path: "/v1/admin/imports/claude-mem", method: "post" },
  harness_mem_admin_reindex_vectors: { path: "/v1/admin/reindex-vectors", method: "post" },
  harness_mem_admin_metrics: { path: "/v1/admin/metrics", method: "get" },
  harness_mem_admin_consolidation_run: { path: "/v1/admin/consolidation/run", method: "post" },
  harness_mem_admin_consolidation_status: { path: "/v1/admin/consolidation/status", method: "get" },
  harness_mem_admin_audit_log: { path: "/v1/admin/audit-log", method: "get" },
  harness_mem_add_relation: { path: "/v1/links/create", method: "post" },
  harness_mem_bulk_delete: { path: "/v1/observations/bulk-delete", method: "post" },
  harness_mem_export: { path: "/v1/export", method: "get" },
  harness_mem_ingest: { path: "/v1/ingest/document", method: "post" },
  harness_mem_graph: { path: "/v1/graph/neighbors", method: "get" },
};

// OpenAPI スキーマ型
interface OpenApiOperation {
  operationId?: string;
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: {
          type?: string;
          required?: string[];
          properties?: Record<string, unknown>;
        };
      };
    };
  };
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
  }>;
}

interface OpenApiPaths {
  [path: string]: {
    [method: string]: OpenApiOperation;
  };
}

interface OpenApiDoc {
  paths: OpenApiPaths;
}

let openApiDoc: OpenApiDoc;

beforeAll(() => {
  const yamlContent = readFileSync(OPENAPI_PATH, "utf-8");
  openApiDoc = parseYaml(yamlContent) as OpenApiDoc;
});

// OpenAPI エンドポイントから必須パラメータを抽出するヘルパー
function getOpenApiRequired(operation: OpenApiOperation): string[] {
  // POST: requestBody.content.application/json.schema.required
  const bodyRequired =
    operation.requestBody?.content?.["application/json"]?.schema?.required ?? [];

  // GET: parameters[].required === true の name
  const queryRequired = (operation.parameters ?? [])
    .filter((p) => p.required === true)
    .map((p) => p.name);

  return [...bodyRequired, ...queryRequired];
}

// OpenAPI エンドポイントからプロパティ名を抽出するヘルパー
function getOpenApiProperties(operation: OpenApiOperation): string[] {
  // POST: requestBody プロパティ
  const bodyProps = Object.keys(
    operation.requestBody?.content?.["application/json"]?.schema?.properties ?? {}
  );

  // GET: parameters の name
  const queryProps = (operation.parameters ?? []).map((p) => p.name);

  return [...bodyProps, ...queryProps];
}

describe("ARC-014: MCP ツール定義と OpenAPI スキーマの整合性", () => {
  test("OpenAPI ファイルが正常にパースされること", () => {
    expect(openApiDoc).toBeDefined();
    expect(openApiDoc.paths).toBeDefined();
    expect(typeof openApiDoc.paths).toBe("object");
  });

  test("TOOL_ENDPOINT_MAP の全エンドポイントが OpenAPI に存在すること", () => {
    for (const [toolName, { path, method }] of Object.entries(TOOL_ENDPOINT_MAP)) {
      const pathEntry = openApiDoc.paths[path];
      expect(pathEntry, `ツール "${toolName}" のパス "${path}" が OpenAPI に存在しません`).toBeDefined();

      const operation = pathEntry?.[method];
      expect(
        operation,
        `ツール "${toolName}" の "${method.toUpperCase()} ${path}" が OpenAPI に存在しません`
      ).toBeDefined();
    }
  });

  test("MCP ツールの必須パラメータが OpenAPI の required と一致すること", () => {
    // POST ツールのみ対象（必須パラメータ検証が requestBody で可能なもの）
    const postToolsToCheck = [
      "harness_mem_search",
      "harness_mem_get_observations",
      "harness_mem_record_checkpoint",
      "harness_mem_finalize_session",
      "harness_mem_record_event",
      "harness_mem_add_relation",
      "harness_mem_bulk_delete",
      "harness_mem_ingest",
    ];

    for (const toolName of postToolsToCheck) {
      const mcpTool = memoryTools.find((t) => t.name === toolName);
      expect(mcpTool, `MCP ツール "${toolName}" が見つかりません`).toBeDefined();

      const endpoint = TOOL_ENDPOINT_MAP[toolName];
      expect(endpoint).toBeDefined();

      const operation = openApiDoc.paths[endpoint.path]?.[endpoint.method];
      expect(operation, `OpenAPI に "${endpoint.method} ${endpoint.path}" が存在しません`).toBeDefined();

      const mcpRequired = (mcpTool!.inputSchema as { required?: string[] }).required ?? [];
      const openApiRequired = getOpenApiRequired(operation!);

      // MCP の必須パラメータが OpenAPI の required に含まれていること
      for (const param of mcpRequired) {
        expect(
          openApiRequired,
          `ツール "${toolName}" の必須パラメータ "${param}" が OpenAPI の required に含まれていません`
        ).toContain(param);
      }
    }
  });

  test("MCP ツールのパラメータ名が OpenAPI のプロパティに含まれること（主要ツール）", () => {
    const toolsToCheck = [
      "harness_mem_search",
      "harness_mem_get_observations",
      "harness_mem_record_checkpoint",
      "harness_mem_record_event",
    ];

    for (const toolName of toolsToCheck) {
      const mcpTool = memoryTools.find((t) => t.name === toolName);
      expect(mcpTool, `MCP ツール "${toolName}" が見つかりません`).toBeDefined();

      const endpoint = TOOL_ENDPOINT_MAP[toolName];
      const operation = openApiDoc.paths[endpoint.path]?.[endpoint.method];
      expect(operation).toBeDefined();

      const mcpProperties = Object.keys(
        (mcpTool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      );
      const openApiProps = getOpenApiProperties(operation!);

      // MCP の各プロパティが OpenAPI にも存在すること
      for (const prop of mcpProperties) {
        expect(
          openApiProps,
          `ツール "${toolName}" のパラメータ "${prop}" が OpenAPI に存在しません`
        ).toContain(prop);
      }
    }
  });

  test("harness_mem_search の必須パラメータ 'query' が OpenAPI と一致すること", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_search");
    expect(tool).toBeDefined();

    const mcpRequired = (tool!.inputSchema as { required?: string[] }).required ?? [];
    expect(mcpRequired).toContain("query");

    const operation = openApiDoc.paths["/v1/search"]?.["post"];
    expect(operation).toBeDefined();

    const openApiRequired = getOpenApiRequired(operation!);
    expect(openApiRequired).toContain("query");
  });

  test("harness_mem_get_observations の必須パラメータ 'ids' が OpenAPI と一致すること", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_get_observations");
    expect(tool).toBeDefined();

    const mcpRequired = (tool!.inputSchema as { required?: string[] }).required ?? [];
    expect(mcpRequired).toContain("ids");

    const operation = openApiDoc.paths["/v1/observations/get"]?.["post"];
    expect(operation).toBeDefined();

    const openApiRequired = getOpenApiRequired(operation!);
    expect(openApiRequired).toContain("ids");
  });

  test("harness_mem_record_checkpoint の必須パラメータが OpenAPI と一致すること", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_record_checkpoint");
    expect(tool).toBeDefined();

    const mcpRequired = (tool!.inputSchema as { required?: string[] }).required ?? [];
    expect(mcpRequired).toContain("session_id");
    expect(mcpRequired).toContain("title");
    expect(mcpRequired).toContain("content");

    const operation = openApiDoc.paths["/v1/checkpoints/record"]?.["post"];
    expect(operation).toBeDefined();

    const openApiRequired = getOpenApiRequired(operation!);
    expect(openApiRequired).toContain("session_id");
    expect(openApiRequired).toContain("title");
    expect(openApiRequired).toContain("content");
  });

  test("harness_mem_record_event の必須パラメータ 'event' が OpenAPI と一致すること", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_record_event");
    expect(tool).toBeDefined();

    const mcpRequired = (tool!.inputSchema as { required?: string[] }).required ?? [];
    expect(mcpRequired).toContain("event");

    const operation = openApiDoc.paths["/v1/events/record"]?.["post"];
    expect(operation).toBeDefined();

    const openApiRequired = getOpenApiRequired(operation!);
    expect(openApiRequired).toContain("event");
  });

  test("harness_mem_finalize_session の必須パラメータ 'session_id' が OpenAPI と一致すること", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_finalize_session");
    expect(tool).toBeDefined();

    const mcpRequired = (tool!.inputSchema as { required?: string[] }).required ?? [];
    expect(mcpRequired).toContain("session_id");

    const operation = openApiDoc.paths["/v1/sessions/finalize"]?.["post"];
    expect(operation).toBeDefined();

    const openApiRequired = getOpenApiRequired(operation!);
    expect(openApiRequired).toContain("session_id");
  });

  test("harness_mem_add_relation の必須パラメータが OpenAPI と一致すること", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_add_relation");
    expect(tool).toBeDefined();

    const mcpRequired = (tool!.inputSchema as { required?: string[] }).required ?? [];
    expect(mcpRequired).toContain("from_observation_id");
    expect(mcpRequired).toContain("to_observation_id");
    expect(mcpRequired).toContain("relation");

    const operation = openApiDoc.paths["/v1/links/create"]?.["post"];
    expect(operation).toBeDefined();

    const openApiRequired = getOpenApiRequired(operation!);
    expect(openApiRequired).toContain("from_observation_id");
    expect(openApiRequired).toContain("to_observation_id");
    expect(openApiRequired).toContain("relation");
  });

  test("harness_mem_ingest の必須パラメータが OpenAPI と一致すること", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_ingest");
    expect(tool).toBeDefined();

    const mcpRequired = (tool!.inputSchema as { required?: string[] }).required ?? [];
    expect(mcpRequired).toContain("file_path");
    expect(mcpRequired).toContain("content");

    const operation = openApiDoc.paths["/v1/ingest/document"]?.["post"];
    expect(operation).toBeDefined();

    const openApiRequired = getOpenApiRequired(operation!);
    expect(openApiRequired).toContain("file_path");
    expect(openApiRequired).toContain("content");
  });

  test("GRAPH-004: harness_mem_graph の depth パラメータが OpenAPI に存在すること", () => {
    const operation = openApiDoc.paths["/v1/graph/neighbors"]?.["get"];
    expect(operation).toBeDefined();

    const openApiProps = getOpenApiProperties(operation!);
    expect(openApiProps).toContain("depth");
  });

  test("GRAPH-004: harness_mem_graph MCP ツールに depth プロパティが定義されていること", () => {
    const tool = memoryTools.find((t) => t.name === "harness_mem_graph");
    expect(tool).toBeDefined();

    const properties = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(properties).toHaveProperty("depth");

    const depthSchema = properties.depth as { type?: string; minimum?: number; maximum?: number; default?: number };
    expect(depthSchema.type).toBe("integer");
    expect(depthSchema.minimum).toBe(1);
    expect(depthSchema.maximum).toBe(5);
    expect(depthSchema.default).toBe(1);
  });

  test("GRAPH-004: depth=3 の場合 OpenAPI のスキーマ制約（minimum=1, maximum=5）を満たすこと", () => {
    const operation = openApiDoc.paths["/v1/graph/neighbors"]?.["get"];
    expect(operation).toBeDefined();

    const depthParam = (operation!.parameters ?? []).find((p) => p.name === "depth");
    expect(depthParam).toBeDefined();

    const depthParamTyped = depthParam as { name: string; in: string; schema?: { type?: string; minimum?: number; maximum?: number; default?: number } };
    expect(depthParamTyped.schema?.type).toBe("integer");
    expect(depthParamTyped.schema?.minimum).toBe(1);
    expect(depthParamTyped.schema?.maximum).toBe(5);
    expect(depthParamTyped.schema?.default).toBe(1);

    // depth=3 は制約範囲内
    const testDepth = 3;
    expect(testDepth).toBeGreaterThanOrEqual(depthParamTyped.schema!.minimum!);
    expect(testDepth).toBeLessThanOrEqual(depthParamTyped.schema!.maximum!);
  });

  test("TOOL_ENDPOINT_MAP にないツールは harness_mem_ プレフィックスを持つこと", () => {
    const unmappedTools = memoryTools.filter(
      (t) => !(t.name in TOOL_ENDPOINT_MAP)
    );

    for (const tool of unmappedTools) {
      // マッピング未定義ツールも harness_mem_ プレフィックスを持つこと
      expect(tool.name).toMatch(/^harness_mem_/);
    }
  });

  test("memoryTools の全ツールが有効な inputSchema を持つこと", () => {
    for (const tool of memoryTools) {
      expect(tool.inputSchema.type).toBe("object");
      const schema = tool.inputSchema as {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
      if (schema.required !== undefined) {
        expect(Array.isArray(schema.required)).toBe(true);
      }
      if (schema.properties !== undefined) {
        expect(typeof schema.properties).toBe("object");
      }
    }
  });
});
