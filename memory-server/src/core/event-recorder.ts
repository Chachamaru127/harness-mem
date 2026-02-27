/**
 * event-recorder.ts
 *
 * イベント記録モジュール。
 * HarnessMemCore から分割されたイベント記録責務を担う。
 *
 * 担当 API (公開):
 *   - recordEvent
 *   - recordEventQueued
 *   - getStreamEventsSince
 *
 * 内部 API (HarnessMemCore から呼び出される):
 *   - appendStreamEvent
 *   - enqueueWrite
 *   - getWriteQueuePending
 */

import type { Database } from "bun:sqlite";
import type { ApiResponse, Config, EventEnvelope, StreamEvent } from "./harness-mem-core";

// ---------------------------------------------------------------------------
// EventRecorderDeps: HarnessMemCore から渡される内部依存
// ---------------------------------------------------------------------------

export interface EventRecorderDeps {
  db: Database;
  config: Config;
  /** normalizeProjectInput のバインド済みバージョン */
  normalizeProject: (project: string) => string;
  /** recordEvent への参照（フルの内部 recordEvent ロジックをここに移さず、コアに残す） */
  doRecordEvent: (event: EventEnvelope, options?: { allowQueue: boolean }) => ApiResponse;
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

function clampLimit(input: unknown, fallback: number, min = 1, max = 500): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// ---------------------------------------------------------------------------
// EventRecorder クラス
// ---------------------------------------------------------------------------

export class EventRecorder {
  private streamEventCounter = 0;
  private streamEvents: StreamEvent[] = [];
  private readonly streamEventRetention = 600;

  private writeQueue: Promise<void> = Promise.resolve();
  private writeQueuePending = 0;
  private readonly writeQueueLimit = 100;

  constructor(private readonly deps: EventRecorderDeps) {}

  // ---------------------------------------------------------------------------
  // ストリームイベント管理
  // ---------------------------------------------------------------------------

  appendStreamEvent(
    type: StreamEvent["type"],
    data: Record<string, unknown>
  ): StreamEvent {
    const event: StreamEvent = {
      id: ++this.streamEventCounter,
      type,
      ts: new Date().toISOString(),
      data,
    };
    this.streamEvents.push(event);
    if (this.streamEvents.length > this.streamEventRetention) {
      this.streamEvents.splice(0, this.streamEvents.length - this.streamEventRetention);
    }
    return event;
  }

  getStreamEventsSince(lastEventId: number, limitInput?: number): StreamEvent[] {
    const limit = clampLimit(limitInput, 100, 1, 500);
    if (this.streamEvents.length === 0) {
      return [];
    }
    return this.streamEvents
      .filter((event) => event.id > lastEventId)
      .slice(0, limit)
      .map((event) => ({ ...event, data: { ...event.data } }));
  }

  // ---------------------------------------------------------------------------
  // 書き込みキュー管理
  // ---------------------------------------------------------------------------

  getWriteQueuePending(): number {
    return this.writeQueuePending;
  }

  enqueueWrite<T>(fn: () => T): Promise<T> {
    this.writeQueuePending += 1;
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const resultPromise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.writeQueue = this.writeQueue.then(() => {
      this.writeQueuePending -= 1;
      try {
        resolve(fn());
      } catch (err) {
        reject(err);
      }
    });

    return resultPromise;
  }

  // ---------------------------------------------------------------------------
  // パブリック API
  // ---------------------------------------------------------------------------

  recordEvent(
    event: EventEnvelope,
    options: { allowQueue: boolean } = { allowQueue: true }
  ): ApiResponse {
    return this.deps.doRecordEvent(event, options);
  }

  async recordEventQueued(
    event: EventEnvelope,
    options: { allowQueue: boolean } = { allowQueue: true }
  ): Promise<ApiResponse | "queue_full"> {
    if (this.writeQueuePending >= this.writeQueueLimit) {
      return "queue_full";
    }
    return this.enqueueWrite(() => this.deps.doRecordEvent(event, options));
  }
}
