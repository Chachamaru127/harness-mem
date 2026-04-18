/**
 * project-profile.ts
 *
 * §78-D03: Auto project profile — static vs dynamic fact separation.
 *
 * Classifies observations into static (long-lived) or dynamic (transient)
 * using a rule-based heuristic. No LLM required.
 *
 * Classification rules:
 *
 * DYNAMIC — short-lived / transient:
 *   1. expires_at is set → time-bound
 *   2. Has a (_, obs_id, 'supersedes') row in mem_links → superseded (stale)
 *   3. Newer than DYNAMIC_AGE_DAYS AND no strong static signal
 *
 * STATIC — long-lived / stable:
 *   1. Tags include any STATIC_TAG_SIGNALS keyword
 *   2. Content/title matches STATIC_CONTENT_PATTERNS regex
 *   3. Older than DYNAMIC_AGE_DAYS → presumed stable
 *
 * If neither: classify as "unknown" (excluded from both buckets).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Observations newer than this are candidates for dynamic classification. */
const DYNAMIC_AGE_DAYS = 14;

/** Tags that signal a static (stable) fact. */
const STATIC_TAG_SIGNALS = new Set([
  "decision",
  "convention",
  "architecture",
  "tech-stack",
  "tech_stack",
  "setup",
  "agreement",
  "standard",
  "policy",
]);

/** Regex against title+content that indicates a static fact. */
const STATIC_CONTENT_RE =
  /\b(we use|uses|adopted|stack is|architecture:|convention:|our standard|we agreed|we follow|team convention)\b/i;

/** Recent observation window for dynamic clustering. */
const RECENT_DAYS = 7;

/** Token budget cap for the whole profile (~300 tokens). */
const TOKEN_BUDGET = 300;

/** Simple token estimate: chars / 4. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// DB row shape (minimal — only what we query)
// ---------------------------------------------------------------------------

interface ObsRow {
  id: string;
  title: string | null;
  content: string;
  tags_json: string;
  created_at: string;
  expires_at: string | null;
  session_id: string;
}

/** Minimal DB interface so this module can be unit-tested without a full core. */
export interface ProfileDatabase {
  query(sql: string): { all(...params: unknown[]): unknown[] };
}

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

type Classification = "static" | "dynamic" | "unknown";

interface ClassifiedObs {
  id: string;
  title: string;
  classification: Classification;
  session_id: string;
  tags: string[];
  created_at: string;
}

function daysBefore(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function parseTags(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // ignore
  }
  return [];
}

function hasStaticTag(tags: string[]): boolean {
  return tags.some((t) => STATIC_TAG_SIGNALS.has(t.toLowerCase()));
}

function hasStaticContent(obs: ObsRow): boolean {
  const text = `${obs.title ?? ""} ${obs.content}`;
  return STATIC_CONTENT_RE.test(text);
}

function isOlderThan(createdAt: string, days: number): boolean {
  const threshold = daysBefore(days);
  return createdAt < threshold;
}

/**
 * Classify a single observation.
 * @param obs Observation row
 * @param isSuperseded Whether any other observation supersedes this one
 */
function classifyObs(obs: ObsRow, isSuperseded: boolean): Classification {
  const tags = parseTags(obs.tags_json);

  // DYNAMIC conditions (checked first — explicit signals)
  if (obs.expires_at !== null && obs.expires_at !== undefined) return "dynamic";
  if (isSuperseded) return "dynamic";

  const isNew = !isOlderThan(obs.created_at, DYNAMIC_AGE_DAYS);

  // STATIC conditions
  if (hasStaticTag(tags)) return "static";
  if (hasStaticContent(obs)) return "static";
  if (!isNew) return "static"; // older → presume stable

  // New observation with no strong static signal → dynamic
  return "dynamic";
}

// ---------------------------------------------------------------------------
// Profile builder
// ---------------------------------------------------------------------------

export interface ProjectProfile {
  static: {
    tech_stack: string[];
    conventions: string[];
    top_facts: string[];
  };
  dynamic: {
    current_sprint: string[];
    recent_decisions: string[];
    expiring_soon: string[];
  };
  token_estimate: number;
}

/**
 * Build a project profile for `project` from the SQLite database.
 * Returns static + dynamic buckets, token-capped at ~300 tokens.
 */
