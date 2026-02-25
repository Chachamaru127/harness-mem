import { describe, expect, test } from "bun:test";
import { type Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  core: HarnessMemCore;
  dir: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-cache-sections-${name}-`));
  const port = 40600 + Math.floor(Math.random() * 1000);
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
  return {
    core,
    dir,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

type ApiPayload = {
  ok: boolean;
  items: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
  error?: string;
};

function recordEvent(core: HarnessMemCore, overrides: Partial<EventEnvelope>): void {
  const event: EventEnvelope = {
    event_id: "default-event-id",
    platform: "codex",
    project: "cache-sections-project",
    session_id: "cache-sections-session",
    event_type: "user_prompt",
    ts: "2026-02-26T00:00:00.000Z",
    payload: { content: "cache sections default content" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
  const response = core.recordEvent(event);
  expect(response.ok).toBe(true);
}

async function postResumePack(baseUrl: string, body: Record<string, unknown>): Promise<ApiPayload> {
  const response = await fetch(`${baseUrl}/v1/resume-pack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<ApiPayload>;
}

/**
 * テスト用ファクト挿入ヘルパー。
 * HarnessMemCore の private db フィールドへのキャストでアクセスする。
 * これはインテグレーションテスト専用の手法で、HTTP API ではファクト直接挿入手段がないため使用する。
 */
