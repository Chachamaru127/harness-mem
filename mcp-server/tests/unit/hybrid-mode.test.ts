/**
 * TEAM-008: ローカル⇔リモート ハイブリッドモード のテスト
 *
 * VPS ダウン時はローカルキューに退避し、
 * 復旧後にキューをフラッシュする動作を検証する。
 */
import { describe, expect, test } from "bun:test";
import {
  LocalRetryQueue,
  classifyHttpFailure,
  type QueuedEvent,
} from "../../src/hybrid/local-retry-queue";

describe("TEAM-008: ローカル⇔リモート ハイブリッドモード", () => {
  test("LocalRetryQueue はイベントをエンキューできる", () => {
    const queue = new LocalRetryQueue();
    queue.enqueue({ event_json: '{"test":1}', reason: "vps_down" });
    expect(queue.size()).toBe(1);
  });

  test("LocalRetryQueue は複数イベントを保持できる", () => {
    const queue = new LocalRetryQueue();
    queue.enqueue({ event_json: '{"a":1}', reason: "vps_down" });
    queue.enqueue({ event_json: '{"b":2}', reason: "timeout" });
    expect(queue.size()).toBe(2);
  });

  test("LocalRetryQueue は全イベントを取り出せる（flush）", () => {
    const queue = new LocalRetryQueue();
    queue.enqueue({ event_json: '{"x":10}', reason: "vps_down" });
    queue.enqueue({ event_json: '{"y":20}', reason: "timeout" });
    const items = queue.flush();
    expect(items).toHaveLength(2);
    expect(items[0].event_json).toBe('{"x":10}');
    expect(queue.size()).toBe(0); // flush 後は空
  });

  test("flush 後は再エンキューできる（空のキューから再利用）", () => {
    const queue = new LocalRetryQueue();
    queue.enqueue({ event_json: '{"z":1}', reason: "vps_down" });
    queue.flush();
    queue.enqueue({ event_json: '{"w":2}', reason: "vps_down" });
    expect(queue.size()).toBe(1);
  });

  test("classifyHttpFailure: 5xx エラーは retryable と判定される", () => {
    expect(classifyHttpFailure(500)).toBe("retryable");
    expect(classifyHttpFailure(503)).toBe("retryable");
  });

  test("classifyHttpFailure: 4xx エラーは non_retryable と判定される", () => {
    expect(classifyHttpFailure(400)).toBe("non_retryable");
    expect(classifyHttpFailure(401)).toBe("non_retryable");
    expect(classifyHttpFailure(404)).toBe("non_retryable");
  });
});
