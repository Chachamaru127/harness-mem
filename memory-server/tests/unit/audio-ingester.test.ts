/**
 * V5-008: 音声トランスクリプション テスト
 *
 * AudioIngester と ingestAudio が正しく動作することを検証する。
 * - whisper-local モックで transcribe できること
 * - openai-whisper モックで transcribe できること
 * - ingestAudio 統合テスト（観察として登録）
 * - 空ファイルのエラーハンドリング
 * - 対応フォーマット (wav, mp3, m4a, webm)
 * - セグメント分割テスト
 */
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { AudioIngester, ingestAudio } from "../../src/ingest/audio-ingester";
import type { AudioIngesterConfig } from "../../src/ingest/audio-ingester";

// ---- グローバルfetchモック ----
const originalFetch = globalThis.fetch;

function makeWhisperLocalResponse(overrides: Partial<{
  text: string;
  language: string;
  duration: number;
  segments: Array<{ start: number; end: number; text: string }>;
}> = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      text: overrides.text ?? "テスト音声のテキストです。",
      language: overrides.language ?? "ja",
      duration: overrides.duration ?? 5.2,
      segments: overrides.segments ?? [
        { start: 0, end: 2.5, text: "テスト音声" },
        { start: 2.5, end: 5.2, text: "のテキストです。" },
      ],
    }),
  } as unknown as Response;
}

function makeOpenAIResponse(overrides: Partial<{
  text: string;
  language: string;
  duration: number;
  segments: Array<{ start: number; end: number; text: string }>;
}> = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      text: overrides.text ?? "OpenAI transcription result",
      language: overrides.language ?? "en",
      duration: overrides.duration ?? 3.7,
      segments: overrides.segments ?? [
        { start: 0, end: 3.7, text: "OpenAI transcription result" },
      ],
    }),
  } as unknown as Response;
}

const sampleBuffer = Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "binary");

beforeEach(() => {
  // デフォルト: whisper-local レスポンス
  globalThis.fetch = mock(async (_url: string | URL | Request, _init?: RequestInit) => {
    const urlStr = typeof _url === "string" ? _url : _url instanceof URL ? _url.href : (_url as Request).url;
    if (urlStr.includes("openai.com")) {
      return makeOpenAIResponse();
    }
    return makeWhisperLocalResponse();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// =============================================================================
// AudioIngester.transcribe — whisper-local
// =============================================================================
describe("AudioIngester.transcribe (whisper-local)", () => {
  test("ローカル whisper.cpp サーバーにリクエストを送信してトランスクリプション結果を返す", async () => {
    const ingester = new AudioIngester({
      provider: "whisper-local",
      whisperEndpoint: "http://localhost:8080/inference",
    });

    const result = await ingester.transcribe(sampleBuffer, "test.wav");

    expect(result.text).toBe("テスト音声のテキストです。");
    expect(result.language).toBe("ja");
    expect(result.duration_seconds).toBe(5.2);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].text).toBe("テスト音声");
    expect(result.segments[1].text).toBe("のテキストです。");
  });

  test("デフォルトエンドポイント (http://localhost:8080/inference) を使用する", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (url: string | URL | Request, _init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      return makeWhisperLocalResponse();
    }) as typeof fetch;

    const ingester = new AudioIngester({ provider: "whisper-local" });
    await ingester.transcribe(sampleBuffer, "audio.wav");

    expect(capturedUrl).toBe("http://localhost:8080/inference");
  });

  test("language オプションを FormData に含める", async () => {
    let capturedFormData: FormData | null = null;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedFormData = init?.body as FormData;
      return makeWhisperLocalResponse({ language: "en" });
    }) as typeof fetch;

    const ingester = new AudioIngester({
      provider: "whisper-local",
      language: "en",
    });
    const result = await ingester.transcribe(sampleBuffer, "audio.wav");

    expect(result.language).toBe("en");
    expect(capturedFormData).not.toBeNull();
  });

  test("サーバーエラー時は例外をスローする", async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    })) as typeof fetch;

    const ingester = new AudioIngester({ provider: "whisper-local" });
    await expect(ingester.transcribe(sampleBuffer, "audio.wav")).rejects.toThrow("500");
  });

  test("空バッファでエラーをスローする", async () => {
    const ingester = new AudioIngester({ provider: "whisper-local" });
    await expect(ingester.transcribe(Buffer.alloc(0), "audio.wav")).rejects.toThrow("empty");
  });

  test("サポートされていないフォーマットはエラーをスローする", async () => {
    const ingester = new AudioIngester({ provider: "whisper-local" });
    await expect(ingester.transcribe(sampleBuffer, "audio.xyz")).rejects.toThrow("Unsupported audio format");
  });
});