export function buildProjectProfile(
  db: ProfileDatabase,
  project: string
): ProjectProfile {
  // 1. Load all observations for the project (non-expired for active profile)
  const cutoff = daysBefore(90); // look back 90 days max
  const rows = db
    .query(
      `SELECT id, title, content, tags_json, created_at, expires_at, session_id
       FROM mem_observations
       WHERE project = ?
         AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT 500`
    )
    .all(project, cutoff) as ObsRow[];

  // 2. Find superseded observation IDs (B in "A supersedes B")
  const supersededIds = new Set<string>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const linkRows = db
      .query(
        `SELECT to_observation_id FROM mem_links
         WHERE relation = 'supersedes'
           AND to_observation_id IN (${placeholders})`
      )
      .all(...ids) as Array<{ to_observation_id: string }>;
    for (const lr of linkRows) {
      supersededIds.add(lr.to_observation_id);
    }
  }

  // 3. Classify each observation
  const classified: ClassifiedObs[] = rows.map((obs) => ({
    id: obs.id,
    title: obs.title ?? obs.content.slice(0, 80),
    classification: classifyObs(obs, supersededIds.has(obs.id)),
    session_id: obs.session_id,
    tags: parseTags(obs.tags_json),
    created_at: obs.created_at,
  }));

  const staticObs = classified.filter((o) => o.classification === "static");
  const dynamicObs = classified.filter((o) => o.classification === "dynamic");

  // 4. Build static buckets
  const techStackObs = staticObs.filter(
    (o) =>
      o.tags.some((t) =>
        ["tech-stack", "tech_stack", "architecture", "setup"].includes(t.toLowerCase())
      )
  );
  const conventionObs = staticObs.filter(
    (o) =>
      o.tags.some((t) =>
        ["decision", "convention", "agreement", "standard", "policy"].includes(t.toLowerCase())
      )
  );

  const techStackTitles = techStackObs.slice(0, 5).map((o) => o.title);
  const conventionTitles = conventionObs.slice(0, 5).map((o) => o.title);
  const topFacts = staticObs.slice(0, 10).map((o) => o.title);

  // 5. Build dynamic buckets
  const recentCutoff = daysBefore(RECENT_DAYS);
  const recentObs = dynamicObs.filter((o) => o.created_at >= recentCutoff);
  const now = new Date().toISOString();

  const expiringRows = rows.filter(
    (r) =>
      r.expires_at !== null &&
      r.expires_at !== undefined &&
      r.expires_at > now &&
      r.expires_at <= new Date(Date.now() + 86400000).toISOString()
  );

  // recent_decisions: last 7d tagged decision/convention OR any superseded obs (stale facts)
  const recentDecisionObs = dynamicObs.filter(
    (o) =>
      (o.created_at >= recentCutoff &&
        o.tags.some((t) => ["decision", "convention"].includes(t.toLowerCase()))) ||
      supersededIds.has(o.id)
  );

  // Cluster current_sprint by session_id (group recent obs by session)
  const sessionSeen = new Set<string>();
  const sprintObs: ClassifiedObs[] = [];
  for (const o of recentObs) {
    if (!sessionSeen.has(o.session_id)) {
      sessionSeen.add(o.session_id);
      sprintObs.push(o);
    }
    if (sprintObs.length >= 7) break;
  }

  const currentSprint = sprintObs.slice(0, 7).map((o) => o.title);
  const recentDecisions = recentDecisionObs.slice(0, 5).map((o) => o.title);
  const expiringSoon = expiringRows.slice(0, 5).map((r) => r.title ?? r.content.slice(0, 80));

  // 6. Token budget enforcement (~300 tokens total)
  function trimToTokenBudget(
    lists: string[][],
    budget: number
  ): string[][] {
    let used = 0;
    return lists.map((list) => {
      const result: string[] = [];
      for (const item of list) {
        const cost = estimateTokens(item) + 1; // +1 for separator
        if (used + cost > budget) break;
        result.push(item);
        used += cost;
      }
      return result;
    });
  }

  const [
    trimmedTechStack,
    trimmedConventions,
    trimmedTopFacts,
    trimmedSprint,
    trimmedDecisions,
    trimmedExpiring,
  ] = trimToTokenBudget(
    [techStackTitles, conventionTitles, topFacts, currentSprint, recentDecisions, expiringSoon],
    TOKEN_BUDGET
  );

  const profile: ProjectProfile = {
    static: {
      tech_stack: trimmedTechStack,
      conventions: trimmedConventions,
      top_facts: trimmedTopFacts,
    },
    dynamic: {
      current_sprint: trimmedSprint,
      recent_decisions: trimmedDecisions,
      expiring_soon: trimmedExpiring,
    },
    token_estimate: 0,
  };

  // 7. Compute actual token estimate
  const allTitles = [
    ...profile.static.tech_stack,
    ...profile.static.conventions,
    ...profile.static.top_facts,
    ...profile.dynamic.current_sprint,
    ...profile.dynamic.recent_decisions,
    ...profile.dynamic.expiring_soon,
  ];
  profile.token_estimate = allTitles.reduce(
    (acc, t) => acc + estimateTokens(t) + 1,
    0
  );

  return profile;
}

