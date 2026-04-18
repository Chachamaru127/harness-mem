/**
 * observation-store.ts
 *
 * 観察ストアモジュール。
 * HarnessMemCore から分割された観察・検索責務を担う。
 *
 * 担当 API:
 *   - search (ハイブリッド検索: lexical + vector + graph + recency + tag + importance)
 *   - feed
 *   - searchFacets
 *   - timeline
 *   - getObservations
 */

import { createHash } from "node:crypto";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { computeJapaneseEnsembleWeight } from "../embedding/adaptive-config";
import { expandQuery } from "../embedding/query-expander";
import { buildTokenEstimateMeta, estimateTokenCount } from "../utils/token-estimate";
import { getDecayTier, getDecayMultiplier } from "./adaptive-decay.js";
import { expandObservationsViaGraph, computeQueryEntityProximity } from "./graph-reasoner.js";
import { routeQuery, type AnswerHints, type RouteDecision, type TemporalAnchor } from "../retrieval/router";
import { compileAnswer } from "../answer/compiler";
import { extractCurrentValueSpan } from "./current-value-compression";
import {
  buildVisibleInteractionText,
  hasIgnoredVisibleTag,
  isIgnoredVisiblePromptText,
  isIgnoredVisibleResponseText,
} from "./interaction-visibility";
import { buildProjectProfile, buildWakeUpContext } from "./project-profile";
import type { Reranker, RerankInputItem, RerankOutputItem } from "../rerank/types";
import {
  getSqliteVecMapTableName,
  getSqliteVecTableName,
  type VectorEngine,
} from "../vector/providers";
import { type AccessFilter } from "../auth/access-control";
import type { IObservationRepository } from "../db/repositories/IObservationRepository.js";
import type {
  ApiResponse,
  Config,
  FeedRequest,
  GetObservationsRequest,
  ResumePackRequest,
  SearchFacetsRequest,
  SearchRequest,
  TimelineRequest,
} from "./types.js";
import {
  buildSearchTokens,
  buildFtsQuery,
  clampLimit,
  cosineSimilarity,
  EVENT_TYPE_IMPORTANCE,
  hasPrivateVisibilityTag,
  isPrivateTag,
  loadObservations,
  makeErrorResponse,
  makeResponse,
  normalizeScoreMap,
  normalizeVectorDimension,
  normalizeWeights,
  nowIso,
  parseArrayJson,
  generateSearchReason,
  recencyScore,
  visibilityFilterSql,
  type RankingWeights,
  type SearchCandidate,
  type VectorSearchResult,
} from "./core-utils.js";

// ---------------------------------------------------------------------------
// S58-002: no_memory 判定閾値
// top1 の finalScore がこの値未満の場合は `no_memory: true` を返す
// ---------------------------------------------------------------------------
const NO_MEMORY_SCORE_THRESHOLD = 0.1;

// ---------------------------------------------------------------------------
// ObservationStoreDeps: HarnessMemCore から渡される内部依存
// ---------------------------------------------------------------------------

export interface ObservationStoreDeps {
  db: Database;
  /** 観察 CRUD のための Repository（基本操作を DB 直接アクセスから分離） */
  repo: IObservationRepository;
  config: Config;
  ftsEnabled: boolean;
  /** normalizeProjectInput のバインド済みバージョン */
  normalizeProject: (project: string) => string;
  /** raw project を UI 用 canonical 名へ変換 */
  canonicalizeProject: (project: string) => string;
  /** canonical project 選択を raw member projects へ展開 */
  expandProjectSelection: (project: string, scope?: "observations" | "sessions") => string[];
  /** platformVisibilityFilterSql のバインド済みバージョン */
  platformVisibilityFilterSql: (alias: string) => string;
  /** writeAuditLog のバインド済みバージョン */
  writeAuditLog: (
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown>
  ) => void;
  // ---- vector 検索に必要な依存 ----
  getVectorEngine: () => VectorEngine;
  getVectorModelVersion: () => string;
  vectorDimension: number;
  getVecTableReady: () => boolean;
  setVecTableReady: (value: boolean) => void;
  /** embeddingProvider.embed() のバインド済みバージョン */
  embedContent: (content: string) => number[];
  /** adaptive 用の検索ベクトル計画。未指定時は embedContent にフォールバック */
  buildQueryEmbeddings?: (content: string) => {
    route: "ruri" | "openai" | "ensemble" | null;
    analysis: { jaRatio: number } | null;
    primary: { model: string; vector: number[] };
    secondary: { model: string; vector: number[] } | null;
  };
  refreshEmbeddingHealth: () => void;
  getEmbeddingProviderName: () => string;
  embeddingProviderModel: string;
  getEmbeddingHealthStatus: () => string;
  // ---- reranker ----
  getRerankerEnabled: () => boolean;
  getReranker: () => Reranker | null;
  // ---- managed backend shadow read ----
  managedShadowRead:
    | ((
        query: string,
        ids: string[],
        opts: { project: string | undefined; limit: number }
      ) => Promise<void>)
    | null;
  // ---- search config ----
  searchRanking: string;
  searchExpandLinks: boolean;
  /** アクセス制御フィルタ（TEAM-005）。未設定時は全許可 */
  accessFilter?: AccessFilter;
}

// ---------------------------------------------------------------------------
// ユーティリティ（このモジュール内でのみ使用）
// ---------------------------------------------------------------------------

function escapeLikePattern(input: string): string {
  return input.replace(/([\\%_])/g, "\\$1");
}

