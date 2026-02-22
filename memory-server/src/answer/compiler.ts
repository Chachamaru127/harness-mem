/**
 * Evidence-Bound Answer Compiler
 *
 * Compiles search results into structured answers where every claim
 * is bound to its source evidence (observation).
 *
 * Principles:
 * - Every statement in the answer must reference a source observation
 * - No hallucinated or inferred information beyond what evidence shows
 * - Sources are ranked by relevance and freshness
 * - Privacy-filtered content is never included in evidence
 */

import type { QuestionKind } from "../retrieval/router";

/** A single piece of evidence from the memory store. */
export interface Evidence {
  /** Observation ID (source). */
  observation_id: string;
  /** Platform that captured this observation. */
  platform: string;
  /** Project context. */
  project: string;
  /** Title of the observation. */
  title: string;
  /** Content (redacted version for privacy). */
  content: string;
  /** Relevance score from search ranking. */
  relevance_score: number;
  /** When the observation was created. */
  created_at: string;
  /** Tags associated with this observation. */
  tags: string[];
}

/** Compiled answer with evidence bindings. */
export interface CompiledAnswer {
  /** The question kind that was used for retrieval. */
  question_kind: QuestionKind;
  /** Total number of evidence items found. */
  evidence_count: number;
  /** Evidence items, ranked by relevance. */
  evidence: Evidence[];
  /** Summary metadata about the evidence set. */
  meta: {
    /** Unique platforms represented in evidence. */
    platforms: string[];
    /** Unique projects represented in evidence. */
    projects: string[];
    /** Time span of evidence (oldest to newest). */
    time_span: { oldest: string; newest: string } | null;
    /** Whether evidence was found across multiple sessions. */
    cross_session: boolean;
    /** Number of evidence items excluded by privacy filters. */
    privacy_excluded: number;
  };
}

export interface CompilerInput {
  question_kind: QuestionKind;
  observations: Array<{
    id: string;
    platform: string;
    project: string;
    title: string | null;
    content_redacted: string;
    created_at: string;
    tags_json: string;
    session_id: string;
    final_score: number;
  }>;
  privacy_excluded_count: number;
}

/**
 * Compile search results into an evidence-bound answer.
 *
 * This function takes ranked observations and structures them as
 * evidence items with metadata about the evidence set.
 */
export function compileAnswer(input: CompilerInput): CompiledAnswer {
  const evidence: Evidence[] = input.observations.map((obs) => {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(obs.tags_json || "[]");
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      // ignore parse errors
    }

    return {
      observation_id: obs.id,
      platform: obs.platform,
      project: obs.project,
      title: obs.title || "",
      content: obs.content_redacted,
      relevance_score: obs.final_score,
      created_at: obs.created_at,
      tags,
    };
  });

  // Compute metadata
  const platforms = [...new Set(evidence.map((e) => e.platform))];
  const projects = [...new Set(evidence.map((e) => e.project))];
  const sessions = new Set(input.observations.map((o) => o.session_id));
  const crossSession = sessions.size > 1;

  let timeSpan: { oldest: string; newest: string } | null = null;
  if (evidence.length > 0) {
    const sorted = [...evidence].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    timeSpan = {
      oldest: sorted[0]!.created_at,
      newest: sorted[sorted.length - 1]!.created_at,
    };
  }

  return {
    question_kind: input.question_kind,
    evidence_count: evidence.length,
    evidence,
    meta: {
      platforms,
      projects,
      time_span: timeSpan,
      cross_session: crossSession,
      privacy_excluded: input.privacy_excluded_count,
    },
  };
}
