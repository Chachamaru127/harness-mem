import { describe, expect, test } from "bun:test";
import { evaluateGraniteFlipPreflight } from "./s154-granite-flip-preflight";

describe("S154-512 granite flip preflight", () => {
  test("authorizes when passed, sqlite_vec, and sidecar parity hold", () => {
    const result = evaluateGraniteFlipPreflight(
      {
        verification: {
          passed: true,
          sqlite_vec_available: true,
          sidecar_rows: 42,
          granite_rows: 42,
        },
      },
      "docs/benchmarks/artifacts/s154-granite-backfill/verification.json",
    );
    expect(result.authorized).toBe(true);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  test("rejects when sidecar_rows != granite_rows", () => {
    const result = evaluateGraniteFlipPreflight(
      {
        verification: {
          passed: true,
          sqlite_vec_available: true,
          sidecar_rows: 41,
          granite_rows: 42,
        },
      },
      "artifact.json",
    );
    expect(result.authorized).toBe(false);
    expect(result.checks.find((check) => check.id.includes("sidecar_rows"))?.ok).toBe(false);
  });
});
