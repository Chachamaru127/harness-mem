/**
 * V5-008: 音声トランスクリプション（Whisper.cpp）
 * 音声ファイルをトランスクリプションして観察として取り込む。
 * - whisper-local: ローカル whisper.cpp HTTP サーバー
 * - openai-whisper: OpenAI Whisper API
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { HarnessMemCore } from "../core/harness-mem-core";

export interface AudioTranscriptionResult {
  text: string;
  language: string;
  duration_seconds: number;
  segments: Array<{ start: number; end: number; text: string }>;
}

export interface AudioIngesterConfig {
  provider: "whisper-local" | "openai-whisper";
  model?: string;
  language?: string;
  /** ローカル whisper.cpp サーバーのエンドポイント */
  whisperEndpoint?: string;
  openaiApiKey?: string;
}

const SUPPORTED_FORMATS = ["wav", "mp3", "m4a", "webm", "ogg", "flac", "mp4", "mpeg", "mpga"];

function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

export class AudioIngester {
  constructor(private config: AudioIngesterConfig) {}

  async transcribe(audioBuffer: Buffer, filename: string): Promise<AudioTranscriptionResult> {
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error("audioBuffer is empty");
    }
    if (!filename || !filename.trim()) {
      throw new Error("filename is required");
    }

    const ext = getExtension(filename);
    if (ext && !SUPPORTED_FORMATS.includes(ext)) {
      throw new Error(`Unsupported audio format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(", ")}`);
    }

    if (this.config.provider === "openai-whisper") {
      return this.transcribeOpenAI(audioBuffer, filename);
    }
    return this.transcribeLocal(audioBuffer, filename);
  }

  private async transcribeLocal(audioBuffer: Buffer, filename: string): Promise<AudioTranscriptionResult> {
    const endpoint = this.config.whisperEndpoint || "http://localhost:8080/inference";

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: "audio/wav" });
    formData.append("file", blob, filename);
    if (this.config.language) {
      formData.append("language", this.config.language);
    }
    if (this.config.model) {
      formData.append("model", this.config.model);
    }
    formData.append("response_format", "json");

    const response = await fetch(endpoint, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`whisper.cpp server error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as Record<string, unknown>;

    // whisper.cpp のレスポンス形式を正規化
    const text = typeof data.text === "string" ? data.text.trim() : "";
    const language = typeof data.language === "string" ? data.language : (this.config.language || "auto");
    const durationSeconds = typeof data.duration === "number" ? data.duration : 0;

    const rawSegments = Array.isArray(data.segments) ? data.segments : [];
    const segments = rawSegments
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
      .map((s) => ({
        start: typeof s.start === "number" ? s.start : 0,
        end: typeof s.end === "number" ? s.end : 0,
        text: typeof s.text === "string" ? s.text.trim() : "",
      }));

    return { text, language, duration_seconds: durationSeconds, segments };
  }

  private async transcribeOpenAI(audioBuffer: Buffer, filename: string): Promise<AudioTranscriptionResult> {
    const apiKey = this.config.openaiApiKey || process.env.OPENAI_API_KEY || "";
    if (!apiKey) {
      throw new Error("OpenAI API key is required for openai-whisper provider");
    }

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: "audio/wav" });
    formData.append("file", blob, filename);
    formData.append("model", this.config.model || "whisper-1");
    formData.append("response_format", "verbose_json");
    if (this.config.language) {
      formData.append("language", this.config.language);
    }

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`OpenAI Whisper API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as Record<string, unknown>;

    const text = typeof data.text === "string" ? data.text.trim() : "";
    const language = typeof data.language === "string" ? data.language : (this.config.language || "auto");
    const durationSeconds = typeof data.duration === "number" ? data.duration : 0;

    const rawSegments = Array.isArray(data.segments) ? data.segments : [];
    const segments = rawSegments
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
      .map((s) => ({
        start: typeof s.start === "number" ? s.start : 0,
        end: typeof s.end === "number" ? s.end : 0,
        text: typeof s.text === "string" ? s.text.trim() : "",
      }));

    return { text, language, duration_seconds: durationSeconds, segments };
  }
}

// ---- 取り込みヘルパー ----

export interface IngestAudioOptions {
  core: HarnessMemCore;
  audioBuffer: Buffer;
  filename: string;
  project?: string;
  session_id?: string;
  tags?: string[];
  language?: string;
  ingesterConfig?: Partial<AudioIngesterConfig>;
}

export interface IngestAudioResult {
  ok: boolean;
  observation_id?: string;
  transcript?: string;
  duration_seconds?: number;
  error?: string;
}

/**
 * 音声バッファをトランスクリプションして観察として登録する。
 */
export async function ingestAudio(options: IngestAudioOptions): Promise<IngestAudioResult> {
  const {
    core,
    audioBuffer,
    filename,
    project = "default",
    session_id,
    tags = [],
    language,
    ingesterConfig = {},
  } = options;

  if (!audioBuffer || audioBuffer.length === 0) {
    return { ok: false, error: "audioBuffer is empty" };
  }
  if (!filename || !filename.trim()) {
    return { ok: false, error: "filename is required" };
  }

  const provider = (ingesterConfig.provider as AudioIngesterConfig["provider"]) ||
    (process.env.WHISPER_PROVIDER as AudioIngesterConfig["provider"]) ||
    "whisper-local";

  const config: AudioIngesterConfig = {
    provider,
    model: ingesterConfig.model || process.env.WHISPER_MODEL,
    language: language || ingesterConfig.language || process.env.WHISPER_LANGUAGE,
    whisperEndpoint: ingesterConfig.whisperEndpoint || process.env.WHISPER_ENDPOINT,
    openaiApiKey: ingesterConfig.openaiApiKey || process.env.OPENAI_API_KEY,
  };

  const ingester = new AudioIngester(config);

  let result: AudioTranscriptionResult;
  try {
    result = await ingester.transcribe(audioBuffer, filename);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }

  if (!result.text) {
    return { ok: true, transcript: "", duration_seconds: result.duration_seconds };
  }

  const contentHash = createHash("sha256").update(result.text).digest("hex");
  const title = `音声メモ: ${basename(filename)}`;
  const sessionId = session_id || `audio-${Date.now()}`;

  try {
    const recordResult = await (core as unknown as { recordEvent: (event: Record<string, unknown>) => { ok: boolean; items?: Array<{ id?: string }> } }).recordEvent({
      event_type: "observation",
      project,
      session_id: sessionId,
      payload: {
        title,
        content: result.text,
        observation_type: "context",
        content_hash: contentHash,
        source_format: "audio_transcription",
        duration_seconds: result.duration_seconds,
        language: result.language,
        segments: result.segments,
      },
      metadata: {
        source: "audio_ingest",
        filename,
        provider: config.provider,
      },
      tags,
    });

    const firstItem = Array.isArray(recordResult?.items) ? recordResult.items[0] : undefined;
    const observationId = firstItem && typeof firstItem === "object" && "id" in firstItem
      ? String((firstItem as { id: unknown }).id)
      : undefined;

    return {
      ok: true,
      observation_id: observationId,
      transcript: result.text,
      duration_seconds: result.duration_seconds,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
