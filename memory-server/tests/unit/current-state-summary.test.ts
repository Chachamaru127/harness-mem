/**
 * S154-204: current-state prose summary + secret redaction.
 *
 * Verifies the deterministic current-state fold (non-empty, length-capped, drops
 * superseded entries, retains >= 90% of key phrases) and that injected secrets never
 * survive into the output (redactSecrets), while ISO dates are NOT over-redacted.
 */

import { describe, expect, test } from "bun:test";
import { redactSecrets, stripPrivateBlocks } from "../../src/core/privacy-tags";
import {
  summarizeCurrentState,
  type CurrentStateEntry,
} from "../../src/core/current-value-compression";

describe("S154-204 redactSecrets", () => {
  const SECRETS: Array<{ label: string; text: string; leak: string }> = [
    { label: "email", text: "ping alice@example.com about it", leak: "alice@example.com" },
    { label: "openai key", text: "key sk-abcdefghij0123456789ABCDEFGH live", leak: "sk-abcdefghij0123456789ABCDEFGH" },
    { label: "bearer", text: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig", leak: "eyJhbGciOiJIUzI1NiJ9.payload.sig" },
    {
      label: "pem",
      text: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAsecretkeymaterialXYZ\n-----END RSA PRIVATE KEY-----",
      leak: "MIIEowIBAAKCAQEAsecretkeymaterialXYZ",
    },
    { label: "assignment", text: "config api_key=supersecretvalue123 here", leak: "supersecretvalue123" },
    { label: "phone-jp", text: "call 090-1234-5678 today", leak: "090-1234-5678" },
    { label: "phone-intl", text: "dial +1-415-555-2671 now", leak: "+1-415-555-2671" },
    { label: "hex", text: "token deadbeefdeadbeefdeadbeefdeadbeef done", leak: "deadbeefdeadbeefdeadbeefdeadbeef" },
  ];

  for (const { label, text, leak } of SECRETS) {
    test(`redacts ${label} — value never survives`, () => {
      const out = redactSecrets(text);
      expect(out).not.toContain(leak);
      expect(out).toMatch(/\[REDACTED_/);
    });
  }

  test("ISO dates are not redacted as phone numbers", () => {
    const out = redactSecrets("deployed to production on 2026-06-08 at 12:34");
    expect(out).toContain("2026-06-08");
  });

  test("returns a string for null/empty", () => {
    expect(redactSecrets(null)).toBe("");
    expect(redactSecrets("")).toBe("");
  });
});

describe("S154-204 summarizeCurrentState", () => {
  const KEY_PHRASES = ["PostgreSQL", "worker.ts", "production cluster", "Ruri embeddings", "BM25 + RRF"];

  const current: CurrentStateEntry[] = [
    { content: "本番DBは PostgreSQL に決定した。" },
    { content: "race condition を worker.ts で修正済み。" },
    { content: "deploy 先は production cluster。", temporal_state: "current" },
    { content: "埋め込みは Ruri embeddings を使用中。" },
    { content: "検索は BM25 + RRF 融合。" },
    { content: "以前は staging environment だった。", temporal_state: "superseded" },
    { content: "昔は SQLite だけだった。", temporal_state: "historical" },
  ];

  test("produces non-empty prose and drops superseded/historical entries", () => {
    const summary = summarizeCurrentState(current);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).not.toContain("staging environment");
    expect(summary).not.toContain("SQLite だけ");
  });

  test("retains >= 90% of current-state key phrases", () => {
    const summary = summarizeCurrentState(current);
    const kept = KEY_PHRASES.filter((phrase) => summary.includes(phrase)).length;
    expect(kept / KEY_PHRASES.length).toBeGreaterThanOrEqual(0.9);
  });

  test("respects the length cap", () => {
    const summary = summarizeCurrentState(current, { maxChars: 40 });
    expect(summary.length).toBeLessThanOrEqual(41); // cap + ellipsis
  });

  test("dedupes identical current entries", () => {
    const dupes: CurrentStateEntry[] = [
      { content: "deploy 先は production cluster。" },
      { content: "deploy 先は production cluster。" },
      { content: "deploy 先は production cluster。" },
    ];
    const summary = summarizeCurrentState(dupes);
    expect(summary.split("production cluster").length - 1).toBe(1);
  });

  test("secrets in checkpoints never reach the summary", () => {
    const withSecret: CurrentStateEntry[] = [
      { content: "現在の本番 key は sk-abcdefghij0123456789ABCDEFGH です。" },
      { content: "<private>internal note: password=hunter2hunter2</private> deploy 先は production cluster。" },
    ];
    const summary = summarizeCurrentState(withSecret);
    expect(summary).not.toContain("sk-abcdefghij0123456789ABCDEFGH");
    expect(summary).not.toContain("hunter2hunter2");
    expect(summary).not.toContain("internal note");
    expect(summary).toContain("production cluster");
  });
});

describe("S154-204 stripPrivateBlocks still works alongside redaction", () => {
  test("private blocks removed before redaction", () => {
    const out = redactSecrets(stripPrivateBlocks("keep <private>secret=abcdef123456</private> this") ?? "");
    expect(out).toBe("keep  this");
  });
});
