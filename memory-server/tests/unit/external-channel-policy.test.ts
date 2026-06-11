/**
 * S154-900: external-channel egress policy tests.
 *
 * Proves the two 154-900 DoD guarantees for memory content bound for an
 * external channel (Hermes business responses):
 *  1) privacy_tags private/internal/secret observations are EXCLUDED from
 *     external-channel egress (policy test), fail-closed on malformed tags.
 *  2) surviving content has passed the deterministic redactor
 *     (stripPrivateBlocks + redactSecrets) — a known injected secret never
 *     appears in external-channel output.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EXTERNAL_CHANNEL_BLOCKED_PRIVACY_TAGS,
  isBlockedForExternalChannel,
  sanitizeItemsForExternalChannel,
  sanitizeTextForExternalChannel,
} from "../../src/core/external-channel-policy";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { removeDirWithRetry } from "../fs-cleanup";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    removeDirWithRetry(dir);
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
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
}

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "external-channel-project",
    session_id: "session-ext-1",
    event_type: "checkpoint",
    payload: { title: "checkpoint", content: "placeholder" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  } as EventEnvelope;
}

describe("isBlockedForExternalChannel", () => {
  test("absent / empty privacy tags are not blocked", () => {
    expect(isBlockedForExternalChannel(undefined)).toBe(false);
    expect(isBlockedForExternalChannel(null)).toBe(false);
    expect(isBlockedForExternalChannel([])).toBe(false);
    expect(isBlockedForExternalChannel(["team"])).toBe(false);
  });

  test("private / internal / secret are blocked (trim + case-insensitive)", () => {
    for (const tag of EXTERNAL_CHANNEL_BLOCKED_PRIVACY_TAGS) {
      expect(isBlockedForExternalChannel([tag])).toBe(true);
    }
    expect(isBlockedForExternalChannel(["Internal"])).toBe(true);
    expect(isBlockedForExternalChannel([" SECRET "])).toBe(true);
    expect(isBlockedForExternalChannel(["team", "internal"])).toBe(true);
  });

  test("fail-closed: malformed privacy tags block egress", () => {
    expect(isBlockedForExternalChannel("internal")).toBe(true); // non-array
    expect(isBlockedForExternalChannel({})).toBe(true);
    expect(isBlockedForExternalChannel([42])).toBe(true); // non-string entry
    expect(isBlockedForExternalChannel([null])).toBe(true);
  });
});

describe("sanitizeTextForExternalChannel", () => {
  test("strips private blocks and redacts secrets", () => {
    const input =
      'deploy done <private>token sk-abcdefghijklmnopqrstuvwx</private> api_key=supersecret123 contact admin@example.com';
    const out = sanitizeTextForExternalChannel(input);
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(out).not.toContain("supersecret123");
    expect(out).not.toContain("admin@example.com");
    expect(out).toContain("deploy done");
  });

  test("null / undefined become empty string", () => {
    expect(sanitizeTextForExternalChannel(null)).toBe("");
    expect(sanitizeTextForExternalChannel(undefined)).toBe("");
  });
});

describe("sanitizeItemsForExternalChannel", () => {
  test("excludes blocked items and redacts survivors", () => {
    const items = [
      { id: "a", title: "ok title", content: "password=hunter2secret done", privacy_tags: [] },
      { id: "b", title: "internal note", content: "x", privacy_tags: ["internal"] },
      { id: "c", title: "secret note", content: "x", privacy_tags: ["secret"] },
      { id: "d", title: "private note", content: "x", privacy_tags: ["private"] },
      { id: "e", title: "malformed", content: "x", privacy_tags: "oops" },
    ];
    const result = sanitizeItemsForExternalChannel(items);
    expect(result.excluded_count).toBe(4);
    expect(result.items.map((i) => i.id)).toEqual(["a"]);
    expect(result.items[0].content).not.toContain("hunter2secret");
    expect(result.items[0].content).toContain("[REDACTED_SECRET]");
  });

  test("non-string title/content are left untouched", () => {
    const result = sanitizeItemsForExternalChannel([
      { id: "a", title: 42 as unknown, content: undefined, privacy_tags: [] },
    ]);
    expect(result.items[0].title).toBe(42);
    expect(result.items[0].content).toBeUndefined();
  });
});

describe("HarnessMemCore.searchForExternalChannel (S154-900 policy gate)", () => {
  test("excludes internal/secret/private observations and redacts surviving content", async () => {
    const core = new HarnessMemCore(createConfig("external-channel"));
    try {
      core.recordEvent(
        baseEvent({
          payload: {
            title: "deploy summary",
            content: "deploy pipeline finished api_key=abcdef123456789 all green",
          },
        }),
        { allowQueue: false },
      );
      core.recordEvent(
        baseEvent({
          session_id: "session-ext-2",
          payload: { title: "internal deploy ledger", content: "deploy pipeline internal margins" },
          privacy_tags: ["internal"],
        }),
        { allowQueue: false },
      );
      core.recordEvent(
        baseEvent({
          session_id: "session-ext-3",
          payload: { title: "secret deploy credentials", content: "deploy pipeline secret credentials" },
          privacy_tags: ["secret"],
        }),
        { allowQueue: false },
      );
      core.recordEvent(
        baseEvent({
          session_id: "session-ext-4",
          payload: { title: "private deploy memo", content: "deploy pipeline private memo" },
          privacy_tags: ["private"],
        }),
        { allowQueue: false },
      );

      const response = await core.searchForExternalChannel({
        query: "deploy pipeline",
        project: "external-channel-project",
        limit: 10,
        safe_mode: true,
        // even an explicit include_private=true must NOT leak: forced off
        include_private: true,
      } as Parameters<typeof core.searchForExternalChannel>[0]);

      expect(response.ok).toBe(true);
      const items = response.items as Array<{ title?: string; content?: string; privacy_tags?: string[] }>;
      expect(items.length).toBeGreaterThanOrEqual(1);
      const text = JSON.stringify(items);
      // policy: blocked observations never reach an external channel
      expect(text).not.toContain("internal margins");
      expect(text).not.toContain("secret credentials");
      expect(text).not.toContain("private memo");
      // redactor contract: known injected secret never appears
      expect(text).not.toContain("abcdef123456789");
      expect(text).toContain("[REDACTED_SECRET]");
      // meta documents the applied policy
      const meta = response.meta as unknown as {
        external_channel?: { policy: string; excluded_count: number; blocked_privacy_tags: string[] };
      };
      expect(meta.external_channel?.policy).toBe("exclude+redact");
      expect(meta.external_channel?.blocked_privacy_tags).toEqual(["private", "internal", "secret"]);
    } finally {
      core.close?.();
    }
  });
});
