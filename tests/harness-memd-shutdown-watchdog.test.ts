import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const INDEX = resolve(ROOT, "memory-server/src/index.ts");
const CORE = resolve(ROOT, "memory-server/src/core/harness-mem-core.ts");
const SCRIPT = resolve(ROOT, "scripts/harness-memd");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * §159-004: shutdown が返らない daemon を残さないための 2 層防衛を pin する。
 *
 * L1 (daemon 内): graceful path が完了しない場合、watchdog timer が強制 exit する。
 * L2 (script): SIGTERM 後に一定秒待って SIGKILL へ escalate する。
 *
 * 2026-07-26 に、listen socket を保持したまま health が応答しない daemon を観測した。
 * L1 が無いと telemetry flush や core.shutdown が返らない経路で停止できず、
 * L2 が無いと event loop が native 処理で塞がれた経路で timer が発火せず停止できない。
 * どちらか一方だけでは塞げないため両方を固定する。
 */
describe("§159-004 shutdown watchdog", () => {
  test("daemon は shutdown timeout を env で上書きでき、既定値を持つ", () => {
    const source = read(INDEX);

    expect(source).toContain("HARNESS_MEM_SHUTDOWN_TIMEOUT_MS");
    expect(source).toContain("DEFAULT_SHUTDOWN_TIMEOUT_MS");
    // 既定値が正数であること (0 や負値は watchdog を無効化してしまう)
    const match = source.match(/const DEFAULT_SHUTDOWN_TIMEOUT_MS = ([\d_]+);/);
    expect(match).not.toBeNull();
    const defaultMs = Number.parseInt((match?.[1] ?? "0").replace(/_/g, ""), 10);
    expect(defaultMs).toBeGreaterThan(0);
  });

  test("graceful shutdown は watchdog を張り、正常終了時に解除する", () => {
    const source = read(INDEX);
    const start = source.indexOf("const gracefulShutdown");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start);

    // watchdog を張る
    expect(body).toContain("setTimeout(");
    expect(body).toContain("shutdownTimeoutMs");
    // 期限切れで強制終了する (0 以外の exit code で graceful と区別できる)
    expect(body).toMatch(/forcing exit/);
    expect(body).toMatch(/process\.exit\(1\)/);
    // 正常完了時は解除して二重 exit を避ける
    expect(body).toContain("clearTimeout(watchdog)");

    // clearTimeout は正常 exit の直前にあること
    const clearIdx = body.indexOf("clearTimeout(watchdog)");
    const exitZeroIdx = body.indexOf("process.exit(0)");
    expect(clearIdx).toBeGreaterThan(-1);
    expect(exitZeroIdx).toBeGreaterThan(clearIdx);
  });

  test("watchdog は unref しない (event loop が空でも発火させる)", () => {
    const source = read(INDEX);
    expect(source).not.toContain("watchdog.unref()");
  });

  test("core.shutdown が throw しても exit まで到達する", () => {
    const source = read(INDEX);
    const start = source.indexOf("const gracefulShutdown");
    const body = source.slice(start);

    expect(body).toContain("core.shutdown(signal)");
    expect(body).toMatch(/catch \(err\)/);
    expect(body).toContain("core.shutdown threw");
    // telemetry flush の失敗も exit を塞がない
    expect(body).toMatch(/shutdownTelemetry\(signal\)\.catch\(/);
  });

  test("shutdown の retry queue 処理は失敗しても db.close まで進む", () => {
    const source = read(CORE);
    const idx = source.indexOf("processRetryQueue(true)");
    expect(idx).toBeGreaterThan(-1);
    const around = source.slice(Math.max(0, idx - 600), idx + 600);

    // 例外で WAL checkpoint / db.close がスキップされないこと
    expect(around).toContain("processRetryQueue failed (continuing)");
    expect(around).toMatch(/try \{\s*\n\s*this\.processRetryQueue\(true\);/);
  });

  test("script 側は SIGTERM 後に SIGKILL へ escalate する", () => {
    const source = read(SCRIPT);

    expect(source).toContain("STOP_TIMEOUT_SEC");
    expect(source).toMatch(/kill -TERM/);
    expect(source).toMatch(/kill -KILL/);
    expect(source).toContain("sending SIGKILL");

    // escalation の待ち時間が env で上書きでき、既定が正数であること
    const match = source.match(/STOP_TIMEOUT_SEC="\$\{HARNESS_MEM_STOP_TIMEOUT_SEC:-(\d+)\}"/);
    expect(match).not.toBeNull();
    expect(Number.parseInt(match?.[1] ?? "0", 10)).toBeGreaterThan(0);
  });
});
