/**
 * Managed Mode Wiring Integration Tests
 *
 * Verifies that managed/hybrid modes are actually wired into runtime:
 * - ManagedBackend initializes when mode is hybrid/managed
 * - Dual-write replicates events to managed backend
 * - Shadow-read executes and tracks metrics
 * - compileAnswer is wired into search response
 * - Promote gate checks actual shadow metrics
 * - Config propagation works end-to-end
 */
import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MEMORY_SERVER_ROOT = resolve(TEST_DIR, "..", "..");
const REPO_ROOT = resolve(MEMORY_SERVER_ROOT, "..");

function createConfig(overrides: Partial<Config> = {}): Config {
  const tempDir = mkdtempSync(join(tmpdir(), "managed-wiring-"));
  return {
    dbPath: join(tempDir, "test.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 999999,
    codexBackfillHours: 0,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
    ...overrides,
  };
}

function cleanupCore(core: HarnessMemCore, config: Config): void {
  core.shutdown("test");
  try { rmSync(join(config.dbPath, ".."), { recursive: true, force: true }); } catch {}
}

// --- P0-1: managed mode does NOT silently fall back to SQLite-only ---

describe("P0-1: backend mode initialization", () => {
  test("local mode: health shows local, no managed_backend", () => {
    const config = createConfig({ backendMode: "local" });
    const core = new HarnessMemCore(config);
    try {
      const health = core.health();
      const item = health.items[0] as Record<string, unknown>;
      expect(item.backend_mode).toBe("local");
      expect(item.managed_backend).toBeNull();
    } finally {
      cleanupCore(core, config);
    }
  });

  test("hybrid mode without endpoint: health shows warning, managed_backend null", () => {
    const config = createConfig({ backendMode: "hybrid" });
    const core = new HarnessMemCore(config);
    try {
      const health = core.health();
      const item = health.items[0] as Record<string, unknown>;
      expect(item.backend_mode).toBe("hybrid");
      // No endpoint configured → managed backend not initialized
      expect(item.managed_backend).toBeNull();
      const warnings = item.warnings as string[];
      expect(warnings.some((w: string) => w.includes("managedEndpoint not configured"))).toBe(true);
    } finally {
      cleanupCore(core, config);
    }
  });

  test("hybrid mode with endpoint: ManagedBackend is initialized", () => {
    const config = createConfig({
      backendMode: "hybrid",
      managedEndpoint: "postgresql://test:test@localhost:5432/test",
    });
    const core = new HarnessMemCore(config);
    try {
      const health = core.health();
      const item = health.items[0] as Record<string, unknown>;
      expect(item.backend_mode).toBe("hybrid");
      // ManagedBackend should be present (may be degraded if pg not installed)
      const managedBackend = item.managed_backend as Record<string, unknown> | null;
      expect(managedBackend).not.toBeNull();
      expect(managedBackend!.backend_mode).toBe("hybrid");
      // Endpoint should be masked
      expect(typeof managedBackend!.endpoint).toBe("string");
      expect((managedBackend!.endpoint as string)).not.toContain("test:test");
    } finally {
      cleanupCore(core, config);
    }
  });

  test("managed mode with endpoint: ManagedBackend is initialized", () => {
    const config = createConfig({
      backendMode: "managed",
      managedEndpoint: "postgresql://admin:secret@pg.example.com:5432/harness",
    });
    const core = new HarnessMemCore(config);
    try {
      const status = core.getManagedStatus();
      expect(status).not.toBeNull();
      expect(status!.backend_mode).toBe("managed");
      expect(status!.endpoint).not.toContain("secret"); // password masked
    } finally {
      cleanupCore(core, config);
    }
  });
});

// --- P1-1: EventStore / Projector / ShadowSync are runtime-wired ---

describe("P1-1: dual-write replication wiring", () => {
  test("hybrid mode: recordEvent triggers shadow primary_write tracking", () => {
    const config = createConfig({
      backendMode: "hybrid",
      managedEndpoint: "postgresql://test@localhost:5432/test",
    });
    const core = new HarnessMemCore(config);
    try {
      // Record an event
      const result = core.recordEvent({
        platform: "claude",
        project: "/test/wiring",
        session_id: "wiring-session-1",
        event_type: "user_prompt",
        payload: { content: "test dual-write wiring" },
        tags: ["test"],
        privacy_tags: [],
      });
      expect(result.ok).toBe(true);

      // Shadow metrics should show primary writes
      const status = core.getManagedStatus();
      expect(status).not.toBeNull();
      expect(status!.shadow_metrics.primary_writes).toBeGreaterThanOrEqual(1);
    } finally {
      cleanupCore(core, config);
    }
  });

  test("local mode: recordEvent does NOT trigger shadow tracking", () => {
    const config = createConfig({ backendMode: "local" });
    const core = new HarnessMemCore(config);
    try {
      core.recordEvent({
        platform: "claude",
        project: "/test/local",
        session_id: "local-session-1",
        event_type: "user_prompt",
        payload: { content: "local mode test" },
        tags: [],
        privacy_tags: [],
      });
      expect(core.getManagedStatus()).toBeNull();
    } finally {
      cleanupCore(core, config);
    }
  });

  test("hybrid mode: multiple writes accumulate shadow metrics", () => {
    const config = createConfig({
      backendMode: "hybrid",
      managedEndpoint: "postgresql://test@localhost:5432/test",
    });
    const core = new HarnessMemCore(config);
    try {
      for (let i = 0; i < 5; i++) {
        core.recordEvent({
          platform: "claude",
          project: "/test/multi-write",
          session_id: "multi-session",
          event_type: "user_prompt",
          payload: { content: `event ${i}` },
          tags: [],
          privacy_tags: [],
        });
      }
      const status = core.getManagedStatus();
      expect(status!.shadow_metrics.primary_writes).toBe(5);
    } finally {
      cleanupCore(core, config);
    }
  });
});

// --- P2: compileAnswer is wired into search response ---

describe("P2: evidence-bound compiler integration", () => {
  test("search response includes compiled evidence metadata", () => {
    const config = createConfig({ backendMode: "local" });
    const core = new HarnessMemCore(config);
    try {
      // Ingest some data
      core.recordEvent({
        platform: "claude",
        project: "/test/compiler",
        session_id: "compiler-session",
        event_type: "user_prompt",
        payload: { content: "Python is my favorite programming language" },
        tags: ["python"],
        privacy_tags: [],
      });
      core.recordEvent({
        platform: "codex",
        project: "/test/compiler",
        session_id: "compiler-session-2",
        event_type: "user_prompt",
        payload: { content: "I use TypeScript for backend development" },
        tags: ["typescript"],
        privacy_tags: [],
      });

      // Search
      const result = core.search({
        query: "programming language",
        project: "/test/compiler",
        include_private: true,
        strict_project: true,
      });

      expect(result.ok).toBe(true);
      const meta = result.meta as Record<string, unknown>;

      // compiled metadata must be present
      expect(meta.compiled).toBeDefined();
      const compiled = meta.compiled as Record<string, unknown>;
      expect(compiled.question_kind).toBeDefined();
      expect(typeof compiled.evidence_count).toBe("number");
      expect(Array.isArray(compiled.platforms)).toBe(true);
      expect(Array.isArray(compiled.projects)).toBe(true);
      expect(typeof compiled.cross_session).toBe("boolean");
      expect(typeof compiled.privacy_excluded).toBe("number");
    } finally {
      cleanupCore(core, config);
    }
  });

  test("search with privacy exclusion reports excluded count in compiled", () => {
    const config = createConfig({ backendMode: "local" });
    const core = new HarnessMemCore(config);
    try {
      core.recordEvent({
        platform: "claude",
        project: "/test/privacy",
        session_id: "priv-session",
        event_type: "user_prompt",
        payload: { content: "secret API key for production" },
        tags: [],
        privacy_tags: ["private"],
      });
      core.recordEvent({
        platform: "claude",
        project: "/test/privacy",
        session_id: "priv-session",
        event_type: "user_prompt",
        payload: { content: "public documentation about APIs" },
        tags: [],
        privacy_tags: [],
      });

      const result = core.search({
        query: "API",
        project: "/test/privacy",
        include_private: false,
        strict_project: true,
      });

      const meta = result.meta as Record<string, unknown>;
      const compiled = meta.compiled as Record<string, unknown>;
      expect(compiled).toBeDefined();
      // Privacy excluded count should be >= 0 (exact count depends on ranking)
      expect(typeof compiled.privacy_excluded).toBe("number");
    } finally {
      cleanupCore(core, config);
    }
  });
});

// --- Shadow metrics via API ---

describe("shadow metrics API", () => {
  test("health includes managed_backend status for hybrid mode", () => {
    const config = createConfig({
      backendMode: "hybrid",
      managedEndpoint: "postgresql://test@localhost:5432/test",
    });
    const core = new HarnessMemCore(config);
    try {
      const health = core.health();
      const item = health.items[0] as Record<string, unknown>;
      const mb = item.managed_backend as Record<string, unknown>;
      expect(mb).not.toBeNull();
      expect(mb.shadow_metrics).toBeDefined();
      const metrics = mb.shadow_metrics as Record<string, unknown>;
      expect(typeof metrics.primary_writes).toBe("number");
      expect(typeof metrics.shadow_reads).toBe("number");
      expect(typeof metrics.shadow_match_rate).toBe("number");
    } finally {
      cleanupCore(core, config);
    }
  });

  test("metrics includes managed_backend for hybrid mode", () => {
    const config = createConfig({
      backendMode: "hybrid",
      managedEndpoint: "postgresql://test@localhost:5432/test",
    });
    const core = new HarnessMemCore(config);
    try {
      const metricsResp = core.metrics();
      const item = metricsResp.items[0] as Record<string, unknown>;
      expect(item.managed_backend).not.toBeNull();
    } finally {
      cleanupCore(core, config);
    }
  });

  test("metrics returns null managed_backend for local mode", () => {
    const config = createConfig({ backendMode: "local" });
    const core = new HarnessMemCore(config);
    try {
      const metricsResp = core.metrics();
      const item = metricsResp.items[0] as Record<string, unknown>;
      expect(item.managed_backend).toBeNull();
    } finally {
      cleanupCore(core, config);
    }
  });
});

// --- Promote gate via ShadowSyncManager ---

describe("P1-2: promote gate with actual metrics", () => {
  test("ManagedBackend.attemptPromotion rejects when insufficient reads", () => {
    // Import ManagedBackend directly for gate testing
    const { ManagedBackend } = require("../../src/projector/managed-backend");
    const mb = new ManagedBackend({
      endpoint: "postgresql://test@localhost/test",
      apiKey: "",
      backendMode: "hybrid",
    });

    // Shadow is in "off" phase, advance to "shadow"
    mb.shadow.advancePhase(); // off → shadow

    // Only 10 reads (need 100+)
    for (let i = 0; i < 10; i++) {
      mb.shadow.recordShadowRead(true);
      mb.shadow.recordReplication(true);
    }

    const result = mb.attemptPromotion();
    expect(result.promoted).toBe(false);
    expect(result.reasons.some((r: string) => r.includes("Insufficient"))).toBe(true);
  });

  test("ManagedBackend.attemptPromotion accepts when all SLA met", () => {
    const { ManagedBackend } = require("../../src/projector/managed-backend");
    const mb = new ManagedBackend({
      endpoint: "postgresql://test@localhost/test",
      apiKey: "",
      backendMode: "hybrid",
    });

    mb.shadow.advancePhase(); // off → shadow

    // 100+ reads, 100% match, 0% failure
    for (let i = 0; i < 110; i++) {
      mb.shadow.recordShadowRead(true);
      mb.shadow.recordReplication(true);
    }

    const result = mb.attemptPromotion();
    expect(result.promoted).toBe(true);
    expect(result.phase).toBe("verified");
    expect(result.reasons).toHaveLength(0);
  });

  test("ManagedBackend.attemptPromotion rejects when match rate < 95%", () => {
    const { ManagedBackend } = require("../../src/projector/managed-backend");
    const mb = new ManagedBackend({
      endpoint: "postgresql://test@localhost/test",
      apiKey: "",
      backendMode: "hybrid",
    });

    mb.shadow.advancePhase(); // off → shadow

    // 100 reads, 90% match rate
    for (let i = 0; i < 90; i++) mb.shadow.recordShadowRead(true);
    for (let i = 0; i < 10; i++) mb.shadow.recordShadowRead(false);
    for (let i = 0; i < 100; i++) mb.shadow.recordReplication(true);

    const result = mb.attemptPromotion();
    expect(result.promoted).toBe(false);
    expect(result.reasons.some((r: string) => r.includes("match rate"))).toBe(true);
  });

  test("ManagedBackend.attemptPromotion rejects when replication failure > 1%", () => {
    const { ManagedBackend } = require("../../src/projector/managed-backend");
    const mb = new ManagedBackend({
      endpoint: "postgresql://test@localhost/test",
      apiKey: "",
      backendMode: "hybrid",
    });

    mb.shadow.advancePhase(); // off → shadow

    // 100+ reads at 100% match, but 5% replication failure
    for (let i = 0; i < 100; i++) mb.shadow.recordShadowRead(true);
    for (let i = 0; i < 95; i++) mb.shadow.recordReplication(true);
    for (let i = 0; i < 5; i++) mb.shadow.recordReplication(false);

    const result = mb.attemptPromotion();
    expect(result.promoted).toBe(false);
    expect(result.reasons.some((r: string) => r.includes("failure rate"))).toBe(true);
  });
});

// --- Config propagation (daemon env vars) ---

describe("P1-3: config propagation", () => {
  test("HarnessMemCore constructor accepts managed config via Config object", () => {
    const config = createConfig({
      backendMode: "managed",
      managedEndpoint: "postgresql://pg.example.com:5432/db",
      managedApiKey: "test-key-123",
    });
    const core = new HarnessMemCore(config);
    try {
      const status = core.getManagedStatus();
      expect(status).not.toBeNull();
      expect(status!.backend_mode).toBe("managed");
      // API key should NOT appear in status (security)
      const statusJson = JSON.stringify(status);
      expect(statusJson).not.toContain("test-key-123");
    } finally {
      cleanupCore(core, config);
    }
  });
});

// --- daemon config script test ---

describe("daemon config script", () => {
  test("harness-memd script reads managed endpoint from config", () => {
    const fs = require("node:fs");
    const script = fs.readFileSync(
      join(REPO_ROOT, "scripts/harness-memd"),
      "utf8"
    );
    expect(script).toContain("HARNESS_MEM_MANAGED_ENDPOINT");
    expect(script).toContain("HARNESS_MEM_MANAGED_API_KEY");
    expect(script).toContain("managed.endpoint");
    expect(script).toContain("managed.api_key");
  });

  test("promote script has shadow metrics gate", () => {
    const fs = require("node:fs");
    const script = fs.readFileSync(
      join(REPO_ROOT, "scripts/harness-mem"),
      "utf8"
    );
    expect(script).toContain("_check_shadow_metrics_gate");
    expect(script).toContain("shadow_reads");
    expect(script).toContain("shadow_match_rate");
    expect(script).toContain("replication_failures");
    expect(script).toContain("Promotion blocked");
  });

  test("promote gate script sends admin token header when set", () => {
    const fs = require("node:fs");
    const script = fs.readFileSync(
      join(REPO_ROOT, "scripts/harness-mem"),
      "utf8"
    );
    expect(script).toContain("HARNESS_MEM_ADMIN_TOKEN");
    expect(script).toContain("x-harness-mem-token");
  });
});

// --- Fix 1: managed hidden fallback ---

describe("Fix 1: managed hidden fallback prevention", () => {
  test("managed mode without endpoint throws (not silent fallback)", () => {
    expect(() => {
      const config = createConfig({ backendMode: "managed" });
      new HarnessMemCore(config);
    }).toThrow("managedEndpoint");
  });

  test("managed mode with endpoint: health warns when ManagedBackend not connected", () => {
    const config = createConfig({
      backendMode: "managed",
      managedEndpoint: "postgresql://test@localhost:5432/test",
    });
    const core = new HarnessMemCore(config);
    try {
      const health = core.health();
      const item = health.items[0] as Record<string, unknown>;
      const warnings = item.warnings as string[];
      // ManagedBackend won't connect (no pg), so degraded warning must appear
      expect(
        warnings.some((w: string) => w.includes("managed") || w.includes("ManagedBackend"))
      ).toBe(true);
    } finally {
      cleanupCore(core, config);
    }
  });

  test("managed mode with endpoint: recordEvent is blocked when ManagedBackend is unavailable", () => {
    const config = createConfig({
      backendMode: "managed",
      // Intentionally unreachable endpoint so managed backend stays unavailable.
      managedEndpoint: "postgresql://127.0.0.1:1/unreachable",
    });
    const core = new HarnessMemCore(config);
    try {
      const result = core.recordEvent({
        platform: "claude",
        project: "/test/managed-fail-close",
        session_id: "managed-fail-close-session",
        event_type: "user_prompt",
        payload: { content: "must be blocked when managed backend is unavailable" },
        tags: [],
        privacy_tags: [],
      });
      expect(result.ok).toBe(false);
      expect((result.error || "").toLowerCase()).toContain("write blocked");
      const filters = (result.meta as Record<string, unknown>).filters as Record<string, unknown>;
      expect(filters.write_durability).toBe("blocked");
    } finally {
      cleanupCore(core, config);
    }
  });

  test("adapter-factory returns managedRequired=true for managed mode", () => {
    const { createStorageAdapter } = require("../../src/db/adapter-factory");
    const { adapter, managedRequired } = createStorageAdapter({
      backendMode: "managed",
      dbPath: ":memory:",
      managedEndpoint: "postgresql://localhost/test",
    });
    expect(managedRequired).toBe(true);
    adapter.close();
  });

  test("adapter-factory returns managedRequired=false for local/hybrid", () => {
    const { createStorageAdapter } = require("../../src/db/adapter-factory");
    const r1 = createStorageAdapter({ backendMode: "local", dbPath: ":memory:" });
    expect(r1.managedRequired).toBe(false);
    r1.adapter.close();

    const r2 = createStorageAdapter({ backendMode: "hybrid", dbPath: ":memory:" });
    expect(r2.managedRequired).toBe(false);
    r2.adapter.close();
  });
});

// --- Fix 2: session FK upsert in event-store ---

describe("Fix 2: event-store session FK upsert", () => {
  test("PostgresEventStore.append includes session upsert SQL", () => {
    const fs = require("node:fs");
    const source = fs.readFileSync(
      join(MEMORY_SERVER_ROOT, "src/projector/event-store.ts"),
      "utf8"
    );
    // Must upsert mem_sessions before inserting mem_events
    expect(source).toContain("INSERT INTO mem_sessions");
    expect(source).toContain("ON CONFLICT (session_id) DO NOTHING");
    // The session upsert must come BEFORE the event insert
    const sessionIdx = source.indexOf("INSERT INTO mem_sessions");
    const eventIdx = source.indexOf("INSERT INTO mem_events");
    expect(sessionIdx).toBeLessThan(eventIdx);
  });
});

// --- Fix 4: shadow match threshold alignment ---

describe("Fix 4: shadow match threshold = 95%", () => {
  test("ManagedBackend.SHADOW_MATCH_THRESHOLD is 0.95", () => {
    const { ManagedBackend } = require("../../src/projector/managed-backend");
    expect(ManagedBackend.SHADOW_MATCH_THRESHOLD).toBe(0.95);
  });

  test("90% match rate counts as divergence (not match)", () => {
    const { ManagedBackend } = require("../../src/projector/managed-backend");
    const mb = new ManagedBackend({
      endpoint: "postgresql://test@localhost/test",
      apiKey: "",
      backendMode: "hybrid",
    });
    mb.shadow.advancePhase(); // off → shadow

    // Simulate 100 reads, 90 matches → 90% match rate → below 95% threshold
    for (let i = 0; i < 90; i++) mb.shadow.recordShadowRead(true);
    for (let i = 0; i < 10; i++) mb.shadow.recordShadowRead(false);
    for (let i = 0; i < 100; i++) mb.shadow.recordReplication(true);

    const result = mb.attemptPromotion();
    expect(result.promoted).toBe(false);
    expect(result.reasons.some((r: string) => r.includes("match rate"))).toBe(true);
  });

  test("95% match rate counts as match and promotes", () => {
    const { ManagedBackend } = require("../../src/projector/managed-backend");
    const mb = new ManagedBackend({
      endpoint: "postgresql://test@localhost/test",
      apiKey: "",
      backendMode: "hybrid",
    });
    mb.shadow.advancePhase(); // off → shadow

    // Simulate 100 reads, 95 matches → 95% match rate → meets threshold
    for (let i = 0; i < 95; i++) mb.shadow.recordShadowRead(true);
    for (let i = 0; i < 5; i++) mb.shadow.recordShadowRead(false);
    for (let i = 0; i < 100; i++) mb.shadow.recordReplication(true);

    const result = mb.attemptPromotion();
    expect(result.promoted).toBe(true);
    expect(result.phase).toBe("verified");
  });
});

// --- Risk mitigation: session upsert batch optimization ---

describe("Risk 1: session upsert batch optimization", () => {
  test("event-store batches session upserts before event inserts", () => {
    const fs = require("node:fs");
    const source = fs.readFileSync(
      join(process.cwd(), "memory-server/src/projector/event-store.ts"),
      "utf8"
    );
    // sessionMap collects unique sessions for batch upsert
    expect(source).toContain("sessionMap");
    // Wrapped in a single transaction
    expect(source).toContain("transactionAsync");
  });
});

// --- Risk mitigation: managed mode fail-close and health degraded ---

describe("Risk 2: managed mode fail-close", () => {
  test("recordEvent returns error when managed backend not connected", () => {
    const config = createConfig({
      backendMode: "managed",
      managedEndpoint: "postgresql://test@localhost:5432/test",
    });
    const core = new HarnessMemCore(config);
    try {
      const result = core.recordEvent({
        platform: "test",
        project: "test-project",
        session_id: "test-session",
        event_type: "tool_use",
        payload: JSON.stringify({ content: "test" }),
      });
      // ManagedBackend won't connect (no pg), so fail-close should trigger
      expect(result.ok).toBe(false);
      expect(result.error).toContain("managed backend");
      expect(result.error).toContain("fail-close");
      const filters = (result.meta as Record<string, unknown>).filters as Record<string, unknown>;
      expect(filters.write_durability).toBe("blocked");
    } finally {
      cleanupCore(core, config);
    }
  });

  test("health returns degraded status when managed backend not connected", () => {
    const config = createConfig({
      backendMode: "managed",
      managedEndpoint: "postgresql://test@localhost:5432/test",
    });
    const core = new HarnessMemCore(config);
    try {
      const health = core.health();
      const item = health.items[0] as Record<string, unknown>;
      expect(item.status).toBe("degraded");
    } finally {
      cleanupCore(core, config);
    }
  });

  test("local mode does NOT fail-close — writes succeed normally", () => {
    const config = createConfig({ backendMode: "local" });
    const core = new HarnessMemCore(config);
    try {
      const result = core.recordEvent({
        platform: "test",
        project: "test-project",
        session_id: "test-session",
        event_type: "tool_use",
        payload: JSON.stringify({ content: "test" }),
      });
      expect(result.ok).toBe(true);
      expect((result.meta as Record<string, unknown>).write_durability).toBe("local");
    } finally {
      cleanupCore(core, config);
    }
  });
});
