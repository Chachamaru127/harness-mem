import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLI = readFileSync(join(ROOT, "scripts/harness-mem"), "utf8");
const CLIENT = readFileSync(join(ROOT, "scripts/harness-mem-client.sh"), "utf8");

describe("harness-mem sqlite-vec repair CLI contract", () => {
  test("exposes a dry-run-by-default admin repair command", () => {
    expect(CLI).toContain("admin-repair-sqlite-vec-map --model <model>");
    expect(CLI).toContain("REPAIR_SQLITE_VEC_EXECUTE=0");
    expect(CLI).toContain("REPAIR_SQLITE_VEC_EXECUTE=1");
    expect(CLI).toContain("REPAIR_SQLITE_VEC_REBUILD_EXISTING=0");
    expect(CLI).toContain("--rebuild-existing");
    expect(CLI).toContain("admin-repair-sqlite-vec-map requires --model <model>");
    expect(CLI).toContain("refusing to infer an admin repair target");
  });

  test("builds the repair payload without printing or embedding secrets", () => {
    expect(CLI).toContain("model: $model");
    expect(CLI).toContain("execute: $execute");
    expect(CLI).toContain("rebuild_existing: $rebuild_existing");
    expect(CLI).toContain("dimension: ($dimension | tonumber)");
    expect(CLI).toContain("limit: ($limit | tonumber)");
    expect(CLI).not.toContain("HARNESS_MEM_ADMIN_TOKEN=");
  });

  test("thin client posts to the server-owned repair endpoint", () => {
    expect(CLIENT).toContain("admin-repair-sqlite-vec-map");
    expect(CLIENT).toContain("/v1/admin/repair-sqlite-vec-map");
    expect(CLIENT).toContain("admin_repair_sqlite_vec_map_failed");
  });
});