// ---------------------------------------------------------------------------
// §78-B03: L0 / L1 wake-up context
// ---------------------------------------------------------------------------

/**
 * Detail level for wake-up context.
 *
 * - L0  : critical facts only (~170 tokens). Always emitted.
 * - L1  : L0 + recent context (~300–1000 tokens). Default.
 * - full : L0 + L1 + all profile data (backward compat).
 */
export type DetailLevel = "L0" | "L1" | "full";

/** L0 — critical facts only. Suitable for token-constrained sessions. */
export interface WakeUpL0 {
  project: string;
  tech_stack: string[];
  conventions: string[];
  pending_count: number;
  token_estimate: number;
}

/** L1 — L0 + recent context. */
export interface WakeUpL1 extends WakeUpL0 {
  recent_observations: string[];
  recent_decisions: string[];
  expiring_soon: string[];
}

/** full — backward-compat shape (entire profile + L1 fields). */
export interface WakeUpFull extends WakeUpL1 {
  top_facts: string[];
  current_sprint: string[];
}

export type WakeUpContext =
  | ({ detail_level: "L0" } & WakeUpL0)
  | ({ detail_level: "L1" } & WakeUpL1)
  | ({ detail_level: "full" } & WakeUpFull);

/**
 * Build a token-budget-aware wake-up context from a ProjectProfile.
 *
 * @param project  Project name (injected for L0 convenience)
 * @param profile  Built by buildProjectProfile()
 * @param level    "L0" | "L1" | "full" (default "L1")
 */
export function buildWakeUpContext(
  project: string,
  profile: ProjectProfile,
  level: DetailLevel = "L1"
): WakeUpContext {
  // --- L0 base ---
  const techStack = profile.static.tech_stack.slice(0, 3);
  const conventions = profile.static.conventions.slice(0, 3);
  const pendingCount =
    profile.dynamic.current_sprint.length +
    profile.dynamic.recent_decisions.length +
    profile.dynamic.expiring_soon.length;

  function tokenCount(strs: string[]): number {
    return strs.reduce((acc, s) => acc + estimateTokens(s) + 1, 0);
  }

  const l0TokenEstimate =
    estimateTokens(project) +
    tokenCount(techStack) +
    tokenCount(conventions) +
    estimateTokens(String(pendingCount)) +
    20; // structural overhead

  const l0Base: WakeUpL0 = {
    project,
    tech_stack: techStack,
    conventions,
    pending_count: pendingCount,
    token_estimate: l0TokenEstimate,
  };

  if (level === "L0") {
    return { detail_level: "L0", ...l0Base };
  }

  // --- L1: add recent context ---
  const recentObs = profile.dynamic.current_sprint.slice(0, 5);
  const recentDecisions = profile.dynamic.recent_decisions.slice(0, 5);
  const expiringSoon = profile.dynamic.expiring_soon.slice(0, 3);

  const l1TokenEstimate =
    l0TokenEstimate +
    tokenCount(recentObs) +
    tokenCount(recentDecisions) +
    tokenCount(expiringSoon) +
    10; // section headers overhead

  const l1Base: WakeUpL1 = {
    ...l0Base,
    recent_observations: recentObs,
    recent_decisions: recentDecisions,
    expiring_soon: expiringSoon,
    token_estimate: l1TokenEstimate,
  };

  if (level === "L1") {
    return { detail_level: "L1", ...l1Base };
  }

  // --- full: backward-compat, adds top_facts + full sprint ---
  const topFacts = profile.static.top_facts;
  const currentSprint = profile.dynamic.current_sprint;

  const fullTokenEstimate =
    l1TokenEstimate +
    tokenCount(topFacts) +
    tokenCount(currentSprint) +
    5;

  const fullCtx: WakeUpFull = {
    ...l1Base,
    top_facts: topFacts,
    current_sprint: currentSprint,
    token_estimate: fullTokenEstimate,
  };

  return { detail_level: "full", ...fullCtx };
}
