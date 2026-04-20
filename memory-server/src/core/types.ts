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
  /** S78-B02: 階層メタデータ — session 内のスレッド識別子 */
  thread_id?: string;
  /** S78-B02: 階層メタデータ — トピックラベル */
  topic?: string;
  /**
   * S78-D01 / §81-B02 temporal-forgetting: TTL。ISO-8601 文字列または Unix 秒の数値。
   * null / 未指定 = 無期限。過去の値を渡してもエラーにしない（既に期限切れとして記録される）。
   * 不正な値（パース不能）は null として扱う。read path は expires_at <= now で除外、
   * forget-policy の force-eviction path は score 軸を無視して強制 archive する。
   */
  expires_at?: string | number | null;
  /**
   * S78-E02: Branch-scoped memory — git ブランチ名。
   * null / 未指定 = ブランチスコープなし。カラーは常に呼び出し元が明示的に渡す（自動検出なし）。
   */
  branch?: string | null;
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
  /**
   * S81-B02 (Codex round 9 P2): admin-only override to include
   * soft-archived observations in the result set. Orthogonal to
   * `include_private` — a caller who only wants their private notes
   * should NOT also see rows that `forget_policy` has pruned.
   */
  include_archived?: boolean;
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
  /**
   * S78-B02: 階層メタデータスコープ — project > session > thread > topic の順で絞り込む。
   * 後方互換: トップレベルの project / session_id も引き続き有効。
   * scope と top-level が両方指定された場合、scope を優先する。
   */
  scope?: {
    project?: string;
    session_id?: string;
    thread_id?: string;
    topic?: string;
  };
  /**
   * S78-D01: Temporal forgetting — true のとき期限切れ観察も検索結果に含む。
   * デフォルト false = 期限切れは除外。管理・監査用途向け。
   */
  include_expired?: boolean;
  /**
   * S78-E02: Branch-scoped memory フィルタ。
   * - 未指定: 全観察を返す（後方互換）
   * - 任意のブランチ名: そのブランチ OR branch=NULL（レガシー行）を返す。
   *   branch=NULL の既存観察は全ブランチから参照可能（後方互換デフォルト）。
   */
  branch?: string;
  /**
   * S78-D02: Contradiction resolution — superseded 観察の扱い。
   * - true（デフォルト）: superseded 観察も含むが rank を 0.5 倍に下げる。
   * - false: superseded 観察を結果から除外する。
   * superseded 観察 = mem_links に (A, B, 'supersedes') が存在する B。
   */
  include_superseded?: boolean;
  /**
   * S78-C03: Multi-hop reasoning — entity graph を辿って関連観察を追加取得。
   * - 0（デフォルト）: グラフ展開なし（後方互換）
   * - 1..3: 指定ホップ数だけ mem_relations エンティティグラフを BFS 探索
   * - グラフ経由で到達した観察にスコアボーナス +0.1 を付与
   * - 展開上限: 最大 20 観察（result explosion を防ぐ）
   */
  graph_depth?: number;
  /**
   * S78-C04: Graph-augmented hybrid search — graph proximity signal の重み。
   * - デフォルト 0.15 (moderate influence)
   * - 0 でグラフ近傍信号を無効化（A/B テスト用）
   * - 環境変数 HARNESS_MEM_GRAPH_OFF=1 でも強制 0 に設定される
   */
  graph_weight?: number;
  /**
   * §89-001 (XR-002 P0): observation_type フィルタ。
   * 単一値（"decision"）または配列（["decision", "summary"]）で指定。
   * 指定された type のみが検索結果に含まれる（AND で他のフィルタと結合）。
   * 未指定の場合は全 type が対象（後方互換）。
   *
   * Note: Step 1 は直接パラメータのみ。`type:xxx` という query 文字列 prefix
   * の pre-parse は Step 2 (MCP + OpenAPI + prefix parser PR) で追加する。
   */
  observation_type?: string | string[];
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
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
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
  /** S81-B02: opt-in low-value eviction policy. See consolidation/forget-policy.ts. */
  forget_policy?: {
    /** Default true — wet mode additionally requires HARNESS_MEM_AUTO_FORGET=1. */
    dry_run?: boolean;
    score_threshold?: number;
    weights?: { access?: number; signal?: number; age?: number };
    limit?: number;
    protect_accessed?: boolean;
  };
  /** S81-B03: opt-in contradiction detection. See consolidation/contradiction-detector.ts. */
  contradiction_scan?: {
    jaccard_threshold?: number;
    min_confidence?: number;
    max_pairs_per_group?: number;
  };
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
  type: "observation.created" | "session.finalized" | "session.partial_finalized" | "health.changed";
  ts: string;
  data: Record<string, unknown>;
}

