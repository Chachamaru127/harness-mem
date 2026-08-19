import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const WORKER_MARKER = "--harness-mem-search-worker";
const DB_ID_PREFIX = "--harness-mem-db-id=";
const PARENT_PID_PREFIX = "--harness-mem-parent-pid=";
const WORKER_TOKEN_PREFIX = "--harness-mem-worker-token=";
const DEFAULT_TERM_TIMEOUT_MS = 1_000;
const DEFAULT_DISAPPEARANCE_TIMEOUT_MS = 500;
const POLL_INTERVAL_MS = 25;

export interface SearchWorkerProcessSnapshot {
  pid: number;
  ppid: number;
  startedAt: string;
  command: string;
}

export interface SearchWorkerProcessOps {
  platform: NodeJS.Platform;
  list(): SearchWorkerProcessSnapshot[];
  inspect(pid: number): SearchWorkerProcessSnapshot | null;
  signal(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  sleep(ms: number): Promise<void>;
  dbHolders?(dbPath: string): Set<number> | null;
}

interface StopSearchWorkerOptions {
  pid: number;
  dbPath: string;
  workerToken: string;
  scriptPath: string;
  expectedParentPid: number | "orphan";
  initialSnapshot?: SearchWorkerProcessSnapshot;
  termTimeoutMs?: number;
  disappearanceTimeoutMs?: number;
  ops?: SearchWorkerProcessOps;
  warn?: (message: string) => void;
}

export interface StopSearchWorkerResult {
  status: "terminated" | "killed" | "skipped" | "still_running";
  forced: boolean;
  reason?: string;
}

export interface OwnedSearchWorkerHandle {
  pid: number;
  kill(signal?: number | NodeJS.Signals): void;
  exited: Promise<number>;
}

interface RecoverSearchWorkerOptions {
  dbPath: string;
  scriptPath: string;
  termTimeoutMs?: number;
  disappearanceTimeoutMs?: number;
  ops?: SearchWorkerProcessOps;
  warn?: (message: string) => void;
}

export interface RecoverSearchWorkerResult {
  killed: number[];
  skipped: number[];
  unsupported: boolean;
}

function resolvedDatabasePath(dbPath: string): string {
  const expanded = dbPath.startsWith("~")
    ? join(process.env.HOME || process.env.USERPROFILE || ".", dbPath.slice(1))
    : dbPath;
  const absolute = resolve(expanded);
  if (existsSync(absolute)) {
    return realpathSync(absolute);
  }
  const parent = dirname(absolute);
  return existsSync(parent) ? join(realpathSync(parent), absolute.slice(parent.length + 1)) : absolute;
}

export function canonicalDatabaseIdentity(dbPath: string): string {
  return createHash("sha256").update(resolvedDatabasePath(dbPath)).digest("hex");
}

export function buildSearchWorkerIdentityArgs(
  dbPath: string,
  parentPid: number,
  workerToken: string,
): string[] {
  return [
    WORKER_MARKER,
    `${DB_ID_PREFIX}${canonicalDatabaseIdentity(dbPath)}`,
    `${PARENT_PID_PREFIX}${parentPid}`,
    `${WORKER_TOKEN_PREFIX}${workerToken}`,
  ];
}

function parsePsOutput(stdout: string): SearchWorkerProcessSnapshot[] {
  const snapshots: SearchWorkerProcessSnapshot[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/,
    );
    if (!match) continue;
    snapshots.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      startedAt: match[3].replace(/\s+/g, " "),
      command: match[4],
    });
  }
  return snapshots;
}

