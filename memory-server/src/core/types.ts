/**
 * 共有型定義モジュール
 * harness-mem-core.ts から抽出されたexport型/インターフェース定義。
 * ランタイムコードは含まない。
 */

export type Platform = "claude" | "codex" | "opencode" | "cursor" | "antigravity" | "gemini";
export type EventType = "session_start" | "user_prompt" | "tool_use" | "checkpoint" | "session_end";

/** V5-004: 心理学的記憶モデルの種類 */
export type MemoryType = "episodic" | "semantic" | "procedural";

export interface EventEnvelope {
  event_id?: string;
  platform: Platform | string;
  project: string;
  session_id: string;
  event_type: EventType | string;
  ts?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
  privacy_tags?: string[];
  dedupe_hash?: string;
  correlation_id?: string;
  /** TEAM-009: イベント送信者のユーザーID（config の userId より優先） */
  user_id?: string;
  /** TEAM-009: イベント送信者のチームID（config の teamId より優先） */
  team_id?: string;
}

export interface SearchRequest {
  query: string;
  project?: string;
  project_members?: string[];
  session_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  include_private?: boolean;
  expand_links?: boolean;
  strict_project?: boolean;
  debug?: boolean;
  /** Explicit question kind for retrieval routing: profile|timeline|graph|vector|hybrid|freshness */
  question_kind?: "profile" | "timeline" | "graph" | "vector" | "hybrid" | "freshness";
  /** updatesリンクで上書きされた旧観察を検索結果から除外する (IMP-002) */
  exclude_updated?: boolean;
  /** COMP-003: 指定時点以前の観察のみを返す Point-in-time クエリ（ISO 8601） */
  as_of?: string;
  /** NEXT-001: Cognitive セクターでフィルタリング: work|people|health|hobby|meta */
  sector?: "work" | "people" | "health" | "hobby" | "meta";
  /** V5-004: 記憶モデルタイプでフィルタリング: episodic|semantic|procedural */
  memory_type?: MemoryType | MemoryType[];
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
  /** S43-SEARCH: ソート順 — relevance(デフォルト) / date_desc / date_asc */
  sort_by?: "relevance" | "date_desc" | "date_asc";
}

export interface FeedRequest {
  cursor?: string;
  limit?: number;
  project?: string;
  project_members?: string[];
  type?: string;
  include_private?: boolean;
  /** TEAM-009: ユーザーフィルター */
  user_id?: string;
  /** TEAM-009: チームフィルター */
  team_id?: string;
  /**
   * TEAM-005: member ロール適用フラグ。
   * true の場合、user_id + team_id フィルターを OR 条件（自分 OR 同チーム）で結合する。
   * false/未設定の場合は従来の AND 結合（TEAM-009 互換）。
   */
  _member_scope?: boolean;
  /** V5-004: 記憶モデルタイプでフィルタリング */
  memory_type?: MemoryType | MemoryType[];
}

export interface ProjectsStatsRequest {
  include_private?: boolean;
}

export interface SessionsListRequest {
  project?: string;
  limit?: number;
  include_private?: boolean;
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
}

export interface SessionThreadRequest {
  session_id: string;
  project?: string;
  limit?: number;
  include_private?: boolean;
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
}

export interface SearchFacetsRequest {
  query?: string;
  project?: string;
  project_members?: string[];
  include_private?: boolean;
}

export interface ImportJobStatusRequest {
  job_id: string;
}

export interface VerifyImportRequest {
  job_id: string;
}

export interface ConsolidationRunRequest {
  reason?: string;
  project?: string;
  session_id?: string;
  limit?: number;
}

export interface AuditLogRequest {
  limit?: number;
  action?: string;
  target_type?: string;
}

export interface BackupRequest {
  dest_dir?: string;
}

export interface StreamEvent {
  id: number;
  type: "observation.created" | "session.finalized" | "health.changed";
  ts: string;
  data: Record<string, unknown>;
}

export interface TimelineRequest {
  id: string;
  before?: number;
  after?: number;
  include_private?: boolean;
}

export interface ResumePackRequest {
  project: string;
  project_members?: string[];
  session_id?: string;
  correlation_id?: string;
  limit?: number;
  include_private?: boolean;
  resume_pack_max_tokens?: number;
}

export interface GetObservationsRequest {
  ids: string[];
  include_private?: boolean;
  compact?: boolean;
}