function collapseWhitespace(input: string | null | undefined, maxLength: number): string {
  if (!input) return "";
  return input.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function compactTextBlock(input: string | null | undefined, maxLength: number): string {
  if (!input) return "";
  return input.replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function extractMarkdownSectionItems(
  markdown: string | null | undefined,
  sectionTitle: string,
  maxItems: number
): string[] {
  if (!markdown) return [];

  const items: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let inSection = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^##\s+/.test(trimmed)) {
      inSection = trimmed.toLowerCase() === `## ${sectionTitle.toLowerCase()}`;
      continue;
    }
    if (!inSection || !trimmed.startsWith("- ")) {
      continue;
    }
    let item = collapseWhitespace(trimmed.slice(2), 180);
    if (!item || /^no /i.test(item) || /^not captured/i.test(item) || isNoisyContinuityWrapper(item)) {
      continue;
    }
    item = stripContinuityWrapperPrefix(item);
    if (!item || /^no /i.test(item) || /^not captured/i.test(item) || /^\{/.test(item)) {
      continue;
    }
    if (!items.includes(item)) {
      items.push(item);
    }
    if (items.length >= maxItems) {
      break;
    }
  }

  return items;
}

function extractMarkdownSectionBody(
  markdown: string | null | undefined,
  sectionTitle: string,
  maxLength: number
): string {
  if (!markdown) return "";

  const lines: string[] = [];
  const targetHeading = `## ${sectionTitle.toLowerCase()}`;
  let inSection = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (/^##\s+/.test(trimmed)) {
      if (inSection) break;
      inSection = trimmed.toLowerCase() === targetHeading;
      continue;
    }
    if (!inSection || !trimmed) {
      continue;
    }
    if (isNoisyContinuityWrapper(trimmed)) {
      continue;
    }
    const cleaned = stripContinuityWrapperPrefix(trimmed);
    if (!cleaned || /^\{/.test(cleaned)) {
      continue;
    }
    lines.push(cleaned);
  }

  return collapseWhitespace(lines.join(" "), maxLength);
}

function stripContinuityWrapperPrefix(line: string | null | undefined): string {
  const normalized = collapseWhitespace(line, 260);
  return normalized.replace(/^(?:assistant_response|user_prompt)\s*:\s*/i, "").trim();
}

function isNoisyContinuityWrapper(line: string | null | undefined): boolean {
  const normalized = collapseWhitespace(line, 260).toLowerCase();
  if (!normalized) return true;
  return (
    normalized.startsWith("session_start:") ||
    normalized.startsWith("session_end:") ||
    normalized.startsWith("continuity_handoff:") ||
    normalized.startsWith("assistant_response:") ||
    normalized.startsWith("user_prompt:")
  );
}

function buildCarryForwardLines(summary: string | null | undefined): string[] {
  if (!summary) return [];

  const lines: string[] = [];
  const pushWithLabel = (label: string, values: string[]) => {
    for (const value of values) {
      const item = `${label}: ${value}`;
      if (!lines.includes(item)) {
        lines.push(item);
      }
      if (lines.length >= 4) {
        return;
      }
    }
  };

  pushWithLabel("Decision", extractMarkdownSectionItems(summary, "Decisions", 2));
  if (lines.length < 4) {
    pushWithLabel("Next Action", extractMarkdownSectionItems(summary, "Next Actions", 2));
  }
  if (lines.length < 4) {
    pushWithLabel("Open Loop", extractMarkdownSectionItems(summary, "Open Loops", 1));
  }
  if (lines.length < 4) {
    pushWithLabel("Risk", extractMarkdownSectionItems(summary, "Risks", 1));
  }
  if (lines.length < 4) {
    pushWithLabel("Key Point", extractMarkdownSectionItems(summary, "Key Points", 2));
  }

  return lines.slice(0, 4);
}

function buildRecentUpdateLines(summary: string | null | undefined): string[] {
  if (!summary) return [];
  const lines: string[] = [];
  const pushWithLabel = (label: string, values: string[]) => {
    for (const value of values) {
      const item = `${label}: ${value}`;
      if (!lines.includes(item)) {
        lines.push(item);
      }
      if (lines.length >= 3) {
        return;
      }
    }
  };

  pushWithLabel("Decision", extractMarkdownSectionItems(summary, "Decisions", 2));
  if (lines.length < 3) {
    pushWithLabel("Next Action", extractMarkdownSectionItems(summary, "Next Actions", 2));
  }
  if (lines.length < 3) {
    pushWithLabel("Open Loop", extractMarkdownSectionItems(summary, "Open Loops", 1));
  }
  if (lines.length < 3) {
    pushWithLabel("Risk", extractMarkdownSectionItems(summary, "Risks", 1));
  }

  return lines.slice(0, 3);
}

function subtractContinuityLines(lines: string[], excluded: string[]): string[] {
  if (excluded.length === 0) return lines.slice();
  const excludedSet = new Set(excluded.map((line) => collapseWhitespace(line, 220).toLowerCase()));
  return lines.filter((line) => !excludedSet.has(collapseWhitespace(line, 220).toLowerCase()));
}

type ContinuitySectionKey = "problems" | "decisions" | "open_loops" | "next_actions" | "risks";

interface ContinuitySections {
  problems: string[];
  decisions: string[];
  open_loops: string[];
  next_actions: string[];
  risks: string[];
}

const CONTINUITY_SCOPE_GUARD_PATTERN =
  /\b(out of scope|not the main thread|not the focus|do not mix|avoid mixing)\b|(本筋ではない|スコープ外|混ぜない|対象外)/i;

function normalizeContinuityBulletContent(line: string, maxLength: number): string {
  return line
    .replace(/^(?:[-*+]|(?:\d+[.)]))\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isContinuityPlaceholder(line: string): boolean {
  return /^(?:no |not captured|none\b|なし\b|未記載\b|未設定\b)/i.test(line);
}

function classifyContinuitySection(line: string): { key: ContinuitySectionKey; value: string } | null {
  const trimmed = line.trim();
  const prefix = "(?:(?:[-*+]\\s*)|(?:(?:\\d+)[.)]\\s*))?";
  const patterns: Array<{ key: ContinuitySectionKey; pattern: RegExp }> = [
    {
      key: "problems",
      pattern: new RegExp(`^(?:#+\\s*)?${prefix}(?:problem|problems|issue|issues|問題|課題)\\s*[:：]?\\s*(.*)$`, "i"),
    },
    {
      key: "decisions",
      pattern: new RegExp(`^(?:#+\\s*)?${prefix}(?:decision|decisions|決定|方針)\\s*[:：]?\\s*(.*)$`, "i"),
    },
    {
      key: "open_loops",
      pattern: new RegExp(
        `^(?:#+\\s*)?${prefix}(?:open loops?|open questions?|unresolved|pending|保留|未解決|確認事項)\\s*[:：]?\\s*(.*)$`,
        "i"
      ),
    },
    {
      key: "next_actions",
      pattern: new RegExp(
        `^(?:#+\\s*)?${prefix}(?:next actions?|next steps?|next step|next action|todo|todos|次アクション|次の対応|次対応|次にやるべきこと|残件)\\s*[:：]?\\s*(.*)$`,
        "i"
      ),
    },
    {
      key: "risks",
      pattern: new RegExp(`^(?:#+\\s*)?${prefix}(?:risk|risks|懸念|リスク)\\s*[:：]?\\s*(.*)$`, "i"),
    },
  ];

  for (const entry of patterns) {
    const match = trimmed.match(entry.pattern);
    if (match) {
      return { key: entry.key, value: normalizeContinuityBulletContent(match[1] || "", 220) };
    }
  }
  return null;
}

function parseContinuitySections(text: string | null | undefined, maxItems: number): ContinuitySections {
  const sections: ContinuitySections = {
    problems: [],
    decisions: [],
    open_loops: [],
    next_actions: [],
    risks: [],
  };
  if (!text) return sections;

  let currentSection: ContinuitySectionKey | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const explicitSection = classifyContinuitySection(trimmed);
    if (explicitSection) {
      currentSection = explicitSection.key;
      if (explicitSection.value && !isContinuityPlaceholder(explicitSection.value)) {
        if (!sections[currentSection].includes(explicitSection.value) && sections[currentSection].length < maxItems) {
          sections[currentSection].push(explicitSection.value);
        }
      }
      continue;
    }

    if (!currentSection) continue;
    const value = normalizeContinuityBulletContent(trimmed, 220);
    if (!value || isContinuityPlaceholder(value)) continue;
    if (!sections[currentSection].includes(value) && sections[currentSection].length < maxItems) {
      sections[currentSection].push(value);
    }
  }

  return sections;
}

function buildPinnedCarryForwardLines(text: string | null | undefined): string[] {
  const sections = parseContinuitySections(text, 2);
  const lines: string[] = [];
  const push = (label: string, values: string[]) => {
    for (const value of values) {
      const entry = `${label}: ${value}`;
      if (!lines.includes(entry)) {
        lines.push(entry);
      }
      if (lines.length >= 5) return;
    }
  };

  push("Problem", sections.problems);
  if (lines.length < 5) push("Decision", sections.decisions);
  if (lines.length < 5) push("Next Action", sections.next_actions.filter((value) => !CONTINUITY_SCOPE_GUARD_PATTERN.test(value)));
  if (lines.length < 5) push("Open Loop", sections.open_loops);
  if (lines.length < 5) push("Risk", sections.risks);
  return lines;
}

function shouldIncludeBriefingAnchor(
  item: Record<string, unknown>,
  pinnedContinuityPresent: boolean
): boolean {
  const title = collapseWhitespace(
    typeof item.title === "string" ? item.title : typeof item.id === "string" ? item.id : "",
    80
  );
  const content = collapseWhitespace(
    typeof item.content === "string"
      ? item.content
      : typeof item.summary === "string"
        ? item.summary
        : "",
    220
  );

  if (!title && !content) return false;
  if (isNoisyContinuityWrapper(title) || isNoisyContinuityWrapper(`${title}: ${content}`) || isNoisyContinuityWrapper(content)) {
    return false;
  }

  const normalizedTitle = title.trim().toLowerCase();
  if (normalizedTitle === "session_start" || normalizedTitle === "session_end" || normalizedTitle === "continuity_handoff") {
    return false;
  }
  if (pinnedContinuityPresent && normalizedTitle === "assistant_response") {
    return false;
  }

  const visibleText = buildVisibleInteractionText(title, content);
  if (hasIgnoredVisibleTag(Array.isArray(item.tags) ? (item.tags as string[]) : []) ||
    isIgnoredVisiblePromptText(visibleText) ||
    isIgnoredVisibleResponseText(content)) {
    return false;
  }

  return true;
}

interface FeedCursor {
  created_at: string;
  id: string;
}

interface ActiveFactRow {
  observation_id: string;
  fact_type: string;
  fact_key: string;
  fact_value: string;
  confidence: number;
}

interface LatestInteractionObservation {
  id: string;
  event_id: string | null;
  event_type: string;
  platform: string;
  project: string;
  session_id: string;
  title: string | null;
  content: string;
  created_at: string;
  tags: string[];
  privacy_tags: string[];
}

interface LatestInteractionContext {
  scope: "project" | "session" | "chain";
  project: string;
  session_id: string;
  platform: string;
  latest_turn_at: string;
  incomplete: boolean;
  prompt: LatestInteractionObservation | null;
  response: LatestInteractionObservation | null;
}

interface LatestCompletedInteraction {
  prompt: LatestInteractionObservation;
  response: LatestInteractionObservation;
}

function buildInteractionSignature(context: LatestInteractionContext | null): string {
  if (!context) return "";
  return collapseWhitespace(
    [
      context.prompt?.content || "",
      context.response?.content || "",
    ]
      .filter(Boolean)
      .join(" || "),
    360
  ).toLowerCase();
}

const RECENT_PROJECT_LOW_SIGNAL_PATTERN =
  /\b(?:running\s+(?:sessionstart|userpromptsubmit|stop)\s+hook|sessionstart hook|userpromptsubmit hook|stop hook|agents\.md|claude\.md|owner repo|impacted repos|cross-repo governance|session-start-checklist|governance bootstrap)\b|^(?:了解しました|現状を確認します|let me check|i(?:'| wi)ll check)\b/i;

function normalizeRecentProjectSnippet(input: string | null | undefined, maxLength: number): string {
  if (!input) return "";
  return collapseWhitespace(
    compactTextBlock(stripContinuityWrapperPrefix(input), maxLength * 2).replace(/\s+/g, " ").trim(),
    maxLength
  );
}

function isLowSignalRecentProjectSnippet(input: string | null | undefined): boolean {
  const normalized = normalizeRecentProjectSnippet(input, 220);
  if (!normalized) return true;
  if (normalized.length < 16) return true;
  if (isNoisyContinuityWrapper(normalized) || CONTINUITY_SCOPE_GUARD_PATTERN.test(normalized)) {
    return true;
  }
  if (/^\{/.test(normalized) || RECENT_PROJECT_LOW_SIGNAL_PATTERN.test(normalized)) {
    return true;
  }
  return false;
}

function buildContinuityBriefingCorpus(markdown: string | null | undefined): string {
  const sectionBodies = [
    extractMarkdownSectionBody(markdown, "Pinned Continuity", 600),
    extractMarkdownSectionBody(markdown, "Carry Forward", 600),
    extractMarkdownSectionBody(markdown, "Recent Update", 600),
    extractMarkdownSectionBody(markdown, "Latest Exchange", 800),
  ].filter(Boolean);
  const combined = sectionBodies.length > 0
    ? sectionBodies.join(" ")
    : collapseWhitespace(markdown, 1600);
  return combined.toLowerCase();
}

function formatRecentProjectContextItem(context: LatestInteractionContext): string {
  const segments: string[] = [];
  const response = normalizeRecentProjectSnippet(context.response?.content, 150);
  const prompt = normalizeRecentProjectSnippet(context.prompt?.content, 120);

  if (!isLowSignalRecentProjectSnippet(response)) {
    segments.push(response);
  }
  if (!isLowSignalRecentProjectSnippet(prompt)) {
    const duplicatePrompt = segments.some((segment) => segment.includes(prompt) || prompt.includes(segment));
    if (!duplicatePrompt) {
      segments.push(prompt);
    }
  } else if (segments.length === 0 && context.incomplete) {
    segments.push("Pending follow-up in this session.");
  }

  return collapseWhitespace(segments.join(" "), 260);
}

function isRecentProjectContextDuplicate(
  context: LatestInteractionContext,
  continuityBriefingCorpus: string
): boolean {
  if (!continuityBriefingCorpus) return false;
  const fragments = [
    normalizeRecentProjectSnippet(context.prompt?.content, 220),
    normalizeRecentProjectSnippet(context.response?.content, 220),
    formatRecentProjectContextItem(context),
    buildInteractionSignature(context),
  ]
    .map((value) => value.toLowerCase())
    .filter((value) => value.length >= 24);
  return fragments.some((fragment) => continuityBriefingCorpus.includes(fragment));
}

function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeFeedCursor(input: string | undefined): FeedCursor | null {
  if (!input) return null;
  try {
    const decoded = Buffer.from(input, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).created_at === "string" &&
      typeof (parsed as Record<string, unknown>).id === "string"
    ) {
      return parsed as FeedCursor;
    }
  } catch {
    // ignore
  }
  return null;
}

// S38-007: temporal 2段階検索を誤爆させないための意図判定（防御的）
const TEMPORAL_INTENT_PATTERN =
  /\b(when|before|after|since|until|during|between|timeline|history|chronolog|first|last|earliest|latest|how long|what year|what month|what date)\b|(の前|の後|以前|以降|最初|最後|直近|最近)/i;
const JAPANESE_CURRENT_PATTERN = /(今|現在|今の|現行|最新|使っている)/;
const JAPANESE_PREVIOUS_PATTERN = /(以前|前の|前回|前は|もともと|元は|最初は|当初|当時|直後|初期|変える前|見直す前|移す前|切り替える前|変更前)/;
const JAPANESE_REASON_PATTERN = /(なぜ|理由|きっかけ|どうして|背景|原因)/;
const JAPANESE_LIST_PATTERN = /(一覧|すべて|全て|挙げて|列挙)/;
const JAPANESE_TEMPORAL_ORDER_PATTERN = /(どちらが先|先に|最後|最初|以前|前回|次に|その後|いつ|何時|変える前|見直す前|移す前|切り替える前|変更前)/;
const CURRENT_CUE_PATTERN = /\b(current|currently|now|latest|active|in use|used now)\b/i;
const CURRENT_SLOT_ONLY_PATTERN = /\b(default|primary)\b/i;
const PREVIOUS_CUE_PATTERN = /\b(previously|formerly|used to|prior|earlier|before)\b/i;
const REASON_CUE_PATTERN = /\b(because|since|due to|reason|caused by|triggered by)\b/i;
const LIST_CUE_PATTERN = /\b(and|all|list|including)\b/i;
const FILLER_CUE_PATTERN = /^(?:ちなみに|なお|ただ|実際には|現時点では|まず|最初に|最後に|That said|Actually|Currently|Right now|At the moment)\b/i;
const LATEST_INTERACTION_CUE_PATTERN =
  /\b(prompt|response|reply|answer|conversation|thread|exchange|recent work|latest work|last work|what happened recently|what happened last)\b|(プロンプト|回答|返答|会話|やり取り|直近の作業|最近の作業|最後の作業)/i;
const GENERIC_RECENT_QUERY_PATTERN =
  /^(?:直近|最近|最後|latest|recent|last)(?:\s*(?:を|の|について|見て|調べて|教えて|show|check|tell me).*)?$/i;
const SESSION_PROGRESS_QUERY_PATTERN =
  /\b(last step|final step|latest step|most recent step|where did .* leave off|how far .* progress)\b|(どこまで進んだ|最後のステップ|最後に何をした|前回.*どこまで|進捗)/i;

function hasTemporalIntent(query: string): boolean {
  return TEMPORAL_INTENT_PATTERN.test(query);
}

function hasPreviousValueIntent(query: string): boolean {
  return PREVIOUS_CUE_PATTERN.test(query) || JAPANESE_PREVIOUS_PATTERN.test(query);
}

function hasSpecificTemporalAnswerCue(query: string): boolean {
  if (hasPreviousValueIntent(query)) {
    return true;
  }
  return /\b(first|last|before|after|since|until|when|what year|what month|what date|earliest|latest)\b/i.test(query) ||
    /(どちらが先|先に|最後|最初|いつ|何時|その後|あとで|後で|直後|の前|の後|以前|以降)/.test(query);
}

function prefersDescendingTemporalOrder(query: string): boolean {
  const normalized = query.toLowerCase();
  if (/\b(first|earliest|before|prior to|until|initial|initially|start|starting|beginning)\b/.test(normalized)) {
    return false;
  }
  if (/(最初|以前|の前|開始|初回)/.test(query)) {
    return false;
  }
  return /\b(last|latest|newest|most recent|recent|current|currently)\b/.test(normalized) || /(最後|最新|直近|最近)/.test(query);
}

function compareCreatedAt(lhs: string | null | undefined, rhs: string | null | undefined): number {
  return String(lhs || "").localeCompare(String(rhs || ""));
}

function isLatestInteractionIntent(query: string): boolean {
  const normalized = query.trim();
  if (!normalized) return false;
  return GENERIC_RECENT_QUERY_PATTERN.test(normalized) || LATEST_INTERACTION_CUE_PATTERN.test(normalized);
}

function hasSessionProgressIntent(query: string): boolean {
  const normalized = query.trim();
  if (!normalized) return false;
  return SESSION_PROGRESS_QUERY_PATTERN.test(normalized);
}

function isIgnoredLatestInteractionPrompt(observation: LatestInteractionObservation): boolean {
  return hasIgnoredVisibleTag(observation.tags) ||
    isIgnoredVisiblePromptText(observation.content) ||
    isIgnoredVisiblePromptText(buildVisibleInteractionText(observation.title, observation.content));
}

function isIgnoredLatestInteractionResponse(observation: LatestInteractionObservation): boolean {
  return hasIgnoredVisibleTag(observation.tags) || isIgnoredVisibleResponseText(observation.content);
}

function hasCurrentValueCue(text: string): boolean {
  if (!text.trim()) return false;
  if (CURRENT_CUE_PATTERN.test(text) || JAPANESE_CURRENT_PATTERN.test(text)) {
    return true;
  }
  const hasSlotOnlyCue = CURRENT_SLOT_ONLY_PATTERN.test(text);
  if (!hasSlotOnlyCue) {
    return false;
  }
  return !(PREVIOUS_CUE_PATTERN.test(text) || JAPANESE_PREVIOUS_PATTERN.test(text));
}

// ---------------------------------------------------------------------------
// ObservationStore クラス
// ---------------------------------------------------------------------------

export class ObservationStore {
  private migrationComplete = false;

  constructor(private readonly deps: ObservationStoreDeps) {}

  private resolveProjectMembers(project: string | undefined, scope: "observations" | "sessions" = "observations"): string[] {
    if (typeof project !== "string" || !project.trim()) {
      return [];
    }
    const expanded = this.deps.expandProjectSelection(project, scope)
      .map((value) => value.trim())
      .filter(Boolean);
    if (expanded.length > 0) {
      return [...new Set(expanded)];
    }
    return [this.deps.normalizeProject(project)];
  }

  private appendProjectFilter(sql: string, params: unknown[], alias: string, projects: string[]): string {
    if (projects.length === 0) {
      return sql;
    }
    if (projects.length === 1) {
      params.push(projects[0]);
      return `${sql} AND ${alias}.project = ?`;
    }
    const placeholders = projects.map(() => "?").join(", ");
    params.push(...projects);
    return `${sql} AND ${alias}.project IN (${placeholders})`;
  }

  private queryLatestInteractionObservations(options: {
    projects?: string[];
    session_id?: string;
    exclude_session_id?: string;
    correlation_id?: string;
    include_private: boolean;
    user_id?: string;
    team_id?: string;
    limit?: number;
  }): LatestInteractionObservation[] {
    const params: unknown[] = [];
    let sql = `
      SELECT
        o.id,
        o.event_id,
        o.platform,
        o.project,
        o.session_id,
        o.title,
        o.content_redacted,
        o.tags_json,
        o.privacy_tags_json,
        o.created_at,
        e.event_type
      FROM mem_observations o
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE 1 = 1
    `;

    if (options.correlation_id) {
      sql = sql.replace(
        "LEFT JOIN mem_events e ON e.event_id = o.event_id",
        "JOIN mem_sessions s ON s.session_id = o.session_id\n      LEFT JOIN mem_events e ON e.event_id = o.event_id"
      );
    }

    sql = this.appendProjectFilter(sql, params, "o", options.projects || []);
    if (options.session_id) {
      sql += " AND o.session_id = ?";
      params.push(options.session_id);
    } else if (options.exclude_session_id) {
      sql += " AND o.session_id <> ?";
      params.push(options.exclude_session_id);
    }
    if (options.correlation_id) {
      sql += " AND s.correlation_id = ?";
      params.push(options.correlation_id);
    }

    sql += this.deps.platformVisibilityFilterSql("o");
    sql += visibilityFilterSql("o", options.include_private);

    if (options.user_id) {
      if (options.team_id) {
        sql += " AND (o.user_id = ? OR o.team_id = ?)";
        params.push(options.user_id, options.team_id);
      } else {
        sql += " AND o.user_id = ?";
        params.push(options.user_id);
      }
    }

    sql += `
      AND (
        e.event_type = 'user_prompt'
        OR (e.event_type = 'checkpoint' AND o.title = 'assistant_response')
      )
    `;

    const limit = Math.max(20, Math.min(options.limit ?? 400, 1000));
    sql += " ORDER BY o.created_at DESC, o.id DESC LIMIT ?";
    params.push(limit);

    const rows = this.deps.db.query(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id || ""),
      event_id: typeof row.event_id === "string" ? row.event_id : null,
      event_type: typeof row.event_type === "string" ? row.event_type : "",
      platform: typeof row.platform === "string" ? row.platform : "",
      project: typeof row.project === "string" ? row.project : "",
      session_id: typeof row.session_id === "string" ? row.session_id : "",
      title: typeof row.title === "string" ? row.title : null,
      content: typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 2000) : "",
      created_at: typeof row.created_at === "string" ? row.created_at : nowIso(),
      tags: parseArrayJson(row.tags_json),
      privacy_tags: parseArrayJson(row.privacy_tags_json),
    }));
  }

  private collectLatestInteractionContexts(
    candidates: LatestInteractionObservation[],
    scope: LatestInteractionContext["scope"]
  ): LatestInteractionContext[] {
    if (candidates.length === 0) {
      return [];
    }

    const bySession = new Map<string, LatestInteractionObservation[]>();
    for (const candidate of candidates) {
      const sessionRows = bySession.get(candidate.session_id) || [];
      sessionRows.push(candidate);
      bySession.set(candidate.session_id, sessionRows);
    }

    const contexts: LatestInteractionContext[] = [];

    for (const sessionRows of bySession.values()) {
      const chronological = [...sessionRows].sort((lhs, rhs) => {
        const byTime = compareCreatedAt(lhs.created_at, rhs.created_at);
        if (byTime !== 0) return byTime;
        return lhs.id.localeCompare(rhs.id);
      });

      let currentPrompt: LatestInteractionObservation | null = null;
      let sessionLatestCompleted: LatestCompletedInteraction | null = null;

      for (const row of chronological) {
        if (row.event_type === "user_prompt") {
          if (isIgnoredLatestInteractionPrompt(row)) {
            continue;
          }
          currentPrompt = row;
          continue;
        }

        if (row.title !== "assistant_response" || isIgnoredLatestInteractionResponse(row)) {
          continue;
        }

        if (!currentPrompt) {
          continue;
        }

        if (compareCreatedAt(row.created_at, currentPrompt.created_at) < 0) {
          continue;
        }

        sessionLatestCompleted = {
          prompt: currentPrompt,
          response: row,
        };
      }

      if (sessionLatestCompleted) {
        contexts.push({
          scope,
          project: this.deps.canonicalizeProject(sessionLatestCompleted.response.project),
          session_id: sessionLatestCompleted.response.session_id,
          platform: sessionLatestCompleted.response.platform,
          latest_turn_at: sessionLatestCompleted.response.created_at,
          incomplete: false,
          prompt: sessionLatestCompleted.prompt,
          response: sessionLatestCompleted.response,
        });
        continue;
      }

      if (currentPrompt) {
        contexts.push({
          scope,
          project: this.deps.canonicalizeProject(currentPrompt.project),
          session_id: currentPrompt.session_id,
          platform: currentPrompt.platform,
          latest_turn_at: currentPrompt.created_at,
          incomplete: true,
          prompt: currentPrompt,
          response: null,
        });
      }
    }

    contexts.sort((lhs, rhs) => {
      const byTime = compareCreatedAt(rhs.latest_turn_at, lhs.latest_turn_at);
      if (byTime !== 0) return byTime;
      return lhs.session_id.localeCompare(rhs.session_id);
    });
    return contexts;
  }

  private selectLatestInteractionContext(
    candidates: LatestInteractionObservation[],
    scope: LatestInteractionContext["scope"]
  ): LatestInteractionContext | null {
    const contexts = this.collectLatestInteractionContexts(candidates, scope);
    return contexts[0] ?? null;
  }

  private getLatestInteractionContext(request: SearchRequest, projectMembers: string[] = [], scanLimit?: number): LatestInteractionContext | null {
    if (projectMembers.length === 0 && !request.session_id) {
      return null;
    }

    const includePrivate = Boolean(request.include_private);
    const userId = typeof request.user_id === "string" && request.user_id.trim()
      ? request.user_id.trim()
      : undefined;
    const teamId = typeof request.team_id === "string" && request.team_id.trim()
      ? request.team_id.trim()
      : undefined;
    const scope: "project" | "session" = request.session_id ? "session" : "project";
    const candidates = this.queryLatestInteractionObservations({
      projects: projectMembers,
      session_id: request.session_id,
      include_private: includePrivate,
      user_id: userId,
      team_id: teamId,
      limit: scanLimit,
    });
    return this.selectLatestInteractionContext(candidates, scope);
  }

  private getResumeInteractionContext(
    request: ResumePackRequest,
    projectMembers: string[] = [],
    scanLimit?: number
  ): LatestInteractionContext | null {
    if (projectMembers.length === 0) {
      return null;
    }

    const candidates = this.queryLatestInteractionObservations({
      projects: projectMembers,
      exclude_session_id: request.session_id,
      correlation_id: request.correlation_id,
      include_private: Boolean(request.include_private),
      limit: scanLimit,
    });

    return this.selectLatestInteractionContext(candidates, request.correlation_id ? "chain" : "project");
  }

  private listChainSessionIds(correlationId: string | null, projectMembers: string[] = []): Set<string> {
    if (!correlationId) return new Set();
    const params: unknown[] = [];
    let sql = `
      SELECT s.session_id
      FROM mem_sessions s
      WHERE s.correlation_id = ?
    `;
    params.push(correlationId);
    sql = this.appendProjectFilter(sql, params, "s", projectMembers);
    const rows = this.deps.db.query(sql).all(...(params as any[])) as Array<{ session_id?: string }>;
    return new Set(
      rows
        .map((row) => (typeof row.session_id === "string" ? row.session_id : ""))
        .filter((sessionId) => sessionId.length > 0)
    );
  }

  private buildLatestInteractionMeta(context: LatestInteractionContext | null): Record<string, unknown> | null {
    if (!context) return null;

    const serializeObservation = (observation: LatestInteractionObservation | null): Record<string, unknown> | null => {
      if (!observation) return null;
      return {
        id: observation.id,
        event_id: observation.event_id,
        created_at: observation.created_at,
        title: observation.title,
        content: observation.content,
        platform: observation.platform,
        project: observation.project,
        session_id: observation.session_id,
      };
    };

    return {
      scope: context.scope,
      project: context.project,
      session_id: context.session_id,
      platform: context.platform,
      latest_turn_at: context.latest_turn_at,
      incomplete: context.incomplete,
      prompt: serializeObservation(context.prompt),
      response: serializeObservation(context.response),
    };
  }

  private buildRecentProjectContext(options: {
    request: ResumePackRequest;
    projectMembers: string[];
    latestInteraction: LatestInteractionContext | null;
    pinnedContinuity: { session_id: string; content: string; created_at: string } | null;
    continuityBriefing: Record<string, unknown> | null;
  }): Record<string, unknown> | null {
    const { request, projectMembers, latestInteraction, pinnedContinuity, continuityBriefing } = options;
    if (projectMembers.length === 0) {
      return null;
    }

    const candidates = this.queryLatestInteractionObservations({
      projects: projectMembers,
      exclude_session_id: request.session_id,
      include_private: Boolean(request.include_private),
      limit: 120,
    });
    const contexts = this.collectLatestInteractionContexts(candidates, "project");
    if (contexts.length === 0) {
      return null;
    }

    const excludedSessions = new Set<string>();
    if (request.session_id) excludedSessions.add(request.session_id);
    if (latestInteraction?.session_id) excludedSessions.add(latestInteraction.session_id);
    if (pinnedContinuity?.session_id) excludedSessions.add(pinnedContinuity.session_id);
    for (const sessionId of this.listChainSessionIds(request.correlation_id ?? null, projectMembers)) {
      excludedSessions.add(sessionId);
    }

    const primarySignature = buildInteractionSignature(latestInteraction);
    const continuityBriefingCorpus = buildContinuityBriefingCorpus(
      typeof continuityBriefing?.content === "string" ? continuityBriefing.content : ""
    );
    const seen = new Set<string>();
    const bullets: string[] = [];
    const sessionIds: string[] = [];
    let latestTurnAt: string | null = null;

    for (const context of contexts) {
      if (excludedSessions.has(context.session_id)) {
        continue;
      }

      const bullet = formatRecentProjectContextItem(context);
      if (!bullet) {
        continue;
      }

      const normalized = collapseWhitespace(bullet, 260).toLowerCase();
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      const signature = buildInteractionSignature(context);
      if (primarySignature && signature && signature === primarySignature) {
        continue;
      }
      if (isRecentProjectContextDuplicate(context, continuityBriefingCorpus)) {
        continue;
      }

      seen.add(normalized);
      bullets.push(`- ${bullet}`);
      sessionIds.push(context.session_id);
      if (!latestTurnAt || compareCreatedAt(context.latest_turn_at, latestTurnAt) > 0) {
        latestTurnAt = context.latest_turn_at;
      }

      if (bullets.length >= 3) {
        break;
      }
    }

    if (bullets.length === 0) {
      return null;
    }

    return {
      content: ["## Also Recently in This Project", ...bullets].join("\n"),
      cache_hint: "volatile",
      source_scope: "project",
      item_count: bullets.length,
      source_session_ids: sessionIds,
      latest_turn_at: latestTurnAt,
    };
  }

  private buildContinuityBriefing(options: {
    correlationId: string | null;
    latestSummary: { session_id: string; summary: string; ended_at: string } | null;
    latestInteraction: LatestInteractionContext | null;
    pinnedContinuity: { session_id: string; content: string; created_at: string } | null;
    detailedItems: Array<Record<string, unknown>>;
    compactItems: Array<Record<string, unknown>>;
  }): Record<string, unknown> | null {
    const { correlationId, latestSummary, latestInteraction, pinnedContinuity, detailedItems, compactItems } = options;
    const anchorItems = [...detailedItems.slice(0, 3), ...compactItems.slice(0, 2)];
    if (!latestSummary && !latestInteraction && !pinnedContinuity && anchorItems.length === 0) {
      return null;
    }

    const sourceScope = latestInteraction?.scope ?? (correlationId ? "chain" : "project");
    const sourceSessionId = latestInteraction?.session_id ?? latestSummary?.session_id ?? pinnedContinuity?.session_id ?? null;
    const latestTurnAt = latestInteraction?.latest_turn_at ?? latestSummary?.ended_at ?? pinnedContinuity?.created_at ?? null;
    const lines: string[] = ["# Continuity Briefing"];

    const pinnedCarryForward = buildPinnedCarryForwardLines(pinnedContinuity?.content);
    const pinnedContinuityPresent = pinnedCarryForward.length > 0;
    if (pinnedCarryForward.length > 0) {
      lines.push("", "## Pinned Continuity");
      for (const line of pinnedCarryForward) {
        lines.push(`- ${line}`);
      }
    }

    lines.push("", "## Current Focus");
    lines.push(`- Resume scope: ${sourceScope}`);
    if (sourceSessionId) {
      lines.push(`- Source session: ${sourceSessionId}`);
    }
    if (latestTurnAt) {
      lines.push(`- Latest turn: ${latestTurnAt}`);
    }
    if (correlationId) {
      lines.push(`- Correlation: ${correlationId}`);
    }

    if (latestSummary) {
      const carryForward = buildCarryForwardLines(latestSummary.summary);
      const summaryKeyPoints = extractMarkdownSectionItems(latestSummary.summary, "Key Points", 3);

      if (pinnedContinuityPresent) {
        const recentUpdate = subtractContinuityLines(
          buildRecentUpdateLines(latestSummary.summary),
          pinnedCarryForward
        ).slice(0, 3);
        if (recentUpdate.length > 0) {
          lines.push("", "## Recent Update");
          for (const updateLine of recentUpdate) {
            lines.push(`- ${updateLine}`);
          }
        }
      } else if (carryForward.length > 0) {
        lines.push("", "## Carry Forward");
        for (const carryLine of carryForward) {
          lines.push(`- ${carryLine}`);
        }
        if (summaryKeyPoints.length > 0) {
          lines.push("", "## Key Points");
          for (const item of summaryKeyPoints) {
            lines.push(`- ${item}`);
          }
        }
        if (carryForward.length === 0 && summaryKeyPoints.length === 0) {
          const overview = extractMarkdownSectionBody(latestSummary.summary, "Overview", 220);
          if (overview) {
            lines.push("", "## Last Session Snapshot", `- ${overview}`);
          } else {
            lines.push("", "## Last Session Summary", compactTextBlock(latestSummary.summary, 400));
          }
        }
      }
    }

    if (latestInteraction?.prompt || latestInteraction?.response) {
      lines.push("", "## Latest Exchange");
      if (latestInteraction.prompt) {
        lines.push(`- User: ${collapseWhitespace(latestInteraction.prompt.content, 280)}`);
      }
      if (latestInteraction.response) {
        lines.push(`- Assistant: ${collapseWhitespace(latestInteraction.response.content, 280)}`);
      } else if (latestInteraction.incomplete) {
        lines.push("- Assistant: no response recorded yet");
      }
    }

    const visibleAnchorItems = pinnedContinuityPresent
      ? []
      : anchorItems
          .filter((item) => shouldIncludeBriefingAnchor(item, pinnedContinuityPresent))
          .slice(0, anchorItems.length);

    if (visibleAnchorItems.length > 0) {
      lines.push("", "## Memory Anchors");
      for (const item of visibleAnchorItems) {
        const title = collapseWhitespace(typeof item.title === "string" ? item.title : String(item.id), 80) || "observation";
        const summary = collapseWhitespace(
          typeof item.content === "string"
            ? item.content
            : typeof item.summary === "string"
              ? item.summary
              : "",
          180
        );
        lines.push(summary ? `- ${title}: ${summary}` : `- ${title}`);
      }
    }

    return {
      content: lines.join("\n"),
      cache_hint: "volatile",
      source_scope: sourceScope,
      source_session_id: sourceSessionId,
      latest_turn_at: latestTurnAt,
      includes_summary: Boolean(latestSummary),
      includes_latest_interaction: Boolean(latestInteraction),
      anchor_count: anchorItems.length,
      cited_item_ids: anchorItems
        .map((item) => (typeof item.id === "string" ? item.id : ""))
        .filter((id) => id.length > 0),
    };
  }

  // ---------------------------------------------------------------------------
  // appendTenantFilter: TEAM-005 テナント分離用の軽量ヘルパー
  // applyCommonFilters を使えない箇所（resumePack 等）で直接 SQL に追加する。
  // ---------------------------------------------------------------------------

  private appendTenantFilter(
    sql: string,
    params: unknown[],
    alias: string,
    user_id?: string,
    team_id?: string
  ): string {
    if (!user_id) return sql;
    if (team_id) {
      sql += ` AND (${alias}.user_id = ? OR ${alias}.team_id = ?)`;
      params.push(user_id, team_id);
    } else {
      sql += ` AND ${alias}.user_id = ?`;
      params.push(user_id);
    }
    return sql;
  }

  // ---------------------------------------------------------------------------
  // applyCommonFilters: SQL WHERE 句に共通フィルタを追加
  // ---------------------------------------------------------------------------

  private applyCommonFilters(
    sql: string,
    params: unknown[],
    alias: string,
    filters: {
      project?: string;
      project_members?: string[];
      session_id?: string;
      since?: string;
      until?: string;
      as_of?: string;
      include_private?: boolean;
      strict_project?: boolean;
      memory_type?: import("./types.js").MemoryType | import("./types.js").MemoryType[];
      /** TEAM-005: member ロール適用 — アクセス制御用ユーザーID */
      user_id?: string;
      /** TEAM-005: member ロール適用 — アクセス制御用チームID */
      team_id?: string;
      /** S78-B02: 階層メタデータスコープ */
      scope?: {
        project?: string;
        session_id?: string;
        thread_id?: string;
        topic?: string;
      };
      /** S78-D01: true のとき期限切れ観察も含む（デフォルト false = 除外）*/
      include_expired?: boolean;
      /**
       * S78-E02: Branch-scoped memory フィルタ。
       * 指定時: そのブランチ OR branch IS NULL を返す（後方互換デフォルト）。
       */
      branch?: string;
    },
    options: { skipPrivacy?: boolean } = {}
  ): string {
    let nextSql = sql;
    const strictProject = filters.strict_project !== false;

    // S78-B02: scope が指定された場合は top-level を上書き (explicit > implicit)
    const effectiveProject = filters.scope?.project ?? filters.project;
    const effectiveSessionId = filters.scope?.session_id ?? filters.session_id;

    if (effectiveProject && strictProject) {
      nextSql = this.appendProjectFilter(nextSql, params, alias, filters.project_members || [effectiveProject]);
    }

    if (effectiveSessionId) {
      nextSql += ` AND ${alias}.session_id = ?`;
      params.push(effectiveSessionId);
    }

    // S78-B02: thread_id / topic スコープフィルタ
    if (filters.scope?.thread_id) {
      nextSql += ` AND ${alias}.thread_id = ?`;
      params.push(filters.scope.thread_id);
    }

    if (filters.scope?.topic) {
      nextSql += ` AND ${alias}.topic = ?`;
      params.push(filters.scope.topic);
    }

    if (filters.since) {
      nextSql += ` AND ${alias}.created_at >= ?`;
      params.push(filters.since);
    }

    if (filters.until) {
      nextSql += ` AND ${alias}.created_at <= ?`;
      params.push(filters.until);
    }

    // COMP-003: Point-in-time クエリ - as_of 時点以前の観察のみを対象とする
    if (filters.as_of) {
      nextSql += ` AND ${alias}.created_at <= ?`;
      params.push(filters.as_of);
    }

    // V5-004: memory_type フィルタ
    if (filters.memory_type !== undefined) {
      const types = Array.isArray(filters.memory_type) ? filters.memory_type : [filters.memory_type];
      if (types.length === 1) {
        nextSql += ` AND ${alias}.memory_type = ?`;
        params.push(types[0]);
      } else if (types.length > 1) {
        const placeholders = types.map(() => "?").join(", ");
        nextSql += ` AND ${alias}.memory_type IN (${placeholders})`;
        params.push(...types);
      }
    }

    // TEAM-005: member ロール — user_id / team_id によるアクセス制御
    // user_id が指定されている場合、自分 OR 同チームのデータのみに絞る
    if (filters.user_id) {
      if (filters.team_id) {
        nextSql += ` AND (${alias}.user_id = ? OR ${alias}.team_id = ?)`;
        params.push(filters.user_id, filters.team_id);
      } else {
        nextSql += ` AND ${alias}.user_id = ?`;
        params.push(filters.user_id);
      }
    }

    // S78-E02: Branch-scoped memory フィルタ
    // branch が指定された場合: そのブランチ OR branch IS NULL（レガシー行）を返す。
    if (filters.branch !== undefined) {
      nextSql += ` AND (${alias}.branch = ? OR ${alias}.branch IS NULL)`;
      params.push(filters.branch);
    }

    // S78-D01: 期限切れフィルタ（デフォルト: 除外）
    if (!filters.include_expired) {
      nextSql += ` AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)`;
      params.push(new Date().toISOString());
    }

    nextSql += this.deps.platformVisibilityFilterSql(alias);
    if (!options.skipPrivacy) {
      nextSql += visibilityFilterSql(alias, Boolean(filters.include_private));
    }
    return nextSql;
  }

  // ---------------------------------------------------------------------------
  // lexicalSearch
  // ---------------------------------------------------------------------------

  private lexicalSearch(request: SearchRequest, internalLimit: number): Map<string, number> {
    if (!this.deps.ftsEnabled) {
      const tokens = buildSearchTokens(request.query);
      if (tokens.length === 0) return new Map<string, number>();

      const params: SQLQueryBindings[] = [];
      let sql = `
        SELECT
          o.id AS id,
          o.title AS title,
          o.content_redacted AS content
        FROM mem_observations o
        WHERE 1 = 1
      `;

      sql = this.applyCommonFilters(sql, params, "o", request);
      sql += " ORDER BY o.created_at DESC LIMIT ?";
      params.push(Math.max(internalLimit * 4, 200));

      const rows = this.deps.db
        .query(sql)
        .all(...(params as any[])) as Array<{ id: string; title: string; content: string }>;

      const raw = new Map<string, number>();
      for (const row of rows) {
        const title = (row.title || "").toLowerCase();
        const content = (row.content || "").toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (title.includes(token)) score += 2;
          if (content.includes(token)) score += 1;
        }
        if (score > 0) raw.set(row.id, score);
      }

      return normalizeScoreMap(raw);
    }

    const params: unknown[] = [];
    let sql = `
      SELECT
        o.id AS id,
        bm25(mem_observations_fts, 0, 3.0, 1.0) AS bm25
      FROM mem_observations_fts
      JOIN mem_observations o ON o.rowid = mem_observations_fts.rowid
      WHERE mem_observations_fts MATCH ?
    `;

    params.push(buildFtsQuery(request.query));
    sql = this.applyCommonFilters(sql, params, "o", request);
    sql += " ORDER BY bm25 ASC LIMIT ?";
    params.push(internalLimit);

    const rows = this.deps.db
      .query(sql)
      .all(...(params as any[])) as Array<{ id: string; bm25: number }>;
    const raw = new Map<string, number>();
    for (const row of rows) {
      raw.set(row.id, -Number(row.bm25));
    }

    return normalizeScoreMap(raw);
  }

  // ---------------------------------------------------------------------------
  // vectorSearch
  // ---------------------------------------------------------------------------

  private vectorSearch(request: SearchRequest, internalLimit: number): VectorSearchResult {
    if (this.deps.getVectorEngine() === "disabled") {
      return { scores: new Map<string, number>(), coverage: 0 };
    }

    this.deps.refreshEmbeddingHealth();
    const strictProjectWindow =
      request.project && request.strict_project !== false
        ? Math.min(1500, Math.max(600, internalLimit * 12))
        : Math.min(2000, Math.max(800, internalLimit * 20));

    const mergeScoreSets = (
      scoreSets: Array<{ weight: number; scores: Map<string, number>; matchedRows: number }>,
      migrationModel: string
    ): VectorSearchResult => {
      const fused = new Map<string, number>();
      let matchedRows = 0;
      for (const scoreSet of scoreSets) {
        matchedRows += scoreSet.matchedRows;
        for (const [id, score] of scoreSet.scores.entries()) {
          fused.set(id, (fused.get(id) ?? 0) + score * scoreSet.weight);
        }
      }
      const normalized = normalizeScoreMap(fused);
      const migrationWarning = this.getMigrationProgress(migrationModel) ?? undefined;
      return {
        scores: normalized,
        coverage: matchedRows === 0 ? 0 : normalized.size / matchedRows,
        migrationWarning,
      };
    };

    const runBruteForce = (model: string, queryVector: number[]): Array<{ id: string; score: number }> => {
      const p: unknown[] = [model, this.deps.vectorDimension];
      let q = `
        SELECT
          v.observation_id AS id,
          v.vector_json AS vector_json,
          o.created_at AS created_at
        FROM mem_vectors v
        JOIN mem_observations o ON o.id = v.observation_id
        WHERE v.model = ? AND v.dimension = ?
      `;
      q = this.applyCommonFilters(q, p, "o", request);
      q += " ORDER BY o.created_at DESC LIMIT ?";
      p.push(strictProjectWindow);

      const bfRows = this.deps.db
        .query(q)
        .all(...(p as any[])) as Array<{
        id: string;
        vector_json: string;
        created_at: string;
      }>;
      const bfScored: Array<{ id: string; score: number }> = [];
      for (const row of bfRows) {
        let vector: number[];
        try {
          const parsed = JSON.parse(row.vector_json);
          if (!Array.isArray(parsed)) continue;
          vector = parsed.filter((value): value is number => typeof value === "number");
        } catch {
          continue;
        }
        const cosine = cosineSimilarity(queryVector, vector);
        bfScored.push({ id: row.id, score: (cosine + 1) / 2 });
      }
      return bfScored;
    };

    const resolveEmbeddingPlan = (queryText: string) => {
      const plan = this.deps.buildQueryEmbeddings?.(queryText);
      if (plan) {
        return plan;
      }
      return {
        route: null,
        analysis: null,
        primary: {
          model: this.deps.getVectorModelVersion(),
          vector: normalizeVectorDimension(this.deps.embedContent(queryText), this.deps.vectorDimension),
        },
        secondary: null,
      };
    };

    const runVariantSearch = (
      plan: ReturnType<typeof resolveEmbeddingPlan>,
      variantWeight: number
    ): VectorSearchResult => {
      const primaryModel = plan.primary.model ?? this.deps.getVectorModelVersion();
      const hasEnsemble = plan.route === "ensemble" && !!plan.secondary;
      const primaryWeight = hasEnsemble
        ? computeJapaneseEnsembleWeight(plan.analysis?.jaRatio)
        : 1;
      const secondaryWeight = hasEnsemble ? 1 - primaryWeight : 0;
      const searchTargets = [
        { model: primaryModel, vector: plan.primary.vector, weight: primaryWeight * variantWeight },
        ...(plan.secondary
          ? [{
              model: plan.secondary.model,
              vector: plan.secondary.vector,
              weight: (secondaryWeight || 1) * variantWeight,
            }]
          : []),
      ];

      if (this.deps.getVectorEngine() === "sqlite-vec" && this.deps.getVecTableReady()) {
        try {
          const sqliteScoreSets: Array<{ weight: number; scores: Map<string, number>; matchedRows: number }> = [];
          let sqliteReady = true;

          for (const target of searchTargets) {
            const tableName = getSqliteVecTableName(target.model);
            const mapTableName = getSqliteVecMapTableName(target.model);
            const tableCount = this.deps.db
              .query<{ count: number }, [string, string]>(
                `SELECT COUNT(*) AS count
                 FROM sqlite_master
                 WHERE type IN ('table', 'view')
                   AND name IN (?, ?)`,
              )
              .get(tableName, mapTableName);

            if (Number(tableCount?.count ?? 0) < 2) {
              sqliteReady = false;
              break;
            }

            const params: unknown[] = [
              JSON.stringify(target.vector),
              internalLimit * 3,
              target.model,
              this.deps.vectorDimension,
            ];
            let sql = `
              SELECT
                c.id AS id,
                c.distance AS distance,
                o.created_at AS created_at
              FROM (
                SELECT
                  m.observation_id AS id,
                  v.distance AS distance
                FROM ${tableName} v
                JOIN ${mapTableName} m ON m.rowid = v.rowid
                WHERE v.embedding MATCH ? AND k = ?
              ) c
              JOIN mem_vectors mv
                ON mv.observation_id = c.id
                AND mv.model = ?
                AND mv.dimension = ?
              JOIN mem_observations o ON o.id = c.id
              WHERE 1 = 1
            `;
            sql = this.applyCommonFilters(sql, params, "o", request);
            sql += " ORDER BY c.distance ASC LIMIT ?";
            params.push(internalLimit);

            const rows = this.deps.db
              .query(sql)
              .all(...(params as any[])) as Array<{
              id: string;
              distance: number;
              created_at: string;
            }>;

            const raw = new Map<string, number>();
            for (const row of rows) {
              const distance = Number(row.distance);
              if (Number.isNaN(distance)) continue;
              raw.set(row.id, 1 / (1 + Math.max(0, distance)));
            }
            sqliteScoreSets.push({
              weight: target.weight,
              scores: normalizeScoreMap(raw),
              matchedRows: rows.length,
            });
          }

          if (sqliteReady && sqliteScoreSets.length > 0) {
            return mergeScoreSets(sqliteScoreSets, primaryModel);
          }
        } catch {
          this.deps.setVecTableReady(false);
        }
      }

      const bruteForceSets = searchTargets.map((target) => {
        const scored = runBruteForce(target.model, target.vector);
        scored.sort((lhs, rhs) => rhs.score - lhs.score);
        const sliced = scored.slice(0, internalLimit);

        const raw = new Map<string, number>();
        for (const entry of sliced) {
          raw.set(entry.id, entry.score);
        }

        return {
          weight: target.weight,
          scores: normalizeScoreMap(raw),
          matchedRows: scored.length,
        };
      });

      return mergeScoreSets(bruteForceSets, primaryModel);
    };

    const initialPlan = resolveEmbeddingPlan(request.query);
    const expandedQuery =
      this.deps.getEmbeddingProviderName() === "adaptive"
        ? expandQuery(request.query, initialPlan.route)
        : { original: request.query, expanded: [], route: initialPlan.route };
    const variantQueries = [expandedQuery.original, ...expandedQuery.expanded].filter(Boolean);
    const variantWeights = [1, 0.9, 0.8, 0.7];
    const variantResults = variantQueries.map((variant, index) =>
      runVariantSearch(index === 0 ? initialPlan : resolveEmbeddingPlan(variant), variantWeights[index] ?? 0.7),
    );

    if (variantResults.length === 1) {
      return variantResults[0]!;
    }

    const fused = new Map<string, number>();
    let coverageTotal = 0;
    for (const [index, result] of variantResults.entries()) {
      const variantWeight = variantWeights[index] ?? 0.7;
      coverageTotal += result.coverage * variantWeight;
      for (const [id, score] of result.scores.entries()) {
        fused.set(id, Math.max(fused.get(id) ?? 0, score * variantWeight));
      }
    }

    return {
      scores: normalizeScoreMap(fused),
      coverage: coverageTotal / variantResults.length,
      migrationWarning: variantResults.find((result) => !!result.migrationWarning)?.migrationWarning,
    };
  }

  // ---------------------------------------------------------------------------
  // S74-001: nuggetSearch — nugget レベルのベクトル検索で親 observation を boost
  // ---------------------------------------------------------------------------

  /**
   * クエリベクトルと mem_nugget_vectors のコサイン類似度を計算し、
   * 親 observation_id → 最大スコアのマップを返す。
   *
   * 最適化: candidateObsIds が指定された場合、その observation の nugget のみ検索する。
   * 全件スキャン (brute-force) を回避し、候補数に比例する高速な検索を実現。
   * candidateObsIds が空または未指定の場合は空 Map を返す。
   */
  private nuggetSearch(query: string, candidateObsIds: Set<string>): Map<string, number> {
    if (this.deps.getVectorEngine() === "disabled" || candidateObsIds.size === 0) {
      return new Map<string, number>();
    }

    try {
      const model = this.deps.getVectorModelVersion();
      const queryVector = normalizeVectorDimension(
        this.deps.embedContent(query),
        this.deps.vectorDimension,
      );

      // 候補 observation の nugget のみ取得（バッチ処理で SQL IN 句のサイズ制限を回避）
      const MAX_BATCH = 200;
      const allCandidates = [...candidateObsIds];
      const raw = new Map<string, number>();

      for (let i = 0; i < allCandidates.length; i += MAX_BATCH) {
        const batch = allCandidates.slice(i, i + MAX_BATCH);
        const placeholders = batch.map(() => "?").join(", ");
        const rows = this.deps.db
          .query<{ observation_id: string; vector_json: string }, (string | number)[]>(
            `SELECT nv.observation_id, nv.vector_json
             FROM mem_nugget_vectors nv
             WHERE nv.observation_id IN (${placeholders})
               AND nv.model = ? AND nv.dimension = ?`
          )
          .all(...batch, model, this.deps.vectorDimension);

        for (const row of rows) {
          let vector: number[];
          try {
            const parsed = JSON.parse(row.vector_json);
            if (!Array.isArray(parsed)) continue;
            vector = parsed.filter((value): value is number => typeof value === "number");
          } catch {
            continue;
          }
          const cosine = cosineSimilarity(queryVector, vector);
          const score = (cosine + 1) / 2;
          const existing = raw.get(row.observation_id) ?? 0;
          if (score > existing) {
            raw.set(row.observation_id, score);
          }
        }
      }

      return normalizeScoreMap(raw);
    } catch {
      return new Map<string, number>();
    }
  }

  private resolveFallbackVectorModel(currentModel: string): string | null {
    const row = this.deps.db
      .query(
        `SELECT model, COUNT(*) AS cnt
         FROM mem_vectors
         WHERE model != ?
         GROUP BY model
         ORDER BY cnt DESC
         LIMIT 1`
      )
      .get(currentModel) as { model: string; cnt: number } | null;
    return row?.model ?? null;
  }

  private getMigrationProgress(currentModel: string): string | null {
    if (this.migrationComplete) return null;

    const totals = this.deps.db
      .query(
        `SELECT
           COUNT(DISTINCT observation_id) AS total,
           COUNT(DISTINCT CASE WHEN model = ? THEN observation_id END) AS current_count
         FROM mem_vectors`
      )
      .get(currentModel) as { total: number; current_count: number } | null;

    if (!totals || totals.total === 0) return null;
    const total = Number(totals.total);
    const current = Number(totals.current_count);
    if (current >= total) {
      this.migrationComplete = true;
      return null;
    }
    const pct = Math.round((current / total) * 100);
    return `vector_migration: ${current}/${total} vectors reindexed (${pct}%)`;
  }

  private tagMatchScore(tagsJson: unknown, queryTokens: string[]): number {
    const tags = parseArrayJson(tagsJson);
    if (tags.length === 0 || queryTokens.length === 0) return 0;

    let matches = 0;
    for (const tag of tags) {
      const normalizedTag = tag.toLowerCase();
      for (const token of queryTokens) {
        if (
          normalizedTag === token ||
          normalizedTag.includes(token) ||
          token.includes(normalizedTag)
        ) {
          matches += 1;
          break;
        }
      }
    }

    return matches / Math.max(tags.length, queryTokens.length);
  }

  /**
   * COMP-001: N-hop グラフ探索（activation spreading）。
   * BFS で最大 MAX_DEPTH ホップ先まで辿り、hop ごとに DECAY を乗算してスコアを減衰させる。
   * visited セットで循環リンクを防ぎ、既存候補(existingIds)に含まれるIDは
   * candidateIds への追加対象外だが、graph スコアは返す（呼び出し元で判断）。
   */
  private expandByLinks(
    topIds: string[],
    request: SearchRequest,
    existingIds: Set<string>
  ): Map<string, number> {
    if (topIds.length === 0) return new Map<string, number>();

    // RQ-010: cat-3 multi-hop 強化 — デフォルトホップ数を 3 → 4 に増加
    const rawHops = this.deps.config?.graphMaxHops ?? 4;
    const MAX_DEPTH = Math.min(Math.max(rawHops, 1), 5);
    const DECAY = 0.5;

    const graphScores = new Map<string, number>();
    // processedAsSource: フロンティアとして発信元として処理済みのID（循環防止）
    const processedAsSource = new Set<string>(topIds);
    let frontier = new Map<string, number>(topIds.map((id) => [id, 1.0]));

    for (let depth = 1; depth <= MAX_DEPTH; depth++) {
      if (frontier.size === 0) break;

      const frontierIds = [...frontier.keys()];
      const placeholders = frontierIds.map(() => "?").join(", ");
      const params: unknown[] = [...frontierIds];

      // contradicts は意味的に逆の関係なので、スコアを 50% 減衰させる
      const CONTRADICTS_PENALTY = 0.5;

      // GRAPH-002: 双方向探索
      // forward: from_observation_id がフロンティア → to 方向へ辿る
      // backward: to_observation_id がフロンティア → from 方向へ辿る
      // applyCommonFilters は SQL 末尾に AND 句を追記するため、
      // 各 SELECT ブランチに個別適用してから UNION ALL で結合する
      const RELATIONS = "'shared_entity', 'follows', 'extends', 'derives', 'contradicts', 'causes', 'part_of', 'updates'";

      const forwardParams: unknown[] = [...params];
      let forwardSql = `
        SELECT
          o.id AS id,
          MAX(l.weight) AS link_weight,
          l.from_observation_id AS from_id,
          l.to_observation_id AS to_id,
          l.relation AS relation,
          'forward' AS direction
        FROM mem_links l
        JOIN mem_observations o ON o.id = l.to_observation_id
        WHERE l.from_observation_id IN (${placeholders})
          AND l.relation IN (${RELATIONS})
      `;
      forwardSql = this.applyCommonFilters(forwardSql, forwardParams, "o", request);

      const backwardParams: unknown[] = [...params];
      let backwardSql = `
        SELECT
          o.id AS id,
          MAX(l.weight) AS link_weight,
          l.from_observation_id AS from_id,
          l.to_observation_id AS to_id,
          l.relation AS relation,
          'backward' AS direction
        FROM mem_links l
        JOIN mem_observations o ON o.id = l.from_observation_id
        WHERE l.to_observation_id IN (${placeholders})
          AND l.relation IN (${RELATIONS})
      `;
      backwardSql = this.applyCommonFilters(backwardSql, backwardParams, "o", request);

      const combinedSql = `${forwardSql} UNION ALL ${backwardSql} ORDER BY link_weight DESC LIMIT 400`;
      const combinedParams: unknown[] = [...forwardParams, ...backwardParams];

      let rows: Array<{ id: string; link_weight: number; from_id: string; to_id: string; relation: string; direction: string }>;
      try {
        rows = this.deps.db.query(combinedSql).all(...(combinedParams as any[])) as typeof rows;
      } catch {
        break;
      }

      const nextFrontier = new Map<string, number>();
      for (const row of rows) {
        const id = typeof row.id === "string" ? row.id : "";
        const fromId = typeof row.from_id === "string" ? row.from_id : "";
        const toId = typeof row.to_id === "string" ? row.to_id : "";
        const linkWeight = Number(row.link_weight ?? 0);
        // id は探索で発見した隣接ノード（forward では to_id、backward では from_id と一致）
        // fromId === toId のみ排除（自己ループリンク）
        if (!id || !fromId || !toId || fromId === toId || Number.isNaN(linkWeight)) continue;

        const relationPenalty = row.relation === "contradicts" ? CONTRADICTS_PENALTY : 1.0;
        // forward: from_id がフロンティア上のノード
        // backward: to_id がフロンティア上のノード
        const parentId = row.direction === "forward" ? fromId : toId;
        const parentScore = frontier.get(parentId) ?? 1.0;
        const hopScore = parentScore * linkWeight * (DECAY ** (depth - 1)) * relationPenalty;

        // graph スコアを記録（from と to が異なるノード間のリンクのみ対象）
        const existingGraph = graphScores.get(id) ?? 0;
        if (hopScore > existingGraph) {
          graphScores.set(id, hopScore);
        }

        // 次フロンティアには「まだ発信元として使っていない」IDのみ追加（循環防止）
        if (!processedAsSource.has(id)) {
          const existingFrontier = nextFrontier.get(id) ?? 0;
          if (hopScore > existingFrontier) {
            nextFrontier.set(id, hopScore);
          }
        }
      }

      for (const id of nextFrontier.keys()) {
        processedAsSource.add(id);
      }
      frontier = nextFrontier;
    }

    return normalizeScoreMap(graphScores);
  }

  private resolveSearchWeights(vectorCoverage: number): RankingWeights {
    const base: RankingWeights = {
      lexical: 0.30,
      vector: 0.25,
      recency: 0.20,
      tag_boost: 0.10,
      importance: 0.08,
      graph: 0.07,
    };
    if (vectorCoverage < 0.2) {
      return normalizeWeights({ ...base, vector: 0 });
    }
    return normalizeWeights(base);
  }

  private loadActiveFactsByObservation(
    projects: string[],
    observationIds: string[]
  ): Map<string, ActiveFactRow[]> {
    const factMap = new Map<string, ActiveFactRow[]>();
    if (observationIds.length === 0) return factMap;

    const placeholders = observationIds.map(() => "?").join(", ");
    const projectClause = projects.length === 0
      ? ""
      : projects.length === 1
        ? "AND project = ?"
        : `AND project IN (${projects.map(() => "?").join(", ")})`;
    const params = projects.length === 0 ? observationIds : [...observationIds, ...projects];

    try {
      const rows = this.deps.db
        .query(
          `
            SELECT observation_id, fact_type, fact_key, fact_value, confidence
            FROM mem_facts
            WHERE observation_id IN (${placeholders})
              ${projectClause}
              AND merged_into_fact_id IS NULL
              AND superseded_by IS NULL
              AND valid_to IS NULL
          `
        )
        .all(...params) as ActiveFactRow[];
      for (const row of rows) {
        if (!row.observation_id) continue;
        const existing = factMap.get(row.observation_id) ?? [];
        existing.push(row);
        factMap.set(row.observation_id, existing);
      }
    } catch {
      return factMap;
    }

    return factMap;
  }

  private countKeywordHits(text: string, keywords: string[]): number {
    if (!text || keywords.length === 0) return 0;
    const lower = text.toLowerCase();
    return keywords.reduce((count, keyword) => {
      const normalized = keyword.trim().toLowerCase();
      return normalized && lower.includes(normalized) ? count + 1 : count;
    }, 0);
  }

  private hasNumericValue(text: string): boolean {
    return /[-+]?\d+(?:\.\d+)?(?:%|pp|ms|s|x)?/i.test(text);
  }

  private normalizeCompactText(value: string): string {
    return value.trim().replace(/\s+/g, " ");
  }

  private cleanExtractedSpan(value: string, options: { dropLeadingArticle?: boolean } = {}): string {
    let cleaned = this.normalizeCompactText(value)
      .replace(/^[,;:.!?'"`\s]+/, "")
      .replace(/[,;:.!?'"`\s]+$/, "")
      .replace(/\b(?:mostly|mainly|especially|currently|right now)\b$/i, "")
      .trim();
    if (options.dropLeadingArticle) {
      cleaned = cleaned.replace(/^(?:the|a|an)\s+/i, "").trim();
    }
    return cleaned;
  }

  private stripTrailingJapaneseCopula(value: string): string {
    return this.cleanExtractedSpan(
      value
        .replace(/^(?:その後|そこで|まず|最初に|最後に)\s+/u, "")
        .replace(/\s*開始$/u, "")
        .replace(/(?:です|でした|だ|だった)$/u, "")
        .replace(/(?:を使っています|を使っている|にしています|にしていました|もサポートしています)$/u, "")
        .replace(/(?:が先に出ました|が先でした|が最後でした|が最初でした)$/u, "")
        .trim()
    ).replace(/(?:も|を|が)$/u, "").trim();
  }

  private countAnswerSentences(text: string): number {
    return text
      .split(/\n+|(?<=[。.!?])\s+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0).length;
  }

  private extractJapaneseReasonSpan(text: string): string | null {
    const source = this.normalizeCompactText(text);
    const patterns = [
      /(?:理由|きっかけ)(?:は|になったのは)?\s*([^。!?]+?(?:から|ため|ので))(?:です|でした|だ|だった)?/u,
      /([^。!?]+?(?:から|ため|ので))(?:です|でした|だ|だった)?(?:。|$)/u,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(source);
      if (match?.[1]) return this.stripTrailingJapaneseCopula(match[1]);
    }
    return null;
  }

  private extractJapaneseCurrentValueSpan(text: string): string | null {
    const source = this.normalizeCompactText(text);
    const patterns = [
      /今(?:は|の)?\s*([^。!?]+?)\s*(?:を使っています|を使っている|です|でした|にしています|になっています|もサポートしています|が使われています)/u,
      /現在(?:は|の)?\s*([^。!?]+?)\s*(?:を使っています|です|でした|にしています|になっています|もサポートしています)/u,
      /今の[^。!?]*?は\s*([^。!?]+?)(?:です|でした|だ|だった)/u,
      /現在の[^。!?]*?は\s*([^。!?]+?)(?:です|でした|だ|だった)/u,
      /((?:平日(?:の)?\s*)?\d{1,2}:\d{2}\s*[〜~-]\s*\d{1,2}:\d{2}\s*(?:JST|UTC)?)\s*に絞りました/u,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(source);
      if (match?.[1]) return this.stripTrailingJapaneseCopula(match[1]);
    }
    return null;
  }

  private extractJapanesePreviousValueSpan(text: string): string | null {
    const source = this.normalizeCompactText(text);
    const patterns = [
      /以前(?:は|の)?\s*([^。!?]+?)\s*(?:でした|です|を使っていました|にしていました)/u,
      /前(?:は|の)?\s*([^。!?]+?)\s*(?:でした|です|を使っていました|にしていました)/u,
      /最初は[^。!?]*?を\s*([^。!?]+?)\s*にしていました/u,
      /最初の[^。!?]*?は\s*([^。!?]+?)\s*だけを対象にしていました/u,
      /元は\s*([^。!?]+?)\s*(?:でした|です|を使っていました|にしていました)/u,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(source);
      if (match?.[1]) return this.stripTrailingJapaneseCopula(match[1]);
    }
    return null;
  }

  private extractJapaneseTemporalOrderSpan(question: string, text: string): string | null {
    const normalizedQuestion = this.normalizeCompactText(question);
    const source = this.normalizeCompactText(text);
    if (/(どちらが先|先に)/u.test(normalizedQuestion)) {
      const first = /([^、,。!?]+?)が先(?:に出ました|に出た|でした|だ)/u.exec(source);
      if (first?.[1]) return this.stripTrailingJapaneseCopula(first[1]);
    }
    if (/(最後|last)/iu.test(normalizedQuestion)) {
      const last = /([^、,。!?]+?)が最後(?:に出ました|でした|だ)/u.exec(source);
      if (last?.[1]) return this.stripTrailingJapaneseCopula(last[1]);
    }
    if (/(最初|first)/iu.test(normalizedQuestion)) {
      const first = /([^、,。!?]+?)が最初(?:に出ました|でした|だ)/u.exec(source);
      if (first?.[1]) return this.stripTrailingJapaneseCopula(first[1]);
    }
    return null;
  }

  private extractJapaneseListSpan(text: string): string | null {
    const source = this.normalizeCompactText(text);
    const patterns = [
      /(?:には|は)\s*([^。!?]+?)\s*を(?:出しました|追加しました|導入しました|含めました)/u,
      /([^。!?]+(?:,|、)\s*[^。!?]+(?:,|、)?\s*[^。!?]+)(?:を出しました|です)/u,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(source);
      if (match?.[1]) {
        return [...new Set(match[1].split(/,|、| and /iu).map((item) => this.stripTrailingJapaneseCopula(item)).filter(Boolean))].join(", ");
      }
    }
    return null;
  }

  private extractConciseAnswerSpan(query: string, answerHints: AnswerHints, text: string): string | null {
    switch (answerHints.intent) {
      case "current_value":
        // S43-006: try bilingual span extraction (English + Japanese)
        return extractCurrentValueSpan(text);
      case "reason":
        return this.extractJapaneseReasonSpan(text);
      case "list_value":
        return this.extractJapaneseListSpan(text);
      case "temporal_value":
        return (
          this.extractJapaneseTemporalOrderSpan(query, text) ||
          extractCurrentValueSpan(text) ||
          this.extractJapanesePreviousValueSpan(text) ||
          this.extractJapaneseListSpan(text)
        );
      case "location": {
        const location =
          /\b(?:in|at|from|to|near|based in|live in|located in)\s+([A-Z][\w.-]+(?:\s+[A-Z][\w.-]+){0,2})\b/u.exec(text) ||
          /(東京|京都|大阪|名古屋|札幌|福岡|ニューヨーク|ロンドン|ベルリン|パリ)/u.exec(text);
        return location?.[1] || location?.[0] || null;
      }
      default:
        return null;
    }
  }

  private hasFocusedNumericLine(text: string, focusKeywords: string[]): boolean {
    if (focusKeywords.length === 0) return false;
    const segments = text
      .split(/\n+/)
      .flatMap((line) => line.split(/[。.!?]/))
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 24);
    return segments.some((line) => {
      const lower = line.toLowerCase();
      return this.countKeywordHits(lower, focusKeywords) > 0 && this.hasNumericValue(line);
    });
  }

  private selectSpecificMetricKeywords(metricKeywords: string[]): string[] {
    if (metricKeywords.length === 0) return metricKeywords;
    const exactKeywords = metricKeywords.filter((keyword) => {
      const normalized = keyword.trim().toLowerCase();
      if (!normalized) return false;
      if (normalized.includes(" ") || normalized.includes("@") || normalized.includes("_")) return true;
      return ["freshness", "tau", "recall", "latency", "p95"].includes(normalized);
    });
    return exactKeywords.length > 0 ? exactKeywords : metricKeywords;
  }

  private isCommandLikeObservation(observation: Record<string, unknown>): boolean {
    const title = typeof observation.title === "string" ? observation.title : "";
    const content = typeof observation.content_redacted === "string" ? observation.content_redacted : "";
    return (
      title.startsWith("Shell:") ||
      /^\s*(?:jq|bun|curl|node|python|bash|ts=)/.test(content) ||
      /^\s*[A-Z_][A-Z0-9_]*=/.test(content)
    );
  }

  private computeActiveFactBoost(
    query: string,
    answerHints: AnswerHints | undefined,
    facts: ActiveFactRow[]
  ): number {
    if (!answerHints?.activeFactPreferred || facts.length === 0) return 0;

    const queryLower = query.toLowerCase();
    const queryTokens = buildSearchTokens(queryLower);
    let best = 0;
    for (const fact of facts) {
      const key = fact.fact_key.toLowerCase();
      const value = fact.fact_value.toLowerCase();
      const slotHits = this.countKeywordHits(`${key} ${value}`, answerHints.slotKeywords);
      const focusHits = this.countKeywordHits(`${key} ${value}`, answerHints.focusKeywords);
      const queryHits = this.countKeywordHits(`${key} ${value}`, queryTokens);
      let score = Math.min(0.35, Math.max(0, fact.confidence) * 0.35);
      if (slotHits > 0) score += Math.min(0.45, slotHits * 0.18);
      if (focusHits > 0) score += Math.min(0.25, focusHits * 0.1);
      else if (answerHints.focusKeywords.length > 0) score -= 0.08;
      if (queryLower.includes(key) || key.includes(queryLower)) score += 0.2;
      if (queryHits > 0) score += Math.min(0.15, queryHits * 0.05);
      if (answerHints.exactValuePreferred && fact.fact_value.trim().length > 0 && fact.fact_value.trim().length <= 64) {
        score += 0.1;
      }
      best = Math.max(best, Math.min(1, score));
    }
    return best;
  }

  private computePrecisionBoost(
    query: string,
    answerHints: AnswerHints | undefined,
    observation: Record<string, unknown>
  ): number {
    if (!answerHints?.exactValuePreferred) return 0;

    const title = typeof observation.title === "string" ? observation.title : "";
    const content = typeof observation.content_redacted === "string" ? observation.content_redacted : "";
    const text = `${title} ${content}`.trim();
    if (!text) return 0;

    const queryLower = query.toLowerCase();
    const lower = text.toLowerCase();
    let score = 0;
    const focusHits = this.countKeywordHits(lower, answerHints.focusKeywords);
    const metricFocusKeywords =
      answerHints.metricKeywords.length > 0 ? answerHints.metricKeywords : answerHints.focusKeywords;
    const exactMetricKeywords = this.selectSpecificMetricKeywords(metricFocusKeywords);
    const contextFocusKeywords = answerHints.focusKeywords.filter(
      (keyword) => !answerHints.metricKeywords.includes(keyword)
    );
    const metricFocusHits = this.countKeywordHits(lower, metricFocusKeywords);
    const exactMetricHits = this.countKeywordHits(lower, exactMetricKeywords);
    const contextFocusHits = this.countKeywordHits(lower, contextFocusKeywords);
    const hasFocusedNumericLine = this.hasFocusedNumericLine(text, metricFocusKeywords);
    const hasExactMetricNumericLine = this.hasFocusedNumericLine(text, exactMetricKeywords);
    const hasNumericValue = this.hasNumericValue(text);
    const commandLike = this.isCommandLikeObservation(observation);
    const hasCurrentCue = hasCurrentValueCue(text);
    const hasPreviousCue = PREVIOUS_CUE_PATTERN.test(text) || JAPANESE_PREVIOUS_PATTERN.test(text);
    const hasReasonCue = /\b(because|since|due to|reason|caused by|triggered by)\b/i.test(text) || /(から|ため|ので|理由|きっかけ|背景|原因)/.test(text);
    const hasListCue = /[,、]/.test(text) || /\b(and|all|list|including)\b/i.test(text) || /(一覧|すべて|全て|挙げて|列挙)/.test(text);
    const queryHasPreviousCue = hasPreviousValueIntent(query);

    if (this.countKeywordHits(lower, answerHints.slotKeywords) > 0) {
      score += 0.15;
    }
    if (answerHints.intent === "metric_value") {
      if (contextFocusHits > 0) {
        score += Math.min(0.12, contextFocusHits * 0.04);
      }
    } else if (focusHits > 0) {
      score += Math.min(0.32, focusHits * 0.08);
    } else if (answerHints.focusKeywords.length > 0) {
      score -= 0.14;
    }
    if (lower.includes(queryLower)) {
      score += 0.05;
    }

    switch (answerHints.intent) {
      case "metric_value":
        if (hasExactMetricNumericLine && (contextFocusKeywords.length === 0 || contextFocusHits > 0)) {
          score += 0.78;
        } else if (hasExactMetricNumericLine) {
          score += 0.34;
        } else if (hasFocusedNumericLine && (contextFocusKeywords.length === 0 || contextFocusHits > 0)) {
          score += 0.62;
        } else if (hasFocusedNumericLine) {
          score += 0.18;
        } else if (hasNumericValue && exactMetricHits > 0 && (contextFocusKeywords.length === 0 || contextFocusHits > 0)) {
          score += 0.24;
        } else if (hasNumericValue && metricFocusHits > 0 && (contextFocusKeywords.length === 0 || contextFocusHits > 0)) {
          score += 0.16;
        }
        else if (hasNumericValue) score -= 0.04;
        else score -= 0.18;
        if (exactMetricKeywords.length > 0 && exactMetricHits === 0) score -= 0.16;
        if (contextFocusKeywords.length > 0 && contextFocusHits === 0) score -= 0.18;
        if (commandLike) score -= 0.28;
        break;
      case "current_value":
        if (hasCurrentCue) score += 0.38;
        if (hasPreviousCue) score -= 0.2;
        break;
      case "reason":
        if (hasReasonCue) score += 0.38;
        break;
      case "list_value":
        if (hasListCue) score += 0.32;
        break;
      case "count":
        if (hasFocusedNumericLine) score += 0.52;
        else if (hasNumericValue && focusHits > 0) score += 0.35;
        else if (hasNumericValue) score += 0.08;
        else if (answerHints.focusKeywords.length > 0) score -= 0.08;
        if (commandLike) score -= 0.18;
        break;
      case "language":
        if (/\b(english|spanish|french|german|japanese|korean|chinese|mandarin|cantonese|portuguese|italian)\b/i.test(text)) {
          score += 0.45;
        }
        break;
      case "location":
        if (/\b(in|at|from|to|near|based in|live in|located in)\s+[A-Z][\w.-]+(?:\s+[A-Z][\w.-]+){0,2}\b/.test(text) ||
          /(東京|京都|大阪|名古屋|札幌|福岡|ニューヨーク|ロンドン|ベルリン|パリ)/.test(text)) {
          score += 0.4;
        }
        break;
      case "temporal_value":
        if (queryHasPreviousCue) {
          if (hasPreviousCue) score += 0.38;
          if (hasCurrentCue) score -= 0.16;
        }
        if (/\b(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|spring|summer|fall|autumn|winter|\d{4})\b/i.test(text)) {
          score += 0.45;
        }
        break;
      case "role":
        if (/\b(engineer|developer|manager|designer|scientist|researcher|lead|director|analyst|architect|consultant|teacher|student)\b/i.test(text)) {
          score += 0.4;
        }
        break;
      case "company":
        if (/\b(joined|company|startup|employer|business|works? at|operate)\b/i.test(text)) {
          score += 0.35;
        }
        break;
      case "person":
        if (/\b(named|name is|called)\b/i.test(text)) {
          score += 0.35;
        }
        break;
      case "kind":
      case "study_field":
        if (/\b(is|was|study|major|focus|type|kind|using)\b/i.test(text)) {
          score += 0.25;
        }
        break;
      default:
        break;
    }

    const firstSentence = text.split(/[.!?\n]/)[0]?.trim() || text.trim();
    if (firstSentence.length > 0 && firstSentence.length <= 120) {
      score += 0.08;
    }

    return Math.min(1, score);
  }

  private buildRerankInput(
    ranked: SearchCandidate[],
    observations: Map<string, Record<string, unknown>>
  ): RerankInputItem[] {
    return ranked.map((item, index) => {
      const observation = observations.get(item.id) ?? {};
      return {
        id: item.id,
        score: item.final,
        created_at: item.created_at,
        title: typeof observation.title === "string" ? observation.title : "",
        content:
          typeof observation.content_redacted === "string" ? observation.content_redacted : "",
        source_index: index,
      };
    });
  }

  private applyRerank(
    query: string,
    ranked: SearchCandidate[],
    observations: Map<string, Record<string, unknown>>,
    options: { skipSemanticRerank?: boolean } = {}
  ): {
    ranked: SearchCandidate[];
    pre: Array<Record<string, unknown>>;
    post: Array<Record<string, unknown>>;
  } {
    const pre = ranked.slice(0, 25).map((item, index) => ({
      rank: index + 1,
      id: item.id,
      score: Number(item.final.toFixed(6)),
    }));

    if (
      options.skipSemanticRerank ||
      !this.deps.getRerankerEnabled() ||
      !this.deps.getReranker() ||
      ranked.length === 0
    ) {
      for (const item of ranked) {
        item.rerank = item.final;
      }
      return { ranked, pre, post: pre };
    }

    const reranked = this.deps.getReranker()!.rerank({
      query,
      items: this.buildRerankInput(ranked, observations),
    });
    const rerankScoreById = new Map<string, number>();
    const rerankOrderById = new Map<string, number>();
    reranked.forEach((item: RerankOutputItem, index: number) => {
      rerankScoreById.set(item.id, item.rerank_score);
      rerankOrderById.set(item.id, index);
    });

    ranked.sort((lhs, rhs) => {
      const lhsOrder = rerankOrderById.get(lhs.id);
      const rhsOrder = rerankOrderById.get(rhs.id);
      if (typeof lhsOrder === "number" && typeof rhsOrder === "number" && lhsOrder !== rhsOrder) {
        return lhsOrder - rhsOrder;
      }
      const lhsScore = rerankScoreById.get(lhs.id) ?? lhs.final;
      const rhsScore = rerankScoreById.get(rhs.id) ?? rhs.final;
      if (rhsScore !== lhsScore) return rhsScore - lhsScore;
      return lhs.id.localeCompare(rhs.id);
    });

    for (const item of ranked) {
      item.rerank = rerankScoreById.get(item.id) ?? item.final;
    }

    const post = ranked.slice(0, 25).map((item, index) => ({
      rank: index + 1,
      id: item.id,
      score: Number((item.rerank ?? item.final).toFixed(6)),
    }));

    return { ranked, pre, post };
  }

  private applyExactValuePriorityRerank(
    ranked: SearchCandidate[],
    routeDecision: RouteDecision,
    observations: Map<string, Record<string, unknown>>
  ): void {
    if (routeDecision.answerHints?.intent !== "metric_value") return;
    const answerHints = routeDecision.answerHints;
    const metricFocusKeywords =
      answerHints.metricKeywords.length > 0 ? answerHints.metricKeywords : answerHints.focusKeywords;
    const exactMetricKeywords = this.selectSpecificMetricKeywords(metricFocusKeywords);
    const contextFocusKeywords = answerHints.focusKeywords.filter(
      (keyword) => !answerHints.metricKeywords.includes(keyword)
    );

    const metricPriority = (candidate: SearchCandidate) => {
      const observation = observations.get(candidate.id) ?? {};
      const title = typeof observation.title === "string" ? observation.title : "";
      const content = typeof observation.content_redacted === "string" ? observation.content_redacted : "";
      const text = `${title} ${content}`.trim();
      const lower = text.toLowerCase();
      const contextHits = this.countKeywordHits(lower, contextFocusKeywords);
      const contextSatisfied = contextFocusKeywords.length === 0 || contextHits > 0 ? 1 : 0;
      const exactMetricHits = this.countKeywordHits(lower, exactMetricKeywords);
      const metricHits = this.countKeywordHits(lower, metricFocusKeywords);
      const exactMetricLine = this.hasFocusedNumericLine(text, exactMetricKeywords) ? 1 : 0;
      const metricLine = this.hasFocusedNumericLine(text, metricFocusKeywords) ? 1 : 0;
      const subagentEnvelope = title.startsWith("<subagent_notification>") ? 1 : 0;
      const commandLike = this.isCommandLikeObservation(observation) ? 1 : 0;
      return {
        exactMetricLineWithContext: exactMetricLine * contextSatisfied,
        exactMetricHitsWithContext: exactMetricHits * contextSatisfied,
        metricLineWithContext: metricLine * contextSatisfied,
        contextHits,
        subagentEnvelope,
        commandLike,
        precisionBoost: candidate.precision_boost ?? 0,
      };
    };

    ranked.sort((lhs, rhs) => {
      const lhsPriority = metricPriority(lhs);
      const rhsPriority = metricPriority(rhs);
      if (rhsPriority.exactMetricLineWithContext !== lhsPriority.exactMetricLineWithContext) {
        return rhsPriority.exactMetricLineWithContext - lhsPriority.exactMetricLineWithContext;
      }
      if (rhsPriority.exactMetricHitsWithContext !== lhsPriority.exactMetricHitsWithContext) {
        return rhsPriority.exactMetricHitsWithContext - lhsPriority.exactMetricHitsWithContext;
      }
      if (rhsPriority.metricLineWithContext !== lhsPriority.metricLineWithContext) {
        return rhsPriority.metricLineWithContext - lhsPriority.metricLineWithContext;
      }
      if (rhsPriority.contextHits !== lhsPriority.contextHits) {
        return rhsPriority.contextHits - lhsPriority.contextHits;
      }
      if (lhsPriority.subagentEnvelope !== rhsPriority.subagentEnvelope) {
        return lhsPriority.subagentEnvelope - rhsPriority.subagentEnvelope;
      }
      if (lhsPriority.commandLike !== rhsPriority.commandLike) {
        return lhsPriority.commandLike - rhsPriority.commandLike;
      }
      const lhsPrecision = lhsPriority.precisionBoost;
      const rhsPrecision = rhsPriority.precisionBoost;
      const lhsFocused = lhsPrecision >= 0.35 ? 1 : 0;
      const rhsFocused = rhsPrecision >= 0.35 ? 1 : 0;
      if (rhsFocused !== lhsFocused) return rhsFocused - lhsFocused;
      if (rhsPrecision !== lhsPrecision) return rhsPrecision - lhsPrecision;
      if (rhs.final !== lhs.final) return rhs.final - lhs.final;
      if (rhs.created_at !== lhs.created_at) {
        return String(rhs.created_at).localeCompare(String(lhs.created_at));
      }
      return lhs.id.localeCompare(rhs.id);
    });
  }

  private applyAnswerHintPriorityRerank(
    query: string,
    ranked: SearchCandidate[],
    routeDecision: RouteDecision,
    observations: Map<string, Record<string, unknown>>
  ): void {
    const answerHints = routeDecision.answerHints;
    if (!answerHints || answerHints.intent === "metric_value" || answerHints.intent === "generic") return;
    if (!["current_value", "reason", "list_value", "temporal_value", "location"].includes(answerHints.intent)) {
      return;
    }
    if (answerHints.intent === "temporal_value" && !hasSpecificTemporalAnswerCue(query)) return;
    const queryHasPreviousCue = hasPreviousValueIntent(query);

    const priorityFor = (candidate: SearchCandidate) => {
      const observation = observations.get(candidate.id) ?? {};
      const title = typeof observation.title === "string" ? observation.title : "";
      const content = typeof observation.content_redacted === "string" ? observation.content_redacted : "";
      const text = `${title} ${content}`.trim();
      const lower = text.toLowerCase();
      const conciseSpan = this.extractConciseAnswerSpan(query, answerHints, text);
      const sentenceCount = this.countAnswerSentences(text);
      const hasCurrentCue = hasCurrentValueCue(text);
      const hasPreviousCue = PREVIOUS_CUE_PATTERN.test(text) || JAPANESE_PREVIOUS_PATTERN.test(text);
      const hasReasonCue = REASON_CUE_PATTERN.test(text) || JAPANESE_REASON_PATTERN.test(text);
      const hasListCue = LIST_CUE_PATTERN.test(text) || /[,、]/.test(text) || JAPANESE_LIST_PATTERN.test(text);
      const hasTemporalCue =
        hasTemporalIntent(query) &&
        (TEMPORAL_INTENT_PATTERN.test(text) || JAPANESE_TEMPORAL_ORDER_PATTERN.test(text));
      const focusHits = this.countKeywordHits(lower, answerHints.focusKeywords);
      const fillerPenalty = FILLER_CUE_PATTERN.test(text) && sentenceCount > 1 ? 1 : 0;
      const overlongPenalty = text.length > 220 || sentenceCount > 2 ? 1 : 0;
      return {
        hasConciseSpan: conciseSpan ? 1 : 0,
        conciseLength: conciseSpan ? conciseSpan.length : 999,
        focusHits,
        hasCurrentCue: hasCurrentCue ? 1 : 0,
        hasPreviousCue: hasPreviousCue ? 1 : 0,
        hasReasonCue: hasReasonCue ? 1 : 0,
        hasListCue: hasListCue ? 1 : 0,
        hasTemporalCue: hasTemporalCue ? 1 : 0,
        fillerPenalty,
        overlongPenalty,
        precisionBoost: candidate.precision_boost ?? 0,
      };
    };

    ranked.sort((lhs, rhs) => {
      const left = priorityFor(lhs);
      const right = priorityFor(rhs);
      // "以前は?" のような質問では、現行値の短い答えよりも
      // 過去値を明示した観察を最優先にする。
      if (answerHints.intent === "temporal_value" && queryHasPreviousCue) {
        if (right.hasPreviousCue !== left.hasPreviousCue) return right.hasPreviousCue - left.hasPreviousCue;
        if (left.hasCurrentCue !== right.hasCurrentCue) return left.hasCurrentCue - right.hasCurrentCue;
      }
      if (right.hasConciseSpan !== left.hasConciseSpan) return right.hasConciseSpan - left.hasConciseSpan;
      if (answerHints.intent === "current_value") {
        if (right.hasCurrentCue !== left.hasCurrentCue) return right.hasCurrentCue - left.hasCurrentCue;
        if (left.hasPreviousCue !== right.hasPreviousCue) return left.hasPreviousCue - right.hasPreviousCue;
      }
      if (answerHints.intent === "reason" && right.hasReasonCue !== left.hasReasonCue) {
        return right.hasReasonCue - left.hasReasonCue;
      }
      if (answerHints.intent === "list_value" && right.hasListCue !== left.hasListCue) {
        return right.hasListCue - left.hasListCue;
      }
      if (answerHints.intent === "temporal_value") {
        if (right.hasTemporalCue !== left.hasTemporalCue) {
          return right.hasTemporalCue - left.hasTemporalCue;
        }
        if (queryHasPreviousCue) {
          if (left.overlongPenalty !== right.overlongPenalty) {
            return left.overlongPenalty - right.overlongPenalty;
          }
          if (left.fillerPenalty !== right.fillerPenalty) {
            return left.fillerPenalty - right.fillerPenalty;
          }
          if (left.conciseLength !== right.conciseLength) {
            return left.conciseLength - right.conciseLength;
          }
        }
      }
      if (right.focusHits !== left.focusHits) return right.focusHits - left.focusHits;
      if (left.fillerPenalty !== right.fillerPenalty) return left.fillerPenalty - right.fillerPenalty;
      if (left.overlongPenalty !== right.overlongPenalty) return left.overlongPenalty - right.overlongPenalty;
      if (left.conciseLength !== right.conciseLength) return left.conciseLength - right.conciseLength;
      if (right.precisionBoost !== left.precisionBoost) return right.precisionBoost - left.precisionBoost;
      if (rhs.final !== lhs.final) return rhs.final - lhs.final;
      if (rhs.created_at !== lhs.created_at) {
        return String(rhs.created_at).localeCompare(String(lhs.created_at));
      }
      return lhs.id.localeCompare(rhs.id);
    });
  }

  private applySessionProgressBoost(
    query: string,
    routeDecision: RouteDecision,
    ranked: SearchCandidate[],
    observations: Map<string, Record<string, unknown>>
  ): void {
    if (routeDecision.kind !== "timeline" || !hasSessionProgressIntent(query) || ranked.length === 0) {
      return;
    }

    const focusKeywords = routeDecision.answerHints?.focusKeywords ?? [];
    if (focusKeywords.length === 0) {
      return;
    }

    const sessionStats = new Map<string, { bestSignal: number; latestTurnAt: string }>();

    for (const candidate of ranked) {
      const observation = observations.get(candidate.id);
      if (!observation) continue;
      const sessionId = typeof observation.session_id === "string" ? observation.session_id : "";
      if (!sessionId) continue;
      const text = `${typeof observation.title === "string" ? observation.title : ""} ${
        typeof observation.content_redacted === "string" ? observation.content_redacted : ""
      }`.trim().toLowerCase();
      const focusHits = this.countKeywordHits(text, focusKeywords);
      const signal = Math.max(
        candidate.lexical,
        candidate.vector,
        candidate.precision_boost ?? 0,
        Math.min(0.9, focusHits * 0.18)
      );
      const existing = sessionStats.get(sessionId);
      if (!existing) {
        sessionStats.set(sessionId, { bestSignal: signal, latestTurnAt: candidate.created_at });
        continue;
      }
      existing.bestSignal = Math.max(existing.bestSignal, signal);
      if (compareCreatedAt(candidate.created_at, existing.latestTurnAt) > 0) {
        existing.latestTurnAt = candidate.created_at;
      }
    }

    const bestSession = [...sessionStats.entries()]
      .sort((lhs, rhs) => {
        if (rhs[1].bestSignal !== lhs[1].bestSignal) {
          return rhs[1].bestSignal - lhs[1].bestSignal;
        }
        return compareCreatedAt(rhs[1].latestTurnAt, lhs[1].latestTurnAt);
      })[0];

    if (!bestSession || bestSession[1].bestSignal < 0.3) {
      return;
    }

    const [bestSessionId] = bestSession;
    const sessionCandidates = ranked
      .filter((candidate) => {
        const observation = observations.get(candidate.id);
        return observation && observation.session_id === bestSessionId;
      })
      .sort((lhs, rhs) => compareCreatedAt(lhs.created_at, rhs.created_at));

    if (sessionCandidates.length === 0) {
      return;
    }

    const denominator = Math.max(1, sessionCandidates.length - 1);
    sessionCandidates.forEach((candidate, index) => {
      const progress = sessionCandidates.length === 1 ? 1 : index / denominator;
      candidate.final += 0.08 + progress * 0.28;
    });
  }

  /**
   * S38-007: temporal 2段階検索の適用条件を厳格化。
   * - 明示 timeline 指定は許可
   * - 暗黙分類は confidence と query 文面の temporal intent を両方満たす場合のみ許可
   */
  private shouldApplyTemporalTwoStageRerank(request: SearchRequest, routeDecision: RouteDecision): boolean {
    if (routeDecision.kind !== "timeline") return false;
    if (routeDecision.temporalAnchors && routeDecision.temporalAnchors.length > 0) return false;
    if (request.question_kind === "timeline") return true;
    if (routeDecision.confidence < 0.6) return false;
    return hasTemporalIntent(request.query);
  }

  // ---------------------------------------------------------------------------
  // §34 FD-006: temporalAnchorSearch — Anchor-Pivoted 時系列検索
  // ---------------------------------------------------------------------------

  /**
   * Anchor-Pivoted Search:
   * 1. anchor.referenceText でベクトル検索 → anchorEntry を特定
   * 2. anchorEntry.created_at を基点に SQL で created_at フィルタ
   *    - "asc"  → created_at > anchor_ts ORDER BY created_at ASC
   *    - "desc" → created_at < anchor_ts ORDER BY created_at DESC
   *    - "around" → anchor_ts の前後を取得
   *
   * relevance score ではなく時間軸でソートする。
   */
  private temporalAnchorSearch(
    request: SearchRequest,
    anchor: TemporalAnchor,
    limit: number
  ): Array<Record<string, unknown>> | null {
    try {
      const projectMembers = request.project_members ?? this.resolveProjectMembers(request.project);
      const includePrivate = Boolean(request.include_private);

      // Phase 1: anchor.referenceText でベクトル検索してアンカーエントリを特定
      // S43-005: anchor 特定の internalLimit を 5 → 20 に拡張して取りこぼしを防ぐ
      const anchorRequest: SearchRequest = {
        ...request,
        query: anchor.referenceText,
        limit: 1,
      };
      const ANCHOR_SEARCH_LIMIT = 20;
      const anchorVec = this.vectorSearch(anchorRequest, ANCHOR_SEARCH_LIMIT);
      const anchorLex = this.lexicalSearch(anchorRequest, ANCHOR_SEARCH_LIMIT);

      // §35 SD-004: hybrid anchor 特定 — vector 60% + lexical 40% の合算スコアで選択
      const hybridScores = new Map<string, number>();
      const allIds = new Set<string>([
        ...anchorVec.scores.keys(),
        ...anchorLex.keys(),
      ]);
      for (const id of allIds) {
        const vScore = anchorVec.scores.get(id) ?? 0;
        const lScore = anchorLex.get(id) ?? 0;
        hybridScores.set(id, 0.6 * vScore + 0.4 * lScore);
      }

      let anchorId: string | null = null;
      let bestScore = -1;
      for (const [id, score] of hybridScores.entries()) {
        if (score > bestScore) {
          bestScore = score;
          anchorId = id;
        }
      }

      // §35 SD-005: anchor 未検出時フォールバック — direction ベースの時間軸ソートで結果を返す
      if (!anchorId) {
        const fallbackParams: unknown[] = [];
        let fallbackSql = `
          SELECT
            o.id, o.event_id, o.platform, o.project, o.session_id,
            o.title, o.content_redacted, o.tags_json, o.privacy_tags_json,
            o.memory_type, o.created_at, o.access_count,
            e.event_type AS event_type
          FROM mem_observations o
          LEFT JOIN mem_events e ON e.event_id = o.event_id
          WHERE 1 = 1
        `;
        fallbackSql = this.appendProjectFilter(fallbackSql, fallbackParams, "o", projectMembers);
        if (!includePrivate) {
          fallbackSql += " AND (o.privacy_tags_json IS NULL OR o.privacy_tags_json = '[]')";
        }
        if (anchor.direction === "desc") {
          fallbackSql += " ORDER BY o.created_at DESC";
        } else {
          // "asc", "around" — デフォルトは ASC
          fallbackSql += " ORDER BY o.created_at ASC";
        }
        fallbackSql += " LIMIT ?";
        fallbackParams.push(limit);

        const fallbackRows = this.deps.db
          .query(fallbackSql)
          .all(...(fallbackParams as any[])) as Array<Record<string, unknown>>;

        return fallbackRows.map((row) => {
          const tags = parseArrayJson(row.tags_json);
          const privacyTags = parseArrayJson(row.privacy_tags_json);
          return {
            id: row.id,
            event_id: row.event_id,
            platform: row.platform,
            project: row.project,
            session_id: row.session_id,
            title: row.title,
            content: typeof row.content_redacted === "string"
              ? row.content_redacted.slice(0, 2000)
              : "",
            observation_type: "context",
            memory_type: row.memory_type || "semantic",
            created_at: row.created_at,
            tags,
            privacy_tags: privacyTags,
            access_count: Number(row.access_count ?? 0),
            anchor_strategy: `temporal_anchor_fallback:${anchor.type}:${anchor.direction}`,
            scores: {
              lexical: 0,
              vector: 0,
              recency: 0,
              tag_boost: 0,
              importance: 0,
              graph: 0,
              final: 0,
              rerank: 0,
            },
          };
        });
      }

      // アンカーエントリの created_at を取得
      const anchorObs = this.deps.db
        .query("SELECT created_at FROM mem_observations WHERE id = ?")
        .get(anchorId) as { created_at: string } | null;
      if (!anchorObs) return null;
      const anchorTs = anchorObs.created_at;

      // Phase 2: anchorTs を基点に時間フィルタ SQL で検索
      const params: SQLQueryBindings[] = [];
      let sql = `
        SELECT
          o.id, o.event_id, o.platform, o.project, o.session_id,
          o.title, o.content_redacted, o.tags_json, o.privacy_tags_json,
          o.memory_type, o.created_at, o.access_count,
          e.event_type AS event_type
        FROM mem_observations o
        LEFT JOIN mem_events e ON e.event_id = o.event_id
        WHERE o.id <> ?
      `;
      params.push(anchorId);

      sql = this.appendProjectFilter(sql, params, "o", projectMembers);
      if (!includePrivate) {
        sql += " AND (o.privacy_tags_json IS NULL OR o.privacy_tags_json = '[]')";
      }

      if (anchor.direction === "asc") {
        sql += " AND o.created_at > ?";
        params.push(anchorTs);
        sql += " ORDER BY o.created_at ASC";
      } else if (anchor.direction === "desc") {
        sql += " AND o.created_at < ?";
        params.push(anchorTs);
        sql += " ORDER BY o.created_at DESC";
      } else {
        // around: 前後を取得
        sql += " AND ABS(julianday(o.created_at) - julianday(?)) <= 7";
        params.push(anchorTs);
        sql += " ORDER BY ABS(julianday(o.created_at) - julianday(?)) ASC";
        params.push(anchorTs);
      }

      // S43-005: Phase 2 候補を limit * 3 以上確保して evidence coverage を改善
      const phase2Limit = Math.max(limit * 3, 30);
      sql += " LIMIT ?";
      params.push(phase2Limit);

      const rows = this.deps.db.query(sql).all(...params) as Array<Record<string, unknown>>;

      // S43-005: query との lexical 関連性でスコアリングして top-3 quality candidate を保証する
      const queryTokens = buildSearchTokens(request.query);
      const scored = rows.map((row) => {
        const titleText = typeof row.title === "string" ? row.title.toLowerCase() : "";
        const contentText =
          typeof row.content_redacted === "string" ? row.content_redacted.toLowerCase() : "";
        const combined = `${titleText} ${contentText}`;
        let relevanceScore = 0;
        for (const token of queryTokens) {
          if (combined.includes(token.toLowerCase())) relevanceScore += 1;
        }
        return { row, relevanceScore, created_at: String(row.created_at ?? "") };
      });

      const withRelevance = scored.filter((s) => s.relevanceScore > 0);
      const withoutRelevance = scored.filter((s) => s.relevanceScore === 0);
      const directionMultiplier = anchor.direction === "desc" ? -1 : 1;
      // S43-FIX: temporal ordering では created_at を主キーにし、
      // relevanceScore は tie-breaking に留める（時系列順序を保護）
      withRelevance.sort((a, b) => {
        const timeCmp = directionMultiplier * a.created_at.localeCompare(b.created_at);
        if (timeCmp !== 0) return timeCmp;
        return b.relevanceScore - a.relevanceScore;
      });
      withoutRelevance.sort(
        (a, b) => directionMultiplier * a.created_at.localeCompare(b.created_at)
      );
      const merged = [...withRelevance, ...withoutRelevance].slice(0, limit);

      return merged.map(({ row, relevanceScore }) => {
        const tags = parseArrayJson(row.tags_json);
        const privacyTags = parseArrayJson(row.privacy_tags_json);
        return {
          id: row.id,
          event_id: row.event_id,
          platform: row.platform,
          project: row.project,
          session_id: row.session_id,
          title: row.title,
          content:
            typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 2000) : "",
          observation_type: "context",
          memory_type: row.memory_type || "semantic",
          created_at: row.created_at,
          tags,
          privacy_tags: privacyTags,
          access_count: Number(row.access_count ?? 0),
          anchor_strategy: `temporal_anchor:${anchor.type}:${anchor.direction}`,
          scores: {
            lexical: 0,
            vector: 0,
            recency: 0,
            tag_boost: 0,
            importance: 0,
            graph: 0,
            final: Number(relevanceScore.toFixed(6)),
            rerank: Number(relevanceScore.toFixed(6)),
          },
        };
      });
    } catch {
      // フォールバック: anchor search に失敗した場合は null を返して通常検索に切り替え
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // S74-005: file: フィルター — クエリから "file:xxx" を解析し、該当するObservationIDセットを返す
  // ---------------------------------------------------------------------------

  /**
   * クエリ文字列から `file:path/to/file` パターンを抽出し、
   * mem_tags テーブルを使って一致する observation_id のセットを返す。
   * マッチがなければ null を返す（フィルターなし扱い）。
   */
  private extractFileFilterIds(query: string): Set<string> | null {
    const FILE_FILTER_RE = /\bfile:(\S+)/g;
    const filePaths: string[] = [];
    let match: RegExpExecArray | null;
    FILE_FILTER_RE.lastIndex = 0;
    while ((match = FILE_FILTER_RE.exec(query)) !== null) {
      if (match[1]) {
        filePaths.push(match[1]);
      }
    }
    if (filePaths.length === 0) return null;

    const matchedIds = new Set<string>();
    try {
      for (const filePath of filePaths) {
        // 完全一致（file:exact/path）と部分一致（LIKE %path%）の両方を試みる
        const exactTag = `file:${filePath}`;
        const exactRows = this.deps.db
          .query(`SELECT observation_id FROM mem_tags WHERE tag = ? AND tag_type = 'provenance'`)
          .all(exactTag) as Array<{ observation_id: string }>;
        for (const row of exactRows) {
          matchedIds.add(row.observation_id);
        }

        // 完全一致で見つからなければ部分一致（パスの一部でも検索できるように）
        if (exactRows.length === 0) {
          const likeRows = this.deps.db
            .query(`SELECT observation_id FROM mem_tags WHERE tag LIKE ? AND tag_type = 'provenance'`)
            .all(`%${filePath}%`) as Array<{ observation_id: string }>;
          for (const row of likeRows) {
            matchedIds.add(row.observation_id);
          }
        }
      }
    } catch {
      // best effort: フィルター失敗時はフィルターなし扱い
      return null;
    }

    return matchedIds;
  }

  // ---------------------------------------------------------------------------
  // search: ハイブリッド検索（lexical + vector + graph + recency + tag + importance）
  // ---------------------------------------------------------------------------

  search(request: SearchRequest): ApiResponse {
    const startedAt = performance.now();

    if (!this.deps.config.retrievalEnabled) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        retrieval_enabled: false,
      });
    }

    if (!request.query || !request.query.trim()) {
      return makeErrorResponse(
        startedAt,
        "query is required",
        request as unknown as Record<string, unknown>
      );
    }

    const limit = clampLimit(request.limit, 20, 1, 100);
    // S43-005: temporal クエリは candidate depth を拡張して取りこぼしを防ぐ
    const isTemporalQuery = request.question_kind === "timeline" || request.question_kind === "freshness";
    const internalLimit = isTemporalQuery
      ? Math.min(500, Math.max(400, limit * 8))
      : Math.min(500, limit * 5);
    const includePrivate = Boolean(request.include_private);
    const strictProject = request.strict_project !== false;
    const expandLinks =
      this.deps.searchExpandLinks !== false && request.expand_links !== false;
    const normalizedProject = request.project
      ? this.deps.normalizeProject(request.project)
      : request.project;
    const projectMembers =
      request.project && strictProject
        ? this.resolveProjectMembers(request.project)
        : undefined;
    // IMP-002 / FQ-013: exclude_updated が明示的に指定された場合のみ有効化
    const excludeUpdated = Boolean(request.exclude_updated);
    // S74-005: file: フィルターをクエリから除去して検索エンジンに渡す（lexical/vector には不要なトークン）
    const cleanedQuery = request.query.replace(/\bfile:\S+/g, "").replace(/\s+/g, " ").trim();
    // S78-B02: scope.project を正規化
    const normalizedScopeProject = request.scope?.project
      ? this.deps.normalizeProject(request.scope.project)
      : undefined;
    const normalizedRequest: SearchRequest = {
      ...request,
      query: cleanedQuery || request.query,
      project: normalizedProject,
      project_members: projectMembers,
      include_private: includePrivate,
      strict_project: strictProject,
      expand_links: expandLinks,
      exclude_updated: excludeUpdated,
      scope: request.scope
        ? { ...request.scope, project: normalizedScopeProject ?? request.scope.project }
        : undefined,
    };
    const hasLatestInteractionIntent = isLatestInteractionIntent(request.query);
    // COMP-003: as_of が指定されている場合、latest interaction は時点外の結果を混入させるためスキップ
    const latestInteraction = request.as_of
      ? null
      : this.getLatestInteractionContext(
          normalizedRequest, projectMembers || [],
          hasLatestInteractionIntent ? 400 : 20,
        );
    const prioritizeLatestInteraction = Boolean(latestInteraction) && hasLatestInteractionIntent;

    const lexical = this.lexicalSearch(normalizedRequest, internalLimit);
    const vectorResult = this.vectorSearch(normalizedRequest, internalLimit);
    const vector = vectorResult.scores;
    const graph = new Map<string, number>();

    const candidateIds = new Set<string>([...lexical.keys(), ...vector.keys()]);

    // S74-001: nugget-level vector search — lexical/vector で見つかった候補の nugget のみ検索
    // 全件スキャンを回避し、候補数に比例する高速検索を実現
    const nuggetScores = this.nuggetSearch(normalizedRequest.query, candidateIds);
    if (prioritizeLatestInteraction) {
      if (latestInteraction?.prompt?.id) candidateIds.add(latestInteraction.prompt.id);
      if (latestInteraction?.response?.id) candidateIds.add(latestInteraction.response.id);
    }
    if (expandLinks && candidateIds.size > 0) {
      const topIds = [...candidateIds]
        .sort((lhs, rhs) => {
          const lhsScore = (lexical.get(lhs) ?? 0) + (vector.get(lhs) ?? 0);
          const rhsScore = (lexical.get(rhs) ?? 0) + (vector.get(rhs) ?? 0);
          return rhsScore - lhsScore;
        })
        .slice(0, 10);
      const linked = this.expandByLinks(topIds, normalizedRequest, candidateIds);
      for (const [id, score] of linked.entries()) {
        // 新規IDは candidateIds に追加、既存IDは graph スコアのみ更新
        if (!candidateIds.has(id)) {
          candidateIds.add(id);
        }
        graph.set(id, score);
      }
    }

    // S78-C03: Multi-hop graph expansion via mem_relations entity graph
    const graphDepth = typeof request.graph_depth === "number" ? request.graph_depth : 0;
    if (graphDepth > 0 && candidateIds.size > 0) {
      const seedIds = [...candidateIds];
      const expanded = expandObservationsViaGraph(this.deps.db, seedIds, graphDepth);
      const GRAPH_DEPTH_BOOST = 0.1;
      for (const id of expanded) {
        if (!candidateIds.has(id)) {
          candidateIds.add(id);
          // New observations reachable via entity graph get a score boost
          graph.set(id, (graph.get(id) ?? 0) + GRAPH_DEPTH_BOOST);
        }
        // Boost score for graph-reachable observations (including seeds)
        // only when they were found via graph traversal (not already in seeds)
      }
    }

    // S78-C04: Graph-augmented hybrid search — blend graph proximity signal
    // graph_proximity(obs_X) = 1 / (1 + hop_distance(obs_X, any_query_entity))
    // Capped at 3 hops. HARNESS_MEM_GRAPH_OFF=1 disables entirely (A/B testing).
    // Proximity is stored in a separate map and applied as a direct additive term
    // in the final scorer (not blended into the RRF graph list) so that it has a
    // measurable and predictable effect on ranking independent of other graph signals.
    const DEFAULT_GRAPH_WEIGHT = 0.15;
    const graphWeightDisabled = process.env.HARNESS_MEM_GRAPH_OFF === "1";
    const graphWeight = graphWeightDisabled
      ? 0
      : typeof request.graph_weight === "number"
        ? request.graph_weight
        : DEFAULT_GRAPH_WEIGHT;
    const queryProximityScores = new Map<string, number>();
    if (graphWeight > 0 && candidateIds.size > 0) {
      const rawProximity = computeQueryEntityProximity(
        this.deps.db,
        normalizedRequest.query,
        [...candidateIds],
      );
      for (const [id, proximity] of rawProximity) {
        queryProximityScores.set(id, proximity);
      }
    }

    // S74-005: file: フィルター — クエリに "file:xxx" が含まれる場合、候補を絞り込む
    const fileFilterIds = this.extractFileFilterIds(request.query);
    if (fileFilterIds !== null) {
      if (candidateIds.size > 0) {
        // 既存候補との intersection
        for (const id of [...candidateIds]) {
          if (!fileFilterIds.has(id)) {
            candidateIds.delete(id);
          }
        }
      }
      // 検索結果が空でも file filter にヒットした観察は直接追加する
      for (const id of fileFilterIds) {
        candidateIds.add(id);
      }
    }

    // IMP-002: exclude_updated=true の場合、updatesリンクで上書きされた旧観察を除外
    const updatedObsIds = new Set<string>();
    if (excludeUpdated && candidateIds.size > 0) {
      try {
        const MAX_BATCH = 500;
        const allCandidates = [...candidateIds];
        for (let i = 0; i < allCandidates.length; i += MAX_BATCH) {
          const batch = allCandidates.slice(i, i + MAX_BATCH);
          const placeholders = batch.map(() => "?").join(", ");
          const updatedRows = this.deps.db
            .query(
              `SELECT to_observation_id FROM mem_links
               WHERE relation = 'updates' AND to_observation_id IN (${placeholders})`
            )
            .all(...batch) as Array<{ to_observation_id: string }>;
          for (const row of updatedRows) {
            updatedObsIds.add(row.to_observation_id);
          }
        }
      } catch {
        // best effort
      }
    }

    const observations = loadObservations(this.deps.db, [...candidateIds]);
    const queryTokens = buildSearchTokens(request.query);
    const routeDecision: RouteDecision = routeQuery(request.query, request.question_kind);
    const activeFactsByObservation = this.loadActiveFactsByObservation(projectMembers || [], [...candidateIds]);

    const ranked: SearchCandidate[] = [];
    let vectorCandidateCount = 0;
    let privacyExcludedCount = 0;
    let boundaryExcludedCount = 0;
    for (const id of candidateIds) {
      const observation = observations.get(id);
      if (!observation) continue;

      // IMP-002: updatesリンクで上書きされた旧観察を除外（FQ-013: デフォルト有効）
      if (excludeUpdated && updatedObsIds.has(id)) continue;

      const observationProject =
        typeof observation.project === "string" ? observation.project : "";
      if (strictProject && normalizedProject && observationProject !== normalizedProject) {
        boundaryExcludedCount++;
        continue;
      }

      const privacyTags = parseArrayJson(observation.privacy_tags_json);
      if (!includePrivate && hasPrivateVisibilityTag(privacyTags)) {
        privacyExcludedCount++;
        continue;
      }

      const createdAt =
        typeof observation.created_at === "string" ? observation.created_at : nowIso();
      const lexicalScore = lexical.get(id) ?? 0;
      const vectorScore = vector.get(id) ?? 0;
      if (vector.has(id)) vectorCandidateCount += 1;
      const recency = recencyScore(createdAt);
      const tagBoost = this.tagMatchScore(observation.tags_json, queryTokens);
      const eventType =
        typeof observation.event_type === "string" ? observation.event_type : "";
      const baseImportance = EVENT_TYPE_IMPORTANCE[eventType] ?? 0.5;
      // IMP-009: signal_score を加算 (上限1.0、下限0.0)
      const signalAdj =
        typeof observation.signal_score === "number" ? observation.signal_score : 0;
      // S74-001: nugget スコアを importance に加点（最大 +0.15）
      const nuggetAdj = Math.min(0.15, (nuggetScores.get(id) ?? 0) * 0.15);
      const importance = Math.min(1.0, Math.max(0.0, baseImportance + signalAdj + nuggetAdj));
      const graphScore = graph.get(id) ?? 0;
      const factBoost = this.computeActiveFactBoost(
        request.query,
        routeDecision.answerHints,
        activeFactsByObservation.get(id) ?? []
      );
      const precisionBoost = this.computePrecisionBoost(request.query, routeDecision.answerHints, observation);

      ranked.push({
        id,
        lexical: lexicalScore,
        vector: vectorScore,
        recency,
        tag_boost: tagBoost,
        importance,
        graph: graphScore,
        fact_boost: factBoost,
        precision_boost: precisionBoost,
        final: 0,
        rerank: 0,
        created_at: createdAt,
      });
    }

    // アクセス頻度による importance 加点（mem_audit_log の search_hit を一括集計）
    if (ranked.length > 0) {
      const ids = ranked.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      try {
        const hitCounts = this.deps.db
          .query(
            `SELECT target_id, COUNT(*) AS cnt
             FROM mem_audit_log
             WHERE action = 'search_hit' AND target_type = 'observation' AND target_id IN (${placeholders})
             GROUP BY target_id`
          )
          .all(...ids) as Array<{ target_id: string; cnt: number }>;
        const hitMap = new Map<string, number>();
        for (const row of hitCounts) {
          hitMap.set(row.target_id, Number(row.cnt));
        }
        for (const item of ranked) {
          const cnt = hitMap.get(item.id) ?? 0;
          // access_count >= 10 → +0.2, >= 5 → +0.1（上限 +0.2）
          const boost = cnt >= 10 ? 0.2 : cnt >= 5 ? 0.1 : 0;
          item.importance = Math.min(1.0, item.importance + boost);
        }
      } catch {
        // best effort: アクセス頻度加点に失敗しても検索は継続
      }
    }

    const vectorCoverage = ranked.length === 0 ? 0 : vectorCandidateCount / ranked.length;

    // Route query to determine retrieval strategy and weight overrides
    const baseWeights = this.resolveSearchWeights(vectorCoverage);
    // Blend router weights with existing weights: router takes precedence
    // when a specific question kind is detected (confidence > 0.5)
    const weights = routeDecision.confidence > 0.5 ? routeDecision.weights : baseWeights;

    // §34 FD-006: TIMELINE かつ temporalAnchors が存在する場合は Anchor-Pivoted Search を優先
    // §35 SD-003: freshness クエリも temporal anchor 検索を使用する
    // router.ts L419 は既に freshness に temporalAnchors を付与済み
    if (
      (routeDecision.kind === "timeline" || routeDecision.kind === "freshness") &&
      routeDecision.temporalAnchors &&
      routeDecision.temporalAnchors.length > 0
    ) {
      const primaryAnchor = routeDecision.temporalAnchors![0];
      const anchorItems = this.temporalAnchorSearch(normalizedRequest, primaryAnchor, limit);
      if (anchorItems && anchorItems.length > 0) {
        const anchorMeta: Record<string, unknown> = {
          ranking: routeDecision.kind,
          question_kind: routeDecision.kind,
          question_kind_confidence: Number(routeDecision.confidence.toFixed(3)),
          vector_engine: this.deps.getVectorEngine(),
          vector_model: this.deps.getVectorModelVersion(),
          fts_enabled: this.deps.ftsEnabled,
          embedding_provider: this.deps.getEmbeddingProviderName(),
          embedding_provider_status: this.deps.getEmbeddingHealthStatus(),
          anchor_strategy: `temporal_anchor:${primaryAnchor.type}:${primaryAnchor.direction}`,
          anchor_reference: primaryAnchor.referenceText,
          lexical_candidates: lexical.size,
          vector_candidates: vector.size,
          graph_candidates: 0,
          candidate_counts: {
            lexical: lexical.size,
            vector: vector.size,
            graph: 0,
            final: anchorItems.length,
          },
          latency_ms: performance.now() - startedAt,
          sla_latency_ms: 500,
          filters: {},
        };
        return makeResponse(startedAt, anchorItems, request as unknown as Record<string, unknown>, anchorMeta);
      }
    }

    const nowMs = Date.now();

    // RQ-006: RRF (Reciprocal Rank Fusion) — lexical / vector / graph の 3 リストを融合
    // k=60 はランク上位でのスコア差を緩和する標準パラメータ
    const RRF_K = 60;
    // スコア > 0 のアイテムのみランクリストに含める（0スコア = そのリストに存在しない）
    const lexicalRanked = [...ranked].filter((item) => item.lexical > 0).sort((a, b) => b.lexical - a.lexical);
    const lexicalRankMap = new Map<string, number>();
    lexicalRanked.forEach((item, idx) => lexicalRankMap.set(item.id, idx));
    const vectorRanked = [...ranked].filter((item) => item.vector > 0).sort((a, b) => b.vector - a.vector);
    const vectorRankMap = new Map<string, number>();
    vectorRanked.forEach((item, idx) => vectorRankMap.set(item.id, idx));
    // RQ-010: cat-3 multi-hop 強化 — graph スコアを第3 RRF リストとして追加
    const graphRanked = [...ranked].filter((item) => item.graph > 0).sort((a, b) => b.graph - a.graph);
    const graphRankMap = new Map<string, number>();
    graphRanked.forEach((item, idx) => graphRankMap.set(item.id, idx));

    for (const item of ranked) {
      // RRF スコア: lexical / vector / graph それぞれのリストに存在する場合のみ加算
      // スコア=0 のアイテムはそのリストに「ヒットしていない」ため寄与しない
      let rrfScore = 0;
      const rankLex = lexicalRankMap.get(item.id);
      if (rankLex !== undefined) {
        rrfScore += 1 / (RRF_K + rankLex);
      }
      const rankVec = vectorRankMap.get(item.id);
      if (rankVec !== undefined) {
        rrfScore += 1 / (RRF_K + rankVec);
      }
      // graph リストへの参加は weights.graph で重み付け（全クエリへの影響を抑制）
      const rankGraph = graphRankMap.get(item.id);
      if (rankGraph !== undefined) {
        rrfScore += weights.graph * (1 / (RRF_K + rankGraph));
      }
      // フォールバック: 全リストに存在しない場合は重み付きスコアで退避
      // （ランクを持たないがgraph等で候補入りしたアイテムを保護）
      if (rankLex === undefined && rankVec === undefined && rankGraph === undefined) {
        rrfScore =
          weights.lexical * item.lexical +
          weights.vector * item.vector;
      }
      // ポスト調整: recency / tag_boost / importance の 3 次元を加算
      // graph は RRF の第3リストに組み込み済みのためポスト調整からは除外
      const factBoostWeight =
        routeDecision.kind === "timeline"
          ? 0.03
          : routeDecision.answerHints?.intent === "metric_value"
            ? 0.16
            : 0.12;
      const precisionBoostWeight =
        routeDecision.kind === "timeline"
          ? 0.02
          : routeDecision.answerHints?.intent === "metric_value"
            ? 0.24
            : routeDecision.answerHints?.intent === "count"
              ? 0.12
              : 0.08;
      // S78-C04: graph proximity signal as direct additive term (linear blend)
      // w_graph * proximity is applied here, not via RRF, so it has a
      // predictable effect independent of RRF rank normalization.
      const proximityAdj = graphWeight * (queryProximityScores.get(item.id) ?? 0);
      const postAdjustment =
        weights.recency * item.recency +
        weights.tag_boost * item.tag_boost +
        weights.importance * item.importance +
        factBoostWeight * (item.fact_boost ?? 0) +
        precisionBoostWeight * (item.precision_boost ?? 0) +
        proximityAdj;
      const rawScore = rrfScore + postAdjustment;
      // COMP-002: 適応的メモリ減衰 - アクセス時刻に応じて decay 乗数を適用
      const obs = observations.get(item.id);
      const lastAccessedAt = (obs?.last_accessed_at as string | null | undefined) ?? null;
      const decayTier = getDecayTier(lastAccessedAt, nowMs);
      const decayMult = getDecayMultiplier(decayTier);
      item.final = rawScore * decayMult;
      if (prioritizeLatestInteraction) {
        if (latestInteraction?.prompt?.id === item.id) {
          item.final += 5;
        }
        if (latestInteraction?.response?.id === item.id) {
          item.final += 5.1;
        }
      }
    }

    this.applySessionProgressBoost(request.query, routeDecision, ranked, observations);

    ranked.sort((lhs, rhs) => {
      if (rhs.final !== lhs.final) return rhs.final - lhs.final;
      if (rhs.created_at !== lhs.created_at) {
        return String(rhs.created_at).localeCompare(String(lhs.created_at));
      }
      return lhs.id.localeCompare(rhs.id);
    });

    // RQ-011: temporal 2段階検索 — timeline クエリかつ anchor なし
    // Phase 1: RRF で上位候補確保（recall 保護: top-30 以上）
    // Phase 2: 候補内を query の向きに合わせて時系列ソートする。
    // デフォルトは古い順。latest/most recent 系のみ新しい順にする。
    if (this.shouldApplyTemporalTwoStageRerank(request, routeDecision)) {
      const TEMPORAL_CANDIDATE_K = Math.max(90, limit * 8);
      const temporalCandidates = ranked.slice(0, TEMPORAL_CANDIDATE_K);
      const descending = prefersDescendingTemporalOrder(request.query);
      temporalCandidates.sort((lhs, rhs) => {
        return descending
          ? String(rhs.created_at).localeCompare(String(lhs.created_at))
          : String(lhs.created_at).localeCompare(String(rhs.created_at));
      });
      // 残りはそのまま追加（recall 保護）
      const remaining = ranked.slice(TEMPORAL_CANDIDATE_K);
      ranked.length = 0;
      ranked.push(...temporalCandidates, ...remaining);
    }

    const rerankResult = this.applyRerank(request.query, ranked, observations, {
      // Timeline / freshness questions are order-sensitive, so preserve the
      // chronology decided by temporal anchor search or two-stage time rerank.
      skipSemanticRerank: routeDecision.kind === "timeline" || routeDecision.kind === "freshness",
    });
    const rankedAfterRerank = rerankResult.ranked;
    this.applyExactValuePriorityRerank(rankedAfterRerank, routeDecision, observations);
    this.applyAnswerHintPriorityRerank(request.query, rankedAfterRerank, routeDecision, observations);

    // S43-SEARCH: sort_by override — date_desc / date_asc は created_at でソート
    if (request.sort_by === "date_desc" || request.sort_by === "date_asc") {
      const ascending = request.sort_by === "date_asc";
      rankedAfterRerank.sort((a, b) => {
        const aTime = (observations.get(a.id)?.created_at as string) ?? "";
        const bTime = (observations.get(b.id)?.created_at as string) ?? "";
        return ascending ? aTime.localeCompare(bTime) : bTime.localeCompare(aTime);
      });
    }

    // S78-D02: Contradiction resolution — superseded 観察の post-filter
    // superseded 観察 = mem_links に (A, B, 'supersedes') が存在する B。
    // include_superseded=false → 除外。デフォルト(true) → rank を 0.5 倍に下げ、後方に沈める。
    const includeSuperseeded = request.include_superseded !== false; // default: true
    const supersededObsIds = new Set<string>();
    if (rankedAfterRerank.length > 0) {
      try {
        const allRankedIds = rankedAfterRerank.map((r) => r.id);
        const MAX_BATCH = 500;
        for (let i = 0; i < allRankedIds.length; i += MAX_BATCH) {
          const batch = allRankedIds.slice(i, i + MAX_BATCH);
          const placeholders = batch.map(() => "?").join(", ");
          const supersededRows = this.deps.db
            .query(
              `SELECT to_observation_id FROM mem_links
               WHERE relation = 'supersedes' AND to_observation_id IN (${placeholders})`
            )
            .all(...batch) as Array<{ to_observation_id: string }>;
          for (const row of supersededRows) {
            supersededObsIds.add(row.to_observation_id);
          }
        }
      } catch {
        // best effort: supersedes rank 調整失敗時は通常のランキングで継続
      }
    }

    // superseded 観察を除外 or rank 下げ
    let finalRanked = rankedAfterRerank;
    if (supersededObsIds.size > 0) {
      if (!includeSuperseeded) {
        // include_superseded=false: 完全除外
        finalRanked = rankedAfterRerank.filter((r) => !supersededObsIds.has(r.id));
      } else {
        // include_superseded=true (default): final score を 0.5 倍にして後方に沈める
        for (const r of rankedAfterRerank) {
          if (supersededObsIds.has(r.id)) {
            r.final = r.final * 0.5;
          }
        }
        // score 変更後に再ソート
        finalRanked = [...rankedAfterRerank].sort((lhs, rhs) => {
          if (rhs.final !== lhs.final) return rhs.final - lhs.final;
          if (rhs.created_at !== lhs.created_at) {
            return String(rhs.created_at).localeCompare(String(lhs.created_at));
          }
          return lhs.id.localeCompare(rhs.id);
        });
      }
    }

    const items = finalRanked.slice(0, limit).map((entry) => {
      const observation = observations.get(entry.id) ?? {};
      const tags = parseArrayJson(observation.tags_json);
      const privacyTags = parseArrayJson(observation.privacy_tags_json);

      // COMP-002: decay tier を算出して返却アイテムに含める
      const lastAccessedAt = (observation.last_accessed_at as string | null | undefined) ?? null;
      const decayTier = getDecayTier(lastAccessedAt, nowMs);
      const item: Record<string, unknown> = {
        id: entry.id,
        event_id: observation.event_id,
        platform: observation.platform,
        project: observation.project,
        session_id: observation.session_id,
        title: observation.title,
        content:
          typeof observation.content_redacted === "string"
            ? observation.content_redacted.slice(0, 2000)
            : "",
        observation_type: observation.observation_type || "context",
        memory_type: observation.memory_type || "semantic",
        created_at: observation.created_at,
        tags,
        privacy_tags: privacyTags,
        decay_tier: decayTier,
        access_count: Number(observation.access_count ?? 0),
        reason: generateSearchReason(entry),
        // S58-006: チーム共有ラベル — team_id が設定されている場合のみ付与
        ...(typeof observation.team_id === "string" && observation.team_id
          ? {
              shared_by: typeof observation.user_id === "string" && observation.user_id
                ? observation.user_id
                : "unknown",
              shared_at: typeof observation.updated_at === "string"
                ? observation.updated_at
                : observation.created_at,
            }
          : {}),
        scores: {
          lexical: Number(entry.lexical.toFixed(6)),
          vector: Number(entry.vector.toFixed(6)),
          recency: Number(entry.recency.toFixed(6)),
          tag_boost: Number(entry.tag_boost.toFixed(6)),
          importance: Number(entry.importance.toFixed(6)),
          graph: Number(entry.graph.toFixed(6)),
          final: Number(entry.final.toFixed(6)),
          rerank: Number((entry.rerank || entry.final).toFixed(6)),
        },
      };

      if (request.debug) {
        const total = entry.final;
        item.recall_trace = {
          lexical: Number((weights.lexical * entry.lexical).toFixed(6)),
          vector: Number((weights.vector * entry.vector).toFixed(6)),
          recency: Number((weights.recency * entry.recency).toFixed(6)),
          tag_boost: Number((weights.tag_boost * entry.tag_boost).toFixed(6)),
          importance: Number((weights.importance * entry.importance).toFixed(6)),
          graph: Number((weights.graph * entry.graph).toFixed(6)),
          total: Number(total.toFixed(6)),
        };
      }

      return item;
    });

    const meta: Record<string, unknown> = {
      ranking: this.deps.searchRanking,
      question_kind: routeDecision.kind,
      question_kind_confidence: Number(routeDecision.confidence.toFixed(3)),
      vector_engine: this.deps.getVectorEngine(),
      vector_model: this.deps.getVectorModelVersion(),
      fts_enabled: this.deps.ftsEnabled,
      embedding_provider: this.deps.getEmbeddingProviderName(),
      embedding_provider_status: this.deps.getEmbeddingHealthStatus(),
      lexical_candidates: lexical.size,
      vector_candidates: vector.size,
      graph_candidates: graph.size,
      candidate_counts: {
        lexical: lexical.size,
        vector: vector.size,
        graph: graph.size,
        final: finalRanked.length,
      },
      vector_coverage: Number(vectorCoverage.toFixed(6)),
    };
    // Append migration warning when vectors are in a mixed-model state
    if (vectorResult.migrationWarning) {
      const existingWarnings = Array.isArray(meta.warnings)
        ? (meta.warnings as string[])
        : [];
      meta.warnings = [...existingWarnings, vectorResult.migrationWarning];
    }
    meta.token_estimate = buildTokenEstimateMeta({
      input: {
        query: request.query,
        limit,
        project: request.project,
      },
      output: items.map((item) => ({
        id: item.id,
        title: item.title,
      })),
      strategy: "index",
    });
    const latestInteractionMeta = this.buildLatestInteractionMeta(latestInteraction);
    if (latestInteractionMeta) {
      meta.latest_interaction = latestInteractionMeta;
    }
    if (request.debug) {
      meta.debug = {
        strict_project: strictProject,
        expand_links: expandLinks,
        weights,
        vector_backend_coverage: Number(vectorResult.coverage.toFixed(6)),
        embedding_provider: this.deps.getEmbeddingProviderName(),
        embedding_model: this.deps.embeddingProviderModel,
        reranker: {
          enabled: this.deps.getRerankerEnabled(),
          name: this.deps.getReranker()?.name || null,
        },
        rerank_pre: rerankResult.pre,
        rerank_post: rerankResult.post,
      };
    }

    try {
      this.deps.writeAuditLog("read.search", "project", normalizedProject || "", {
        query: request.query,
        limit,
        include_private: includePrivate,
        count: items.length,
        privacy_excluded_count: privacyExcludedCount,
        boundary_excluded_count: boundaryExcludedCount,
      });
      if (privacyExcludedCount > 0) {
        this.deps.writeAuditLog(
          "privacy_filter",
          "search",
          normalizedProject || "",
          {
            reason: "include_private_false",
            query: request.query,
            returned_count: items.length,
            excluded_count: privacyExcludedCount,
            path: `search/${normalizedProject || "global"}`,
            ts: nowIso(),
          }
        );
      }
      if (boundaryExcludedCount > 0) {
        this.deps.writeAuditLog(
          "boundary_filter",
          "search",
          normalizedProject || "",
          {
            reason: "workspace_boundary",
            excluded_count: boundaryExcludedCount,
            project: normalizedProject,
          }
        );
      }
      // 返却した observation ごとに search_hit を記録し、access_count をインクリメント
      const hitIds = (items as Array<{ id?: unknown }>)
        .map((item) => item.id as string)
        .filter((id): id is string => Boolean(id));
      if (hitIds.length > 0) {
        try {
          this.deps.db.transaction(() => {
            const now = new Date().toISOString();
            const ph = hitIds.map(() => "?").join(",");
            // COMP-002: access_count インクリメント + last_accessed_at 更新（バッチ）
            this.deps.db
              .query(
                `UPDATE mem_observations SET access_count = COALESCE(access_count,0)+1, last_accessed_at=? WHERE id IN (${ph})`
              )
              .run(now, ...hitIds);
            // audit_log バッチ INSERT
            const auditValues = hitIds.map(() => "(?,?,?,?,?,?)").join(",");
            const auditParams: SQLQueryBindings[] = [];
            for (const id of hitIds) {
              auditParams.push(
                "search_hit",
                "system",
                "observation",
                id,
                JSON.stringify({ query: request.query?.substring(0, 100), project: normalizedProject }),
                now
              );
            }
            this.deps.db
              .query(
                `INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at) VALUES ${auditValues}`
              )
              .run(...auditParams);
          })();
        } catch {
          // best effort: access_count 更新に失敗しても検索結果は返す
        }
      }
    } catch {
      // best effort
    }

    // Shadow-read: compare results with managed backend (fire-and-forget)
    if (this.deps.managedShadowRead) {
      const resultIds = items.map((item) => item.id as string);
      this.deps.managedShadowRead(request.query, resultIds, {
        project: normalizedProject,
        limit,
      }).catch(() => {
        // fire-and-forget, errors tracked in shadow metrics
      });
    }

    // Evidence-bound answer compilation
    const compiled = compileAnswer({
      question_kind: routeDecision.kind,
      observations: items.map((item) => ({
        id: item.id as string,
        platform: item.platform as string,
        project: item.project as string,
        title: item.title as string | null,
        content_redacted: item.content as string,
        created_at: item.created_at as string,
        tags_json: JSON.stringify(item.tags),
        session_id: item.session_id as string,
        final_score: (item.scores as { final: number }).final,
      })),
      privacy_excluded_count: privacyExcludedCount,
    });
    meta.compiled = {
      question_kind: compiled.question_kind,
      evidence_count: compiled.evidence_count,
      platforms: compiled.meta.platforms,
      projects: compiled.meta.projects,
      time_span: compiled.meta.time_span,
      cross_session: compiled.meta.cross_session,
      privacy_excluded: compiled.meta.privacy_excluded,
    };

    const response = makeResponse(startedAt, items, request as unknown as Record<string, unknown>, meta);
    response.no_memory = false;
    response.no_memory_reason = "";

    const topCandidate = rankedAfterRerank[0];
    const hasStrongMemoryEvidence = Boolean(topCandidate) && (
      (topCandidate.lexical ?? 0) >= 0.35 ||
      (topCandidate.tag_boost ?? 0) >= 0.2 ||
      (topCandidate.fact_boost ?? 0) >= 0.18 ||
      (topCandidate.precision_boost ?? 0) >= 0.18
    );

    // S58-002: no_memory フラグ — 低スコアでも lexical / fact / precision の
    // 根拠が十分強い場合は false positive を避ける
    if (items.length === 0) {
      response.no_memory = true;
      response.no_memory_reason = "No matching memories found";
    } else {
      const topScore = (items[0] as Record<string, unknown>)?.scores as { final?: number } | undefined;
      const topFinalScore = topScore?.final ?? 0;
      if (topFinalScore < NO_MEMORY_SCORE_THRESHOLD && !hasStrongMemoryEvidence) {
        response.no_memory = true;
        response.no_memory_reason = "No matching memories found";
      }
    }

    return response;
  }

  // ---------------------------------------------------------------------------
  // feed
  // ---------------------------------------------------------------------------

  feed(request: FeedRequest): ApiResponse {
    const startedAt = performance.now();

    if (!this.deps.config.retrievalEnabled) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        retrieval_enabled: false,
      });
    }

    const limit = clampLimit(request.limit, 40, 1, 200);
    const includePrivate = Boolean(request.include_private);
    const cursor = decodeFeedCursor(request.cursor);
    const typeFilter =
      typeof request.type === "string" && request.type.trim()
        ? request.type.trim()
        : undefined;
    const projectMembers = request.project_members ?? this.resolveProjectMembers(request.project);

    const params: unknown[] = [];
    let sql = `
      SELECT
        o.id,
        o.event_id,
        o.platform,
        o.project,
        o.session_id,
        o.title,
        o.content_redacted,
        o.tags_json,
        o.privacy_tags_json,
        o.user_id,
        o.team_id,
        o.memory_type,
        o.created_at,
        e.event_type AS event_type
      FROM mem_observations o
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE 1 = 1
    `;

    sql = this.appendProjectFilter(sql, params, "o", projectMembers);

    if (typeFilter) {
      sql += " AND COALESCE(e.event_type, '') = ?";
      params.push(typeFilter);
    }

    sql += this.deps.platformVisibilityFilterSql("o");
    sql += visibilityFilterSql("o", includePrivate);

    if (this.deps.accessFilter?.sql) {
      sql += " " + this.deps.accessFilter.sql;
      params.push(...this.deps.accessFilter.params);
    }

    // TEAM-005/TEAM-009: user_id / team_id フィルター
    // _member_scope=true の場合は OR 条件（自分 OR 同チーム）、それ以外は AND 条件（TEAM-009 互換）
    const userIdFilter = typeof request.user_id === "string" && request.user_id.trim() ? request.user_id.trim() : undefined;
    const teamIdFilter = typeof request.team_id === "string" && request.team_id.trim() ? request.team_id.trim() : undefined;
    if (request._member_scope && userIdFilter && teamIdFilter) {
      // member ロール: 自分 OR 同チームの OR 条件
      sql += " AND (o.user_id = ? OR o.team_id = ?)";
      params.push(userIdFilter, teamIdFilter);
    } else if (request._member_scope && userIdFilter) {
      sql += " AND o.user_id = ?";
      params.push(userIdFilter);
    } else {
      // TEAM-009 互換: AND 結合（クエリパラメータによる個別フィルタ）
      if (userIdFilter) {
        sql += " AND o.user_id = ?";
        params.push(userIdFilter);
      }
      if (teamIdFilter) {
        sql += " AND o.team_id = ?";
        params.push(teamIdFilter);
      }
    }

    // V5-004: memory_type フィルター
    if (request.memory_type !== undefined) {
      const types = Array.isArray(request.memory_type) ? request.memory_type : [request.memory_type];
      if (types.length === 1) {
        sql += " AND o.memory_type = ?";
        params.push(types[0]);
      } else if (types.length > 1) {
        const placeholders = types.map(() => "?").join(", ");
        sql += ` AND o.memory_type IN (${placeholders})`;
        params.push(...types);
      }
    }

    if (cursor) {
      sql += " AND (o.created_at < ? OR (o.created_at = ? AND o.id < ?))";
      params.push(cursor.created_at, cursor.created_at, cursor.id);
    }

    sql += " ORDER BY o.created_at DESC, o.id DESC LIMIT ?";
    params.push(limit + 1);

    const rows = this.deps.db
      .query(sql)
      .all(...(params as any[])) as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items = pageRows.map((row) => {
      const eventTypeRaw = typeof row.event_type === "string" ? row.event_type : "";
      const eventType = eventTypeRaw || "unknown";
      const cardType = eventType === "session_end" ? "session_summary" : eventType;
      const content = typeof row.content_redacted === "string" ? row.content_redacted : "";
      const privacyTags = parseArrayJson(row.privacy_tags_json);

      return {
        id: row.id,
        event_id: row.event_id,
        platform: row.platform,
        project: row.project,
        canonical_project: this.deps.canonicalizeProject(String(row.project || "")),
        session_id: row.session_id,
        event_type: eventType,
        card_type: cardType,
        title: row.title || eventType,
        content: content.slice(0, 1200),
        memory_type: row.memory_type || "semantic",
        created_at: row.created_at,
        tags: parseArrayJson(row.tags_json),
        privacy_tags: privacyTags,
        user_id: row.user_id,
        team_id: row.team_id,
      };
    });

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      const createdAt = typeof last.created_at === "string" ? last.created_at : "";
      const id = typeof last.id === "string" ? last.id : "";
      if (createdAt && id) {
        nextCursor = encodeFeedCursor({ created_at: createdAt, id });
      }
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      ranking: "feed_v1",
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  }

  // ---------------------------------------------------------------------------
  // searchFacets
  // ---------------------------------------------------------------------------

  searchFacets(request: SearchFacetsRequest): ApiResponse {
    const startedAt = performance.now();
    const includePrivate = Boolean(request.include_private);
    const projectMembers = request.project_members ?? this.resolveProjectMembers(request.project);
    const query = (request.query || "").trim();

    // MAJOR-5: SQL GROUP BY で project・event_type・時間バケットを集計し、
    // JS 側の全件ループを排除する。tags_json のみ JS でパースが必要なため
    // 別途 LIMIT 付きで取得する。

    // 共通 WHERE 条件を構築するヘルパー
    const buildBaseFilter = (): { whereClauses: string; baseParams: unknown[] } => {
      const baseParams: unknown[] = [];
      let whereClauses = " WHERE 1 = 1";
      whereClauses = this.appendProjectFilter(whereClauses, baseParams, "o", projectMembers);
      whereClauses += this.deps.platformVisibilityFilterSql("o");
      whereClauses += visibilityFilterSql("o", includePrivate);
      if (this.deps.accessFilter?.sql) {
        whereClauses += " " + this.deps.accessFilter.sql;
        baseParams.push(...this.deps.accessFilter.params);
      }
      // TEAM-005: テナント分離 — per-request user_id/team_id フィルタ
      if (request.user_id) {
        if (request.team_id) {
          whereClauses += ` AND (o.user_id = ? OR o.team_id = ?)`;
          baseParams.push(request.user_id, request.team_id);
        } else {
          whereClauses += ` AND o.user_id = ?`;
          baseParams.push(request.user_id);
        }
      }
      if (query) {
        if (this.deps.ftsEnabled) {
          whereClauses += ` AND o.rowid IN (SELECT rowid FROM mem_observations_fts WHERE mem_observations_fts MATCH ?)`;
          baseParams.push(buildFtsQuery(query));
        } else {
          const escapedLike = escapeLikePattern(query);
          whereClauses += " AND (o.title LIKE ? ESCAPE '\\' OR o.content_redacted LIKE ? ESCAPE '\\')";
          baseParams.push(`%${escapedLike}%`, `%${escapedLike}%`);
        }
      }
      return { whereClauses, baseParams };
    };

    const { whereClauses, baseParams } = buildBaseFilter();

    // (1) project 集計: SQL GROUP BY
    const projectRows = this.deps.db
      .query(
        `SELECT COALESCE(o.project,'unknown') AS value, COUNT(*) AS cnt
         FROM mem_observations o${whereClauses}
         GROUP BY o.project
         ORDER BY cnt DESC
         LIMIT 30`
      )
      .all(...(baseParams as any[])) as Array<{ value: string; cnt: number }>;

    // (2) event_type 集計: SQL GROUP BY
    const eventTypeRows = this.deps.db
      .query(
        `SELECT COALESCE(e.event_type,'unknown') AS value, COUNT(*) AS cnt
         FROM mem_observations o
         LEFT JOIN mem_events e ON e.event_id = o.event_id${whereClauses}
         GROUP BY e.event_type
         ORDER BY cnt DESC
         LIMIT 20`
      )
      .all(...(baseParams as any[])) as Array<{ value: string; cnt: number }>;

    // (3) 時間バケット集計: SQL CASE 式で分類
    const nowIsoForSql = new Date().toISOString();
    const bucketRows = this.deps.db
      .query(
        `SELECT
           CASE
             WHEN o.created_at >= datetime(?, '-1 day')   THEN '24h'
             WHEN o.created_at >= datetime(?, '-7 days')  THEN '7d'
             WHEN o.created_at >= datetime(?, '-30 days') THEN '30d'
             ELSE 'older'
           END AS value,
           COUNT(*) AS cnt
         FROM mem_observations o${whereClauses}
         GROUP BY value`
      )
      .all(nowIsoForSql, nowIsoForSql, nowIsoForSql, ...(baseParams as any[])) as Array<{ value: string; cnt: number }>;

    // (4) total_candidates
    const totalRow = this.deps.db
      .query(`SELECT COUNT(*) AS cnt FROM mem_observations o${whereClauses}`)
      .get(...(baseParams as any[])) as { cnt: number } | null;
    const totalCandidates = Number(totalRow?.cnt ?? 0);

    // (5) tags_json: JSON_EACH で SQL 側で GROUP BY 集計（LIMIT 5000 JS集計を廃止）
    const tagRows = this.deps.db
      .query(
        `SELECT jt.value AS tag, COUNT(*) AS cnt
         FROM mem_observations o, json_each(o.tags_json) AS jt${whereClauses}
         GROUP BY jt.value
         ORDER BY cnt DESC
         LIMIT 50`
      )
      .all(...(baseParams as any[])) as Array<{ tag: string; cnt: number }>;

    const tagCounts = new Map<string, number>();
    for (const row of tagRows) {
      tagCounts.set(row.tag, Number(row.cnt));
    }

    const toFacetArray = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort(
          (lhs, rhs) => rhs.count - lhs.count || lhs.value.localeCompare(rhs.value)
        );

    const toFacetArrayFromRows = (rows: Array<{ value: string; cnt: number }>) =>
      rows.map((r) => ({ value: r.value, count: Number(r.cnt) }));

    const groupedProjectCounts = new Map<string, number>();
    for (const row of projectRows) {
      const canonical = this.deps.canonicalizeProject(String(row.value || ""));
      if (!canonical) {
        continue;
      }
      groupedProjectCounts.set(canonical, (groupedProjectCounts.get(canonical) || 0) + Number(row.cnt || 0));
    }
    const groupedProjects = [...groupedProjectCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((lhs, rhs) => rhs.count - lhs.count || lhs.value.localeCompare(rhs.value));

    // 時間バケットは固定順で返す
    const bucketMap = new Map<string, number>(
      bucketRows.map((r) => [r.value, Number(r.cnt)])
    );
    const timeBuckets = [
      { value: "24h", count: bucketMap.get("24h") ?? 0 },
      { value: "7d", count: bucketMap.get("7d") ?? 0 },
      { value: "30d", count: bucketMap.get("30d") ?? 0 },
      { value: "older", count: bucketMap.get("older") ?? 0 },
    ];

    return makeResponse(
      startedAt,
      [
        {
          query: query || null,
          total_candidates: totalCandidates,
          projects: groupedProjects,
          event_types: toFacetArrayFromRows(eventTypeRows),
          tags: toFacetArray(tagCounts).slice(0, 50),
          time_buckets: timeBuckets,
        },
      ],
      {
        query: query || undefined,
        project: request.project,
        include_private: includePrivate,
      },
      { ranking: "search_facets_v1" }
    );
  }

  // ---------------------------------------------------------------------------
  // timeline
  // ---------------------------------------------------------------------------

  async timeline(request: TimelineRequest): Promise<ApiResponse> {
    const startedAt = performance.now();

    const before = clampLimit(request.before, 5, 0, 50);
    const after = clampLimit(request.after, 5, 0, 50);

    const centerRow = await this.deps.repo.findById(request.id);
    const center: Record<string, unknown> | null = centerRow as unknown as Record<string, unknown> | null;

    if (!center) {
      return makeErrorResponse(startedAt, `observation not found: ${request.id}`, {
        id: request.id,
      });
    }

    const includePrivate = Boolean(request.include_private);

    // TEAM-005: テナント分離 — center observation の所有権チェック
    if (request.user_id) {
      const centerUserId = typeof center.user_id === "string" ? center.user_id : "";
      const centerTeamId = typeof center.team_id === "string" ? center.team_id : "";
      const isOwner = centerUserId === request.user_id;
      const isSameTeam = request.team_id ? centerTeamId === request.team_id : false;
      if (!isOwner && !isSameTeam) {
        return makeErrorResponse(startedAt, `observation not found: ${request.id}`, {
          id: request.id,
        });
      }
    }

    if (!includePrivate) {
      const centerPrivacyTags = parseArrayJson(
        typeof center.privacy_tags_json === "string" ? center.privacy_tags_json : "[]"
      );
      if (isPrivateTag(centerPrivacyTags)) {
        return makeErrorResponse(startedAt, `observation not found: ${request.id}`, {
          id: request.id,
        });
      }
    }

    const centerProject = typeof center.project === "string" ? center.project : "";
    const centerSession = typeof center.session_id === "string" ? center.session_id : "";
    const centerCreatedAt =
      typeof center.created_at === "string" ? center.created_at : nowIso();
    const visibility = visibilityFilterSql("o", includePrivate);

    // TEAM-005: テナント分離 — before/after クエリにもテナントフィルタ適用
    const tenantFilterSql = request.user_id
      ? (request.team_id
        ? ` AND (o.user_id = ? OR o.team_id = ?)`
        : ` AND o.user_id = ?`)
      : "";
    const tenantFilterParams: unknown[] = request.user_id
      ? (request.team_id ? [request.user_id, request.team_id] : [request.user_id])
      : [];

    const beforeRows = this.deps.db
      .query(
        `
          SELECT o.id, o.created_at, o.title, o.content_redacted, o.tags_json, o.privacy_tags_json
          FROM mem_observations o
          WHERE o.project = ? AND o.session_id = ? AND o.created_at < ?
          ${tenantFilterSql}
          ${visibility}
          ORDER BY o.created_at DESC
          LIMIT ?
        `
      )
      .all(...([centerProject, centerSession, centerCreatedAt, ...tenantFilterParams, before] as any[])) as Array<
      Record<string, unknown>
    >;

    const afterRows = this.deps.db
      .query(
        `
          SELECT o.id, o.created_at, o.title, o.content_redacted, o.tags_json, o.privacy_tags_json
          FROM mem_observations o
          WHERE o.project = ? AND o.session_id = ? AND o.created_at > ?
          ${tenantFilterSql}
          ${visibility}
          ORDER BY o.created_at ASC
          LIMIT ?
        `
      )
      .all(...([centerProject, centerSession, centerCreatedAt, ...tenantFilterParams, after] as any[])) as Array<
      Record<string, unknown>
    >;

    const normalizeItem = (
      row: Record<string, unknown>,
      position: "before" | "center" | "after"
    ) => ({
      id: row.id,
      position,
      created_at: row.created_at,
      title: row.title,
      content:
        typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 1200) : "",
      tags: parseArrayJson(row.tags_json),
      privacy_tags: parseArrayJson(row.privacy_tags_json),
    });

    const items = [
      ...beforeRows.reverse().map((row) => normalizeItem(row, "before")),
      normalizeItem(center, "center"),
      ...afterRows.map((row) => normalizeItem(row, "after")),
    ];

    try {
      this.deps.writeAuditLog("read.timeline", "observation", request.id, {
        before,
        after,
        include_private: includePrivate,
        count: items.length,
      });
    } catch {
      // best effort
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      center_id: request.id,
      token_estimate: buildTokenEstimateMeta({
        input: {
          id: request.id,
          before,
          after,
        },
        output: items,
        strategy: "timeline",
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // getObservations
  // ---------------------------------------------------------------------------

  getObservations(request: GetObservationsRequest): ApiResponse {
    const startedAt = performance.now();
    const ids = Array.isArray(request.ids)
      ? request.ids.filter((id): id is string => typeof id === "string")
      : [];

    if (ids.length === 0) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        token_estimate: buildTokenEstimateMeta({
          input: { ids: [] },
          output: [],
          strategy: "details",
        }),
      });
    }

    const observationMap = loadObservations(this.deps.db, ids);
    const includePrivate = Boolean(request.include_private);
    const compact = request.compact !== false;
    const accessFilter = this.deps.accessFilter;

    const items: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const row = observationMap.get(id);
      if (!row) continue;

      // TEAM-005: アクセス制御 — admin は全許可、member は自分 or 同チームのみ
      // per-request user_id/team_id（server.ts から注入）を優先チェック
      const effectiveUserId = request.user_id ?? accessFilter?.user_id;
      const effectiveTeamId = request.team_id ?? accessFilter?.team_id;
      if (effectiveUserId) {
        const rowUserId = typeof row.user_id === "string" ? row.user_id : "";
        const rowTeamId = typeof row.team_id === "string" ? row.team_id : null;
        const allowed = rowUserId === effectiveUserId ||
          (effectiveTeamId != null && rowTeamId === effectiveTeamId);
        if (!allowed) {
          continue;
        }
      }

      const privacyTags = parseArrayJson(row.privacy_tags_json);
      if (!includePrivate && isPrivateTag(privacyTags)) continue;

      const content = typeof row.content_redacted === "string" ? row.content_redacted : "";

      items.push({
        id,
        event_id: row.event_id,
        platform: row.platform,
        project: row.project,
        session_id: row.session_id,
        title: row.title,
        content: compact ? content.slice(0, 800) : content,
        // S78-B01: Include raw_text when present (null for legacy rows / RAW=0 mode).
        // Consumers can choose which field to display; content is always the structured summary.
        raw_text: typeof row.raw_text === "string" ? row.raw_text : null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: parseArrayJson(row.tags_json),
        privacy_tags: privacyTags,
      });
    }

    const warnings: string[] = [];
    if (ids.length >= 20) {
      warnings.push(
        "Large details request detected. Prefer 3-layer workflow: search -> timeline -> get_observations (targeted IDs)."
      );
    }

    try {
      this.deps.writeAuditLog("read.get_observations", "observation", ids[0] || "", {
        requested_ids: ids.length,
        returned_ids: items.length,
        include_private: includePrivate,
        compact,
      });
    } catch {
      // best effort
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      compact,
      token_estimate: buildTokenEstimateMeta({
        input: { ids, compact },
        output: items,
        strategy: "details",
      }),
      warnings,
    });
  }

  // ---------------------------------------------------------------------------
  // resumePack
  // ---------------------------------------------------------------------------

  resumePack(request: ResumePackRequest): ApiResponse {
    const startedAt = performance.now();

    if (!this.deps.config.injectionEnabled) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, { injection_enabled: false });
    }

    if (!request.project) {
      return makeErrorResponse(startedAt, "project is required", request as unknown as Record<string, unknown>);
    }

    const normalizedProject = this.deps.normalizeProject(request.project);
    const projectMembers = request.project_members ?? this.resolveProjectMembers(request.project, "sessions");
    const limit = clampLimit(request.limit, 5, 1, 20);
    const includePrivate = Boolean(request.include_private);
    const visibility = visibilityFilterSql("o", includePrivate);

    // max_tokens: request > config > env > default (2000)
    const requestedBudget = request.resume_pack_max_tokens;
    const maxTokens: number = (() => {
      if (typeof requestedBudget === "number" && requestedBudget >= 0) {
        return requestedBudget;
      }
      if (typeof this.deps.config.resumePackMaxTokens === "number" && this.deps.config.resumePackMaxTokens > 0) {
        return this.deps.config.resumePackMaxTokens;
      }
      const envRaw = Number(process.env.HARNESS_MEM_RESUME_PACK_MAX_TOKENS);
      if (Number.isFinite(envRaw) && envRaw > 0) {
        return envRaw;
      }
      // Default raised from 2000→4000 for Opus 4.6 (64k default / 128k max output tokens)
      return 4000;
    })();

    if (maxTokens === 0) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        include_summary: false,
        correlation_id: request.correlation_id ?? null,
        compaction_ratio: 0,
        resume_pack_max_tokens: 0,
        detailed_count: 0,
        compacted_count: 0,
      });
    }

    const useCorrelationId = Boolean(request.correlation_id);
    const correlationId = request.correlation_id ?? null;

    const summaryParams: unknown[] = [];
    let latestSummarySql = `
      SELECT s.session_id, s.summary, s.ended_at
      FROM mem_sessions s
      WHERE 1 = 1
    `;
    latestSummarySql = this.appendProjectFilter(latestSummarySql, summaryParams, "s", projectMembers);
    // TEAM-005: テナント分離 — session テーブルの user_id でフィルタ
    latestSummarySql = this.appendTenantFilter(latestSummarySql, summaryParams, "s", request.user_id, request.team_id);
    latestSummarySql += useCorrelationId ? " AND s.correlation_id = ?" : " AND s.summary IS NOT NULL";
    if (useCorrelationId) {
      summaryParams.push(correlationId as string);
    }
    latestSummarySql += " ORDER BY s.ended_at DESC LIMIT 1";
    const latestSummary = this.deps.db
      .query(latestSummarySql)
      .get(...(summaryParams as any[])) as { session_id: string; summary: string; ended_at: string } | null;

    const pinnedContinuityParams: unknown[] = [];
    let pinnedContinuitySql = `
      SELECT o.session_id, o.content_redacted AS content, o.created_at
      FROM mem_observations o
    `;
    if (useCorrelationId) {
      pinnedContinuitySql += "\n      JOIN mem_sessions s ON s.session_id = o.session_id";
    }
    pinnedContinuitySql += "\n      WHERE 1 = 1";
    pinnedContinuitySql = this.appendProjectFilter(pinnedContinuitySql, pinnedContinuityParams, "o", projectMembers);
    // TEAM-005: テナント分離
    pinnedContinuitySql = this.appendTenantFilter(pinnedContinuitySql, pinnedContinuityParams, "o", request.user_id, request.team_id);
    pinnedContinuitySql += " AND o.title = 'continuity_handoff'";
    pinnedContinuitySql += " AND o.tags_json LIKE '%\"continuity_handoff\"%'";
    if (useCorrelationId) {
      pinnedContinuitySql += " AND s.correlation_id = ?";
      pinnedContinuityParams.push(correlationId as string);
    }
    if (request.session_id) {
      pinnedContinuitySql += " AND o.session_id <> ?";
      pinnedContinuityParams.push(request.session_id);
    }
    pinnedContinuitySql += `${visibility} ORDER BY o.created_at DESC LIMIT 1`;
    const pinnedContinuity = this.deps.db
      .query(pinnedContinuitySql)
      .get(...(pinnedContinuityParams as any[])) as {
      session_id: string;
      content: string;
      created_at: string;
    } | null;

    let rows: Array<Record<string, unknown>>;

    if (useCorrelationId) {
      const rowParams: unknown[] = [];
      let rowsSql = `
        SELECT
          o.id,
          o.event_id,
          o.platform,
          o.project,
          o.session_id,
          o.title,
          o.content_redacted,
          o.tags_json,
          o.privacy_tags_json,
          o.created_at,
          e.event_type
        FROM mem_observations o
        JOIN mem_sessions s ON o.session_id = s.session_id
        LEFT JOIN mem_events e ON o.event_id = e.event_id
        WHERE 1 = 1
      `;
      rowsSql = this.appendProjectFilter(rowsSql, rowParams, "o", projectMembers);
      // TEAM-005: テナント分離
      rowsSql = this.appendTenantFilter(rowsSql, rowParams, "o", request.user_id, request.team_id);
      rowsSql += " AND s.correlation_id = ?";
      rowParams.push(correlationId as string);
      if (request.session_id) {
        rowsSql += " AND o.session_id <> ?";
        rowParams.push(request.session_id);
      }
      rowsSql += `${visibility} ORDER BY o.created_at DESC LIMIT ?`;
      rowParams.push(limit);
      rows = this.deps.db
        .query(rowsSql)
        .all(...(rowParams as any[])) as Array<Record<string, unknown>>;
    } else {
      const rowParams: unknown[] = [];
      let rowsSql = `
        SELECT
          o.id,
          o.event_id,
          o.platform,
          o.project,
          o.session_id,
          o.title,
          o.content_redacted,
          o.tags_json,
          o.privacy_tags_json,
          o.created_at,
          e.event_type
        FROM mem_observations o
        LEFT JOIN mem_events e ON o.event_id = e.event_id
        WHERE 1 = 1
      `;
      rowsSql = this.appendProjectFilter(rowsSql, rowParams, "o", projectMembers);
      // TEAM-005: テナント分離
      rowsSql = this.appendTenantFilter(rowsSql, rowParams, "o", request.user_id, request.team_id);
      if (request.session_id) {
        rowsSql += " AND o.session_id <> ?";
        rowParams.push(request.session_id);
      }
      rowsSql += `${visibility} ORDER BY o.created_at DESC LIMIT ?`;
      rowParams.push(limit);
      rows = this.deps.db
        .query(rowsSql)
        .all(...(rowParams as any[])) as Array<Record<string, unknown>>;
    }

    interface RankedRow {
      row: Record<string, unknown>;
      score: number;
    }
    const rankedRows: RankedRow[] = rows.map((row) => {
      const eventType = typeof row.event_type === "string" ? row.event_type : "";
      const importance = typeof EVENT_TYPE_IMPORTANCE[eventType] === "number" ? EVENT_TYPE_IMPORTANCE[eventType] : 0.5;
      const recency = recencyScore(typeof row.created_at === "string" ? row.created_at : "");
      return { row, score: importance * recency };
    });
    rankedRows.sort((a, b) => b.score - a.score);

    const summaryTokens = latestSummary ? estimateTokenCount(latestSummary.summary ?? "") : 0;
    const observationBudget = Math.max(0, maxTokens - summaryTokens);

    const detailedItems: Array<Record<string, unknown>> = [];
    const compactItems: Array<Record<string, unknown>> = [];
    let usedTokens = 0;
    let originalTokens = 0;

    for (const { row } of rankedRows) {
      const content = typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 800) : "";
      const fullItem = {
        id: row.id,
        type: "observation",
        event_id: row.event_id,
        platform: row.platform,
        project: row.project,
        canonical_project: this.deps.canonicalizeProject(String(row.project || "")),
        session_id: row.session_id,
        title: row.title,
        content,
        created_at: row.created_at,
        tags: parseArrayJson(row.tags_json),
        privacy_tags: parseArrayJson(row.privacy_tags_json),
      };
      const fullTokens = estimateTokenCount(JSON.stringify(fullItem));
      originalTokens += fullTokens;

      if (usedTokens + fullTokens <= observationBudget) {
        detailedItems.push(fullItem);
        usedTokens += fullTokens;
      } else {
        const title = typeof row.title === "string" && row.title.length > 0 ? row.title : typeof row.id === "string" ? row.id : "observation";
        const date = typeof row.created_at === "string" ? row.created_at.slice(0, 10) : "";
        const summaryLine = `- ${title} (${date})`;
        compactItems.push({
          id: row.id,
          type: "observation_summary",
          title,
          created_at: row.created_at,
          summary: summaryLine,
        });
        usedTokens += estimateTokenCount(summaryLine);
      }
    }

    const compressedTokens = summaryTokens + usedTokens;
    const totalOriginalTokens = summaryTokens + originalTokens;
    const compaction_ratio = totalOriginalTokens > 0
      ? Math.max(0, 1 - compressedTokens / totalOriginalTokens)
      : 0;

    const items: Array<Record<string, unknown>> = [];

    if (latestSummary) {
      items.push({
        id: `session:${latestSummary.session_id}`,
        type: "session_summary",
        session_id: latestSummary.session_id,
        summary: latestSummary.summary,
        ended_at: latestSummary.ended_at,
      });
    }
    for (const item of detailedItems) items.push(item);
    for (const item of compactItems) items.push(item);

    const activeFacts = this.deps.db
      .query(
        `
          SELECT fact_type, fact_key, fact_value, confidence
          FROM mem_facts
          WHERE ${
            projectMembers.length === 0
              ? "1 = 1"
              : projectMembers.length === 1
                ? "project = ?"
                : `project IN (${projectMembers.map(() => "?").join(", ")})`
          }
            AND merged_into_fact_id IS NULL
            AND superseded_by IS NULL
          ORDER BY fact_type ASC, fact_key ASC, created_at ASC
        `
      )
      .all(...(projectMembers.length === 0 ? [] : projectMembers)) as Array<{
        fact_type: string;
        fact_key: string;
        fact_value: string;
        confidence: number;
      }>;

    interface StaticSection {
      content: string;
      content_hash: string;
      cache_hint: "stable";
      fact_count: number;
    }

    interface DynamicSection {
      content: string;
      cache_hint: "volatile";
      observation_count: number;
    }

    let static_section: StaticSection | undefined;
    let dynamic_section: DynamicSection | undefined;

    if (activeFacts.length > 0) {
      const factLines = activeFacts.map(
        (f) => `[${f.fact_type}] ${f.fact_key}: ${f.fact_value} (confidence=${f.confidence.toFixed(2)})`
      );
      const staticContent = `# Project Facts\n\n${factLines.join("\n")}`;
      const contentHash = createHash("sha256").update(staticContent, "utf8").digest("hex");
      static_section = {
        content: staticContent,
        content_hash: contentHash,
        cache_hint: "stable",
        fact_count: activeFacts.length,
      };
    }

    const dynamicLines: string[] = [];
    if (latestSummary) {
      dynamicLines.push(`## Session Summary (${latestSummary.session_id})\n${latestSummary.summary}`);
    }
    if (detailedItems.length > 0) {
      dynamicLines.push(
        "## Recent Observations\n" +
          detailedItems
            .map((item) => {
              const title = typeof item.title === "string" ? item.title : String(item.id);
              const content = typeof item.content === "string" ? item.content.slice(0, 200) : "";
              const date = typeof item.created_at === "string" ? item.created_at.slice(0, 10) : "";
              return `### ${title} (${date})\n${content}`;
            })
            .join("\n\n")
      );
    }
    if (compactItems.length > 0) {
      dynamicLines.push(
        "## Compacted Observations\n" +
          compactItems.map((item) => (typeof item.summary === "string" ? item.summary : String(item.id))).join("\n")
      );
    }

    if (dynamicLines.length > 0) {
      dynamic_section = {
        content: dynamicLines.join("\n\n"),
        cache_hint: "volatile",
        observation_count: detailedItems.length + compactItems.length,
      };
    }

    const latestInteraction = this.getResumeInteractionContext(request, projectMembers, Math.max(limit * 4, 40));
    const latestInteractionMeta = this.buildLatestInteractionMeta(latestInteraction);
    const continuityBriefing = this.buildContinuityBriefing({
      correlationId,
      latestSummary,
      latestInteraction,
      pinnedContinuity,
      detailedItems,
      compactItems,
    });
    const recentProjectContext = this.buildRecentProjectContext({
      request,
      projectMembers,
      latestInteraction,
      pinnedContinuity,
      continuityBriefing,
    });

    // §78-B03: Build token-budget-aware wake-up context (L0 / L1 / full split)
    const detailLevel = request.detail_level ?? "L1";
    const profileDb = {
      query: (sql: string) => ({
        all: (...params: unknown[]) =>
          this.deps.db.query(sql).all(...(params as import("bun:sqlite").SQLQueryBindings[])),
      }),
    };
    const projectProfile = buildProjectProfile(profileDb, normalizedProject);
    const wakeUpContext = buildWakeUpContext(normalizedProject, projectProfile, detailLevel);

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      include_summary: Boolean(latestSummary),
      correlation_id: request.correlation_id ?? null,
      compaction_ratio: Math.round(compaction_ratio * 1000) / 1000,
      resume_pack_max_tokens: maxTokens,
      detailed_count: detailedItems.length,
      compacted_count: compactItems.length,
      ...(latestInteractionMeta !== null ? { latest_interaction: latestInteractionMeta } : {}),
      ...(continuityBriefing !== null ? { continuity_briefing: continuityBriefing } : {}),
      ...(recentProjectContext !== null ? { recent_project_context: recentProjectContext } : {}),
      ...(static_section !== undefined ? { static_section } : {}),
      ...(dynamic_section !== undefined ? { dynamic_section } : {}),
      wake_up_context: wakeUpContext,
    });
  }

  /**
   * V5-001: サブグラフ取得。
   * 指定エンティティを含む観察を起点に BFS で depth ホップ先まで探索し、
   * nodes (観察) + edges (mem_links) を返す。
   */
  getSubgraph(
    entity: string,
    depth: number,
    options?: { project?: string; limit?: number; user_id?: string; team_id?: string }
  ): SubgraphResult {
    const maxDepth = Math.min(depth, 5);
    const nodeLimit = Math.min(options?.limit ?? 100, 100);
    const projectMembers = this.resolveProjectMembers(options?.project);

    // エンティティ名で観察を検索（起点ノード）— 完全一致 → 部分一致フォールバック
    const seedLimit = Math.min(50, nodeLimit);
    let seedSql = `
      SELECT DISTINCT o.id
      FROM mem_observations o
      JOIN mem_observation_entities oe ON oe.observation_id = o.id
      JOIN mem_entities e ON e.id = oe.entity_id
      WHERE e.name = ?
    `;
    let seedParams: unknown[] = [entity];
    seedSql = this.appendProjectFilter(seedSql, seedParams, "o", projectMembers);
    // TEAM-005: テナント分離
    seedSql = this.appendTenantFilter(seedSql, seedParams, "o", options?.user_id, options?.team_id);
    seedSql += ` LIMIT ${seedLimit}`;

    let seedRows = this.deps.db.query(seedSql).all(...(seedParams as any[])) as Array<{ id: string }>;

    // 完全一致で見つからなければ部分一致（LIKE）で再検索
    if (seedRows.length === 0) {
      let likeSql = `
        SELECT DISTINCT o.id
        FROM mem_observations o
        JOIN mem_observation_entities oe ON oe.observation_id = o.id
        JOIN mem_entities e ON e.id = oe.entity_id
        WHERE e.name LIKE ?
      `;
      const likeParams: unknown[] = [`%${entity}%`];
      likeSql = this.appendProjectFilter(likeSql, likeParams, "o", projectMembers);
      // TEAM-005: テナント分離
      likeSql = this.appendTenantFilter(likeSql, likeParams, "o", options?.user_id, options?.team_id);
      likeSql += ` LIMIT ${seedLimit}`;
      seedRows = this.deps.db.query(likeSql).all(...(likeParams as any[])) as Array<{ id: string }>;
    }

    const seedIds = seedRows.map((r) => r.id);

    if (seedIds.length === 0) {
      return { nodes: [], edges: [], center_entity: entity, depth: maxDepth };
    }

    // BFS でノード収集
    const visitedIds = new Set<string>(seedIds);
    let frontier = [...seedIds];
    const edgeSet = new Map<string, { source: string; target: string; relation: string; weight: number }>();

    for (let d = 1; d <= maxDepth && frontier.length > 0 && visitedIds.size < nodeLimit; d++) {
      const placeholders = frontier.map(() => "?").join(", ");
      const linkRows = this.deps.db
        .query(`
          SELECT from_observation_id AS src, to_observation_id AS tgt, relation, weight
          FROM mem_links
          WHERE from_observation_id IN (${placeholders})
             OR to_observation_id IN (${placeholders})
        `)
        .all(...frontier, ...frontier) as Array<{ src: string; tgt: string; relation: string; weight: number }>;

      const nextFrontier: string[] = [];
      for (const row of linkRows) {
        // エッジ記録
        const edgeKey = `${row.src}:${row.tgt}`;
        if (!edgeSet.has(edgeKey)) {
          edgeSet.set(edgeKey, { source: row.src, target: row.tgt, relation: row.relation, weight: row.weight ?? 1.0 });
        }
        // 未訪問ノードを次フロンティアへ
        for (const nodeId of [row.src, row.tgt]) {
          if (!visitedIds.has(nodeId) && visitedIds.size < nodeLimit) {
            visitedIds.add(nodeId);
            nextFrontier.push(nodeId);
          }
        }
      }
      frontier = nextFrontier;
    }

    // ノード詳細を取得
    const allIds = [...visitedIds];
    if (allIds.length === 0) {
      return { nodes: [], edges: [], center_entity: entity, depth: maxDepth };
    }
    const placeholders = allIds.map(() => "?").join(", ");
    // TEAM-005: テナント分離 — ノード詳細もテナントでフィルタ
    const nodeQueryParams: unknown[] = [...allIds];
    let nodeQuerySql = `
        SELECT mo.id, mo.title, mo.observation_type, mo.created_at
        FROM mem_observations mo
        WHERE mo.id IN (${placeholders})
    `;
    nodeQuerySql = this.appendTenantFilter(nodeQuerySql, nodeQueryParams, "mo", options?.user_id, options?.team_id);
    const nodeRows = this.deps.db
      .query(nodeQuerySql)
      .all(...(nodeQueryParams as any[])) as Array<{ id: string; title: string | null; observation_type: string; created_at: string }>;

    // エンティティ情報を一括取得
    const entityRows = this.deps.db
      .query(`
        SELECT oe.observation_id, e.name
        FROM mem_observation_entities oe
        JOIN mem_entities e ON e.id = oe.entity_id
        WHERE oe.observation_id IN (${placeholders})
      `)
      .all(...allIds) as Array<{ observation_id: string; name: string }>;

    const entityMap = new Map<string, string[]>();
    for (const er of entityRows) {
      const arr = entityMap.get(er.observation_id) ?? [];
      arr.push(er.name);
      entityMap.set(er.observation_id, arr);
    }

    const nodes: SubgraphResult["nodes"] = nodeRows.map((row) => ({
      id: row.id,
      title: row.title ?? "",
      observation_type: row.observation_type,
      created_at: row.created_at,
      entities: entityMap.get(row.id) ?? [],
    }));

    // TEAM-005: テナント分離 — nodeQuerySql でフィルタされたノード集合に基づき
    // edges もフィルタする。BFS で発見されたが tenant 外のノードを参照するエッジを除外。
    const permittedNodeIds = new Set(nodeRows.map((row) => row.id));
    const edges: SubgraphResult["edges"] = [...edgeSet.values()]
      .filter((e) => permittedNodeIds.has(e.source) && permittedNodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        relation: e.relation,
        weight: e.weight,
      }));

    return { nodes, edges, center_entity: entity, depth: maxDepth };
  }
}

// ---------------------------------------------------------------------------
// SubgraphResult: サブグラフ取得結果
// ---------------------------------------------------------------------------

export interface SubgraphResult {
  nodes: Array<{
    id: string;
    title: string;
    observation_type: string;
    created_at: string;
    entities: string[];
  }>;
  edges: Array<{
    source: string;
    target: string;
    relation: string;
    weight: number;
  }>;
  center_entity: string;
  depth: number;
}
