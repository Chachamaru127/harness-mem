import { type Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { dedupeFacts, buildSupersededDecisions, type ConsolidationFact } from "./deduper";
import { extractFacts, llmExtractWithDiff, type ExistingFact } from "./extractor";
import { expiredFilterSql, segmentJapaneseForFts, tokenize as tokenizeText } from "../core/core-utils";
import { redactSecrets, stripPrivateBlocks } from "../core/privacy-tags";

export interface ConsolidationRunOptions {
  reason?: string;
  project?: string;
  session_id?: string;
  limit?: number;
}

export interface ConsolidationRunStats {
  jobs_processed: number;
  facts_extracted: number;
  facts_merged: number;
  pending_jobs: number;
  /** IMP-011: derives リンクとして生成されたリンク数 */
  derives_links_created?: number;
  /** S154-303: append-only tense rewrite observations created by dreaming. */
  dreaming_rewrites_created?: number;
}

export interface ConsolidationRunDeps {
  materializeObservationDerivedData?: (observationId: string) => Record<string, unknown>;
  allowLocalDreamingObservationWrites?: boolean;
}

interface QueueRow {
  id: number;
  project: string;
  session_id: string;
  /** S154-201: per-job reason ('finalize' | 'dreaming' | 'manual' | ...). */
  reason?: string | null;
}

interface DreamingObservationRow {
  id: string;
  session_id: string;
  title: string | null;
  content_redacted: string;
  observation_type: string;
  privacy_tags_json: string;
  user_id: string;
  team_id: string | null;
  event_time: string | null;
  observed_at: string | null;
  valid_from: string | null;
  created_at: string;
  thread_id: string | null;
  topic: string | null;
  expires_at: string | null;
  branch: string | null;
}

/** S154-201: the dreaming consolidation job reason. */
export const DREAMING_REASON = "dreaming";

const EXTERNAL_LLM_PROVIDERS = new Set(["openai", "anthropic", "gemini"]);
const PLANNED_TENSE_PATTERN =
  /\b(will|plan to|planned to|going to|todo|next action|need to|needs to|should)\b|(予定|する予定|やる|対応する|すべき|次対応|次の対応)/i;
const COMPLETION_EVIDENCE_PATTERN =
  /\b(completed|done|submitted|shipped|implemented|merged|finished|resolved)\b|(完了|実行済|提出済|対応済|実装済|完了した|終わった)/i;
const MAX_DREAMING_TENSE_REWRITE_ATTEMPTS_PER_JOB = 24;
const DREAMING_OLLAMA_PREFLIGHT_TIMEOUT_MS = 500;
const DREAMING_OLLAMA_AVAILABILITY_CACHE_MS = 60_000;
let dreamingOllamaAvailableUntilMs = 0;
let dreamingOllamaUnavailableUntilMs = 0;
let dreamingOllamaAvailabilityHost: string | null = null;

/**
 * S154-201: dreaming consolidation is LOCAL by default. It does NOT inherit the
 * fact-extractor provider — it reads its own HARNESS_MEM_DREAMING_LLM_PROVIDER and
 * falls back to local ollama, so memory never leaves the machine unless explicitly
 * opted in for dreaming specifically.
 */
function resolveDreamingProvider(): string {
  return (process.env.HARNESS_MEM_DREAMING_LLM_PROVIDER || "ollama").trim().toLowerCase();
}

/** S154-201: warn + audit if dreaming is pointed at an external (off-machine) provider. */
function auditDreamingProvider(db: Database, project: string, sessionId: string): string {
  const provider = resolveDreamingProvider();
  if (EXTERNAL_LLM_PROVIDERS.has(provider)) {
    process.stderr.write(
      `[dreaming] WARNING: external LLM provider '${provider}' selected via HARNESS_MEM_DREAMING_LLM_PROVIDER; ` +
        `dreaming tense rewrite will be skipped unless local ollama is selected. Default is local ollama.\n`,
    );
    writeAudit(
      db,
      "consolidation.dreaming.external_provider",
      { provider },
      "session",
      `${project}:${sessionId}`,
    );
  }
  return provider;
}

function createFactId(project: string, sessionId: string, factKey: string, sourceObservationId: string): string {
  const hash = createHash("sha1");
  hash.update(`${project}:${sessionId}:${factKey}:${sourceObservationId}`);
  return `fact_${hash.digest("hex").slice(0, 24)}`;
}

function createDreamingObservationId(project: string, sessionId: string, sourceObservationId: string, content: string): string {
  const hash = createHash("sha1");
  hash.update(`${project}:${sessionId}:${sourceObservationId}:${content}`);
  return `obs_dream_${hash.digest("hex").slice(0, 24)}`;
}

function hashContent(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function temporalAnchorMs(row: { event_time: string | null; observed_at: string | null; valid_from: string | null; created_at: string }): number {
  return parseTimeMs(row.event_time ?? row.valid_from ?? row.observed_at ?? row.created_at) ?? parseTimeMs(row.created_at) ?? 0;
}

function isLikelySinglePlannedStatement(text: string): boolean {
  const parts = text
    .split(/[\n。.!?;；,、，]+|\s+and\s+|\s+そして\s+|\s+かつ\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length <= 1;
}

function parsePrivacyTagsJson(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) return ["private"];
    if (!parsed.every((item) => typeof item === "string")) return ["private"];
    return parsed;
  } catch {
    return ["private"];
  }
}

function observationText(row: { title: string | null; content_redacted: string | null }): string {
  const title = (row.title ?? "").trim();
  const content = (row.content_redacted ?? "").trim();
  if (!title) return content;
  if (!content || title === content) return title;
  return `${title} ${content}`.trim();
}

function isBranchCompatible(plannedBranch: string | null, evidenceBranch: string | null): boolean {
  if (plannedBranch === evidenceBranch) return true;
  if (plannedBranch && !evidenceBranch) return true;
  return false;
}

function isVisibilityCompatible(
  planned: { user_id: string; team_id: string | null },
  evidence: { user_id: string; team_id: string | null },
): boolean {
  if (planned.user_id === evidence.user_id) return true;
  if (planned.team_id && evidence.team_id && planned.team_id === evidence.team_id) return true;
  return false;
}

function isLoopbackHost(rawHost: string): boolean {
  try {
    const url = new URL(rawHost);
    const hostname = url.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function resolveDreamingOllamaHost(): string {
  return (process.env.HARNESS_MEM_DREAMING_OLLAMA_HOST || process.env.HARNESS_MEM_OLLAMA_HOST || "http://127.0.0.1:11434").trim();
}

function resolveDreamingOllamaModel(): string {
  return (process.env.HARNESS_MEM_DREAMING_LLM_MODEL || "qwen3.5:9b").trim();
}

async function isLocalDreamingOllamaAvailable(host: string): Promise<boolean> {
  if (!isLoopbackHost(host)) return false;
  const now = Date.now();
  if (dreamingOllamaAvailabilityHost === host && now < dreamingOllamaAvailableUntilMs) return true;
  if (dreamingOllamaAvailabilityHost === host && now < dreamingOllamaUnavailableUntilMs) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DREAMING_OLLAMA_PREFLIGHT_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/api/tags", host), { method: "GET", signal: controller.signal });
    if (response.ok) {
      dreamingOllamaAvailabilityHost = host;
      dreamingOllamaAvailableUntilMs = now + DREAMING_OLLAMA_AVAILABILITY_CACHE_MS;
      dreamingOllamaUnavailableUntilMs = 0;
      return true;
    }
  } catch {
    // cached below
  } finally {
    clearTimeout(timeout);
  }
  dreamingOllamaAvailabilityHost = host;
  dreamingOllamaUnavailableUntilMs = now + DREAMING_OLLAMA_AVAILABILITY_CACHE_MS;
  return false;
}

async function callLocalDreamingTenseRewrite(
  planned: string,
  evidence: string,
  host: string,
  model: string,
): Promise<{ changed: boolean; false_positive: boolean; rewritten: string; completed_at?: string; reason?: string } | null> {
  if (!isLoopbackHost(host)) return null;
  const system = [
    "Return JSON only.",
    "You are a conservative temporal rewrite judge.",
    "Rewrite a planned statement as completed only when explicit completion evidence is present.",
    "If evidence is missing or ambiguous, return changed=false and false_positive=false.",
  ].join(" ");
  const prompt = [
    "Return exactly this JSON shape:",
    "{\"changed\":true,\"false_positive\":false,\"rewritten\":\"Completed statement.\",\"completed_at\":\"2026-06-09T00:00:00.000Z\",\"reason\":\"short reason\"}",
    `planned: ${redactSecrets(stripPrivateBlocks(planned) ?? "").slice(0, 1200)}`,
    `evidence: ${redactSecrets(stripPrivateBlocks(evidence) ?? "").slice(0, 1200)}`,
  ].join("\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(new URL("/api/chat", host), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const parsed = await response.json() as { message?: { content?: unknown } };
    const content = parsed.message?.content;
    if (typeof content !== "string") return null;
    const json = JSON.parse(content) as Record<string, unknown>;
    return {
      changed: json.changed === true,
      false_positive: json.false_positive === true,
      rewritten: typeof json.rewritten === "string" ? json.rewritten : "",
      completed_at: typeof json.completed_at === "string" ? json.completed_at : undefined,
      reason: typeof json.reason === "string" ? json.reason : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function writeAudit(
  db: Database,
  action: string,
  details: Record<string, unknown>,
  targetType = "consolidation",
  targetId = ""
): void {
  db.query(
    `
      INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
      VALUES (?, 'system', ?, ?, ?, ?)
    `
  ).run(action, targetType, targetId, JSON.stringify(details), nowIso());
}

function loadPendingJobs(db: Database, options: ConsolidationRunOptions): QueueRow[] {
  if (options.project && options.session_id) {
    return [
      {
        id: -1,
        project: options.project,
        session_id: options.session_id,
        reason: options.reason ?? null,
      },
    ];
  }

  const limit = Math.max(1, Math.min(200, Math.floor(options.limit || 20)));
  const queued = db
    .query(
      `
        SELECT id, project, session_id, reason
        FROM mem_consolidation_queue
        WHERE status = 'pending'
        ORDER BY requested_at ASC, id ASC
        LIMIT ?
      `
    )
    .all(limit) as QueueRow[];
  if (queued.length > 0) {
    return queued;
  }

  return db
    .query(
      `
        SELECT -1 AS id, project, session_id
        FROM mem_sessions
        ORDER BY updated_at DESC
        LIMIT ?
      `
    )
    .all(limit) as QueueRow[];
}

/** LLM モードが有効かどうか判定する */
function isLlmModeEnabled(): boolean {
  return (process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE || "heuristic").trim().toLowerCase() === "llm";
}

/** 既存のアクティブなファクトを取得する（差分比較用） */
function loadExistingFacts(db: Database, project: string): ExistingFact[] {
  return db
    .query(
      `
        SELECT fact_id, fact_type, fact_key, fact_value
        FROM mem_facts
        WHERE project = ?
          AND merged_into_fact_id IS NULL
          AND superseded_by IS NULL
          AND valid_to IS NULL
        ORDER BY created_at ASC
      `
    )
    .all(project) as ExistingFact[];
}

async function upsertFactsForSession(db: Database, project: string, sessionId: string): Promise<number> {
  const observations = db
    .query(
      `
        SELECT o.id, o.title, o.content_redacted, o.observation_type,
               o.event_time, o.observed_at, o.valid_from, o.valid_to, o.supersedes, o.invalidated_at
        FROM mem_observations o
        WHERE o.project = ? AND o.session_id = ?
          AND o.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM mem_links l
            JOIN mem_observations rewrite ON rewrite.id = l.from_observation_id
            WHERE l.to_observation_id = o.id
              AND l.relation = 'superseded'
              AND rewrite.platform = 'dreaming'
          )
          ${expiredFilterSql("o")}
        ORDER BY o.created_at ASC
      `
    )
    .all(project, sessionId) as Array<{
    id: string;
    title: string;
    content_redacted: string;
    observation_type: string;
    event_time: string | null;
    observed_at: string | null;
    valid_from: string | null;
    valid_to: string | null;
    supersedes: string | null;
    invalidated_at: string | null;
  }>;

  let inserted = 0;

  if (isLlmModeEnabled()) {
    // LLM モード: 差分比較を含む抽出
    const existingFacts = loadExistingFacts(db, project);

    for (const observation of observations) {
      const diffResult = await llmExtractWithDiff(
        {
          title: observation.title || "",
          content: observation.content_redacted || "",
          observation_type: observation.observation_type || "context",
        },
        existingFacts
      );

      // S154-110: an external (off-machine) provider call is auditable egress.
      // Record metrics only (provider/model/bytes/obs) — never the prompt/response
      // body. Local ollama leaves egress undefined, so default config emits no rows.
      if (diffResult.egress) {
        writeAudit(
          db,
          "external.llm.call",
          {
            provider: diffResult.egress.provider,
            model: diffResult.egress.model,
            input_bytes: diffResult.egress.input_bytes,
            output_bytes: diffResult.egress.output_bytes,
            observation_count: 1,
          },
          "session",
          `${project}:${sessionId}`
        );
      }

      // 差分で削除が指定されたファクトに superseded_by を暫定設定（後で新 factId で上書き）
      // まず新ファクトを INSERT してから superseded_by を紐付ける
      const newFactIds: string[] = [];

      for (let i = 0; i < diffResult.new_facts.length; i++) {
        const fact = diffResult.new_facts[i];
        const factId = createFactId(project, sessionId, fact.fact_key, observation.id);
        const validFrom = nowIso();
        const factEventTime = observation.event_time ?? null;
        const factObservedAt = observation.observed_at ?? validFrom;
        const factValidFrom = observation.valid_from ?? factEventTime ?? validFrom;
        const factValidTo = observation.valid_to ?? null;
        const factSupersedes = diffResult.supersedes[i] ?? observation.supersedes ?? null;
        const factInvalidatedAt = observation.invalidated_at ?? null;
        const row = db
          .query(
            `
              INSERT OR IGNORE INTO mem_facts(
                fact_id,
                observation_id,
                project,
                session_id,
                fact_type,
                fact_key,
                fact_value,
                confidence,
                event_time,
                observed_at,
                valid_from,
                valid_to,
                supersedes,
                invalidated_at,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            factId,
            observation.id,
            project,
            sessionId,
            fact.fact_type,
            fact.fact_key,
            fact.fact_value,
            fact.confidence,
            factEventTime,
            factObservedAt,
            factValidFrom,
            factValidTo,
            factSupersedes,
            factInvalidatedAt,
            validFrom,
            validFrom
          );
        const changes = Number((row as { changes?: number }).changes ?? 0);
        inserted += changes;
        newFactIds.push(factId);

        // 自動推薦タグを mem_tags に挿入する（重複は IGNORE で無視）
        if (Array.isArray(fact.auto_tags)) {
          for (const tag of fact.auto_tags) {
            db.query(
              `INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type, created_at) VALUES (?, ?, 'auto', ?)`
            ).run(observation.id, tag, validFrom);
          }
        }

        // この新ファクトが上書きする旧ファクトに superseded_by と valid_to を設定
        const supersededOldId = diffResult.supersedes[i];
        if (supersededOldId) {
          const decisions = buildSupersededDecisions(factId, [supersededOldId]);
          const expiredAt = nowIso();
          for (const decision of decisions) {
            db.query(
              `UPDATE mem_facts
               SET superseded_by = ?, valid_to = ?, invalidated_at = ?, updated_at = ?
               WHERE fact_id = ? AND superseded_by IS NULL`
            ).run(decision.superseded_by, expiredAt, expiredAt, expiredAt, decision.fact_id);
          }
          // 既存ファクトリストからも除外（後続ループで重複処理しないよう）
          const idx = existingFacts.findIndex((ef) => ef.fact_id === supersededOldId);
          if (idx >= 0) {
            existingFacts.splice(idx, 1);
          }
        }
      }

      // deleted_fact_ids: 矛盾で完全無効化されたファクト
      // superseded_by を最後に挿入した新ファクト、または観測IDベースの仮IDで設定
      const representativeNewFactId = newFactIds[newFactIds.length - 1] || `invalidated_by_${observation.id}`;
      if (diffResult.deleted_fact_ids.length > 0) {
        const decisions = buildSupersededDecisions(representativeNewFactId, diffResult.deleted_fact_ids);
        const expiredAt = nowIso();
        for (const decision of decisions) {
          db.query(
            `UPDATE mem_facts
             SET superseded_by = ?, valid_to = ?, invalidated_at = ?, updated_at = ?
             WHERE fact_id = ? AND superseded_by IS NULL`
          ).run(decision.superseded_by, expiredAt, expiredAt, expiredAt, decision.fact_id);
          // 既存ファクトリストからも除外
          const idx = existingFacts.findIndex((ef) => ef.fact_id === decision.fact_id);
          if (idx >= 0) {
            existingFacts.splice(idx, 1);
          }
        }
      }

      // 新たに挿入されたファクトを existingFacts に追加（後続 observation の差分比較に使う）
      for (let i = 0; i < diffResult.new_facts.length; i++) {
        const fact = diffResult.new_facts[i];
        existingFacts.push({
          fact_id: newFactIds[i],
          fact_type: fact.fact_type,
          fact_key: fact.fact_key,
          fact_value: fact.fact_value,
        });
      }
    }
  } else {
    // Heuristic モード: 既存ロジックを維持
    for (const observation of observations) {
      const facts = await extractFacts({
        title: observation.title || "",
        content: observation.content_redacted || "",
        observation_type: observation.observation_type || "context",
      });

      for (const fact of facts) {
        const factId = createFactId(project, sessionId, fact.fact_key, observation.id);
        const validFrom = nowIso();
        const factEventTime = observation.event_time ?? null;
        const factObservedAt = observation.observed_at ?? validFrom;
        const factValidFrom = observation.valid_from ?? factEventTime ?? validFrom;
        const factValidTo = observation.valid_to ?? null;
        const factSupersedes = observation.supersedes ?? null;
        const factInvalidatedAt = observation.invalidated_at ?? null;
        const row = db
          .query(
            `
              INSERT OR IGNORE INTO mem_facts(
                fact_id,
                observation_id,
                project,
                session_id,
                fact_type,
                fact_key,
                fact_value,
                confidence,
                event_time,
                observed_at,
                valid_from,
                valid_to,
                supersedes,
                invalidated_at,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            factId,
            observation.id,
            project,
            sessionId,
            fact.fact_type,
            fact.fact_key,
            fact.fact_value,
            fact.confidence,
            factEventTime,
            factObservedAt,
            factValidFrom,
            factValidTo,
            factSupersedes,
            factInvalidatedAt,
            validFrom,
            validFrom
          );
        inserted += Number((row as { changes?: number }).changes ?? 0);

        // 自動推薦タグを mem_tags に挿入する（重複は IGNORE で無視）
        if (Array.isArray(fact.auto_tags)) {
          for (const tag of fact.auto_tags) {
            db.query(
              `INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type, created_at) VALUES (?, ?, 'auto', ?)`
            ).run(observation.id, tag, validFrom);
          }
        }
      }
    }
  }

  return inserted;
}

/**
 * IMP-011: Derives 関係性（推論リンク）の自動生成
 *
 * 同一プロジェクトのファクト間で Jaccard 類似度を計算し、
 * - 類似度が低い (< 0.15) にも関わらず同じ fact_type を持つファクトは
 *   「別の視点から同じ結論を導いた」推論リンク (derives) として結合する
 * - derives リンクは mem_links テーブルに relation='derives' で保存する
 * - 自己参照・重複リンクは OR IGNORE で排除する
 *
 * LLM モードの有無にかかわらず heuristic ベースで動作する。
 */
function generateDerivesLinks(db: Database, project: string, sessionId: string): number {
  // 同一プロジェクトのアクティブなファクトとその観察IDを取得
  const facts = db
    .query(
      `
        SELECT
          f.fact_id,
          f.observation_id,
          f.fact_type,
          f.fact_key,
          f.fact_value
        FROM mem_facts f
        WHERE f.project = ?
          AND f.merged_into_fact_id IS NULL
          AND f.superseded_by IS NULL
          AND f.valid_to IS NULL
        ORDER BY f.created_at ASC
        LIMIT 200
      `
    )
    .all(project) as Array<{
    fact_id: string;
    observation_id: string;
    fact_type: string;
    fact_key: string;
    fact_value: string;
  }>;

  if (facts.length < 2) {
    return 0;
  }

  function tokenize(text: string): Set<string> {
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .slice(0, 64);
    return new Set(tokens);
  }

  function jaccard(lhs: Set<string>, rhs: Set<string>): number {
    if (lhs.size === 0 || rhs.size === 0) return 0;
    let intersection = 0;
    for (const token of lhs) {
      if (rhs.has(token)) intersection += 1;
    }
    const union = lhs.size + rhs.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  let linksCreated = 0;
  const nowTs = new Date().toISOString();

  // O(n) で全ファクトのトークンセットを事前計算（O(n^2) の内部ループ再計算を回避）
  const tokenSets = facts.map((f) => tokenize(`${f.fact_key} ${f.fact_value}`));

  for (let i = 0; i < facts.length; i++) {
    const fi = facts[i];
    const fiTokens = tokenSets[i];

    for (let j = i + 1; j < facts.length; j++) {
      const fj = facts[j];

      // 異なる観察 ID かつ同じ fact_type のファクト間でリンクを検討
      if (fi.observation_id === fj.observation_id) continue;
      if (fi.fact_type !== fj.fact_type) continue;

      const fjTokens = tokenSets[j];
      const similarity = jaccard(fiTokens, fjTokens);

      // 低類似度 (0.05 〜 0.35) の同型ファクト = 「異なる観点から導かれた洞察」
      // 0.05 未満は無関係、0.35 超は同一ファクトの重複（dedupe 済みのはず）
      if (similarity < 0.05 || similarity > 0.35) continue;

      // derives リンクを双方向に挿入
      const weight = Number((0.5 + similarity).toFixed(4)); // 0.55〜0.85
      const row1 = db
        .query(
          `INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
           VALUES (?, ?, 'derives', ?, ?)`
        )
        .run(fi.observation_id, fj.observation_id, weight, nowTs);
      const changes1 = Number((row1 as { changes?: number }).changes ?? 0);

      const row2 = db
        .query(
          `INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
           VALUES (?, ?, 'derives', ?, ?)`
        )
        .run(fj.observation_id, fi.observation_id, weight, nowTs);
      const changes2 = Number((row2 as { changes?: number }).changes ?? 0);

      linksCreated += changes1 + changes2;
    }
  }

  return linksCreated;
}

function dedupeSessionFacts(db: Database, project: string, sessionId: string): number {
  const facts = db
    .query(
      `
        SELECT
          fact_id,
          project,
          session_id,
          fact_type,
          fact_key,
          fact_value,
          created_at
        FROM mem_facts
        WHERE project = ?
          AND session_id = ?
          AND merged_into_fact_id IS NULL
          AND superseded_by IS NULL
          AND valid_to IS NULL
          AND invalidated_at IS NULL
        ORDER BY created_at ASC
      `
    )
    .all(project, sessionId) as ConsolidationFact[];

  const merges = dedupeFacts(facts);
  for (const merge of merges) {
    db.query(
      `
        UPDATE mem_facts
        SET merged_into_fact_id = ?, updated_at = ?
        WHERE fact_id = ?
      `
    ).run(merge.into_fact_id, nowIso(), merge.from_fact_id);
  }

  return merges.length;
}

async function runDreamingTenseRewrite(
  db: Database,
  project: string,
  sessionId: string,
  provider: string,
  deps: ConsolidationRunDeps,
): Promise<number> {
  if (EXTERNAL_LLM_PROVIDERS.has(provider)) {
    writeAudit(
      db,
      "consolidation.dreaming.tense_rewrite_skipped",
      { provider, reason: "external_provider" },
      "session",
      `${project}:${sessionId}`,
    );
    return 0;
  }
  if (provider !== "ollama") {
    writeAudit(
      db,
      "consolidation.dreaming.tense_rewrite_skipped",
      { provider, reason: "unsupported_provider" },
      "session",
      `${project}:${sessionId}`,
    );
    return 0;
  }
  if (deps.allowLocalDreamingObservationWrites === false) {
    writeAudit(
      db,
      "consolidation.dreaming.tense_rewrite_skipped",
      { provider, reason: "managed_backend" },
      "session",
      `${project}:${sessionId}`,
    );
    return 0;
  }

  const activeObservationSql = `
        SELECT o.id, o.session_id, o.title, o.content_redacted, o.observation_type, o.privacy_tags_json,
               o.user_id, o.team_id,
               o.event_time, o.observed_at, o.valid_from, o.created_at,
               o.thread_id, o.topic, o.expires_at, o.branch
        FROM mem_observations o
        WHERE o.project = ?
          AND o.platform != 'dreaming'
          AND o.archived_at IS NULL
          AND o.invalidated_at IS NULL
          AND (o.valid_to IS NULL OR julianday(o.valid_to) > julianday('now'))
          AND NOT EXISTS (
            SELECT 1
            FROM mem_links l
            JOIN mem_observations rewrite ON rewrite.id = l.from_observation_id
            WHERE l.to_observation_id = o.id
              AND l.relation = 'superseded'
              AND rewrite.platform = 'dreaming'
          )
          ${expiredFilterSql("o")}
  `;
  const recentRows = db
    .query(
      `
        ${activeObservationSql}
        ORDER BY created_at DESC
        LIMIT 500
      `
    )
    .all(project) as DreamingObservationRow[];
  const sessionRows = db
    .query(
      `
        ${activeObservationSql}
          AND o.session_id = ?
        ORDER BY created_at DESC
      `
    )
    .all(project, sessionId) as DreamingObservationRow[];
  const rowsById = new Map<string, DreamingObservationRow>();
  for (const row of recentRows) rowsById.set(row.id, row);
  for (const row of sessionRows) rowsById.set(row.id, row);
  const rows = Array.from(rowsById.values());

  let created = 0;
  let attempts = 0;
  let availabilityChecked = false;
  const ollamaHost = resolveDreamingOllamaHost();
  const ollamaModel = resolveDreamingOllamaModel();
  const currentMs = Date.now();
  plannedLoop:
  for (const planned of rows) {
    const plannedText = observationText(planned);
    if (!PLANNED_TENSE_PATTERN.test(plannedText)) continue;
    if (!isLikelySinglePlannedStatement(plannedText)) continue;

    const plannedTime = temporalAnchorMs(planned);
    const evidenceCandidates = rows
    .filter((row) => {
        if (row.id === planned.id) return false;
        if (row.session_id !== sessionId) return false;
        if (!isBranchCompatible(planned.branch, row.branch)) return false;
        if (!isVisibilityCompatible(planned, row)) return false;
        const evidenceTime = temporalAnchorMs(row);
        if (evidenceTime <= plannedTime) return false;
        if (evidenceTime > currentMs) return false;
        return COMPLETION_EVIDENCE_PATTERN.test(observationText(row));
      })
      .sort((left, right) => temporalAnchorMs(left) - temporalAnchorMs(right));
    if (evidenceCandidates.length === 0) continue;

    for (const evidence of evidenceCandidates) {
      if (attempts >= MAX_DREAMING_TENSE_REWRITE_ATTEMPTS_PER_JOB) break plannedLoop;
      if (!availabilityChecked) {
        availabilityChecked = true;
        if (!(await isLocalDreamingOllamaAvailable(ollamaHost))) {
          writeAudit(
            db,
            "consolidation.dreaming.tense_rewrite_skipped",
            { provider, reason: "ollama_unavailable" },
            "session",
            `${project}:${sessionId}`,
          );
          break plannedLoop;
        }
      }
      const evidenceText = observationText(evidence);
      attempts += 1;
      const rewrite = await callLocalDreamingTenseRewrite(plannedText, evidenceText, ollamaHost, ollamaModel);
      if (!rewrite?.changed || rewrite.false_positive || !rewrite.rewritten.trim()) continue;

      const current = nowIso();
      const plannedAnchor = planned.event_time ?? planned.observed_at ?? planned.valid_from ?? planned.created_at ?? current;
      const evidenceAnchor = evidence.event_time ?? evidence.observed_at ?? evidence.valid_from ?? evidence.created_at ?? current;
      const plannedMs = parseTimeMs(plannedAnchor) ?? Number.NEGATIVE_INFINITY;
      const evidenceMs = parseTimeMs(evidenceAnchor) ?? Date.parse(current);
      const candidateMs = parseTimeMs(rewrite.completed_at);
      const fallbackCompletedAt = evidenceMs >= plannedMs ? evidenceAnchor : plannedAnchor;
      const completedAt = candidateMs !== null && candidateMs >= plannedMs && candidateMs <= evidenceMs
        ? rewrite.completed_at!
        : fallbackCompletedAt;
      const completedMs = parseTimeMs(completedAt);
      if (completedMs !== null && completedMs > parseTimeMs(current)!) continue;
      const redacted = redactSecrets(stripPrivateBlocks(rewrite.rewritten) ?? "").trim();
      if (redacted.length < 8) continue;
      const observationId = createDreamingObservationId(project, sessionId, planned.id, redacted);
      const contentHash = hashContent(project, sessionId, planned.id, redacted);
      const title = "Dreaming tense rewrite";
      const titleFts = segmentJapaneseForFts(title);
      const contentFts = segmentJapaneseForFts(redacted);
      const privacyTags = Array.from(new Set([
        ...parsePrivacyTagsJson(planned.privacy_tags_json),
        ...parsePrivacyTagsJson(evidence.privacy_tags_json),
      ]));

      const transaction = db.transaction(() => {
        const inserted = db
          .query(
            `
              INSERT OR IGNORE INTO mem_observations(
                id, event_id, platform, project, session_id,
                title, content, content_redacted, content_dedupe_hash, raw_text,
                observation_type, memory_type, tags_json, privacy_tags_json,
                user_id, team_id, event_time, observed_at, valid_from, valid_to,
                supersedes, invalidated_at, created_at, updated_at,
                thread_id, topic, expires_at, branch,
                title_fts, content_fts
              ) VALUES (?, NULL, 'dreaming', ?, ?, ?, ?, ?, ?, NULL,
                'action', 'semantic', ?, ?, ?, ?, ?, ?, ?, NULL,
                ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            observationId,
            project,
            sessionId,
            title,
            redacted,
            redacted,
            contentHash,
            JSON.stringify(["dreaming", "tense_rewrite"]),
            JSON.stringify(privacyTags),
            planned.user_id,
            planned.team_id,
            completedAt,
            current,
            completedAt,
            planned.id,
            completedAt,
            current,
            planned.thread_id,
            planned.topic,
            planned.expires_at,
            planned.branch,
            titleFts,
            contentFts,
          ) as { changes?: number };
        if (Number(inserted.changes ?? 0) === 0) return 0;

        db.query(
          `
            UPDATE mem_observations
            SET valid_to = CASE
                  WHEN valid_to IS NULL OR julianday(valid_to) > julianday(?) THEN ?
                  ELSE valid_to
                END,
                invalidated_at = COALESCE(invalidated_at, ?),
                updated_at = ?
            WHERE id = ?
          `
        ).run(completedAt, completedAt, current, current, planned.id);
        db.query(
          `
            UPDATE mem_facts
            SET valid_to = CASE
                  WHEN valid_to IS NULL OR julianday(valid_to) > julianday(?) THEN ?
                  ELSE valid_to
                END,
                invalidated_at = COALESCE(invalidated_at, ?),
                updated_at = ?
            WHERE observation_id = ?
              AND (valid_to IS NULL OR julianday(valid_to) > julianday(?))
          `
        ).run(completedAt, completedAt, current, current, planned.id, completedAt);
        db.query(
          `
            INSERT OR IGNORE INTO mem_links(
              from_observation_id, to_observation_id, relation, weight,
              event_time, observed_at, valid_from, supersedes, created_at
            )
            VALUES (?, ?, 'superseded', 1.0, ?, ?, ?, ?, ?)
          `
        ).run(observationId, planned.id, completedAt, current, completedAt, planned.id, current);
        db.query(
          `INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type, created_at) VALUES (?, 'dreaming', 'auto', ?)`
        ).run(observationId, current);
        db.query(
          `INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type, created_at) VALUES (?, 'tense_rewrite', 'auto', ?)`
        ).run(observationId, current);
        return 1;
      });

      const insertedCount = Number(transaction());
      if (insertedCount > 0 && deps.materializeObservationDerivedData) {
        try {
          deps.materializeObservationDerivedData(observationId);
        } catch (error) {
          writeAudit(
            db,
            "consolidation.dreaming.derived_data_failed",
            { observation_id: observationId, error: error instanceof Error ? error.message : String(error) },
            "observation",
            observationId,
          );
        }
      }
      created += insertedCount;
      if (insertedCount > 0) break;
    }
  }
  return created;
}

export async function runConsolidationOnce(
  db: Database,
  options: ConsolidationRunOptions = {},
  deps: ConsolidationRunDeps = {},
): Promise<ConsolidationRunStats> {
  const jobs = loadPendingJobs(db, options);
  let jobsProcessed = 0;
  let factsExtracted = 0;
  let factsMerged = 0;
  let derivesLinksTotal = 0;
  let dreamingRewritesTotal = 0;

  for (const job of jobs) {
    if (job.id > 0) {
      db.query(`UPDATE mem_consolidation_queue SET status = 'running', started_at = ? WHERE id = ?`).run(nowIso(), job.id);
    }

    // S154-201: per-job reason makes the dreaming path distinguishable in audit/status.
    const jobReason = job.reason || options.reason || "manual";
    const isDreaming = jobReason === DREAMING_REASON;
    const dreamingProvider = isDreaming ? auditDreamingProvider(db, job.project, job.session_id) : undefined;

    const dreamingRewrites = isDreaming && dreamingProvider
      ? await runDreamingTenseRewrite(db, job.project, job.session_id, dreamingProvider, deps)
      : 0;
    const extracted = await upsertFactsForSession(db, job.project, job.session_id);
    const merged = dedupeSessionFacts(db, job.project, job.session_id);
    // IMP-011: derives リンクの自動生成（heuristic ベース）
    const derivesLinks = generateDerivesLinks(db, job.project, job.session_id);

    factsExtracted += extracted;
    factsMerged += merged;
    derivesLinksTotal += derivesLinks;
    dreamingRewritesTotal += dreamingRewrites;
    jobsProcessed += 1;

    writeAudit(
      db,
      "consolidation.run",
      {
        project: job.project,
        session_id: job.session_id,
        facts_extracted: extracted,
        facts_merged: merged,
        derives_links_created: derivesLinks,
        dreaming_rewrites_created: dreamingRewrites,
        reason: jobReason,
      },
      "session",
      `${job.project}:${job.session_id}`
    );

    // S154-201: dreaming jobs get a dedicated, queryable audit row. The dreaming-
    // specific synthesis (prose current-state 204, tense rewrite 303) layers onto
    // this branch later; for now the job runs local-default consolidation + dedup.
    if (isDreaming) {
      writeAudit(
        db,
        "consolidation.dreaming",
        {
          project: job.project,
          session_id: job.session_id,
          provider: dreamingProvider,
          facts_extracted: extracted,
          facts_merged: merged,
          tense_rewrites_created: dreamingRewrites,
        },
        "session",
        `${job.project}:${job.session_id}`
      );
    }

    if (job.id > 0) {
      db.query(
        `
          UPDATE mem_consolidation_queue
          SET status = 'completed', finished_at = ?, error = NULL
          WHERE id = ?
        `
      ).run(nowIso(), job.id);
    }
  }

  const pendingRow = db
    .query(`SELECT COUNT(*) AS count FROM mem_consolidation_queue WHERE status = 'pending'`)
    .get() as { count?: number } | null;

  return {
    jobs_processed: jobsProcessed,
    facts_extracted: factsExtracted,
    facts_merged: factsMerged,
    pending_jobs: Number(pendingRow?.count ?? 0),
    derives_links_created: derivesLinksTotal,
    dreaming_rewrites_created: dreamingRewritesTotal,
  };
}

export function enqueueConsolidationJob(db: Database, project: string, sessionId: string, reason: string): void {
  db.query(
    `
      INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at)
      VALUES (?, ?, ?, 'pending', ?)
    `
  ).run(project, sessionId, reason.slice(0, 255), nowIso());
}