export interface TimelineRequest {
  id: string;
  before?: number;
  after?: number;
  include_private?: boolean;
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
}

export interface ResumePackRequest {
  project: string;
  project_members?: string[];
  session_id?: string;
  correlation_id?: string;
  limit?: number;
  include_private?: boolean;
  resume_pack_max_tokens?: number;
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
  /**
   * §78-B03: Token-budget-aware wake-up context detail level.
   * - "L0"  : critical facts only (~170 tokens, ≥ 50% token reduction)
   * - "L1"  : L0 + recent context (~500-1000 tokens) [default]
   * - "full": backward-compat shape (same richness as pre-B03)
   */
  detail_level?: "L0" | "L1" | "full";
  /**
   * §91-003: When true (default), partial session summaries
   * (metadata.is_partial=true, stored as session_end observations with
   * tag "partial") are considered alongside full summaries.
   * Within the same session_id, the most recent created_at wins.
   * Set to false to restore pre-§91 behaviour (full finalize only).
   */
  include_partial?: boolean;
}

export interface GetObservationsRequest {
  ids: string[];
  include_private?: boolean;
  compact?: boolean;
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
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
  | "part_of"
  /** S78-D02: (A, B, 'supersedes') = "A supersedes B" — B は A によって古くなった */
  | "supersedes";

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
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID */
  team_id?: string;
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

/** §78-E04: Procedural skill synthesis — skill step */
export interface SkillStep {
  order: number;
  summary: string;
  obs_id: string;
}

/** §78-E04: Procedural skill synthesis — skill suggestion produced by finalize_session */
export interface SkillSuggestion {
  title: string;
  steps: SkillStep[];
  tools_used: string[];
  estimated_duration_min: number;
  source_session_id: string;
  created_at: string;
}

export interface FinalizeSessionRequest {
  platform?: Platform | string;
  project?: string;
  session_id: string;
  correlation_id?: string;
  summary_mode?: "standard" | "short" | "detailed";
  /**
   * §78-E04: If true, persist the detected skill as an observation with
   * tags ["skill", "procedural"]. Defaults to false (suggestion only).
   */
  persist_skill?: boolean;
  /**
   * §91-001 (XR-004): If true, perform a partial finalize — generate a
   * session_summary observation with metadata.is_partial=true but keep
   * the session status active (do not set ended_at). Idempotent when
   * called on an already-closed session (no-op, 200 response).
   * Defaults to false (full finalize, existing behavior).
   */
  partial?: boolean;
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

/** S74-004: Fact History — fact_key の時系列変遷エントリ */
export interface FactHistoryEntry {
  fact_id: string;
  fact_type: string;
  fact_key: string;
  fact_value: string;
  confidence: number;
  valid_from: string | null;
  valid_to: string | null;
  superseded_by: string | null;
  is_active: boolean;
  created_at: string;
}

/** S74-004: Fact History リクエスト */
export interface FactHistoryRequest {
  fact_key: string;
  project?: string;
  limit?: number;
  /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID (factsMode: 認証のみ) */
  user_id?: string;
  /** TEAM-005: member ロール適用 — アクセス制御用チームID (factsMode: 認証のみ) */
  team_id?: string;
}

/** S74-005: Code Provenance メタデータ — tool_use イベントから抽出されるファイル変更情報 */
export interface CodeProvenance {
  file_path: string;
  action: "create" | "edit" | "delete" | "read";
  lines_changed?: [number, number][];  // [[start, end], ...]
  model_id?: string;  // e.g. "anthropic/claude-opus-4-6"
  language?: string;   // file extension or detected language
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
  /** §91-002 (XR-004): 定期 partial finalize scheduler を有効にするか (既定 false = opt-in) */
  partialFinalizeEnabled?: boolean;
  /** §91-002 (XR-004): scheduler の tick 間隔 ms (既定 300000 = 5 分) */
  partialFinalizeIntervalMs?: number;
}
