/**
 * §34 FD-016: Self-eval クエリ生成器
 *
 * 実DBのセッション単位で temporal クエリを自動生成する。
 * 同一セッション内の3件以上のエントリを時系列で取得し、
 * 「最初のタスクは？」「Xの後に何をした？」型のクエリを生成する。
 *
 * 使用方法: bun run memory-server/src/benchmark/self-eval-generator.ts <db-path> [output-path]
 */

import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SelfEvalEntry {
  id: string;
  content: string;
  created_at: string;
  session_id: string;
}

export interface SelfEvalCase {
  id: string;
  session_id: string;
  query: string;
  query_template: string;
  entries: SelfEvalEntry[];
  expected_order: string[];
  generated_at: string;
}

/** クエリテンプレート（日英両対応） */
const QUERY_TEMPLATES = [
  {
    id: "first-task",
    template: (entries: SelfEvalEntry[]) =>
      `What was the first thing I worked on in this session?`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id), // ascending (oldest first)
  },
  {
    id: "latest-task",
    template: (entries: SelfEvalEntry[]) =>
      `What was the most recent activity in this session?`,
    expected_order: (entries: SelfEvalEntry[]) =>
      [...entries].reverse().map((e) => e.id), // descending (newest first)
  },
  {
    id: "after-anchor",
    template: (entries: SelfEvalEntry[]) => {
      // 先頭から2番目のエントリをアンカーとして使用
      const anchor = entries[1] ?? entries[0];
      const snippet = anchor.content.slice(0, 40).replace(/\s+/g, " ").trim();
      return `What happened after "${snippet}"?`;
    },
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.slice(2).map((e) => e.id), // entries after anchor
  },
  {
    id: "sequence",
    template: (entries: SelfEvalEntry[]) =>
      `In what order did I complete tasks in this session?`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id), // ascending
  },
  {
    id: "recent-ja",
    template: (entries: SelfEvalEntry[]) =>
      `このセッションで最後に何をしましたか？`,
    expected_order: (entries: SelfEvalEntry[]) =>
      [...entries].reverse().map((e) => e.id),
  },
  {
    id: "first-ja",
    template: (entries: SelfEvalEntry[]) =>
      `このセッションで最初のタスクは何でしたか？`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },
] as const;

interface SessionRow {
  session_id: string;
  entry_count: number;
}

interface EntryRow {
  id: string;
  content: string;
  created_at: string;
  session_id: string;
}

/**
 * 実DBからセッション別エントリを取得して SelfEvalCase を生成する。
 * @param dbPath SQLite データベースのパス
 * @param targetCount 生成目標件数（デフォルト 50）
 */
export function generateSelfEvalCases(
  dbPath: string,
  targetCount = 50
): SelfEvalCase[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    // 3件以上のエントリを持つセッションを取得
    const sessions = db
      .query<SessionRow, []>(`
        SELECT session_id, COUNT(*) as entry_count
        FROM mem_observations
        WHERE session_id IS NOT NULL AND session_id != ''
          AND content IS NOT NULL AND content != ''
        GROUP BY session_id
        HAVING entry_count >= 3
        ORDER BY entry_count DESC
        LIMIT 200
      `)
      .all();

    if (sessions.length === 0) {
      return [];
    }

    const cases: SelfEvalCase[] = [];
    let caseIdx = 0;

    for (const session of sessions) {
      if (cases.length >= targetCount) break;

      // セッション内エントリを時系列昇順で取得
      const entries = db
        .query<EntryRow, [string]>(`
          SELECT id, content, created_at, session_id
          FROM mem_observations
          WHERE session_id = ?
            AND content IS NOT NULL AND content != ''
          ORDER BY created_at ASC
          LIMIT 20
        `)
        .all(session.session_id);

      if (entries.length < 3) continue;

      // 各テンプレートから1件ずつ生成（targetCount まで）
      for (const tmpl of QUERY_TEMPLATES) {
        if (cases.length >= targetCount) break;

        const expectedOrder = tmpl.expected_order(entries as SelfEvalEntry[]);
        if (expectedOrder.length === 0) continue;

        cases.push({
          id: `self-eval-${String(caseIdx + 1).padStart(3, "0")}`,
          session_id: session.session_id,
          query: tmpl.template(entries as SelfEvalEntry[]),
          query_template: tmpl.id,
          entries: (entries as SelfEvalEntry[]).map((e) => ({
            id: e.id,
            content: e.content.slice(0, 200), // プライバシー: 200文字に切り詰め
            created_at: e.created_at,
            session_id: e.session_id,
          })),
          expected_order: expectedOrder,
          generated_at: new Date().toISOString(),
        });
        caseIdx++;
      }
    }

    return cases;
  } finally {
    db.close();
  }
}

/**
 * 生成された SelfEvalCase の基本統計を表示する。
 */
export function summarizeCases(cases: SelfEvalCase[]): void {
  const byTemplate: Record<string, number> = {};
  for (const c of cases) {
    byTemplate[c.query_template] = (byTemplate[c.query_template] ?? 0) + 1;
  }
  const uniqueSessions = new Set(cases.map((c) => c.session_id)).size;

  console.log(`[self-eval] Generated ${cases.length} cases from ${uniqueSessions} sessions`);
  console.log(`[self-eval] By template:`);
  for (const [tmpl, count] of Object.entries(byTemplate)) {
    console.log(`  ${tmpl}: ${count}`);
  }
}

// CLI として実行された場合
if (import.meta.main) {
  const [, , dbPath, outputPath] = process.argv;
  if (!dbPath) {
    console.error("Usage: bun self-eval-generator.ts <db-path> [output-path]");
    process.exit(1);
  }

  const resolvedDb = resolve(dbPath);
  const cases = generateSelfEvalCases(resolvedDb, 50);
  summarizeCases(cases);

  if (outputPath) {
    const out = resolve(outputPath);
    writeFileSync(out, JSON.stringify(cases, null, 2));
    console.log(`[self-eval] Written to ${out}`);
  } else {
    // stdout に出力
    console.log(JSON.stringify(cases, null, 2));
  }
}