/** IMP-002: メモリリンクの関係性タイプ（8種）*/
export type RelationType =
  | "follows"
  | "extends"
  | "updates"
  | "shared_entity"
  | "derives"
  | "contradicts"
  | "causes"
  | "part_of";

/** IMP-002: メモリリンク作成リクエスト */
export interface CreateLinkRequest {
  from_observation_id: string;
  to_observation_id: string;
  /** 関係性タイプ: updates(上書き) / extends(補足) / derives(推論) / follows / shared_entity / contradicts / causes / part_of */
  relation: RelationType;
  weight?: number;
}

/** IMP-002: メモリリンク取得リクエスト */
export interface GetLinksRequest {
  observation_id: string;
  relation?: string;
  /** BFS 探索深度 (1-5, デフォルト 1) */
  depth?: number;
}

export interface RecordCheckpointRequest {
  platform?: Platform | string;
  project?: string;
  session_id: string;
  title: string;
  content: string;
  tags?: string[];
  privacy_tags?: string[];
}

export interface FinalizeSessionRequest {
  platform?: Platform | string;
  project?: string;
  session_id: string;
  correlation_id?: string;
  summary_mode?: "standard" | "short" | "detailed";
}

export interface ApiMeta {
  count: number;
  latency_ms: number;
  sla_latency_ms: number;
  filters: Record<string, unknown>;
  ranking: string;
  [key: string]: unknown;
}

export interface ApiResponse {
  ok: boolean;
  source: "core" | "merged" | "sync" | "audio_ingest";
  items: unknown[];
  meta: ApiMeta;
  error?: string;
  no_memory?: boolean;
  no_memory_reason?: string;
}

export interface Config {
  dbPath: string;
  bindHost: string;
  bindPort: number;
  vectorDimension: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  openaiApiKey?: string;
  openaiEmbedModel?: string;
  ollamaBaseUrl?: string;
  ollamaEmbedModel?: string;
  localModelsDir?: string;
  proApiKey?: string;
  proApiUrl?: string;
  adaptiveJaThreshold?: number;
  adaptiveCodeThreshold?: number;
  captureEnabled: boolean;
  retrievalEnabled: boolean;
  injectionEnabled: boolean;
  codexHistoryEnabled: boolean;
  codexProjectRoot: string;
  codexSessionsRoot: string;
  codexIngestIntervalMs: number;
  codexBackfillHours: number;
  opencodeIngestEnabled?: boolean;
  opencodeStorageRoot?: string;
  opencodeDbPath?: string;
  opencodeIngestIntervalMs?: number;
  opencodeBackfillHours?: number;
  cursorIngestEnabled?: boolean;
  cursorEventsPath?: string;
  cursorIngestIntervalMs?: number;
  cursorBackfillHours?: number;
  antigravityIngestEnabled?: boolean;
  antigravityWorkspaceRoots?: string[];
  antigravityLogsRoot?: string;
  antigravityWorkspaceStorageRoot?: string;
  antigravityIngestIntervalMs?: number;
  antigravityBackfillHours?: number;
  geminiIngestEnabled?: boolean;
  geminiEventsPath?: string;
  geminiIngestIntervalMs?: number;
  geminiBackfillHours?: number;
  claudeCodeIngestEnabled?: boolean;
  claudeCodeProjectsRoot?: string;
  claudeCodeIngestIntervalMs?: number;
  claudeCodeBackfillHours?: number;
  searchRanking?: string;
  searchExpandLinks?: boolean;
  rerankerEnabled?: boolean;
  consolidationEnabled?: boolean;
  consolidationIntervalMs?: number;
  backendMode?: "local" | "managed" | "hybrid";
  managedEndpoint?: string;
  managedApiKey?: string;
  resumePackMaxTokens?: number;
  /** TEAM-003: ユーザー識別 - 環境変数 HARNESS_MEM_USER_ID から設定 */
  userId?: string;
  /** TEAM-003: チーム識別 - 環境変数 HARNESS_MEM_TEAM_ID から設定 */
  teamId?: string;
  /** テスト時に false を設定し、バックグラウンドワーカー（heartbeat, WAL checkpoint 等）を無効化する */
  backgroundWorkersEnabled?: boolean;
  /** GRAPH-003: グラフ探索の最大ホップ数（環境変数 HARNESS_MEM_GRAPH_MAX_HOPS、デフォルト3、上限5） */
  graphMaxHops?: number;
}
