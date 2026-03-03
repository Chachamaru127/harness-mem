/**
 * ingester 共通インターフェース定義
 * 各 PlatformIngester はこのインターフェースを implements することで
 * IngesterRegistry や IngestCoordinator から統一的に扱われる。
 */

import type { Config, EventEnvelope } from "../core/types.js";

/** EventInput は EventEnvelope と同義。ingester 側の呼称として再エクスポート */
export type EventInput = EventEnvelope;

/** 最小限のロガーインターフェース（console 互換） */
export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

/** PlatformIngester が initialize 時に受け取る依存オブジェクト */
export interface IngesterDeps {
  dataDir: string;
  recordEvent: (event: EventInput) => Promise<void>;
  getConfig: () => Config;
  logger?: Logger;
}

/**
 * 全 ingester に共通のインターフェース。
 *
 * 各 ingester クラスは `implements PlatformIngester` を宣言することで
 * 型安全に IngesterRegistry に登録できる。
 */
export interface PlatformIngester {
  /** ingester の識別名 (例: "claude", "cursor", "vscode") */
  readonly name: string;

  /** ingester の説明 */
  readonly description: string;

  /** ポーリング間隔（ミリ秒）。0 ならポーリングなし */
  readonly pollIntervalMs: number;

  /**
   * 初期化。DB やファイルシステムへのアクセスをセットアップ
   * @returns true if initialization successful
   */
  initialize(deps: IngesterDeps): Promise<boolean>;

  /**
   * 新しいデータをポーリングして取り込む
   * @returns 取り込んだイベント数
   */
  poll(): Promise<number>;

  /**
   * リソースのクリーンアップ
   */
  shutdown(): Promise<void>;
}
