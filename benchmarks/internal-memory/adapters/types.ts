import type { AdapterQueryResult, AdapterRunContext, BenchmarkCase } from "../lib/types";

export interface MemoryBenchmarkAdapter {
  readonly id: string;
  prepareCase(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<void>;
  query(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<AdapterQueryResult>;
  dispose(): Promise<void>;
}
