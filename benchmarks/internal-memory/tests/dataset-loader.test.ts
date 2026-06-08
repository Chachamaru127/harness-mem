import { describe, expect, test } from "bun:test";
import {
  CODINGMEMORY_V3_FILE,
  loadCodingMemoryDataset,
  loadRealDataDataset,
  resolveRealDataDatasetFile,
} from "../lib/dataset-loader";

describe("dataset-loader v3 priority", () => {
  test("prefers v3 over v2 when present", () => {
    const file = resolveRealDataDatasetFile();
    if (!file) return;
    expect(file).toBe(CODINGMEMORY_V3_FILE);
  });

  test("loadCodingMemoryDataset returns non-empty when v3 exists", () => {
    const cases = loadCodingMemoryDataset("v3");
    if (cases.length === 0) return;
    expect(cases.length).toBeGreaterThanOrEqual(300);
    expect(cases.every((row) => row.source_dataset === "coding-memory-real-ja-mixed-v3")).toBe(true);
  });

  test("loadRealDataDataset uses highest available version", () => {
    const cases = loadRealDataDataset();
    if (cases.length === 0) return;
    const file = resolveRealDataDatasetFile();
    if (file === CODINGMEMORY_V3_FILE) {
      expect(cases.some((row) => row.source_platform !== undefined)).toBe(true);
    }
  });
});