function insertTestFact(
  core: HarnessMemCore,
  factId: string,
  project: string,
  sessionId: string,
  factType: string,
  factKey: string,
  factValue: string,
  confidence: number,
  createdAt: string
): void {
  const db = (core as unknown as { db: Database }).db;
  db.run(
    `INSERT INTO mem_facts(fact_id, project, session_id, fact_type, fact_key, fact_value, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    factId,
    project,
    sessionId,
    factType,
    factKey,
    factValue,
    confidence,
    createdAt,
    createdAt
  );
}

describe("resume-pack cache sections (W2-010)", () => {
  test("meta does not include static_section or dynamic_section when no facts and no observations", async () => {
    const runtime = createRuntime("empty");
    const { baseUrl } = runtime;

    try {
      const payload = await postResumePack(baseUrl, {
        project: "cache-sections-empty-project",
        include_private: true,
        limit: 20,
      });

      expect(payload.ok).toBe(true);
      // ファクトも観測もない場合、両セクションとも含まれない
      expect(payload.meta.static_section).toBeUndefined();
      expect(payload.meta.dynamic_section).toBeUndefined();
    } finally {
      runtime.stop();
    }
  });

  test("dynamic_section is present when observations exist, static_section absent when no facts", async () => {
    const runtime = createRuntime("obs-only");
    const { core, baseUrl } = runtime;
    const project = "cache-sections-obs-only";

    try {
      recordEvent(core, {
        event_id: "obs-only-1",
        project,
        session_id: "obs-only-session",
        ts: "2026-02-26T01:00:00.000Z",
        payload: { content: "observation without facts" },
      });

      const payload = await postResumePack(baseUrl, {
        project,
        include_private: true,
        limit: 20,
      });

      expect(payload.ok).toBe(true);

      // ファクトなし → static_section なし
      expect(payload.meta.static_section).toBeUndefined();

      // 観測あり → dynamic_section あり
      const dynamicSection = payload.meta.dynamic_section as Record<string, unknown> | undefined;
      expect(dynamicSection).toBeDefined();
      expect(dynamicSection!.cache_hint).toBe("volatile");
      expect(typeof dynamicSection!.content).toBe("string");
      expect((dynamicSection!.content as string).length).toBeGreaterThan(0);
      expect(typeof dynamicSection!.observation_count).toBe("number");
      expect(dynamicSection!.observation_count as number).toBeGreaterThan(0);
    } finally {
      runtime.stop();
    }
  });

  test("static_section has stable content_hash: same facts produce same hash across two calls", async () => {
    const runtime = createRuntime("hash-stability");
    const { core, baseUrl } = runtime;
    const project = "cache-sections-hash-stability";
    const now = "2026-02-26T00:00:00.000Z";

    insertTestFact(core, "fact-hash-1", project, "hash-session", "preference", "language", "TypeScript", 0.9, now);

    try {
      recordEvent(core, {
        event_id: "hash-obs-1",
        project,
        session_id: "hash-obs-session",
        ts: "2026-02-26T02:00:00.000Z",
        payload: { content: "hash stability test" },
      });

      const payload1 = await postResumePack(baseUrl, {
        project,
        include_private: true,
        limit: 20,
      });
      const payload2 = await postResumePack(baseUrl, {
        project,
        include_private: true,
        limit: 20,
      });

      expect(payload1.ok).toBe(true);
      expect(payload2.ok).toBe(true);

      const staticSection1 = payload1.meta.static_section as Record<string, unknown> | undefined;
      const staticSection2 = payload2.meta.static_section as Record<string, unknown> | undefined;

      expect(staticSection1).toBeDefined();
      expect(staticSection2).toBeDefined();

      // 同じファクトセットなら同じハッシュ
      expect(staticSection1!.content_hash).toBe(staticSection2!.content_hash);
      // content も同一
      expect(staticSection1!.content).toBe(staticSection2!.content);
    } finally {
      runtime.stop();
    }
  });

  test("static_section has cache_hint=stable and fact_count reflects active facts", async () => {
    const runtime = createRuntime("cache-hint");
    const { core, baseUrl } = runtime;
    const project = "cache-sections-cache-hint";
    const now = "2026-02-26T00:00:00.000Z";

    for (let i = 1; i <= 3; i++) {
      insertTestFact(core, `fact-hint-${i}`, project, "hint-session", "context", `key${i}`, `value${i}`, 0.8, now);
    }

    try {
      recordEvent(core, {
        event_id: "hint-obs-1",
        project,
        session_id: "hint-obs-session",
        ts: "2026-02-26T03:00:00.000Z",
        payload: { content: "cache hint test observation" },
      });

      const payload = await postResumePack(baseUrl, {
        project,
        include_private: true,
        limit: 20,
      });

      expect(payload.ok).toBe(true);

      const staticSection = payload.meta.static_section as Record<string, unknown> | undefined;
      expect(staticSection).toBeDefined();
      expect(staticSection!.cache_hint).toBe("stable");
      expect(staticSection!.fact_count).toBe(3);
      expect(typeof staticSection!.content_hash).toBe("string");
      // SHA-256 の hex 文字列は 64 文字
      expect((staticSection!.content_hash as string).length).toBe(64);
      expect(typeof staticSection!.content).toBe("string");
      expect((staticSection!.content as string).startsWith("# Project Facts")).toBe(true);
    } finally {
      runtime.stop();
    }
  });

  test("existing items array and backward-compatible meta fields are preserved", async () => {
    const runtime = createRuntime("backward-compat");
    const { core, baseUrl } = runtime;
    const project = "cache-sections-compat";

    try {
      recordEvent(core, {
        event_id: "compat-obs-1",
        project,
        session_id: "compat-session",
        ts: "2026-02-26T04:00:00.000Z",
        payload: { content: "backward compatibility test" },
      });

      const payload = await postResumePack(baseUrl, {
        project,
        include_private: true,
        limit: 20,
      });

      expect(payload.ok).toBe(true);
      // 既存フィールドが引き続き存在する
      expect(payload.items).toBeDefined();
      expect(Array.isArray(payload.items)).toBe(true);
      expect(typeof payload.meta.compaction_ratio).toBe("number");
      expect(typeof payload.meta.detailed_count).toBe("number");
      expect(typeof payload.meta.compacted_count).toBe("number");
      expect(typeof payload.meta.resume_pack_max_tokens).toBe("number");
    } finally {
      runtime.stop();
    }
  });

  test("content_hash changes when facts change", async () => {
    const runtime = createRuntime("hash-change");
    const { core, baseUrl } = runtime;
    const project = "cache-sections-hash-change";
    const now = "2026-02-26T00:00:00.000Z";

    insertTestFact(core, "fact-change-1", project, "change-session", "context", "framework", "React", 0.9, now);

    try {
      recordEvent(core, {
        event_id: "change-obs-1",
        project,
        session_id: "change-obs-session",
        ts: "2026-02-26T05:00:00.000Z",
        payload: { content: "hash change test" },
      });

      const payload1 = await postResumePack(baseUrl, {
        project,
        include_private: true,
        limit: 20,
      });

      const hash1 = (payload1.meta.static_section as Record<string, unknown>)?.content_hash;
      expect(typeof hash1).toBe("string");

      // ファクトを追加
      const later = "2026-02-26T06:00:00.000Z";
      insertTestFact(core, "fact-change-2", project, "change-session", "context", "language", "TypeScript", 0.95, later);

      const payload2 = await postResumePack(baseUrl, {
        project,
        include_private: true,
        limit: 20,
      });

      const hash2 = (payload2.meta.static_section as Record<string, unknown>)?.content_hash;
      expect(typeof hash2).toBe("string");

      // ファクトが変わったのでハッシュも変わる
      expect(hash1).not.toBe(hash2);
    } finally {
      runtime.stop();
    }
  });
});
