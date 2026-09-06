/**
 * Arm SIGTERM/SIGINT before search-worker.ts loads HarnessMemCore.
 *
 * The worker is visible in `ps` as soon as Bun starts. Default SIGTERM during
 * sqlite/schema init kills the child immediately, so daemon shutdown returns
 * without awaiting the graceful drain the parent is waiting on.
 */

import { writeFileSync } from "node:fs";

type ShutdownHandler = (reason: string) => void;

let pendingReason: string | null = null;
let handler: ShutdownHandler | null = null;
let armed = false;

function onSignal(reason: string): void {
  pendingReason = reason;
  if (handler) {
    handler(reason);
  }
}

function writeTestLatchReady(): void {
  const path = process.env.HARNESS_MEM_TEST_SIGNAL_LATCH_READY;
  if (process.env.NODE_ENV !== "test" || !path) return;
  try {
    writeFileSync(path, "armed\n");
  } catch {
    // test-only best effort
  }
}

function arm(): void {
  if (armed) return;
  armed = true;
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
  writeTestLatchReady();
}

arm();

export function bindSearchWorkerShutdown(fn: ShutdownHandler): string | null {
  handler = fn;
  return pendingReason;
}
