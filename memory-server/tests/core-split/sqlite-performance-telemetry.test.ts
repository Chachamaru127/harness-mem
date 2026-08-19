import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  beginIngestTickTelemetry,
  endIngestTickTelemetry,
  getCurrentIngestTickTelemetry,
  recordSqliteError,
  recordSqlitePhase,
  recordWalCheckpointCompleted,
  sqliteErrorCodes,
} from "../../src/core/sqlite-performance-telemetry";
import { createTestDb } from "./test-helpers";

describe("sqlite performance telemetry", () => {
  afterEach(() => {
    const active = getCurrentIngestTickTelemetry();
    if (active) endIngestTickTelemetry(active, createTestDb(), 0, Infinity);
  });

  test("slow tick emits one bounded privacy-safe aggregate", () => {
    const db = createTestDb();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const tick = beginIngestTickTelemetry("codex");
    recordSqlitePhase("ensure_session", 3);
    recordSqlitePhase("ensure_session", 5);
    recordSqlitePhase("secret-project-/tmp/private", 999);
    recordWalCheckpointCompleted(db, { busy: 0, log: 4, checkpointed: 4 });
    endIngestTickTelemetry(tick, db, 25, 10);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('"count":2');
    expect(line).toContain('"total_ms":8');
    expect(line).toContain('"max_ms":5');
    expect(line).not.toContain("secret-project");
    expect(line).not.toContain("/tmp/private");
    expect(line).toContain('"tick_available":true');
    for (const forbidden of ["tick_id", "tick_correlation", "correlation_id", "nonce", "sequence"]) {
      expect(line).not.toContain(forbidden);
    }
    expect(line).toContain('"wal_size_available":false');
    expect(line).not.toContain('"wal_bytes":0');
    expect(line).toContain('"wal_checkpoint_available":true');
    expect(line).toContain('"wal_checkpoint_age_available":true');
    expect(line).toContain('"successful_lock_wait_available":false');
    expect(line).toContain('"sqlite_db_read_latency_available":false');
    const durable = db.query<{ value: string }, []>(
      "SELECT value FROM mem_meta WHERE key = 'ingest.telemetry.wal_checkpoint'",
    ).get();
    expect(durable?.value).toContain('"checkpointed":4');
    warn.mockRestore();
  });

  test("fast tick is silent and context is cleared", () => {
    const db = createTestDb();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const tick = beginIngestTickTelemetry("cursor");
    endIngestTickTelemetry(tick, db, 1, 10);
    expect(warn).not.toHaveBeenCalled();
    expect(getCurrentIngestTickTelemetry()).toBeNull();
    warn.mockRestore();
  });

  test("a worker tick reads the parent checkpoint timestamp from durable metadata", () => {
    const db = createTestDb();
    db.query("INSERT INTO mem_meta(key, value, updated_at) VALUES (?, ?, ?)").run(
      "ingest.telemetry.wal_checkpoint",
      JSON.stringify({ completed_at_ms: Date.now() - 50, busy: 0, log: 9, checkpointed: 8 }),
      new Date().toISOString(),
    );
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const tick = beginIngestTickTelemetry("codex");
    endIngestTickTelemetry(tick, db, 20, 10);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('"wal_checkpoint_age_available":true');
    expect(line).toContain('"log":9');
    expect(line).toContain('"checkpointed":8');
    warn.mockRestore();
  });

  test("SQLite extended busy codes are classified without error messages", () => {
    expect(sqliteErrorCodes({ code: "SQLITE_BUSY", errno: 5 })).toEqual({
      code: "SQLITE_BUSY", extendedCode: 5, busyOrLocked: true,
    });
    expect(sqliteErrorCodes({ code: "SQLITE_BUSY_SNAPSHOT", errno: 517 })).toEqual({
      code: "SQLITE_BUSY_SNAPSHOT", extendedCode: 517, busyOrLocked: true,
    });

    const db = createTestDb();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const tick = beginIngestTickTelemetry("claude_code");
    recordSqliteError({ code: "SQLITE_BUSY_SNAPSHOT", errno: 517, message: "secret SQL and path" });
    endIngestTickTelemetry(tick, db, 1, 10);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("SQLITE_BUSY_SNAPSHOT");
    expect(line).toContain('"sqlite_last_extended_code":517');
    expect(line).not.toContain("secret SQL and path");
    warn.mockRestore();
  });
});
