import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLI = readFileSync(join(ROOT, "scripts/harness-mem"), "utf8");
const CLIENT = readFileSync(join(ROOT, "scripts/harness-mem-client.sh"), "utf8");

describe("harness-mem vector backfill CLI contract", () => {
  test("exposes the admin vector backfill command and options", () => {
    expect(CLI).toContain("admin-vector-backfill start|status|stop");
    expect(CLI).toContain("Manage the out-of-request vector compact/reindex backfill worker");
    expect(CLI).toContain("--compact-batch-size <n>");
    expect(CLI).toContain("--reindex-batch-size <n>");
    expect(CLI).toContain("--interval-ms <n>");
    expect(CLI).toContain("--target-coverage <n>");
    expect(CLI).toContain("--reset");
  });

  test("builds the start payload with server-owned field names", () => {
    expect(CLI).toContain("build_vector_backfill_start_payload");
    expect(CLI).toContain("compact_batch_size: ($compact_batch_size | tonumber)");
    expect(CLI).toContain("reindex_batch_size: ($reindex_batch_size | tonumber)");
    expect(CLI).toContain("interval_ms: ($interval_ms | tonumber)");
    expect(CLI).toContain("target_coverage: ($target_coverage | tonumber)");
    expect(CLI).toContain("model: $model");
    expect(CLI).toContain("dimension: ($dimension | tonumber)");
    expect(CLI).toContain("reset: true");
    expect(CLI).toContain('local payload="${2-}"');
    expect(CLI).not.toContain('local payload="${2:-{}}"');
    expect(CLI).not.toContain("HARNESS_MEM_ADMIN_TOKEN=");
  });

  test("dispatches through the thin client without requiring a live daemon", () => {
    expect(CLI).toContain("admin_vector_backfill_impl");
    expect(CLI).toContain("admin-vector-backfill-${action}");
    expect(CLIENT).toContain("admin-vector-backfill-start");
    expect(CLIENT).toContain("admin-vector-backfill-status");
    expect(CLIENT).toContain("admin-vector-backfill-stop");
    expect(CLIENT).toContain("/v1/admin/vector-backfill/start");
    expect(CLIENT).toContain("/v1/admin/vector-backfill/status");
    expect(CLIENT).toContain("/v1/admin/vector-backfill/stop");
    expect(CLIENT).toContain("admin_vector_backfill_start_failed");
    expect(CLIENT).toContain("admin_vector_backfill_status_failed");
    expect(CLIENT).toContain("admin_vector_backfill_stop_failed");
  });
});
