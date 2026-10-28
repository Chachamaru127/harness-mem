import { describe, expect, test } from "bun:test";
import {
  ClairicClient,
  type ClairicClientOptions,
  type ClairicFacts,
} from "../../src/core/clairic-client";

type Captured = { url: string; init: RequestInit };

const EMPTY: ClairicFacts = {
  decision: null,
  reason: null,
  date: null,
  version: null,
  files: [],
};

const options = (overrides: Partial<ClairicClientOptions> = {}): ClairicClientOptions => ({
  accountId: "account-1",
  apiToken: "token-1",
  timeoutMs: 1_000,
  backoffMs: () => 0,
  ...overrides,
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const wrapped = (answers: Record<string, unknown>) => ({ result: { answers } });

describe("ClairicClient", () => {
  test("sends the typed-extraction contract and reads Japanese values", async () => {
    const calls: Captured[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return json(
        wrapped({
          decision: { value: "バックアップを取り、VACUUM は別工程に分ける方針" },
          reason: { value: "失敗時に戻せない" },
          date: { value: "2026-10-20" },
          version: { value: "v0.31.2" },
          files: { value: ["memory-server/src/core/session-manager.ts", "scripts/vacuum.ts"] },
        }),
      );
    }) as unknown as typeof fetch;

    const facts = await new ClairicClient(options({ fetchImpl })).extract(
      "決定: バックアップを取り、VACUUM は別工程に分ける。理由は失敗時に戻せないため。",
    );

    expect(facts).toEqual({
      decision: "バックアップを取り、VACUUM は別工程に分ける方針",
      reason: "失敗時に戻せない",
      date: "2026-10-20",
      version: "v0.31.2",
      files: ["memory-server/src/core/session-manager.ts", "scripts/vacuum.ts"],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-1/ai/run/@cf/cloudflare/clairic",
    );
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      model: "clairic",
      state: "決定: バックアップを取り、VACUUM は別工程に分ける。理由は失敗時に戻せないため。",
      fields: {
        decision: { type: "text", instructions: "採った決定" },
        reason: { type: "text", instructions: "決定の理由" },
        date: { type: "date", instructions: "決定日" },
        version: { type: "text", instructions: "対象のバージョン" },
        files: { type: "list", items: "text", instructions: "変更したファイル" },
      },
    });
  });

  test("reads the direct answers shape", async () => {
    const fetchImpl = (async () =>
      json({
        answers: {
          decision: { value: "BLOB で持つ" },
          reason: { value: "検索が速い" },
        },
      })) as unknown as typeof fetch;

    const facts = await new ClairicClient(options({ fetchImpl })).extract("state");

    expect(facts.decision).toBe("BLOB で持つ");
    expect(facts.reason).toBe("検索が速い");
  });

  test("normalizes a partial response and non-string list entries", async () => {
    const fetchImpl = (async () =>
      json(
        wrapped({
          decision: { value: "方針 A" },
          reason: { value: null },
          files: { value: ["a.ts", 3, null] },
        }),
      )) as unknown as typeof fetch;

    const facts = await new ClairicClient(options({ fetchImpl })).extract("state");

    expect(facts).toEqual({
      decision: "方針 A",
      reason: null,
      date: null,
      version: null,
      files: ["a.ts"],
    });
  });

  test("fails safe on 401 without retrying", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json({ success: false, errors: [{ code: 10000 }] }, 401);
    }) as unknown as typeof fetch;

    const facts = await new ClairicClient(options({ fetchImpl })).extract("state");

    expect(calls).toBe(1);
    expect(facts).toEqual(EMPTY);
  });

  test("retries once after 500 and succeeds", async () => {
    let calls = 0;
    const attempts: number[] = [];
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1 ? json({ error: "boom" }, 500) : json(wrapped({ decision: { value: "再試行で成功" } }));
    }) as unknown as typeof fetch;

    const facts = await new ClairicClient(
      options({ fetchImpl, backoffMs: (attempt) => (attempts.push(attempt), 0) }),
    ).extract("state");

    expect(calls).toBe(2);
    expect(attempts).toEqual([1]);
    expect(facts.decision).toBe("再試行で成功");
  });

  test("retries 429 once and then fails safe", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json({ error: "rate limited" }, 429);
    }) as unknown as typeof fetch;

    const facts = await new ClairicClient(options({ fetchImpl })).extract("state");

    expect(calls).toBe(2);
    expect(facts).toEqual(EMPTY);
  });

  test("fails safe on 500 twice", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json({ error: "boom" }, 500);
    }) as unknown as typeof fetch;

    const facts = await new ClairicClient(options({ fetchImpl })).extract("state");

    expect(calls).toBe(2);
    expect(facts).toEqual(EMPTY);
  });

  test("fails safe on invalid JSON", async () => {
    const fetchImpl = (async () =>
      new Response("not json", { status: 200 })) as unknown as typeof fetch;

    const facts = await new ClairicClient(options({ fetchImpl })).extract("state");

    expect(facts).toEqual(EMPTY);
  });

  test("fails safe when answers are missing", async () => {
    const fetchImpl = (async () => json({ result: {} })) as unknown as typeof fetch;

    const facts = await new ClairicClient(options({ fetchImpl })).extract("state");

    expect(facts).toEqual(EMPTY);
  });

  test("fails safe on timeout without retrying", async () => {
    let calls = 0;
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as unknown as typeof fetch;

    const started = Date.now();
    const facts = await new ClairicClient(options({ fetchImpl, timeoutMs: 20 })).extract("state");

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(calls).toBe(1);
    expect(facts).toEqual(EMPTY);
  });

  test("fails safe without credentials and never calls the network", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json(wrapped({ decision: { value: "使われない" } }));
    }) as unknown as typeof fetch;

    const noAccount = await new ClairicClient(
      options({ fetchImpl, accountId: undefined }),
    ).extract("state");
    const noToken = await new ClairicClient(options({ fetchImpl, apiToken: undefined })).extract(
      "state",
    );

    expect(calls).toBe(0);
    expect(noAccount).toEqual(EMPTY);
    expect(noToken).toEqual(EMPTY);
  });

  test("honors a model override in the run path and body", async () => {
    const calls: Captured[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return json(wrapped({ decision: { value: "override" } }));
    }) as unknown as typeof fetch;

    await new ClairicClient(
      options({ fetchImpl, model: "@cf/cloudflare/clairic-next" }),
    ).extract("state");

    expect(calls[0]!.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-1/ai/run/@cf/cloudflare/clairic-next",
    );
    expect(JSON.parse(String(calls[0]!.init.body)).model).toBe("clairic-next");
  });
});
