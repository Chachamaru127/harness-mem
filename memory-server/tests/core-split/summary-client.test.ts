import { describe, expect, test } from "bun:test";
import { SummaryClient, type SummaryFacts, type SummaryInput } from "../../src/core/summary-client";

const FACTS: SummaryFacts = {
  decision: "要約は Ollama Cloud の glm-5.3-flash を既定にする",
  reason: "bake-off が未完了で、暫定の最安候補だから",
  date: "2026-10-20",
  version: "1.4.0",
  files: ["memory-server/src/core/summary-client.ts"],
};

const INPUT: SummaryInput = {
  project: "harness-mem",
  sessionId: "session-abc",
  text: "ユーザー: 要約の既定モデルを決めたい。\nAI: glm-5.3-flash を既定にします。",
  facts: FACTS,
};

type Captured = {
  url: string;
  init: RequestInit | undefined;
  body: {
    model: string;
    stream: boolean;
    options: { num_predict: number };
    messages: Array<{ role: string; content: string }>;
  };
};

function capture(): { calls: Captured[]; fetchImpl: typeof fetch } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ message: { role: "assistant", content: "  要約本文  " } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/** Never settles on its own; rejects only when the client aborts. */
function hangingFetch(): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    })) as typeof fetch;
}

describe("SummaryClient", () => {
  test("posts to /api/chat with the contract body and returns the trimmed summary", async () => {
    const { calls, fetchImpl } = capture();
    const client = new SummaryClient({ fetchImpl });

    const result = await client.summarize(INPUT);
    expect(result).toEqual({ ok: true, summary: "要約本文" });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(call.init?.method).toBe("POST");
    expect(call.body.model).toBe("glm-5.3-flash:cloud");
    expect(call.body.stream).toBe(false);
    expect(call.body.options).toEqual({ num_predict: 2000 });
    expect(call.body.messages).toHaveLength(2);
    expect(call.body.messages[0]).toEqual({
      role: "system",
      content: "あなたは開発記憶の圧縮担当です。日本語で要約します。",
    });
    expect(call.body.messages[1]!.role).toBe("user");
  });

  test("honours endpoint, model and maxTokens options", async () => {
    const { calls, fetchImpl } = capture();
    const client = new SummaryClient({
      endpoint: "http://10.0.0.5:11434/",
      model: "gemma4:cloud",
      maxTokens: 1200,
      fetchImpl,
    });

    const result = await client.summarize(INPUT);
    expect(result.ok).toBe(true);
    expect(calls[0]!.url).toBe("http://10.0.0.5:11434/api/chat");
    expect(calls[0]!.body.model).toBe("gemma4:cloud");
    expect(calls[0]!.body.options).toEqual({ num_predict: 1200 });
  });

  test("the user prompt carries the extracted facts and the instructions", async () => {
    const { calls, fetchImpl } = capture();
    await new SummaryClient({ fetchImpl }).summarize(INPUT);

    const prompt = calls[0]!.body.messages[1]!.content;
    expect(prompt).toContain(FACTS.decision!);
    expect(prompt).toContain(FACTS.reason!);
    expect(prompt).toContain(FACTS.date!);
    expect(prompt).toContain(FACTS.version!);
    expect(prompt).toContain(FACTS.files[0]!);
    expect(prompt).toContain(INPUT.sessionId);
    expect(prompt).toContain(INPUT.project);
    expect(prompt).toContain("決定、理由、手順、数値、未解決点を必ず残す。");
    expect(prompt).toContain("進捗報告、挨拶、ツールの生出力は落とす。");
    expect(prompt).toContain("800字以内。");
    expect(prompt).toContain("推測を足さない。");
    expect(prompt).toContain("glm-5.3-flash を既定にします。");
  });

  test("truncates the session log to 6000 characters", async () => {
    const { calls, fetchImpl } = capture();
    const text = `${"あ".repeat(6000)}TAIL_MARKER`;
    await new SummaryClient({ fetchImpl }).summarize({ ...INPUT, text });

    const prompt = calls[0]!.body.messages[1]!.content;
    expect(prompt).not.toContain("TAIL_MARKER");
    expect(prompt).toContain("あ".repeat(6000));
  });

  test("missing facts render as an explicit placeholder, not as 'null'", async () => {
    const { calls, fetchImpl } = capture();
    await new SummaryClient({ fetchImpl }).summarize({
      ...INPUT,
      facts: { decision: null, reason: null, date: null, version: null, files: [] },
    });

    const prompt = calls[0]!.body.messages[1]!.content;
    expect(prompt).not.toContain("null");
    expect(prompt).toContain("(なし)");
  });

  test("an empty answer is a failure, not an empty summary", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: { role: "assistant", content: "   \n " } }), {
        status: 200,
      })) as unknown as typeof fetch;

    const result = await new SummaryClient({ fetchImpl }).summarize(INPUT);
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  test("a 500 response returns a failure instead of throwing", async () => {
    const fetchImpl = (async () =>
      new Response("upstream exploded", { status: 500 })) as unknown as typeof fetch;

    const result = await new SummaryClient({ fetchImpl }).summarize(INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("500");
  });

  test("invalid JSON returns a failure instead of throwing", async () => {
    const fetchImpl = (async () =>
      new Response("not json", { status: 200 })) as unknown as typeof fetch;

    const result = await new SummaryClient({ fetchImpl }).summarize(INPUT);
    expect(result).toEqual({ ok: false, reason: "invalid-json" });
  });

  test("a network error returns a failure instead of throwing", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const result = await new SummaryClient({ fetchImpl }).summarize(INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("network");
  });

  test("a timeout returns a failure instead of hanging", async () => {
    const started = Date.now();
    const result = await new SummaryClient({
      timeoutMs: 20,
      fetchImpl: hangingFetch(),
    }).summarize(INPUT);

    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("a response without message.content is a failure, not a crash", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ done: true }), { status: 200 })) as unknown as typeof fetch;

    const result = await new SummaryClient({ fetchImpl }).summarize(INPUT);
    expect(result).toEqual({ ok: false, reason: "empty" });
  });
});
