/**
 * TEAM-011: クライアント設定配布コマンド のテスト
 *
 * scripts/deploy.sh client-config が
 * --user-id / --team-id / --remote-url 引数に応じた
 * 設定スニペットを出力することを検証する。
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const DEPLOY_SCRIPT = join(import.meta.dir, "../../scripts/deploy.sh");

function runClientConfig(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("bash", [DEPLOY_SCRIPT, "client-config", ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: process.env.HOME || "/tmp" },
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

describe("TEAM-011: クライアント設定配布コマンド", () => {
  test("client-config はゼロ終了コードで正常終了する", () => {
    const { exitCode } = runClientConfig();
    expect(exitCode).toBe(0);
  });

  test("--user-id 引数が出力に反映される", () => {
    const { stdout } = runClientConfig("--user-id", "ohashi");
    expect(stdout).toContain("HARNESS_MEM_USER_ID=ohashi");
  });

  test("--team-id と --remote-url 引数が出力に反映される", () => {
    const { stdout } = runClientConfig(
      "--team-id", "it-team",
      "--remote-url", "https://vps.example.com"
    );
    expect(stdout).toContain("HARNESS_MEM_TEAM_ID=it-team");
    expect(stdout).toContain("HARNESS_MEM_REMOTE_URL=https://vps.example.com");
  });
});
