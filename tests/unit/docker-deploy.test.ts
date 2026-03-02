/**
 * TEAM-007: Docker compose + セットアップ自動化 のテスト
 *
 * Dockerfile / docker-compose.yml / Caddyfile の存在と必須内容を検証する。
 * deploy コマンドスクリプトの基本動作も確認する。
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "../..");

describe("TEAM-007: Docker compose + セットアップ自動化", () => {
  test("Dockerfile が存在する", () => {
    expect(existsSync(join(PROJECT_ROOT, "Dockerfile"))).toBe(true);
  });

  test("docker-compose.yml が存在し必須サービスを含む", () => {
    const path = join(PROJECT_ROOT, "docker-compose.yml");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("memory-server");
    expect(content).toContain("caddy");
    expect(content).toContain("HARNESS_MEM_ADMIN_TOKEN");
  });

  test("Caddyfile が存在しリバースプロキシ設定を含む", () => {
    const path = join(PROJECT_ROOT, "Caddyfile");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("memory-server");
  });

  test("scripts/deploy.sh が存在し実行可能", () => {
    const path = join(PROJECT_ROOT, "scripts/deploy.sh");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    // init / check / start / client-config サブコマンドを含む
    expect(content).toContain("init");
    expect(content).toContain("check");
    expect(content).toContain("start");
    expect(content).toContain("client-config");
  });
});