function runPs(args: string[]): string {
  const result = Bun.spawnSync(["ps", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error("process inspection unavailable");
  }
  return result.stdout.toString();
}

function createDefaultOps(): SearchWorkerProcessOps {
  return {
    platform: process.platform,
    list: () => parsePsOutput(runPs(["-axo", "pid=,ppid=,lstart=,command="])),
    inspect: (pid) => {
      const result = Bun.spawnSync(
        ["ps", "-p", String(pid), "-o", "pid=,ppid=,lstart=,command="],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (result.exitCode !== 0) return null;
      return parsePsOutput(result.stdout.toString())[0] ?? null;
    },
    signal: (pid, signal) => process.kill(pid, signal),
    sleep: (ms) => Bun.sleep(ms),
    dbHolders: (dbPath) => {
      const canonical = resolvedDatabasePath(dbPath);
      const result = Bun.spawnSync(
        ["lsof", "-nP", "-t", "--", canonical, `${canonical}-wal`, `${canonical}-shm`],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (result.exitCode !== 0 && result.exitCode !== 1) return null;
      return new Set(
        result.stdout.toString().split(/\s+/).map(Number).filter((pid) => Number.isSafeInteger(pid) && pid > 1),
      );
    },
  };
}

function commandArg(command: string, prefix: string): string | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = command.match(new RegExp(`(?:^|\\s)${escaped}([^\\s]+)`));
  return match?.[1] ?? null;
}

function commandHasScript(command: string, scriptPath: string): boolean {
  const resolved = resolve(scriptPath);
  const candidates = existsSync(resolved) ? [resolved, realpathSync(resolved)] : [resolved];
  return candidates.some((candidate) => {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s)\\S*?bun\\s+run\\s+${escaped}(?:\\s|$)`).test(command);
  });
}

function validateLegacyOrphan(
  snapshot: SearchWorkerProcessSnapshot | null,
  expected: SearchWorkerProcessSnapshot,
  dbPath: string,
  scriptPath: string,
  ops: SearchWorkerProcessOps,
): string | null {
  if (!snapshot) return "not_running";
  if (snapshot.pid !== expected.pid || snapshot.startedAt !== expected.startedAt) return "identity_changed";
  if (snapshot.ppid > 1) return "parent_still_alive";
  if (!commandHasScript(snapshot.command, scriptPath) || snapshot.command.includes(WORKER_MARKER)) {
    return "command_mismatch";
  }
  const holders = ops.dbHolders?.(dbPath);
  if (holders === null || !holders?.has(snapshot.pid)) return "database_handle_unproven";
  return null;
}

async function stopLegacyOrphan(
  candidate: SearchWorkerProcessSnapshot,
  options: RecoverSearchWorkerOptions,
  ops: SearchWorkerProcessOps,
): Promise<StopSearchWorkerResult> {
  const beforeTerm = ops.inspect(candidate.pid);
  const termReason = validateLegacyOrphan(beforeTerm, candidate, options.dbPath, options.scriptPath, ops);
  if (termReason) {
    if (termReason !== "not_running") warning(options.warn, termReason);
    return { status: termReason === "not_running" ? "terminated" : "skipped", forced: false, reason: termReason };
  }
  ops.signal(candidate.pid, "SIGTERM");
  if (await waitForDisappearance(candidate.pid, options.termTimeoutMs ?? DEFAULT_TERM_TIMEOUT_MS, ops)) {
    return { status: "terminated", forced: false };
  }
  const beforeKill = ops.inspect(candidate.pid);
  const killReason = validateLegacyOrphan(beforeKill, candidate, options.dbPath, options.scriptPath, ops);
  if (killReason) {
    if (killReason !== "not_running") warning(options.warn, killReason);
    return { status: killReason === "not_running" ? "terminated" : "skipped", forced: false, reason: killReason };
  }
  ops.signal(candidate.pid, "SIGKILL");
  if (await waitForDisappearance(
    candidate.pid,
    options.disappearanceTimeoutMs ?? DEFAULT_DISAPPEARANCE_TIMEOUT_MS,
    ops,
  )) {
    return { status: "killed", forced: true };
  }
  warning(options.warn, "disappearance_unconfirmed");
  return { status: "still_running", forced: true, reason: "disappearance_unconfirmed" };
}

function isMarkedSearchWorkerCommand(
  snapshot: SearchWorkerProcessSnapshot,
  scriptPath: string,
): boolean {
  return commandHasScript(snapshot.command, scriptPath) &&
    new RegExp(`(?:^|\\s)${WORKER_MARKER}(?:\\s|$)`).test(snapshot.command);
}

function validateSnapshot(
  snapshot: SearchWorkerProcessSnapshot | null,
  expected: {
    pid: number;
    startedAt: string;
    dbIdentity: string;
    workerToken: string;
    scriptPath: string;
    expectedParentPid: number | "orphan";
    ops: SearchWorkerProcessOps;
  },
): string | null {
  if (!snapshot) return "not_running";
  if (snapshot.pid !== expected.pid || snapshot.startedAt !== expected.startedAt) return "identity_changed";
  if (!isMarkedSearchWorkerCommand(snapshot, expected.scriptPath)) return "command_mismatch";
  if (commandArg(snapshot.command, DB_ID_PREFIX) !== expected.dbIdentity) return "database_mismatch";
  if (commandArg(snapshot.command, WORKER_TOKEN_PREFIX) !== expected.workerToken) return "token_mismatch";
  const recordedParentPid = Number(commandArg(snapshot.command, PARENT_PID_PREFIX));
  if (!Number.isSafeInteger(recordedParentPid) || recordedParentPid <= 1) {
    return "parent_identity_missing";
  }
  if (expected.expectedParentPid === "orphan") {
    if (snapshot.ppid > 1) return "parent_still_alive";
    if (expected.ops.inspect(recordedParentPid)) return "recorded_parent_still_alive";
  } else if (snapshot.ppid !== expected.expectedParentPid || recordedParentPid !== expected.expectedParentPid) {
    return "parent_mismatch";
  }
  return null;
}

async function waitForDisappearance(
  pid: number,
  timeoutMs: number,
  ops: SearchWorkerProcessOps,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!ops.inspect(pid)) return true;
    await ops.sleep(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  return !ops.inspect(pid);
}

function warning(warn: ((message: string) => void) | undefined, reason: string): void {
  (warn ?? console.error)(`[harness-memd] search worker cleanup skipped reason=${reason}`);
}

async function exitsWithin(exited: Promise<number>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      exited.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Stop a child still owned through its Bun subprocess handle. Unlike orphan
 * recovery, the live handle itself is the non-reusable process identity, so
 * this path works without `ps` and remains usable on Windows.
 */
export async function stopOwnedSearchWorkerProcess(options: {
  proc: OwnedSearchWorkerHandle;
  termTimeoutMs?: number;
  disappearanceTimeoutMs?: number;
  warn?: (message: string) => void;
}): Promise<StopSearchWorkerResult> {
  try {
    options.proc.kill("SIGTERM");
  } catch {
    if (await exitsWithin(options.proc.exited, POLL_INTERVAL_MS)) {
      return { status: "terminated", forced: false, reason: "already_exited" };
    }
    warning(options.warn, "owned_term_failed");
    return { status: "still_running", forced: false, reason: "owned_term_failed" };
  }
  if (await exitsWithin(options.proc.exited, options.termTimeoutMs ?? DEFAULT_TERM_TIMEOUT_MS)) {
    return { status: "terminated", forced: false };
  }
  try {
    options.proc.kill("SIGKILL");
  } catch {
    if (await exitsWithin(options.proc.exited, POLL_INTERVAL_MS)) {
      return { status: "terminated", forced: false, reason: "exited_before_kill" };
    }
    warning(options.warn, "owned_kill_failed");
    return { status: "still_running", forced: true, reason: "owned_kill_failed" };
  }
  if (await exitsWithin(
    options.proc.exited,
    options.disappearanceTimeoutMs ?? DEFAULT_DISAPPEARANCE_TIMEOUT_MS,
  )) {
    return { status: "killed", forced: true };
  }
  warning(options.warn, "owned_disappearance_unconfirmed");
  return { status: "still_running", forced: true, reason: "owned_disappearance_unconfirmed" };
}

export async function stopSearchWorkerProcess(
  options: StopSearchWorkerOptions,
): Promise<StopSearchWorkerResult> {
  const ops = options.ops ?? createDefaultOps();
  if (ops.platform === "win32") {
    warning(options.warn, "unsupported_platform");
    return { status: "skipped", forced: false, reason: "unsupported_platform" };
  }

  try {
    const initial = options.initialSnapshot ?? ops.inspect(options.pid);
    if (!initial) return { status: "terminated", forced: false, reason: "not_running" };
    const expected = {
      pid: options.pid,
      startedAt: initial.startedAt,
      dbIdentity: canonicalDatabaseIdentity(options.dbPath),
      workerToken: options.workerToken,
      scriptPath: options.scriptPath,
      expectedParentPid: options.expectedParentPid,
      ops,
    };
    // Read twice. The second read is the signal-time guard against PID reuse and
    // command/parent/DB identity changes between discovery and action.
    const initialReason = validateSnapshot(initial, expected);
    if (initialReason) {
      warning(options.warn, initialReason);
      return { status: "skipped", forced: false, reason: initialReason };
    }
    const beforeTerm = ops.inspect(options.pid);
    const termReason = validateSnapshot(beforeTerm, expected);
    if (termReason) {
      if (termReason !== "not_running") warning(options.warn, termReason);
      return {
        status: termReason === "not_running" ? "terminated" : "skipped",
        forced: false,
        reason: termReason,
      };
    }
    ops.signal(options.pid, "SIGTERM");
    if (await waitForDisappearance(options.pid, options.termTimeoutMs ?? DEFAULT_TERM_TIMEOUT_MS, ops)) {
      return { status: "terminated", forced: false };
    }

    const beforeKill = ops.inspect(options.pid);
    const killReason = validateSnapshot(beforeKill, expected);
    if (killReason) {
      if (killReason !== "not_running") warning(options.warn, killReason);
      return {
        status: killReason === "not_running" ? "terminated" : "skipped",
        forced: false,
        reason: killReason,
      };
    }
    ops.signal(options.pid, "SIGKILL");
    const disappeared = await waitForDisappearance(
      options.pid,
      options.disappearanceTimeoutMs ?? DEFAULT_DISAPPEARANCE_TIMEOUT_MS,
      ops,
    );
    if (!disappeared) {
      warning(options.warn, "disappearance_unconfirmed");
      return { status: "still_running", forced: true, reason: "disappearance_unconfirmed" };
    }
    return { status: "killed", forced: true };
  } catch {
    warning(options.warn, "inspection_or_signal_failed");
    return { status: "skipped", forced: false, reason: "inspection_or_signal_failed" };
  }
}

export async function recoverOrphanedSearchWorkers(
  options: RecoverSearchWorkerOptions,
): Promise<RecoverSearchWorkerResult> {
  const ops = options.ops ?? createDefaultOps();
  if (ops.platform === "win32") {
    warning(options.warn, "unsupported_platform");
    return { killed: [], skipped: [], unsupported: true };
  }
  try {
    const dbIdentity = canonicalDatabaseIdentity(options.dbPath);
    const candidates = ops.list().filter((snapshot) =>
      snapshot.ppid <= 1 &&
      isMarkedSearchWorkerCommand(snapshot, options.scriptPath) &&
      commandArg(snapshot.command, DB_ID_PREFIX) === dbIdentity,
    );
    const killed: number[] = [];
    const skipped: number[] = [];
    for (const candidate of candidates) {
      const workerToken = commandArg(candidate.command, WORKER_TOKEN_PREFIX);
      if (!workerToken) {
        skipped.push(candidate.pid);
        warning(options.warn, "token_missing");
        continue;
      }
      const result = await stopSearchWorkerProcess({
        pid: candidate.pid,
        dbPath: options.dbPath,
        workerToken,
        scriptPath: options.scriptPath,
        expectedParentPid: "orphan",
        initialSnapshot: candidate,
        termTimeoutMs: options.termTimeoutMs,
        disappearanceTimeoutMs: options.disappearanceTimeoutMs,
        ops,
        warn: options.warn,
      });
      if (result.status === "terminated" || result.status === "killed") killed.push(candidate.pid);
      else skipped.push(candidate.pid);
    }
    let legacyCandidates: SearchWorkerProcessSnapshot[] = [];
    try {
      const dbHolders = ops.dbHolders?.(options.dbPath);
      if (dbHolders) {
        legacyCandidates = ops.list().filter((snapshot) =>
          snapshot.ppid <= 1 &&
          !snapshot.command.includes(WORKER_MARKER) &&
          commandHasScript(snapshot.command, options.scriptPath) &&
          dbHolders.has(snapshot.pid),
        );
      }
    } catch {
      // Legacy recovery needs lsof proof. Marker-based recovery above remains
      // available when lsof is absent or unsupported.
      warning(options.warn, "legacy_db_handle_inspection_unavailable");
    }
    for (const candidate of legacyCandidates) {
      const result = await stopLegacyOrphan(candidate, options, ops);
      if (result.status === "terminated" || result.status === "killed") killed.push(candidate.pid);
      else skipped.push(candidate.pid);
    }
    return { killed, skipped, unsupported: false };
  } catch {
    warning(options.warn, "inspection_failed");
    return { killed: [], skipped: [], unsupported: false };
  }
}
