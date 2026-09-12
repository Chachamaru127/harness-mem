import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ReferenceProcessLedger } from "../../src/core/reference-process-ledger";
import { ProjectPathResolver } from "../../src/core/project-path-resolver";

function database() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE mem_meta(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)");
  return db;
}

test("reservations survive owner replacement and release only after proven disappearance", () => {
  const db = database();
  let status: "present" | "unknown" | "absent" = "present";
  const ledger = new ReferenceProcessLedger(db, "project-resolver", () => status);
  const first = ledger.reserve(2)!;
  ledger.attach(first, 987654);
  const unattached = ledger.reserve(2)!;
  expect(first).toBeTruthy(); expect(unattached).toBeTruthy();
  const restarted = new ReferenceProcessLedger(db, "project-resolver", () => status);
  for (let i = 0; i < 1000; i++) expect(restarted.reserve(2)).toBeNull();
  status = "unknown";
  expect(restarted.reserve(2)).toBeNull();
  status = "absent";
  expect(restarted.status()).toEqual({ reserved: 1, unconfirmed: 1 });
  expect(restarted.reserve(2)).toBeTruthy();
  // No PID reservation remains reserved even when its original parent is gone.
  expect(restarted.reserve(2)).toBeNull();
  db.close();
});

test("reused live PID is neither released nor signaled and namespaces have separate budgets", () => {
  const db = database();
  const resolver = new ReferenceProcessLedger(db, "project-resolver", () => "present");
  const token = resolver.reserve(1)!; resolver.attach(token, 1234);
  expect(new ReferenceProcessLedger(db, "project-resolver", () => "present").reserve(1)).toBeNull();
  expect(new ReferenceProcessLedger(db, "source-reader", () => "present").reserve(1)).toBeTruthy();
  resolver.release(token);
  expect(resolver.reserve(1)).toBeTruthy();
  db.close();
});

test("resolver replacement cannot spawn beyond persisted unconfirmed children", async () => {
  const db = database();
  let spawns = 0;
  let exit!: (code: number) => void;
  const options = {
    maxChildren: 1, timeoutMs: 10, onResult: () => {},
    spawn: () => { spawns++; return {
      pid: 987655, stdout: new ReadableStream<Uint8Array>(),
      exited: new Promise<number>(resolve => { exit = resolve; }), kill: () => {},
    }; },
  };
  const first = new ProjectPathResolver({ ...options, reservations: new ReferenceProcessLedger(db, "project-resolver", () => "present") });
  first.schedule("/stalled");
  await Bun.sleep(20);
  first.stop();
  const next = new ProjectPathResolver({ ...options, reservations: new ReferenceProcessLedger(db, "project-resolver", () => "present") });
  for (let i = 0; i < 1000; i++) next.schedule(`/other/${i}`);
  expect(spawns).toBe(1);
  expect(next.status()).toMatchObject({ active: 0, reserved: 1, unconfirmed: 1 });
  exit(137); await Bun.sleep(0);
  expect(next.status()).toMatchObject({ reserved: 0 });
  next.stop(); db.close();
});

test("closed owner leaves a durable slot which cold restart recovers only after disappearance", () => {
  const { mkdtempSync, rmSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { join } = require("node:path");
  const root = mkdtempSync(join(tmpdir(), "reference-ledger-restart-"));
  const path = join(root, "memory.db");
  const db = new Database(path);
  db.exec("CREATE TABLE mem_meta(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)");
  const owner = new ReferenceProcessLedger(db, "project-resolver", () => "present");
  const token = owner.reserve(1)!; owner.attach(token, 987656);
  db.close();
  owner.release(token); // Exit arrives after shutdown has closed the owner's DB.
  const nextDb = new Database(path);
  try {
    const alive = new ReferenceProcessLedger(nextDb, "project-resolver", () => "present");
    expect(alive.reserve(1)).toBeNull();
    const gone = new ReferenceProcessLedger(nextDb, "project-resolver", () => "absent");
    expect(gone.status()).toEqual({ reserved: 0, unconfirmed: 0 });
    expect(gone.reserve(1)).toBeTruthy();
  } finally { nextDb.close(); rmSync(root, { recursive: true, force: true }); }
});
