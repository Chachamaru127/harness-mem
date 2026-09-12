/** Source I/O process. This module never creates a memory database connection. */
import { readSync, writeSync, statSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { IngestCoordinator } from "../core/ingest-coordinator";
import { installSourceReadHooks, SourceReaderDeferredError } from "../core/source-reader-fs";
import { encodeReaderPacket, sanitizeReaderEvent, sanitizeReaderContext, SOURCE_READER_MAX_PACKET_BYTES, type SourceReaderOperation, type SourceReaderSource } from "../core/source-reader-protocol";
import type { ApiResponse, Config } from "../core/types";

let input = Buffer.alloc(0);
const pause = new Int32Array(new SharedArrayBuffer(4));
function packet(): any {
  for (;;) {
    const end = input.indexOf(10);
    if (end >= 0) {
      const value = JSON.parse(input.subarray(0, end).toString("utf8"));
      input = input.subarray(end + 1);
      return value;
    }
    const chunk = Buffer.alloc(16 * 1024);
    let count: number;
    try { count = readSync(0, chunk, 0, chunk.length, null); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      Atomics.wait(pause, 0, 0, 2); continue;
    }
    if (!count) throw new Error("source_reader_closed");
    input = Buffer.concat([input, chunk.subarray(0, count)]);
    if (input.length > SOURCE_READER_MAX_PACKET_BYTES) throw new Error("source_reader_packet_limit");
  }
}
const initial = packet();
const id = initial.id;
function send(value: object): void {
  const bytes = encodeReaderPacket({ id, ...value });
  let written = 0;
  while (written < bytes.length) {
    try { written += writeSync(1, bytes, written, bytes.length - written); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      Atomics.wait(pause, 0, 0, 2);
    }
  }
}
let callId = 0;
function call(operation: SourceReaderOperation): any {
  send({ kind: "call", callId: ++callId, operation });
  const ack = packet();
  if (ack.id !== id || ack.callId !== callId || ack.result?.reader_error) { deferred = true; throw new Error("source_reader_ack_failed"); }
  return ack.result;
}
let deferred = false;
let primaryDeferred = false;
let globalDeferred = false;
let primary: string | null = null;
const quarantine = new Set<string>(initial.quarantine);
installSourceReadHooks({
  beginFile(path) { primary = path; primaryDeferred = false; context = undefined; privacyTags = []; },
  enter(path, operation) {
    if (quarantine.has(path)) {
      deferred = true;
      if (primary) primaryDeferred = true;
      // Missing directory discovery is pending, but already discovered files can proceed.
      else if (["read_file", "read", "sqlite_open", "sqlite_read"].includes(operation)) globalDeferred = true;
      throw new SourceReaderDeferredError();
    }
    send({ kind: "fs_begin", path, operation });
    if (operation === "sqlite_open" && initial.memoryIdentity) {
      const identity = statSync(path, { bigint: true });
      if (String(identity.dev) === initial.memoryIdentity.device && String(identity.ino) === initial.memoryIdentity.inode) {
        deferred = true;
        primaryDeferred = true;
        throw new SourceReaderDeferredError();
      }
    }
  },
  leave() { send({ kind: "fs_end" }); },
});
let context: { key: string; value: string } | undefined;
let privacyTags: string[] = [];
const offsets = new Map<string, number | null>();
function sanitizedContext(value: string): string {
  return JSON.stringify(sanitizeReaderContext(JSON.parse(value), privacyTags));
}
// The parser's existing synchronous persistence interface is adapted locally.
// Only this finite semantic operation set crosses IPC; SQL never does.
const db = {
  query(sql: string) {
    const query = sql.replace(/\s+/g, " ").trim();
    return {
      get(key: string) {
        if (query.startsWith("SELECT 1 AS present FROM sqlite_master")) return call({ op: "meta_available" });
        if (query === "SELECT value FROM mem_meta WHERE key = ?") return key === "ingest.telemetry.wal_checkpoint" ? null : call({ op: "meta_get", key });
        if (query === "SELECT offset FROM mem_ingest_offsets WHERE source_key = ?") {
          const row = call({ op: "offset_get", key });
          offsets.set(key, row?.offset ?? null);
          return row;
        }
        throw new Error("source_reader_operation_denied");
      },
      all(...keys: string[]) {
        if (query !== "SELECT key, value FROM mem_meta WHERE key IN (?, ?)") throw new Error("source_reader_operation_denied");
        return keys.flatMap((key) => { const row = call({ op: "meta_get", key }); return row ? [{ key, ...row }] : []; });
      },
      run(key: string, value: string | number) {
        if (query.startsWith("INSERT INTO mem_meta(")) {
          if (key.startsWith("ingest.scheduler.")) return call({ op: "meta_set", key, value: String(value) });
          context = { key, value: sanitizedContext(String(value)) };
          return;
        }
        if (query.startsWith("INSERT INTO mem_ingest_offsets(")) {
          if (primaryDeferred || globalDeferred) throw new SourceReaderDeferredError();
          const result = call({ op: "offset_commit", key, offset: Number(value), expected: offsets.get(key) ?? null, context });
          offsets.set(key, Number(value));
          context = undefined;
          return result;
        }
        throw new Error("source_reader_operation_denied");
      },
    };
  },
} as unknown as Database;
const failure = { ok: false, error_code: "record_write_failed", retryable: true };
try {
  const coordinator = new IngestCoordinator({
    db, config: initial.config as Config,
    recordEvent: () => { throw new Error("source_reader_sync_record_denied"); },
    recordEventQueued: async (event) => {
      if (primaryDeferred || globalDeferred) return failure as ApiResponse;
      privacyTags = Array.isArray(event.privacy_tags) ? event.privacy_tags.filter((tag): tag is string => typeof tag === "string") : [];
      try {
        const result = call({ op: "record", event: sanitizeReaderEvent(event) });
        return result;
      } catch (error) { deferred = true; throw error; }
    },
    upsertSessionSummary: () => { throw new Error("source_reader_operation_denied"); },
    heartbeatPath: "", isShuttingDown: () => false, processRetryQueue: () => {},
  }, { readerProcess: true });
  const methods = { codex: "ingestCodexHistory", opencode: "ingestOpencodeHistory", cursor: "ingestCursorHistory", antigravity: "ingestAntigravityHistory", gemini: "ingestGeminiHistory", claude_code: "ingestClaudeCodeHistory" } as const;
  const source = initial.source as SourceReaderSource;
  const result = initial.mode === "periodic"
    ? await coordinator.runPeriodicIngestTickLocal(source)
    : await coordinator[methods[source]]();
  send({ kind: "done", result: deferred ? failure : result });
} catch { send({ kind: "done", result: failure }); }
