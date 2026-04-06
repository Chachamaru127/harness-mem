import { rmSync } from "node:fs";

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function removeDirWithRetry(dir: string, attempts = 5): void {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
      const retriable = code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
      if (!retriable) {
        throw error;
      }
      if (process.platform !== "win32") {
        throw error;
      }
      if (attempt === attempts - 1) {
        return;
      }
      sleep(50 * (attempt + 1));
    }
  }
}
