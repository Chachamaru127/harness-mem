/**
 * session-start-daemon-restart.test.ts
 *
 * memory-session-start.sh のデーモン自動再起動フォールバック契約テスト:
 * - attempt_daemon_restart() 関数が存在する
 * - デーモン生存チェック (health) が resume-pack の前に実行される
 * - _DAEMON_RESTARTED フラグで再起動は1回のみに制限される
 * - resume-pack 失敗後のフォールバック再起動 + リトライが存在する
 * - harness-memd スクリプトへの参照がある
 * - デーモン正常時はフォールバックが発動しない (E2E)
 * - デーモン不在時にフォールバック再起動を試みる (E2E)
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SESSION_START_SCRIPT = resolve(
  import.meta.dir,
  "../scripts/hook-handlers/memory-session-start.sh"
);

describe("session-start daemon restart contract", () => {
  const script = readFileSync(SESSION_START_SCRIPT, "utf8");

  test("attempt_daemon_restart() function is defined", () => {
    expect(script).toContain("attempt_daemon_restart()");
  });

  test("DAEMON_SCRIPT variable is defined", () => {
    expect(script).toContain('DAEMON_SCRIPT="${PARENT_DIR}/harness-memd"');
  });

  test("_DAEMON_RESTARTED flag is initialized to false", () => {
    expect(script).toContain('_DAEMON_RESTARTED=false');
  });

  test("attempt_daemon_restart sets _DAEMON_RESTARTED=true to prevent re-entry", () => {
    const func = script.match(/attempt_daemon_restart\(\)\s*\{[\s\S]*?\n\}/);
    expect(func).toBeTruthy();
    const body = func![0];
    expect(body).toContain('_DAEMON_RESTARTED=true');
    // 再入防止チェックがある
    expect(body).toContain('"$_DAEMON_RESTARTED" = "true"');
  });

  test("attempt_daemon_restart calls cleanup-stale and start", () => {
    const func = script.match(/attempt_daemon_restart\(\)\s*\{[\s\S]*?\n\}/);
    expect(func).toBeTruthy();
    const body = func![0];
    expect(body).toContain("cleanup-stale --quiet");
    expect(body).toContain("start --quiet");
  });

  test("health check is performed before record-event", () => {
    // HEALTH_CHECK_RESULT が EVENT_PAYLOAD の前にある
    const healthPos = script.indexOf("HEALTH_CHECK_RESULT=");
    const eventPos = script.indexOf("EVENT_PAYLOAD=");
    expect(healthPos).toBeGreaterThan(-1);
    expect(eventPos).toBeGreaterThan(-1);
    expect(healthPos).toBeLessThan(eventPos);
  });

  test("health check uses 2-second timeout", () => {
    expect(script).toContain("HARNESS_MEM_CLIENT_TIMEOUT_SEC=2");
  });

  test("resume-pack failure triggers daemon restart retry when not yet restarted", () => {
    // RESUME_FAILED=true の後に _DAEMON_RESTARTED=false チェック + attempt_daemon_restart がある
    const resumeFailedBlock = script.indexOf('if [ "$RESUME_FAILED" = "true" ]; then');
    expect(resumeFailedBlock).toBeGreaterThan(-1);
    const afterBlock = script.slice(resumeFailedBlock);
    expect(afterBlock).toContain('_DAEMON_RESTARTED" = "false"');
    expect(afterBlock).toContain("attempt_daemon_restart");
    // リトライ後に resume-pack を再度呼ぶ
    expect(afterBlock).toContain("resume-pack");
  });

  test("daemon restart retry error messages include '(after daemon restart)' suffix", () => {
    expect(script).toContain("(after daemon restart)");
  });

  test("E2E: daemon healthy — no restart attempted", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-daemon-restart-"));
    const stateDir = join(tmp, ".claude", "state");
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const libDir = join(hookDir, "lib");

    try {
      mkdirSync(libDir, { recursive: true });
      mkdirSync(stateDir, { recursive: true });

      // mock client: health=ok, resume-pack=ok
      const mockClient = join(scriptRoot, "harness-mem-client.sh");
      writeFileSync(
        mockClient,
        `#!/bin/bash
command="\${1:-health}"
case "$command" in
  health)
    printf '{"ok":true,"items":[{"backend_mode":"local"}]}'
    ;;
  resume-pack)
    cat >/dev/null
    printf '{"ok":true,"meta":{"count":0},"items":[]}'
    ;;
  record-event)
    cat >/dev/null
    printf '{"ok":true}'
    ;;
esac
`
      );
      chmodSync(mockClient, 0o755);

      // mock daemon: should NOT be called
      const mockDaemon = join(scriptRoot, "harness-memd");
      writeFileSync(
        mockDaemon,
        '#!/bin/bash\necho "DAEMON_SHOULD_NOT_BE_CALLED" >&2\nexit 1\n'
      );
      chmodSync(mockDaemon, 0o755);

      // copy session-start script
      const copiedScript = join(hookDir, "memory-session-start.sh");
      writeFileSync(copiedScript, readFileSync(SESSION_START_SCRIPT, "utf8"));
      chmodSync(copiedScript, 0o755);

      const proc = Bun.spawn(["bash", copiedScript], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmp,
      });
      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).toBe(0);
      // デーモンが呼ばれていない
      expect(stderr).not.toContain("DAEMON_SHOULD_NOT_BE_CALLED");
      // エラーファイルが生成されていない
      expect(existsSync(join(stateDir, "memory-resume-error.md"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("E2E: daemon down — fallback restart attempted and resume-pack retried", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-daemon-restart-"));
    const stateDir = join(tmp, ".claude", "state");
    const scriptRoot = join(tmp, "scripts");
    const hookDir = join(scriptRoot, "hook-handlers");
    const libDir = join(hookDir, "lib");
    const logFile = join(tmp, "daemon-calls.log");

    try {
      mkdirSync(libDir, { recursive: true });
      mkdirSync(stateDir, { recursive: true });

      // mock client: health=fail first, then ok after restart; resume-pack fails then succeeds
      const mockClient = join(scriptRoot, "harness-mem-client.sh");
      const clientScript = [
        '#!/bin/bash',
        'CALL_LOG="' + logFile + '"',
        'command="${1:-health}"',
        'echo "client_call:$command" >> "$CALL_LOG"',
        'CALL_N=$(grep -c "client_call:$command" "$CALL_LOG" 2>/dev/null || echo "1")',
        'case "$command" in',
        '  health)',
        '    if [ "$CALL_N" -le 1 ]; then',
        '      printf \'{"ok":false,"error":"unreachable"}\'',
        '    else',
        '      printf \'{"ok":true,"items":[{"backend_mode":"local"}]}\'',
        '    fi',
        '    ;;',
        '  resume-pack)',
        '    cat >/dev/null',
        '    if [ "$CALL_N" -le 1 ]; then',
        '      printf \'\'',
        '    else',
        '      printf \'{"ok":true,"meta":{"count":1},"items":[{"id":"obs-1","type":"observation","title":"test","content":"hello"}]}\'',
        '    fi',
        '    ;;',
        '  record-event)',
        '    cat >/dev/null',
        '    printf \'{"ok":true}\'',
        '    ;;',
        'esac',
        '',
      ].join('\n');
      writeFileSync(mockClient, clientScript);
      chmodSync(mockClient, 0o755);

      // mock daemon: log calls
      const mockDaemon = join(scriptRoot, "harness-memd");
      writeFileSync(
        mockDaemon,
        '#!/bin/bash\necho "daemon_call:$*" >> "' + logFile + '"\n'
      );
      chmodSync(mockDaemon, 0o755);

      const copiedScript = join(hookDir, "memory-session-start.sh");
      writeFileSync(copiedScript, readFileSync(SESSION_START_SCRIPT, "utf8"));
      chmodSync(copiedScript, 0o755);

      const proc = Bun.spawn(["bash", copiedScript], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmp,
        env: {
          ...process.env,
          HOME: tmp,
        },
      });
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);

      // ログを確認: デーモンが呼ばれた
      if (existsSync(logFile)) {
        const log = readFileSync(logFile, "utf8");
        expect(log).toContain("daemon_call:");
        expect(log).toContain("cleanup-stale");
        expect(log).toContain("start");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
