/**
 * session-manager.ts
 *
 * セッション管理モジュール。
 * HarnessMemCore から分割されたセッション管理責務を担う。
 *
 * 担当 API:
 *   - sessionsList
 *   - sessionThread
 *   - recordCheckpoint
 *   - finalizeSession
 *   - resolveSessionChain
 */

import type { Database } from "bun:sqlite";
import { basename } from "node:path";
import type {
  ApiResponse,
  Config,
  EventEnvelope,
  FinalizeSessionRequest,
  RecordCheckpointRequest,
  SessionsListRequest,
  SessionThreadRequest,
  SkillSuggestion,
  StreamEvent,
} from "./types.js";
import {
  clampLimit,
  makeErrorResponse,
  makeResponse,
  nowIso,
  parseArrayJson,
  visibilityFilterSql,
} from "./core-utils.js";
import {
  buildVisibleInteractionText,
  hasIgnoredVisibleTag,
  isIgnoredVisiblePromptText,
  isIgnoredVisibleResponseText,
} from "./interaction-visibility";
import type { AccessFilter } from "../auth/access-control.js";

// ---------------------------------------------------------------------------
// CoreDependencies: HarnessMemCore から渡される内部依存
// ---------------------------------------------------------------------------

export interface SessionManagerDeps {
  db: Database;
  config: Config;
  /** normalizeProjectInput のバインド済みバージョン */
  normalizeProject: (project: string) => string;
  /** raw project を UI 用 canonical 名へ変換 */
  canonicalizeProject: (project: string) => string;
  /** canonical project 選択を raw member projects へ展開 */
  expandProjectSelection: (project: string, scope?: "observations" | "sessions") => string[];
  /** platformVisibilityFilterSql のバインド済みバージョン */
  platformVisibilityFilterSql: (alias: string) => string;
  /** recordEvent への参照（recordCheckpoint が内部で使用） */
  recordEvent: (event: EventEnvelope) => ApiResponse;
  /** appendStreamEvent への参照 */
  appendStreamEvent: (type: StreamEvent["type"], data: Record<string, unknown>) => StreamEvent;
  /** enqueueConsolidation への参照 */
  enqueueConsolidation: (project: string, sessionId: string, reason: string) => void;
}

interface SessionSummaryRow {
  title: string | null;
  content_redacted: string | null;
  created_at: string;
  event_type: string | null;
  tags_json: string | null;
}

interface SessionHandoff {
  overview: string;
  decisions: string[];
  open_loops: string[];
  next_actions: string[];
  risks: string[];
  key_points: string[];
  latest_exchange: {
    user: string | null;
    assistant: string | null;
    incomplete: boolean;
  };
  observation_count: number;
}

const DECISION_HINT_PATTERN =
  /\b(decided|decision|chose|choose|picked|adopted|switched|implemented|fixed|completed)\b|(決定|方針|採用|選択|切り替え|実装完了|修正した|完了)/i;
const OPEN_LOOP_HINT_PATTERN =
  /\b(pending|need to|needs to|investigate|follow up|unknown|unresolved|confirm|check)\b|(保留|未完|未解決|要確認|確認する|調査する|検討する)/i;
const NEXT_ACTION_HINT_PATTERN =
  /\b(next step|next action|todo|follow up|continue|remaining|plan to)\b|(次対応|次の対応|次アクション|次の一手|TODO|続き|今後やる|残件)/i;
const RISK_HINT_PATTERN =
  /\b(risk|blocker|blocked|issue|problem|concern|regression)\b|(リスク|懸念|課題|問題|ブロッカー|詰まり|後退)/i;
const SCOPE_GUARD_PATTERN =
  /\b(out of scope|not the main thread|not the focus|do not mix|avoid mixing)\b|(本筋ではない|スコープ外|混ぜない|対象外)/i;

type ExplicitSectionKey = "problems" | "decisions" | "open_loops" | "next_actions" | "risks";

