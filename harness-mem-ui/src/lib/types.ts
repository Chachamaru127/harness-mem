export type UiTheme = "light" | "dark" | "system";
export type UiLanguage = "en" | "ja";
export type UiTab = "feed" | "search" | "observation" | "session";
export type UiPlatformFilter = "__all__" | "claude" | "codex" | "opencode";

export interface UiSettings {
  includePrivate: boolean;
  selectedProject: string;
  projectAutoPinned: boolean;
  platformFilter: UiPlatformFilter;
  compactFeed: boolean;
  pageSize: number;
  autoScroll: boolean;
  theme: UiTheme;
  language: UiLanguage;
  activeTab: UiTab;
}

export interface UiContext {
  ok: boolean;
  default_project: string | null;
}

export interface FeedItem {
  id: string;
  event_id?: string;
  platform?: string;
  project?: string;
  session_id?: string;
  event_type?: string;
  card_type?: string;
  title?: string;
  content?: string;
  created_at?: string;
  tags?: string[];
  privacy_tags?: string[];
}

export interface ProjectsStatsItem {
  project: string;
  observations: number;
  sessions: number;
  updated_at: string | null;
}

export interface SessionListItem {
  session_id: string;
  platform: string;
  project: string;
  started_at?: string;
  ended_at?: string;
  updated_at?: string;
  last_event_at?: string;
  summary?: string;
  summary_mode?: string;
  counts?: {
    observations: number;
    prompts: number;
    tools: number;
    checkpoints: number;
    summaries: number;
  };
}

export interface SessionThreadItem {
  step: number;
  id: string;
  event_id?: string;
  event_type: string;
  title?: string;
  content?: string;
  created_at?: string;
  project?: string;
  session_id?: string;
  tags?: string[];
  privacy_tags?: string[];
}

export interface SearchFacetsItem {
  query: string | null;
  total_candidates: number;
  projects: Array<{ value: string; count: number }>;
  event_types: Array<{ value: string; count: number }>;
  tags: Array<{ value: string; count: number }>;
  time_buckets: Array<{ value: string; count: number }>;
}

export interface ApiResponse<T> {
  ok: boolean;
  source: "core" | "merged";
  items: T[];
  meta: {
    count: number;
    latency_ms: number;
    filters: Record<string, unknown>;
    ranking: string;
    next_cursor?: string | null;
    [key: string]: unknown;
  };
  error?: string;
}

export interface SseUiEvent<T = Record<string, unknown>> {
  event: string;
  data: T;
}
