import { type Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { dedupeFacts, buildSupersededDecisions, type ConsolidationFact } from "./deduper";
import { extractFacts, llmExtractWithDiff, type ExistingFact } from "./extractor";

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
}

interface QueueRow {
  id: number;
  project: string;
  session_id: string;
}

function createFactId(project: string, sessionId: string, factKey: string, sourceObservationId: string): string {
  const hash = createHash("sha1");
  hash.update(`${project}:${sessionId}:${factKey}:${sourceObservationId}`);
  return `fact_${hash.digest("hex").slice(0, 24)}`;
}

function nowIso(): string {
  return new Date().toISOString();
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
      },
    ];
  }

  const limit = Math.max(1, Math.min(200, Math.floor(options.limit || 20)));
  const queued = db
    .query(
      `
        SELECT id, project, session_id
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
        SELECT id, title, content_redacted, observation_type
        FROM mem_observations
        WHERE project = ? AND session_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(project, sessionId) as Array<{
    id: string;
    title: string;
    content_redacted: string;
    observation_type: string;
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

      // 差分で削除が指定されたファクトに superseded_by を暫定設定（後で新 factId で上書き）
      // まず新ファクトを INSERT してから superseded_by を紐付ける
      const newFactIds: string[] = [];

      for (let i = 0; i < diffResult.new_facts.length; i++) {
        const fact = diffResult.new_facts[i];
        const factId = createFactId(project, sessionId, fact.fact_key, observation.id);
        const validFrom = nowIso();
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
                valid_from,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            validFrom,
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
              `UPDATE mem_facts SET superseded_by = ?, valid_to = ?, updated_at = ? WHERE fact_id = ? AND superseded_by IS NULL`
            ).run(decision.superseded_by, expiredAt, expiredAt, decision.fact_id);
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
            `UPDATE mem_facts SET superseded_by = ?, valid_to = ?, updated_at = ? WHERE fact_id = ? AND superseded_by IS NULL`
          ).run(decision.superseded_by, expiredAt, expiredAt, decision.fact_id);
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
                valid_from,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            validFrom,
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

export async function runConsolidationOnce(db: Database, options: ConsolidationRunOptions = {}): Promise<ConsolidationRunStats> {
  const jobs = loadPendingJobs(db, options);
  let jobsProcessed = 0;
  let factsExtracted = 0;
  let factsMerged = 0;
  let derivesLinksTotal = 0;

  for (const job of jobs) {
    if (job.id > 0) {
      db.query(`UPDATE mem_consolidation_queue SET status = 'running', started_at = ? WHERE id = ?`).run(nowIso(), job.id);
    }

    const extracted = await upsertFactsForSession(db, job.project, job.session_id);
    const merged = dedupeSessionFacts(db, job.project, job.session_id);
    // IMP-011: derives リンクの自動生成（heuristic ベース）
    const derivesLinks = generateDerivesLinks(db, job.project, job.session_id);

    factsExtracted += extracted;
    factsMerged += merged;
    derivesLinksTotal += derivesLinks;
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
        reason: options.reason || "manual",
      },
      "session",
      `${job.project}:${job.session_id}`
    );

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
