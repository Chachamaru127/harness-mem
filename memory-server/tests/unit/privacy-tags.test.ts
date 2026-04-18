/**
 * S78-E01: privacy-tags.ts unit tests
 *
 * Verifies that stripPrivateBlocks() correctly sanitizes <private>...</private>
 * blocks from observation content before ingest.
 */

import { describe, expect, test } from "bun:test";
import { stripPrivateBlocks } from "../../src/core/privacy-tags";

describe("stripPrivateBlocks", () => {
  test("strips a simple <private> block, returning empty string", () => {
    expect(stripPrivateBlocks("<private>foo</private>")).toBe("");
  });

  test("strips inline block, preserving surrounding text", () => {
    expect(stripPrivateBlocks("before <private>secret</private> after")).toBe("before  after");
  });

  test("case-insensitive: strips <PRIVATE> tags", () => {
    expect(stripPrivateBlocks("<PRIVATE>x</PRIVATE>")).toBe("");
  });

  test("case-insensitive: strips mixed-case <Private> tags", () => {
    expect(stripPrivateBlocks("<Private>mixed</Private>")).toBe("");
  });

  test("multi-line: strips block spanning multiple lines", () => {
    expect(stripPrivateBlocks("<private>\nmulti\nline\n</private>")).toBe("");
  });

  test("attributes: strips block with attributes like reason=...", () => {
    expect(stripPrivateBlocks('<private reason="creds">x</private>')).toBe("");
  });

  test("multiple blocks: strips all independently", () => {
    expect(stripPrivateBlocks("a <private>x</private> b <private>y</private> c")).toBe("a  b  c");
  });

  test("unbalanced open tag without close: returns original text unchanged", () => {
    const input = "<private>no close";
    expect(stripPrivateBlocks(input)).toBe(input);
  });

  test("empty string: returns empty string unchanged", () => {
    expect(stripPrivateBlocks("")).toBe("");
  });

  test("null: returns null unchanged", () => {
    expect(stripPrivateBlocks(null)).toBeNull();
  });

  test("undefined: returns undefined unchanged", () => {
    expect(stripPrivateBlocks(undefined)).toBeUndefined();
  });

  test("no private tags: returns original text unchanged", () => {
    const input = "normal text without any private blocks";
    expect(stripPrivateBlocks(input)).toBe(input);
  });

  test("entire content is private: returns empty string (no error)", () => {
    expect(stripPrivateBlocks("<private>entire observation</private>")).toBe("");
  });
});

describe("stripPrivateBlocks — ingest integration smoke", () => {
  /**
   * Verifies that content stripped before storage does not leak private data.
   * This uses the pure function directly — the integration through HarnessMemCore
   * is verified by the full core.test.ts integration suite.
   */
  test("content with private block at start is sanitized", () => {
    const raw = "<private>API_KEY=secret123</private>\nReal observation content here.";
    const result = stripPrivateBlocks(raw);
    expect(result).not.toContain("<private>");
    expect(result).not.toContain("secret123");
    expect(result).toContain("Real observation content here.");
  });

  test("private blocks do not appear in stripped output", () => {
    const raw = "Context: <private>token=abc</private>. Decision: use TypeScript.";
    const result = stripPrivateBlocks(raw);
    expect(result).not.toContain("<private>");
    expect(result).not.toContain("</private>");
    expect(result).not.toContain("token=abc");
    expect(result).toContain("Context: ");
    expect(result).toContain("Decision: use TypeScript.");
  });
});