// =============================================================================
// AudioIngester.transcribe — openai-whisper
// =============================================================================
describe("AudioIngester.transcribe (openai-whisper)", () => {
  test("OpenAI Whisper API にリクエストを送信してトランスクリプション結果を返す", async () => {
    const ingester = new AudioIngester({
      provider: "openai-whisper",
      openaiApiKey: "sk-test-key",
    });

    const result = await ingester.transcribe(sampleBuffer, "meeting.mp3");

    expect(result.text).toBe("OpenAI transcription result");
    expect(result.language).toBe("en");
    expect(result.duration_seconds).toBe(3.7);
    expect(result.segments).toHaveLength(1);
  });

  test("API キーなしでエラーをスローする", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const ingester = new AudioIngester({ provider: "openai-whisper" });
    await expect(ingester.transcribe(sampleBuffer, "audio.wav")).rejects.toThrow("API key");

    if (originalKey !== undefined) {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  test("Authorization ヘッダーに Bearer トークンを含める", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      return makeOpenAIResponse();
    }) as typeof fetch;

    const ingester = new AudioIngester({
      provider: "openai-whisper",
      openaiApiKey: "sk-my-test-key",
    });
    await ingester.transcribe(sampleBuffer, "audio.wav");

    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-my-test-key");
  });

  test("OpenAI API エラー時は例外をスローする", async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    })) as typeof fetch;

    const ingester = new AudioIngester({
      provider: "openai-whisper",
      openaiApiKey: "invalid-key",
    });
    await expect(ingester.transcribe(sampleBuffer, "audio.mp3")).rejects.toThrow("401");
  });
});

// =============================================================================
// 対応フォーマットテスト
// =============================================================================
describe("AudioIngester — 対応フォーマット", () => {
  const supportedFormats = ["wav", "mp3", "m4a", "webm"];

  for (const fmt of supportedFormats) {
    test(`${fmt} フォーマットを受け入れる`, async () => {
      const ingester = new AudioIngester({ provider: "whisper-local" });
      const result = await ingester.transcribe(sampleBuffer, `audio.${fmt}`);
      expect(result.text).toBeTruthy();
    });
  }
});

// =============================================================================
// セグメント分割テスト
// =============================================================================
describe("AudioIngester — セグメント分割", () => {
  test("複数のセグメントを正しくパースする", async () => {
    globalThis.fetch = mock(async () =>
      makeWhisperLocalResponse({
        segments: [
          { start: 0.0, end: 1.5, text: "First segment" },
          { start: 1.5, end: 3.0, text: "Second segment" },
          { start: 3.0, end: 5.0, text: "Third segment" },
        ],
      })
    ) as typeof fetch;

    const ingester = new AudioIngester({ provider: "whisper-local" });
    const result = await ingester.transcribe(sampleBuffer, "multi.wav");

    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toEqual({ start: 0.0, end: 1.5, text: "First segment" });
    expect(result.segments[2]).toEqual({ start: 3.0, end: 5.0, text: "Third segment" });
  });

  test("セグメントがない場合は空配列を返す", async () => {
    globalThis.fetch = mock(async () =>
      makeWhisperLocalResponse({ segments: [] })
    ) as typeof fetch;

    const ingester = new AudioIngester({ provider: "whisper-local" });
    const result = await ingester.transcribe(sampleBuffer, "audio.wav");

    expect(result.segments).toEqual([]);
  });
});

