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
 * §159-004 / §159-005: shutdown が返らない daemon を残さないための 2 層防衛を pin する。
 *
 * L1 (daemon 内): graceful path が完了しない場合、watchdog timer が強制 exit する。
 * L2 (script): SIGTERM 後に一定秒待って SIGKILL へ escalate する。
 *
 * 2026-07-26 に、listen socket を保持したまま health が応答しない daemon を観測した。
 * L1 が無いと telemetry flush や core.shutdown が返らない経路で停止できず、
 * L2 が無いと event loop が native 処理で塞がれた経路で timer が発火せず停止できない。
 * §159-005 では launchctl restart と offline-stop に残っていた L2 の未配線も塞ぐ。
 * どちらか一方だけでは塞げないため両方を固定する。
 */
describe("§159-004 / §159-005 shutdown watchdog", () => {
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
    const escalationStart = source.indexOf("stop_pid_with_escalation()");
    const escalationEnd = source.indexOf("\n}\n", escalationStart);
    const escalationBody = source.slice(escalationStart, escalationEnd);

    expect(source).toContain("STOP_TIMEOUT_SEC");
    expect(escalationStart).toBeGreaterThan(-1);
    expect(escalationBody).toMatch(/kill -TERM/);
    expect(escalationBody).toMatch(/kill -KILL/);
    expect(escalationBody).toContain("sending SIGKILL");

    // escalation の待ち時間が env で上書きでき、既定が正数であること
    const match = source.match(/STOP_TIMEOUT_SEC="\$\{HARNESS_MEM_STOP_TIMEOUT_SEC:-(\d+)\}"/);
    expect(match).not.toBeNull();
    expect(Number.parseInt(match?.[1] ?? "0", 10)).toBeGreaterThan(0);
  });

  test("通常 stop は共通の SIGKILL escalation を使う", () => {
    const source = read(SCRIPT);
    const start = source.indexOf("stop_daemon()");
    const end = source.indexOf("offline_stop_daemon()", start);
    const body = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('stop_pid_with_escalation "$pid" "$STOP_TIMEOUT_SEC"');
    // 3 経路で kill 手順が分岐しないよう、通常 stop の重複実装を禁じる。
    expect(body).not.toMatch(/kill -(?:TERM|KILL)/);
  });

  test("offline-stop は bootout 後の runtime PID を共通 escalation へ渡す", () => {
    const source = read(SCRIPT);
    const start = source.indexOf("offline_stop_daemon()");
    const end = source.indexOf("offline_start_daemon()", start);
    const body = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('pid="$(resolve_daemon_pid || true)"');
    expect(body).toContain('stop_pid_with_escalation "$pid" "$STOP_TIMEOUT_SEC"');
    const listenerTimeout = body.indexOf("if ! wait_for_daemon_listener_closed; then");
    const handleTimeout = body.indexOf("if ! wait_for_db_handles_closed; then");
    expect(listenerTimeout).toBeGreaterThan(body.indexOf("bootout_launchctl_job"));
    expect(
      body.slice(listenerTimeout, handleTimeout),
    ).toContain('stop_pid_with_escalation "$pid" "$STOP_TIMEOUT_SEC"');
    // §159-003f (review 指摘): DB handle が残る経路は候補を 1 つに絞らない。
    // 孤児 + 現行の 2 プロセスが同じ DB を掴む場合、resolve_daemon_pid は
    // 片方しか返さず、間違った方を落として失敗し得る。
    expect(body.slice(handleTimeout)).toContain('escalate_all_db_handle_holders "$STOP_TIMEOUT_SEC"');
  });

  test("DB handle 保持プロセスは該当する全件を escalate する", () => {
    const source = read(SCRIPT);
    const start = source.indexOf("escalate_all_db_handle_holders()");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 900);

    // 候補列挙は db_handle_pids、daemon 以外 (sqlite3 CLI 等) は is_expected_daemon_pid で除外
    expect(body).toContain("db_handle_pids");
    expect(body).toContain("is_expected_daemon_pid");
    expect(body).toContain("is_pid_running");
    // 共通 escalation を再利用し、独自実装を増やさない
    expect(body).toContain('stop_pid_with_escalation "$handle_pid" "$timeout_sec"');
    // 1 件で return せずループし切る (全件を落とす)
    expect(body).not.toMatch(/stop_pid_with_escalation[^\n]*\n\s*return 0\n\s*fi/);
  });

  test("launchctl restart の health 失敗は runtime PID を共通 escalation へ渡す", () => {
    const source = read(SCRIPT);
    const start = source.indexOf("restart)");
    const end = source.indexOf("status)", start);
    const body = source.slice(start, end);
    const healthFailure = body.indexOf("launchctl restart did not restore health in time");
    const resolvePid = body.indexOf('failed_pid="$(resolve_daemon_pid || true)"');
    const escalate = body.indexOf(
      'stop_pid_with_escalation "$failed_pid" "$STOP_TIMEOUT_SEC"',
    );

    expect(start).toBeGreaterThan(-1);
    expect(healthFailure).toBeGreaterThan(-1);
    expect(resolvePid).toBeGreaterThan(healthFailure);
    expect(escalate).toBeGreaterThan(resolvePid);
    // job を bootout せず、KeepAlive による再起動を妨げない。
    expect(body.slice(healthFailure)).not.toContain(
      'bootout_launchctl_job "$DAEMON_LAUNCHD_LABEL"',
    );
  });
});
