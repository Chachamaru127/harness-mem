import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../src/core/harness-mem-core";
import { startHarnessMemServer } from "../src/server";

const dir = mkdtempSync(join(tmpdir(), "harness-mem-test-"));
const port = 49999;
const config: Config = {
  dbPath: join(dir, "harness-mem.db"),
  bindHost: "127.0.0.1",
  bindPort: port,
  vectorDimension: 64,
  captureEnabled: true,
  retrievalEnabled: true,
  injectionEnabled: true,
  codexHistoryEnabled: false,
  codexProjectRoot: process.cwd(),
  codexSessionsRoot: process.cwd(),
  codexIngestIntervalMs: 5000,
  codexBackfillHours: 24,
  opencodeIngestEnabled: false,
  cursorIngestEnabled: false,
  antigravityIngestEnabled: false,
};
const core = new HarnessMemCore(config);
const server = startHarnessMemServer(core, config);

const res = await fetch(`http://127.0.0.1:${port}/v1/resume-pack`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ project: "test-project", include_private: true, limit: 20 }),
});

console.log("status:", res.status);
const data = await res.json();
console.log("response:", JSON.stringify(data, null, 2));

core.shutdown("test");
server.stop(true);
rmSync(dir, { recursive: true, force: true });