// =============================================================================
// ingestAudio 統合テスト
// =============================================================================
describe("ingestAudio", () => {
  test("トランスクリプション結果を観察として登録できる", async () => {
    const events: unknown[] = [];
    const mockCore = {
      recordEvent: mock(async (event: unknown) => {
        events.push(event);
        return { ok: true, items: [{ id: "obs-001" }] };
      }),
    } as any;

    const result = await ingestAudio({
      core: mockCore,
      audioBuffer: sampleBuffer,
      filename: "voice-memo.wav",
      project: "test-project",
      session_id: "test-session",
    });

    expect(result.ok).toBe(true);
    expect(result.transcript).toBe("テスト音声のテキストです。");
    expect(result.duration_seconds).toBe(5.2);
    expect(events).toHaveLength(1);

    const ev = events[0] as any;
    expect(ev.payload.content).toBe("テスト音声のテキストです。");
    expect(ev.payload.observation_type).toBe("context");
    expect(ev.payload.source_format).toBe("audio_transcription");
    expect(ev.payload.language).toBe("ja");
  });

  test("空バッファの場合は ok:false を返す", async () => {
    const mockCore = {
      recordEvent: mock(async () => ({ ok: true, items: [] })),
    } as any;

    const result = await ingestAudio({
      core: mockCore,
      audioBuffer: Buffer.alloc(0),
      filename: "empty.wav",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("トランスクリプションが空の場合は観察を登録しない", async () => {
    globalThis.fetch = mock(async () =>
      makeWhisperLocalResponse({ text: "" })
    ) as typeof fetch;

    const mockCore = {
      recordEvent: mock(async () => ({ ok: true, items: [] })),
    } as any;

    const result = await ingestAudio({
      core: mockCore,
      audioBuffer: sampleBuffer,
      filename: "silent.wav",
    });

    expect(result.ok).toBe(true);
    expect(result.transcript).toBe("");
    expect(mockCore.recordEvent).not.toHaveBeenCalled();
  });

  test("tags を観察に付与できる", async () => {
    const events: unknown[] = [];
    const mockCore = {
      recordEvent: mock(async (event: unknown) => {
        events.push(event);
        return { ok: true, items: [{ id: "obs-002" }] };
      }),
    } as any;

    await ingestAudio({
      core: mockCore,
      audioBuffer: sampleBuffer,
      filename: "tagged.mp3",
      tags: ["meeting", "important"],
    });

    const ev = events[0] as any;
    expect(ev.tags).toEqual(["meeting", "important"]);
  });

  test("API 呼び出しエラー時は ok:false を返す", async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 500,
      text: async () => "Server Error",
    })) as typeof fetch;

    const mockCore = {
      recordEvent: mock(async () => ({ ok: true, items: [] })),
    } as any;

    const result = await ingestAudio({
      core: mockCore,
      audioBuffer: sampleBuffer,
      filename: "error.wav",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });

  test("openai-whisper プロバイダーで ingestAudio が動作する", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key-for-ingest";

    const events: unknown[] = [];
    const mockCore = {
      recordEvent: mock(async (event: unknown) => {
        events.push(event);
        return { ok: true, items: [{ id: "obs-003" }] };
      }),
    } as any;

    const result = await ingestAudio({
      core: mockCore,
      audioBuffer: sampleBuffer,
      filename: "interview.mp3",
      ingesterConfig: {
        provider: "openai-whisper",
        openaiApiKey: "sk-test-key-for-ingest",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.transcript).toBe("OpenAI transcription result");

    const ev = events[0] as any;
    expect(ev.metadata.provider).toBe("openai-whisper");

    delete process.env.OPENAI_API_KEY;
  });
});
