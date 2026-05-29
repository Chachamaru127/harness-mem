import { describe, expect, test } from "bun:test";
import { AgentmemoryAdapter } from "../adapters/agentmemory";
import { SupermemoryAdapter } from "../adapters/supermemory";
import type { BenchmarkCase } from "../lib/types";

const caseRow: BenchmarkCase = {
  case_id: "skip-001",
  layer: "public_compatible",
  category: "english_fact",
  language_profile: "en",
  project: "bench-skip",
  memories: [{ id: "skip-001-m1", content: "sample memory" }],
  query: "sample query",
  relevant_ids: ["skip-001-m1"],
};

describe("external competitor adapters skip contract", () => {
  test("agentmemory skips when AGENTMEMORY_BASE_URL is unset", async () => {
    const previous = process.env.AGENTMEMORY_BASE_URL;
    delete process.env.AGENTMEMORY_BASE_URL;
    const adapter = new AgentmemoryAdapter();
    const context = { run_id: "r", competitor_id: "agentmemory", project_prefix: "p" };
    try {
      const result = await adapter.query(caseRow, context);
      expect(result.status).toBe("skipped_missing_credentials");
      expect(result.skip_reason).toContain("AGENTMEMORY_BASE_URL");
    } finally {
      if (previous) process.env.AGENTMEMORY_BASE_URL = previous;
      await adapter.dispose();
    }
  });

  test("supermemory skips when SUPERMEMORY_API_KEY is unset", async () => {
    const previous = process.env.SUPERMEMORY_API_KEY;
    delete process.env.SUPERMEMORY_API_KEY;
    const adapter = new SupermemoryAdapter();
    const context = { run_id: "r", competitor_id: "supermemory", project_prefix: "p" };
    try {
      const result = await adapter.query(caseRow, context);
      expect(result.status).toBe("skipped_missing_credentials");
      expect(result.skip_reason).toContain("SUPERMEMORY_API_KEY");
    } finally {
      if (previous) process.env.SUPERMEMORY_API_KEY = previous;
      await adapter.dispose();
    }
  });
});
