/**
 * TEAM-008: ローカル⇔リモート ハイブリッドモード
 *
 * VPS が応答しない場合にイベントをメモリキューに退避し、
 * VPS 復旧後に順次フラッシュするためのモジュール。
 *
 * 設計:
 *   - インメモリキュー（プロセス再起動で消える。永続化は将来拡張）
 *   - 60秒間隔の定期ヘルスチェックで復旧を検出
 *   - 5xx / タイムアウトはリトライ対象、4xx はリトライ不要
 */

export interface QueuedEvent {
  /** イベントの JSON 文字列 */
  event_json: string;
  /** キューに積まれた理由 */
  reason: string;
  /** エンキュー時刻（ISO 8601）*/
  queued_at?: string;
}

export type FailureType = "retryable" | "non_retryable";

/**
 * HTTP ステータスコードをリトライ可否に分類する。
 * - 5xx / タイムアウト相当: retryable（VPS 一時障害）
 * - 4xx: non_retryable（クライアント側の問題）
 */
export function classifyHttpFailure(statusCode: number): FailureType {
  if (statusCode >= 500) {
    return "retryable";
  }
  return "non_retryable";
}

/**
 * インメモリのリトライキュー。
 * VPS がダウンしている間のイベントを保持し、復旧後に flush() で取り出す。
 */
export class LocalRetryQueue {
  private queue: QueuedEvent[] = [];

  /**
   * イベントをキューに追加する。
   */
  enqueue(event: QueuedEvent): void {
    this.queue.push({
      ...event,
      queued_at: event.queued_at ?? new Date().toISOString(),
    });
  }

  /**
   * キュー内の全イベントを返し、キューを空にする。
   * VPS 復旧後の一括送信に使用する。
   */
  flush(): QueuedEvent[] {
    const items = this.queue.slice();
    this.queue = [];
    return items;
  }

  /**
   * 現在のキューサイズを返す。
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * キューが空かどうかを返す。
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }
}

/**
 * シングルトンインスタンス（MCP Server 全体で共有）
 */
export const globalRetryQueue = new LocalRetryQueue();

/**
 * VPS の /health エンドポイントを確認し、VPS が応答しているか検証する。
 * @param baseUrl - VPS の base URL
 * @param timeoutMs - タイムアウト（デフォルト 5000ms）
 */
export async function checkVpsHealth(
  baseUrl: string,
  timeoutMs = 5000
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${baseUrl}/health`, {
      signal: controller.signal,
      method: "GET",
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * キューに積まれたイベントを VPS にフラッシュする。
 * 送信失敗したイベントは再度キューに積む。
 * @param baseUrl - VPS の base URL
 * @param queue - フラッシュ対象のキュー
 * @param sendFn - VPS への送信関数（テスト時にモック可能）
 * @returns 送信成功数
 */
export async function flushRetryQueue(
  baseUrl: string,
  queue: LocalRetryQueue,
  sendFn?: (url: string, event_json: string) => Promise<boolean>
): Promise<number> {
  const items = queue.flush();
  if (items.length === 0) return 0;

  const defaultSendFn = async (url: string, event_json: string): Promise<boolean> => {
    try {
      const response = await fetch(`${url}/v1/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: event_json,
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const fn = sendFn ?? defaultSendFn;
  let successCount = 0;

  for (const item of items) {
    const ok = await fn(baseUrl, item.event_json);
    if (ok) {
      successCount++;
    } else {
      // 失敗したイベントは再度キューに積む
      queue.enqueue({ ...item, reason: `retry_flush_failed` });
    }
  }

  return successCount;
}
