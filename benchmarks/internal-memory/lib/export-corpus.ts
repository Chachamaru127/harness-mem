import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { maskTextInline, TsMaskCounters } from "./pii-mask-inline";
import { normalizeDbPlatform } from "./codingmemory-platform";

export interface CorpusRound {
  round_id: string;
  session_id: string;
  project: string;
  timestamp: string;
  language_hint: "ja" | "en" | "mixed";
  source_platform?: "claude" | "codex" | "cursor" | "mixed" | "unknown";
  turns: Array<{
    turn_id: string;
    observation_id: string;
    content: string;
    supersedes?: string;
    observation_type: string;
  }>;
}

function detectLanguage(text: string): "ja" | "en" | "mixed" {
  const ja = (text.match(/[\u3040-\u30ff\u4e00-\u9faf]/g) ?? []).length;
  const en = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (ja > 0 && en > 0) return "mixed";
  if (ja > en) return "ja";
  return "en";
}

function defaultDbPath(): string {
  return join(homedir(), ".harness-mem", "harness-mem.db");
}

export interface ExportCorpusOptions {
  dbPath?: string;
  limit?: number;
  minContentLength?: number;
}

/** Read-only export of observations grouped into session rounds, PII-masked. */
export function exportMaskedCorpus(options: ExportCorpusOptions = {}): CorpusRound[] {
  const dbPath = options.dbPath ?? defaultDbPath();
  const limit = options.limit ?? 5000;
  const minLen = options.minContentLength ?? 40;

  const uri = `file:${dbPath}?mode=ro`;
  const db = new Database(uri, { readonly: true });

  const rows = db
    .query(
      `
      SELECT id, project, session_id, platform, content_redacted, content, created_at,
             supersedes, observation_type
      FROM mem_observations
      WHERE archived_at IS NULL
        AND length(COALESCE(content_redacted, content)) >= ?
      ORDER BY session_id, created_at
      LIMIT ?
    `,
    )
    .all(minLen, limit) as Array<{
    id: string;
    project: string;
    session_id: string;
    platform: string;
    content_redacted: string;
    content: string;
    created_at: string;
    supersedes: string | null;
    observation_type: string;
  }>;

  db.close();

  const bySession = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }

  const counters = new TsMaskCounters();
  const rounds: CorpusRound[] = [];
  for (const [sessionId, sessionRows] of bySession) {
    for (let i = 0; i < sessionRows.length; i += 2) {
      const chunk = sessionRows.slice(i, i + 2);
      const maskedTurns = chunk.map((row) => {
        const raw = row.content_redacted || row.content;
        return maskTextInline(raw, counters);
      });
      const combined = maskedTurns.join("\n");
      const lang = detectLanguage(combined);
      const turns = chunk.map((row, idx) => ({
        turn_id: `${row.id}-t`,
        observation_id: row.id,
        content: maskedTurns[idx] ?? "",
        supersedes: row.supersedes ?? undefined,
        observation_type: row.observation_type,
      }));
      const platforms = chunk
        .map((row) => normalizeDbPlatform(row.platform))
        .filter((value): value is NonNullable<typeof value> => value !== null);
      const platformSet = new Set(platforms);
      const source_platform =
        platformSet.size === 0
          ? undefined
          : platformSet.size === 1
            ? [...platformSet][0]
            : "mixed";
      rounds.push({
        round_id: `${sessionId}-${i}`,
        session_id: sessionId,
        project: maskTextInline(chunk[0].project, counters),
        timestamp: chunk[0].created_at,
        language_hint: lang,
        source_platform,
        turns,
      });
    }
  }
  return rounds;
}
