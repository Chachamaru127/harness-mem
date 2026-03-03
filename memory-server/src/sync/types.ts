/**
 * V5-005: Cloud Sync コネクタ型定義
 */

export interface SyncConnector {
  name: string;
  type: 'github' | 'notion' | 'gdrive';

  /** 初期化（認証情報セットアップ） */
  initialize(config: ConnectorConfig): Promise<void>;

  /** リモートから変更を取得 */
  pull(): Promise<SyncChangeset[]>;

  /** リモートに変更をプッシュ */
  push(changes: SyncChangeset[]): Promise<PushResult>;

  /** 接続テスト */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

export interface ConnectorConfig {
  type: 'github' | 'notion' | 'gdrive';
  credentials: Record<string, string>;
  settings?: Record<string, unknown>;
}

export interface SyncChangeset {
  id: string;
  action: 'create' | 'update' | 'delete';
  observation_id?: number;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface PushResult {
  success: boolean;
  synced: number;
  errors: string[];
}

export interface SyncResult {
  connector: string;
  pulled: number;
  pushed: number;
  errors: string[];
}

export interface ConnectorRecord {
  id: number;
  name: string;
  type: string;
  config: string;
  last_synced_at: string | null;
  status: string;
  created_at: string;
}