interface ExplicitHandoffSections {
  problems: string[];
  decisions: string[];
  open_loops: string[];
  next_actions: string[];
  risks: string[];
}

function hasExplicitHandoffSections(sections: ExplicitHandoffSections): boolean {
  return (
    sections.problems.length > 0 ||
    sections.decisions.length > 0 ||
    sections.open_loops.length > 0 ||
    sections.next_actions.length > 0 ||
    sections.risks.length > 0
  );
}

function isStructuredHandoffNoiseRow(eventType: string | null | undefined, title: string): boolean {
  const normalizedEventType = (eventType || "").trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();
  return (
    normalizedEventType === "session_start" ||
    normalizedEventType === "session_end" ||
    normalizedTitle === "session_start" ||
    normalizedTitle === "session_end" ||
    normalizedTitle === "continuity_handoff"
  );
}

function summarizeLine(text: string | null | undefined, maxLength: number): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function pushUniqueLine(target: string[], value: string, maxItems: number): void {
  if (!value) return;
  if (target.includes(value)) return;
  if (target.length >= maxItems) return;
  target.push(value);
}

function unwrapStructuredObservationText(raw: string | null | undefined): string {
  const trimmed = (raw || "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return raw || "";
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.content === "string" && parsed.content.trim()) {
      return parsed.content;
    }
    if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
      return parsed.prompt;
    }
    if (typeof parsed.title === "string" && parsed.title.trim()) {
      return parsed.title;
    }
  } catch {
    return raw || "";
  }

  return raw || "";
}

