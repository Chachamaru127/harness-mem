import { describe, expect, test } from "bun:test";
import {
  createInjectEnvelope,
  validateProseContainsSignals,
  type InjectEnvelope,
  type InjectKind,
} from "../../src/inject/envelope";

describe("inject envelope (§S109 D8 P0-OBS-001)", () => {
  test("structured-side is the source of truth and carries the required fields", () => {
    const env = createInjectEnvelope({
      kind: "contradiction",
      signals: ["MySQL", "PostgreSQL", "§D-2"],
      action_hint: "warn_user_before_act",
      confidence: 0.84,
      prose:
        "前は MySQL と決めましたが、§D-2 で PostgreSQL に変更した経緯があります。確認してから進めてください。",
    });

    expect(env.structured.kind).toBe("contradiction" satisfies InjectKind);
    expect(env.structured.signals).toEqual(["MySQL", "PostgreSQL", "§D-2"]);
    expect(env.structured.action_hint).toBe("warn_user_before_act");
    expect(env.structured.confidence).toBe(0.84);
    expect(env.structured.trace_id).toMatch(/^inj_[0-9]{4}-[0-9]{2}-[0-9]{2}_[A-Za-z0-9]{4,}$/);
    expect(typeof env.prose).toBe("string");
    expect(env.prose.length).toBeGreaterThan(0);
  });

  test("trace_id is unique across consecutive envelopes", () => {
    const a = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["foo.ts"],
      action_hint: "read_before_edit",
      confidence: 0.7,
      prose: "foo.ts は §54 で rollback された経緯があります。",
    });
    const b = createInjectEnvelope({
      kind: "recall_chain",
      signals: ["foo.ts"],
      action_hint: "read_before_edit",
      confidence: 0.7,
      prose: "foo.ts は §54 で rollback された経緯があります。",
    });
    expect(a.structured.trace_id).not.toBe(b.structured.trace_id);
  });

  test("validateProseContainsSignals returns ok when every signal appears verbatim in prose", () => {
    const env: InjectEnvelope = createInjectEnvelope({
      kind: "contradiction",
      signals: ["MySQL", "PostgreSQL", "§D-2"],
      action_hint: "warn_user_before_act",
      confidence: 0.84,
      prose:
        "前は MySQL と決めましたが、§D-2 で PostgreSQL に変更した経緯があります。確認してから進めてください。",
    });
    const result = validateProseContainsSignals(env);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test("validateProseContainsSignals reports the missing signals when prose drops any of them", () => {
    const env: InjectEnvelope = createInjectEnvelope({
      kind: "contradiction",
      signals: ["MySQL", "PostgreSQL", "§D-2"],
      action_hint: "warn_user_before_act",
      confidence: 0.84,
      // §D-2 が prose から欠落しているケース
      prose: "前は MySQL でしたが PostgreSQL に変更されました。",
    });
    const result = validateProseContainsSignals(env);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["§D-2"]);
  });

  test("kind enum rejects unknown values at the type boundary (compile-time guard)", () => {
    // 実行時の検証も最低限入れる: 未知 kind は throw
    expect(() =>
      createInjectEnvelope({
        // @ts-expect-error — invalid kind on purpose
        kind: "unknown_kind",
        signals: [],
        action_hint: "warn_user_before_act",
        confidence: 0.5,
        prose: "x",
      }),
    ).toThrow(/unknown inject kind/i);
  });
});
