import { describe, expect, test } from "bun:test";
import {
  JevTriageClient,
  type JevClientOptions,
  type TriageItem,
} from "../../src/core/jev-client";

type Captured = { url: string; init: RequestInit };

const options = (overrides: Partial<JevClientOptions> = {}): JevClientOptions => ({
  model: "typesafe/jev-1.14.0",
  threshold: 0.3,
  concurrency: 4,
  timeoutMs: 1_000,
  accountId: "account-1",
  apiToken: "token-1",
  backoffMs: () => 0,
  ...overrides,
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const answers = (noul: number) => ({ result: { answers: { needed: { noul } } } });

describe("JevTriageClient", () => {
  test("sends the one-question contract and keeps a high score", async () => {
    const calls: Captured[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return json(answers(0.9));
    }) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl })).triage([
      { observationId: "obs-1", content: "決定: SQLite を BLOB で持つ" },
    ]);

    expect(decisions).toEqual([
      { observationId: "obs-1", score: 0.9, durable: null, decision: "keep", fallback: false },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-1/ai/run",
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      model: "typesafe/jev-1.14.0",
      input: {
        state: "決定: SQLite を BLOB で持つ",
        questions: {
          needed: {
            type: "noul",
            instructions: "これは今後の開発で再利用する記憶として残すべきか",
          },
          durable: {
            type: "noul",
            instructions: "これは今後の判断に直接使う決定、方針、手順、好み、または失敗から学んだ教訓か",
          },
        },
      },
    });
    expect(calls[0]!.init.method).toBe("POST");
  });

  test("keeps at the threshold and compacts below it", async () => {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const content = JSON.parse(String(init?.body)).input.state as string;
      return json(answers(content === "a" ? 0.3 : 0.299));
    }) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl })).triage([
      { observationId: "edge", content: "a" },
      { observationId: "below", content: "b" },
    ]);

    expect(decisions.map((d) => d.decision)).toEqual(["keep", "compact"]);
    expect(decisions.map((d) => d.fallback)).toEqual([false, false]);
  });

  test("reads the nested result shape", async () => {
    const fetchImpl = (async () =>
      json({ result: { result: { answers: { needed: { noul: 0.2 } } } } })) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl })).triage([
      { observationId: "nested", content: "a" },
    ]);

    expect(decisions).toEqual([
      { observationId: "nested", score: 0.2, durable: null, decision: "compact", fallback: false },
    ]);
  });

  test("fails safe when answers are missing", async () => {
    const fetchImpl = (async () => json({ result: {} })) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl })).triage([
      { observationId: "missing", content: "a" },
    ]);

    expect(decisions).toEqual([
      { observationId: "missing", score: null, durable: null, decision: "keep", fallback: true, failureReason: "invalid_answer" },
    ]);
  });

  test("fails safe on invalid JSON", async () => {
    const fetchImpl = (async () =>
      new Response("not json", { status: 200 })) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl })).triage([
      { observationId: "bad-json", content: "a" },
    ]);

    expect(decisions[0]).toEqual({
      observationId: "bad-json",
      score: null,
      durable: null,
      decision: "keep",
      fallback: true,
      failureReason: "invalid_answer",
    });
  });

  test("does not retry on 401", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json({ success: false }, 401);
    }) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl })).triage([
      { observationId: "unauthorized", content: "a" },
    ]);

    expect(calls).toBe(1);
    expect(decisions[0]).toEqual({
      observationId: "unauthorized",
      score: null,
      durable: null,
      decision: "keep",
      fallback: true,
      failureReason: "http_401",
    });
  });

  test("retries once after 500 and succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1 ? json({ error: "boom" }, 500) : json(answers(0.8));
    }) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl })).triage([
      { observationId: "retry", content: "a" },
    ]);

    expect(calls).toBe(2);
    expect(decisions[0]).toEqual({
      observationId: "retry",
      score: 0.8,
      durable: null,
      decision: "keep",
      fallback: false,
    });
  });

  test("retries 429 once and then fails safe", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json({ error: "rate limited" }, 429);
    }) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl })).triage([
      { observationId: "rate", content: "a" },
    ]);

    expect(calls).toBe(2);
    expect(decisions[0]!.fallback).toBe(true);
    expect(decisions[0]!.failureReason).toBe("http_429");
    expect(decisions[0]!.decision).toBe("keep");
  });

  test("fails safe on timeout without waiting on the network", async () => {
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;

    const started = Date.now();
    const decisions = await new JevTriageClient(
      options({ fetchImpl, timeoutMs: 20 }),
    ).triage([{ observationId: "slow", content: "a" }]);

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(decisions[0]).toEqual({
      observationId: "slow",
      score: null,
      durable: null,
      decision: "keep",
      fallback: true,
      failureReason: "timeout",
    });
  });

  test("never exceeds the concurrency limit and preserves input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const items: TriageItem[] = Array.from({ length: 7 }, (_, index) => ({
      observationId: `obs-${index}`,
      content: `content-${index}`,
    }));
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const content = JSON.parse(String(init?.body)).input.state as string;
      const index = Number(content.slice("content-".length));
      await new Promise((resolve) => setTimeout(resolve, 7 - index));
      inFlight -= 1;
      return json(answers(index % 2 === 0 ? 0.9 : 0.1));
    }) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl, concurrency: 2 })).triage(items);

    expect(peak).toBe(2);
    expect(decisions.map((d) => d.observationId)).toEqual(items.map((i) => i.observationId));
    expect(decisions.map((d) => d.score)).toEqual([0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9]);
  });

  test("keeps going when one item fails", async () => {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const content = JSON.parse(String(init?.body)).input.state as string;
      if (content === "b") return json({ success: false }, 401);
      return json(answers(0.7));
    }) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl, concurrency: 1 })).triage([
      { observationId: "a", content: "a" },
      { observationId: "b", content: "b" },
      { observationId: "c", content: "c" },
    ]);

    expect(decisions.map((d) => [d.observationId, d.decision, d.fallback])).toEqual([
      ["a", "keep", false],
      ["b", "keep", true],
      ["c", "keep", false],
    ]);
  });

  test("fails safe without credentials and never calls the network", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json(answers(0.9));
    }) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(
      options({ fetchImpl, accountId: undefined, apiToken: undefined }),
    ).triage([
      { observationId: "a", content: "a" },
      { observationId: "b", content: "b" },
    ]);

    expect(calls).toBe(0);
    expect(decisions.every((d) => d.fallback && d.decision === "keep" && d.score === null)).toBe(true);
  });

  test("reads the durable question in the same request", async () => {
    const calls: Captured[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return json({ result: { result: { answers: { needed: { noul: 0.8 }, durable: { noul: 0.7 } } } } });
    }) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({ fetchImpl })).triage([
      { observationId: "durable", content: "決定: BLOB で持つ" },
    ]);

    expect(decisions[0]).toEqual({
      observationId: "durable",
      score: 0.8,
      durable: 0.7,
      decision: "keep",
      fallback: false,
    });
    const body = JSON.parse(String(calls[0]!.init.body)) as { input?: { questions?: Record<string, unknown> } };
    expect(Object.keys(body.input?.questions ?? {})).toEqual(["needed", "durable"]);
  });

  test("supports a local System One endpoint without input wrapper or auth", async () => {
    const calls: Captured[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return json({ answers: { needed: { noul: 0.6 }, durable: { noul: 0.2 } } });
    }) as unknown as typeof fetch;

    const decisions = await new JevTriageClient(options({
      fetchImpl,
      endpoint: "http://127.0.0.1:11434/v1/systemone",
      requestShape: "systemone",
      auth: "none",
      accountId: undefined,
      apiToken: undefined,
    })).triage([{ observationId: "local", content: "a" }]);

    expect(decisions[0]).toEqual({
      observationId: "local",
      score: 0.6,
      durable: 0.2,
      decision: "keep",
      fallback: false,
    });
    expect(calls[0]!.url).toBe("http://127.0.0.1:11434/v1/systemone");
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body.state).toBe("a");
    expect(body.input).toBeUndefined();
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