function normalizeBulletContent(line: string, maxLength: number): string {
  return line
    .replace(/^(?:[-*+]|(?:\d+\.))\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isPlaceholderSectionLine(line: string): boolean {
  return /^(?:no |not captured|none\b|なし\b|未記載\b|未設定\b)/i.test(line);
}

function classifyExplicitSection(line: string): { key: ExplicitSectionKey; value: string } | null {
  const trimmed = line.trim();
  const prefix = "(?:(?:[-*+]\\s*)|(?:(?:\\d+)[.)]\\s*))?";
  const sectionMatchers: Array<{ key: ExplicitSectionKey; pattern: RegExp }> = [
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

  for (const matcher of sectionMatchers) {
    const match = trimmed.match(matcher.pattern);
    if (match) {
      return { key: matcher.key, value: normalizeBulletContent(match[1] || "", 220) };
    }
  }
  return null;
}

function parseExplicitHandoffSections(text: string | null | undefined, maxItems: number): ExplicitHandoffSections {
  const sections: ExplicitHandoffSections = {
    problems: [],
    decisions: [],
    open_loops: [],
    next_actions: [],
    risks: [],
  };
  if (!text) {
    return sections;
  }

  let currentSection: ExplicitSectionKey | null = null;
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const explicitSection = classifyExplicitSection(trimmed);
    if (explicitSection) {
      currentSection = explicitSection.key;
      if (explicitSection.value && !isPlaceholderSectionLine(explicitSection.value)) {
        pushUniqueLine(sections[currentSection], explicitSection.value, maxItems);
      }
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const normalized = normalizeBulletContent(trimmed, 220);
    if (!normalized || isPlaceholderSectionLine(normalized)) {
      continue;
    }
    pushUniqueLine(sections[currentSection], normalized, maxItems);
  }

  return sections;
}

// ---------------------------------------------------------------------------
// SessionManager クラス
// ---------------------------------------------------------------------------

export class SessionManager {
  constructor(private readonly deps: SessionManagerDeps) {}

  private resolveProjectMembers(project: string | undefined, scope: "observations" | "sessions"): string[] {
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

  private loadSessionSummaryRows(sessionId: string, maxRows: number): SessionSummaryRow[] {
    return this.deps.db
      .query(
        `
          SELECT
            o.title,
            o.content_redacted,
            o.created_at,
            e.event_type,
            o.tags_json
          FROM mem_observations o
          LEFT JOIN mem_events e ON e.event_id = o.event_id
          WHERE o.session_id = ?
          ORDER BY o.created_at ASC, o.id ASC
          LIMIT ?
        `
      )
      .all(sessionId, maxRows) as SessionSummaryRow[];
  }

  private buildStructuredHandoff(
    sessionId: string,
    rows: SessionSummaryRow[],
    summaryMode: string
  ): SessionHandoff {
    const sectionLimit = summaryMode === "detailed" ? 5 : summaryMode === "short" ? 2 : 3;
    const keyPointLimit = summaryMode === "detailed" ? 6 : summaryMode === "short" ? 2 : 4;

    const decisions: string[] = [];
    const openLoops: string[] = [];
    const nextActions: string[] = [];
    const risks: string[] = [];
    const keyPoints: string[] = [];

    let currentPrompt: string | null = null;
    let latestExchangeUser: string | null = null;
    let latestExchangeAssistant: string | null = null;

    for (const row of rows) {
      const tags = parseArrayJson(row.tags_json);
      const normalizedContent = unwrapStructuredObservationText(row.content_redacted);
      const normalizedTitle = unwrapStructuredObservationText(row.title);
      const explicitSections = parseExplicitHandoffSections(normalizedContent || normalizedTitle, sectionLimit);
      const hasExplicitSections = hasExplicitHandoffSections(explicitSections);
      for (const problem of explicitSections.problems) {
        pushUniqueLine(keyPoints, problem, keyPointLimit);
      }
      for (const decision of explicitSections.decisions) {
        pushUniqueLine(decisions, decision, sectionLimit);
      }
      for (const openLoop of explicitSections.open_loops) {
        pushUniqueLine(openLoops, openLoop, sectionLimit);
      }
      for (const nextAction of explicitSections.next_actions) {
        if (SCOPE_GUARD_PATTERN.test(nextAction)) {
          pushUniqueLine(keyPoints, nextAction, keyPointLimit);
        } else {
          pushUniqueLine(nextActions, nextAction, sectionLimit);
        }
      }
      for (const risk of explicitSections.risks) {
        pushUniqueLine(risks, risk, sectionLimit);
      }

      const title = summarizeLine(normalizedTitle, 120);
      const content = summarizeLine(normalizedContent, 240);
      const visibleText = buildVisibleInteractionText(title, content);
      const line = title && content && title !== content ? `${title}: ${content}` : content || title;

      if (row.event_type === "user_prompt") {
        if (hasIgnoredVisibleTag(tags) || isIgnoredVisiblePromptText(visibleText)) {
          continue;
        }
        currentPrompt = content || title;
        if (/\?$/.test(content || "") || OPEN_LOOP_HINT_PATTERN.test(visibleText)) {
          pushUniqueLine(openLoops, currentPrompt, sectionLimit);
        }
        continue;
      }

      if (isStructuredHandoffNoiseRow(row.event_type, title)) {
        continue;
      }

      if (title === "assistant_response") {
        if (hasIgnoredVisibleTag(tags) || isIgnoredVisibleResponseText(content)) {
          continue;
        }
        latestExchangeUser = currentPrompt;
        latestExchangeAssistant = content || title;
        if (hasExplicitSections) {
          continue;
        }
      } else if (hasExplicitSections) {
        continue;
      }

      if (DECISION_HINT_PATTERN.test(visibleText)) {
        pushUniqueLine(decisions, line, sectionLimit);
      }
      if (NEXT_ACTION_HINT_PATTERN.test(visibleText)) {
        pushUniqueLine(nextActions, line, sectionLimit);
      }
      if (RISK_HINT_PATTERN.test(visibleText)) {
        pushUniqueLine(risks, line, sectionLimit);
      }
      if (OPEN_LOOP_HINT_PATTERN.test(visibleText)) {
        pushUniqueLine(openLoops, line, sectionLimit);
      }
      if (!DECISION_HINT_PATTERN.test(visibleText) && !NEXT_ACTION_HINT_PATTERN.test(visibleText)) {
        pushUniqueLine(keyPoints, line, keyPointLimit);
      }
    }

    const fallbackOverview = rows
      .slice(-2)
      .map((row) => summarizeLine(row.content_redacted || row.title, 140))
      .filter(Boolean)
      .join(" / ");
    const overview = [
      decisions[0],
      nextActions[0],
      openLoops[0],
      risks[0],
      keyPoints[0],
    ].filter(Boolean).slice(0, 2).join(" ") || fallbackOverview || `Session ${sessionId} handoff.`;

    return {
      overview,
      decisions,
      open_loops: openLoops,
      next_actions: nextActions,
      risks,
      key_points: keyPoints,
      latest_exchange: {
        user: latestExchangeUser,
        assistant: latestExchangeAssistant,
        incomplete: Boolean(latestExchangeUser && !latestExchangeAssistant),
      },
      observation_count: rows.length,
    };
  }

  private renderHandoffSummary(
    sessionId: string,
    summaryMode: string,
    handoff: SessionHandoff
  ): string {
    const lines: string[] = [
      "# Session Handoff",
      "",
      `- Session: ${sessionId}`,
      `- Summary mode: ${summaryMode}`,
      `- Observations reviewed: ${handoff.observation_count}`,
      "",
      "## Overview",
      handoff.overview || "- no overview captured",
      "",
    ];

    const renderSection = (title: string, items: string[], emptyText: string) => {
      lines.push(`## ${title}`);
      if (items.length === 0) {
        lines.push(`- ${emptyText}`);
      } else {
        for (const item of items) {
          lines.push(`- ${item}`);
        }
      }
      lines.push("");
    };

    renderSection("Decisions", handoff.decisions, "No explicit decisions captured.");
    renderSection("Open Loops", handoff.open_loops, "No unresolved follow-ups captured.");
    renderSection("Next Actions", handoff.next_actions, "No next actions captured.");
    renderSection("Risks", handoff.risks, "No explicit risks captured.");
    renderSection("Key Points", handoff.key_points, "No additional key points captured.");

    lines.push("## Latest Exchange");
    lines.push(`- User: ${handoff.latest_exchange.user || "not captured"}`);
    if (handoff.latest_exchange.assistant) {
      lines.push(`- Assistant: ${handoff.latest_exchange.assistant}`);
    } else if (handoff.latest_exchange.incomplete) {
      lines.push("- Assistant: no response recorded yet");
    } else {
      lines.push("- Assistant: not captured");
    }

    return lines.join("\n");
  }

  sessionsList(request: SessionsListRequest): ApiResponse {
    const startedAt = performance.now();
    const limit = clampLimit(request.limit, 50, 1, 200);
    const includePrivate = Boolean(request.include_private);
    const projectMembers = this.resolveProjectMembers(request.project, "sessions");

    // TEAM-005: member ロール適用
    const userIdFilter = typeof request.user_id === "string" && request.user_id.trim() ? request.user_id.trim() : undefined;
    const teamIdFilter = typeof request.team_id === "string" && request.team_id.trim() ? request.team_id.trim() : undefined;

    const params: unknown[] = [];
    let sql = `
      SELECT
        s.session_id,
        s.platform,
        s.project,
        s.started_at,
        s.ended_at,
        s.summary,
        s.summary_mode,
        s.updated_at,
        MAX(o.created_at) AS last_event_at,
        COUNT(o.id) AS observation_count,
        SUM(CASE WHEN e.event_type = 'user_prompt' THEN 1 ELSE 0 END) AS prompt_count,
        SUM(CASE WHEN e.event_type = 'tool_use' THEN 1 ELSE 0 END) AS tool_count,
        SUM(CASE WHEN e.event_type = 'checkpoint' THEN 1 ELSE 0 END) AS checkpoint_count,
        SUM(CASE WHEN e.event_type = 'session_end' THEN 1 ELSE 0 END) AS summary_count
      FROM mem_sessions s
      LEFT JOIN mem_observations o
        ON o.session_id = s.session_id
        ${visibilityFilterSql("o", includePrivate)}
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE 1 = 1
    `;

    sql = this.appendProjectFilter(sql, params, "s", projectMembers);
    sql += this.deps.platformVisibilityFilterSql("s");

    // TEAM-005: member ロール — sessions テーブルの user_id / team_id で絞る
    if (userIdFilter) {
      if (teamIdFilter) {
        sql += " AND (s.user_id = ? OR s.team_id = ?)";
        params.push(userIdFilter, teamIdFilter);
      } else {
        sql += " AND s.user_id = ?";
        params.push(userIdFilter);
      }
    }

    sql += `
      GROUP BY
        s.session_id, s.platform, s.project, s.started_at,
        s.ended_at, s.summary, s.summary_mode, s.updated_at
      ORDER BY COALESCE(MAX(o.created_at), s.updated_at) DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = this.deps.db.query(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
    const items = rows.map((row) => ({
      session_id: row.session_id,
      platform: row.platform,
      project: row.project,
      canonical_project: this.deps.canonicalizeProject(String(row.project || "")),
      started_at: row.started_at,
      ended_at: row.ended_at,
      updated_at: row.updated_at,
      last_event_at: row.last_event_at,
      summary: row.summary,
      summary_mode: row.summary_mode,
      counts: {
        observations: Number(row.observation_count || 0),
        prompts: Number(row.prompt_count || 0),
        tools: Number(row.tool_count || 0),
        checkpoints: Number(row.checkpoint_count || 0),
        summaries: Number(row.summary_count || 0),
      },
    }));

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      ranking: "sessions_list_v1",
    });
  }

  sessionThread(request: SessionThreadRequest): ApiResponse {
    const startedAt = performance.now();
    if (!request.session_id) {
      return makeErrorResponse(startedAt, "session_id is required", {});
    }

    const includePrivate = Boolean(request.include_private);
    const limit = clampLimit(request.limit, 200, 1, 1000);
    const projectMembers = this.resolveProjectMembers(request.project, "sessions");

    // TEAM-005: member ロール適用
    const userIdFilter = typeof request.user_id === "string" && request.user_id.trim() ? request.user_id.trim() : undefined;
    const teamIdFilter = typeof request.team_id === "string" && request.team_id.trim() ? request.team_id.trim() : undefined;

    const params: unknown[] = [request.session_id];
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
      WHERE o.session_id = ?
    `;

    sql = this.appendProjectFilter(sql, params, "o", projectMembers);

    sql += this.deps.platformVisibilityFilterSql("o");
    sql += visibilityFilterSql("o", includePrivate);

    // TEAM-005: member ロール — observations の user_id / team_id で絞る
    if (userIdFilter) {
      if (teamIdFilter) {
        sql += " AND (o.user_id = ? OR o.team_id = ?)";
        params.push(userIdFilter, teamIdFilter);
      } else {
        sql += " AND o.user_id = ?";
        params.push(userIdFilter);
      }
    }

    sql += " ORDER BY o.created_at ASC, o.id ASC LIMIT ?";
    params.push(limit);

    const rows = this.deps.db.query(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
    const filteredRows = rows.filter((row) => {
      const eventType = typeof row.event_type === "string" ? row.event_type : "";
      const title = typeof row.title === "string" ? row.title : "";
      const content = typeof row.content_redacted === "string" ? row.content_redacted : "";
      const tags = parseArrayJson(row.tags_json);
      if (hasIgnoredVisibleTag(tags)) {
        return false;
      }
      if (eventType === "user_prompt" && isIgnoredVisiblePromptText(buildVisibleInteractionText(title, content))) {
        return false;
      }
      if (title === "assistant_response" && isIgnoredVisibleResponseText(content)) {
        return false;
      }
      return true;
    });
    const items = filteredRows.map((row, index) => ({
      step: index + 1,
      id: row.id,
      event_id: row.event_id,
      event_type: row.event_type || "unknown",
      platform: row.platform,
      project: row.project,
      canonical_project: this.deps.canonicalizeProject(String(row.project || "")),
      session_id: row.session_id,
      title: row.title,
      content: typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 2000) : "",
      created_at: row.created_at,
      tags: parseArrayJson(row.tags_json),
      privacy_tags: parseArrayJson(row.privacy_tags_json),
    }));

    return makeResponse(
      startedAt,
      items,
      {
        session_id: request.session_id,
        project: request.project,
        include_private: includePrivate,
      },
      { ranking: "session_thread_v1" }
    );
  }

  recordCheckpoint(request: RecordCheckpointRequest): ApiResponse {
    const event: EventEnvelope = {
      platform: request.platform || "claude",
      project: request.project || basename(process.cwd()),
      session_id: request.session_id,
      event_type: "checkpoint",
      ts: nowIso(),
      payload: {
        title: request.title,
        content: request.content,
      },
      tags: request.tags || [],
      privacy_tags: request.privacy_tags || [],
    };

    return this.deps.recordEvent(event);
  }

  // ---------------------------------------------------------------------------
  // §78-E04: Procedural skill synthesis
  // ---------------------------------------------------------------------------

  /**
   * Detect whether a session qualifies as a reusable procedural skill.
   *
   * Heuristics (rule-based, no LLM):
   *  1. Length   — session has ≥ 5 observations
   *  2. Sequential flow — observations are ordered in time (implicit, guaranteed by ORDER BY)
   *  3. Completion signal — last observation's title/content/tags contain a done-keyword
   *
   * Returns a SkillSuggestion when all three pass, or null otherwise.
   */
  private detectSkillFromSession(sessionId: string): SkillSuggestion | null {
    const COMPLETION_PATTERN = /\b(completed|done|shipped|merged|deployed)\b/i;
    const MIN_STEPS = 5;

    interface SkillRow {
      id: string;
      title: string | null;
      content_redacted: string | null;
      tags_json: string | null;
      created_at: string;
    }

    const rows = this.deps.db
      .query(
        `SELECT o.id, o.title, o.content_redacted, o.tags_json, o.created_at
           FROM mem_observations o
           LEFT JOIN mem_events e ON e.event_id = o.event_id
          WHERE o.session_id = ?
            AND (o.tags_json NOT LIKE '%"skill"%' OR o.tags_json IS NULL)
            AND (o.tags_json NOT LIKE '%"finalized"%' OR o.tags_json IS NULL)
            AND (e.event_type IS NULL OR e.event_type NOT IN ('session_start', 'session_end'))
          ORDER BY o.created_at ASC, o.id ASC`
      )
      .all(sessionId) as SkillRow[];

    // 1. Length check
    if (rows.length < MIN_STEPS) return null;

    // 3. Completion signal: check last observation
    const last = rows[rows.length - 1];
    const lastTags = parseArrayJson(last.tags_json);
    const lastTagMatch = lastTags.some((t) =>
      COMPLETION_PATTERN.test(t)
    );
    const lastTitleMatch = COMPLETION_PATTERN.test(last.title ?? "");
    const lastContentMatch = COMPLETION_PATTERN.test(last.content_redacted ?? "");

    if (!lastTagMatch && !lastTitleMatch && !lastContentMatch) return null;

    // Build skill suggestion
    const first = rows[0];
    const firstTitle = (first.title ?? "").slice(0, 60) || "start";
    const lastTitle = (last.title ?? "").slice(0, 60) || "end";

    const steps = rows.map((r, i) => ({
      order: i + 1,
      summary: (r.title ?? "").slice(0, 120) || `step ${i + 1}`,
      obs_id: r.id,
    }));

    const firstTs = new Date(first.created_at).getTime();
    const lastTs = new Date(last.created_at).getTime();
    const estimatedDurationMin = Math.round((lastTs - firstTs) / 60000);

    return {
      title: `${firstTitle} → ${lastTitle}`,
      steps,
      tools_used: [],
      estimated_duration_min: Math.max(0, estimatedDurationMin),
      source_session_id: sessionId,
      created_at: nowIso(),
    };
  }

  finalizeSession(request: FinalizeSessionRequest): ApiResponse {
    const startedAt = performance.now();

    if (!request.session_id) {
      return makeErrorResponse(
        startedAt,
        "session_id is required",
        request as unknown as Record<string, unknown>
      );
    }

    const summaryMode = request.summary_mode || "standard";
    const maxRows = summaryMode === "detailed" ? 48 : summaryMode === "short" ? 20 : 32;
    const rows = this.loadSessionSummaryRows(request.session_id, maxRows);
    const handoff = this.buildStructuredHandoff(request.session_id, rows, summaryMode);
    const summary = this.renderHandoffSummary(request.session_id, summaryMode, handoff);

    const current = nowIso();
    this.deps.db
      .query(
        `
          UPDATE mem_sessions
          SET ended_at = ?, summary = ?, summary_mode = ?, correlation_id = COALESCE(correlation_id, ?), updated_at = ?
          WHERE session_id = ?
        `
      )
      .run(current, summary, summaryMode, request.correlation_id ?? null, current, request.session_id);

    this.deps.recordEvent({
      platform: request.platform || "claude",
      project: request.project || basename(process.cwd()),
      session_id: request.session_id,
      correlation_id: request.correlation_id,
      event_type: "session_end",
      ts: current,
      payload: {
        summary,
        summary_mode: summaryMode,
        handoff,
      },
      tags: ["finalized"],
      privacy_tags: [],
    });

    this.deps.appendStreamEvent("session.finalized", {
      session_id: request.session_id,
      project: request.project || basename(process.cwd()),
      summary_mode: summaryMode,
      finalized_at: current,
    });
    this.deps.enqueueConsolidation(
      request.project || basename(process.cwd()),
      request.session_id,
      "finalize"
    );

    // §78-E04: Procedural skill synthesis — detect and optionally persist
    const skillSuggestion = this.detectSkillFromSession(request.session_id);
    if (skillSuggestion && request.persist_skill) {
      this.deps.recordEvent({
        platform: request.platform || "claude",
        project: request.project || basename(process.cwd()),
        session_id: request.session_id,
        correlation_id: request.correlation_id,
        event_type: "checkpoint",
        ts: current,
        payload: {
          title: skillSuggestion.title,
          content: JSON.stringify(skillSuggestion),
        },
        tags: ["skill", "procedural", `skill-from:${request.session_id}`],
        privacy_tags: [],
      });
    }

    return makeResponse(
      startedAt,
      [
        {
          session_id: request.session_id,
          summary_mode: summaryMode,
          summary,
          handoff,
          finalized_at: current,
          ...(skillSuggestion ? { skill_suggestion: skillSuggestion } : {}),
        },
      ],
      request as unknown as Record<string, unknown>
    );
  }

  resolveSessionChain(correlationId: string, project: string): ApiResponse {
    const startedAt = performance.now();

    if (!correlationId || !project) {
      return makeErrorResponse(startedAt, "correlation_id and project are required", {
        correlation_id: correlationId,
        project,
      });
    }

    const normalizedProject = this.deps.normalizeProject(project);
    const sessions = this.deps.db
      .query(
        `
          SELECT session_id, platform, project, started_at, ended_at, correlation_id
          FROM mem_sessions
          WHERE correlation_id = ? AND project = ?
          ORDER BY started_at ASC
        `
      )
      .all(correlationId, normalizedProject) as Array<{
      session_id: string;
      platform: string;
      project: string;
      started_at: string;
      ended_at: string | null;
      correlation_id: string;
    }>;

    const items = sessions.map((s) => ({
      session_id: s.session_id,
      platform: s.platform,
      project: s.project,
      started_at: s.started_at,
      ended_at: s.ended_at,
      correlation_id: s.correlation_id,
    }));

    return makeResponse(
      startedAt,
      items,
      { correlation_id: correlationId, project: normalizedProject },
      { chain_length: items.length }
    );
  }
}
