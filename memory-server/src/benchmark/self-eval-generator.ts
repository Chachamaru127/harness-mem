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
  slice: string;
  entries: SelfEvalEntry[];
  expected_order: string[];
  generated_at: string;
}

interface QueryTemplate {
  id: string;
  slice: string;
  template: (entries: SelfEvalEntry[]) => string;
  expected_order: (entries: SelfEvalEntry[]) => string[];
}

/** セッション固有のスニペットを取得（クエリの一意性を確保） */
function snippet(entries: SelfEvalEntry[], idx: number, len = 30): string {
  const e = entries[idx] ?? entries[0];
  const text = e.content.slice(0, len).replace(/\s+/g, " ").trim();
  // 同一先頭テキストのセッションを区別するため、末尾のエントリからも短いスニペットを追加
  const last = entries[entries.length - 1];
  if (last && last.id !== e.id) {
    const tail = last.content.slice(0, 15).replace(/\s+/g, " ").trim();
    return `${text}...${tail}`;
  }
  return text;
}

/** クエリテンプレート（日英両対応・全20種） */
export const QUERY_TEMPLATES: QueryTemplate[] = [
  // --- temporal-order 系（3種: 既存6種から3種に削減。スニペット埋め込みで一意化） ---
  {
    id: "se-to-01",
    slice: "temporal-order",
    template: (entries: SelfEvalEntry[]) =>
      `In the session starting with "${snippet(entries, 0)}", what was the first thing I worked on?`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },
  {
    id: "se-to-02",
    slice: "temporal-order",
    template: (entries: SelfEvalEntry[]) =>
      `What was the most recent activity in the session involving "${snippet(entries, 0)}"?`,
    expected_order: (entries: SelfEvalEntry[]) =>
      [...entries].reverse().map((e) => e.id),
  },
  {
    id: "se-to-03",
    slice: "temporal-order",
    template: (entries: SelfEvalEntry[]) => {
      const anchor = entries[1] ?? entries[0];
      const s = anchor.content.slice(0, 40).replace(/\s+/g, " ").trim();
      return `What happened after "${s}"?`;
    },
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.slice(2).map((e) => e.id),
  },

  // --- tool-recall 系（2種、スニペット埋め込みで一意化） ---
  {
    id: "tool-recall-en",
    slice: "tool-recall",
    template: (entries: SelfEvalEntry[]) =>
      `What tools or commands were used in the session about "${snippet(entries, 0)}"?`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },
  {
    id: "tool-recall-ja",
    slice: "tool-recall",
    template: (entries: SelfEvalEntry[]) =>
      `「${snippet(entries, 0)}」のセッションで使ったツールやコマンドは？`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },

  // --- error-resolution 系（新規2種） ---
  {
    id: "error-resolution-en",
    slice: "error-resolution",
    template: (entries: SelfEvalEntry[]) => {
      const errEntry =
        entries.find((e) => /error|fail|bug|fix/i.test(e.content)) ??
        entries[0];
      const snippet = errEntry.content
        .slice(0, 50)
        .replace(/\s+/g, " ")
        .trim();
      return `How was the issue "${snippet}" resolved?`;
    },
    expected_order: (entries: SelfEvalEntry[]) => {
      const filtered = entries
        .filter((e) =>
          /error|fail|bug|fix|resolve|fixed/i.test(e.content)
        )
        .map((e) => e.id);
      return filtered.length > 0 ? filtered : entries.map((e) => e.id);
    },
  },
  {
    id: "error-resolution-ja",
    slice: "error-resolution",
    template: (entries: SelfEvalEntry[]) => {
      const errEntry =
        entries.find((e) =>
          /エラー|失敗|バグ|修正|error|fail|fix/i.test(e.content)
        ) ?? entries[0];
      const snippet = errEntry.content
        .slice(0, 50)
        .replace(/\s+/g, " ")
        .trim();
      return `「${snippet}」の問題はどう解決しましたか？`;
    },
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },

  // --- decision-why 系（新規2種） ---
  {
    id: "decision-why-en",
    slice: "decision-why",
    template: (entries: SelfEvalEntry[]) => {
      const anchor = entries[Math.floor(entries.length / 2)];
      const snippet = anchor.content
        .slice(0, 40)
        .replace(/\s+/g, " ")
        .trim();
      return `Why was the decision made regarding "${snippet}"?`;
    },
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },
  {
    id: "decision-why-ja",
    slice: "decision-why",
    template: (entries: SelfEvalEntry[]) => {
      const anchor = entries[Math.floor(entries.length / 2)];
      const snippet = anchor.content
        .slice(0, 40)
        .replace(/\s+/g, " ")
        .trim();
      return `「${snippet}」に関する判断の理由は何ですか？`;
    },
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },

  // --- file-change 系（2種、スニペット埋め込みで一意化） ---
  {
    id: "file-change-en",
    slice: "file-change",
    template: (entries: SelfEvalEntry[]) =>
      `Which files were modified in the session about "${snippet(entries, 0)}"?`,
    expected_order: (entries: SelfEvalEntry[]) => {
      const filtered = entries
        .filter((e) =>
          /\.(ts|js|json|md|sh|yaml|yml|css|html)/i.test(e.content)
        )
        .map((e) => e.id);
      return filtered.length > 0 ? filtered : entries.map((e) => e.id);
    },
  },
  {
    id: "file-change-ja",
    slice: "file-change",
    template: (entries: SelfEvalEntry[]) =>
      `「${snippet(entries, 0)}」のセッションで変更されたファイルは？`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },

  // --- cross-client 系（2種、スニペット埋め込みで一意化） ---
  {
    id: "cross-client-en",
    slice: "cross-client",
    template: (entries: SelfEvalEntry[]) =>
      `In the session about "${snippet(entries, 0)}", what work was done across different AI tools?`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },
  {
    id: "cross-client-ja",
    slice: "cross-client",
    template: (entries: SelfEvalEntry[]) =>
      `「${snippet(entries, 0)}」のセッションで別のAIツールを使った作業は？`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },

  // --- session-summary 系（2種、スニペット埋め込みで一意化） ---
  {
    id: "session-summary-en",
    slice: "session-summary",
    template: (entries: SelfEvalEntry[]) =>
      `Summarize what was accomplished in the session starting with "${snippet(entries, 0)}".`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },
  {
    id: "session-summary-ja",
    slice: "session-summary",
    template: (entries: SelfEvalEntry[]) =>
      `「${snippet(entries, 0)}」から始まるセッションで何を達成しましたか？`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },

  // --- dependency 系（新規1種: 20種目） ---
  {
    id: "dependency-ja",
    slice: "dependency",
    template: (entries: SelfEvalEntry[]) =>
      `「${snippet(entries, 0)}」のセッションで追加・変更したパッケージや依存関係は？`,
    expected_order: (entries: SelfEvalEntry[]) => {
      const filtered = entries
        .filter((e) => /package|install|dependency|import|require|npm|bun|yarn/i.test(e.content))
        .map((e) => e.id);
      return filtered.length > 0 ? filtered : entries.map((e) => e.id);
    },
  },

  // --- noisy-ja 系（口語日本語・新規1種） ---
  {
    id: "noisy-casual-ja",
    slice: "noisy-ja",
    template: (entries: SelfEvalEntry[]) => {
      const anchor = entries[Math.floor(entries.length / 2)];
      const snippet = anchor.content
        .slice(0, 30)
        .replace(/\s+/g, " ")
        .trim();
      return `あの${snippet}ってどうなったんだっけ？`;
    },
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },

  // --- noisy-ja 系（口語日本語・追加1種 → 計2種） ---
  {
    id: "noisy-vague-ja",
    slice: "noisy-ja",
    template: (entries: SelfEvalEntry[]) =>
      `えっと、${snippet(entries, entries.length - 1, 25)}の件、結局どうなった？`,
    expected_order: (entries: SelfEvalEntry[]) =>
      [...entries].reverse().map((e) => e.id),
  },

  // --- cross-lingual 系（2種） ---
  {
    id: "cross-lingual-en-to-ja",
    slice: "cross-lingual",
    template: (entries: SelfEvalEntry[]) =>
      `「${snippet(entries, 0, 40)}」について教えてください`,
    expected_order: (entries: SelfEvalEntry[]) =>
      entries.map((e) => e.id),
  },
  {
    id: "cross-lingual-ja-to-en",
    slice: "cross-lingual",
    template: (entries: SelfEvalEntry[]) =>
      `Tell me about the work related to "${snippet(entries, entries.length - 1, 40)}"`,
    expected_order: (entries: SelfEvalEntry[]) =>
      [...entries].reverse().map((e) => e.id),
  },
];

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
 * @param targetCount 生成目標件数（デフォルト 300）
 */
export function generateSelfEvalCases(
  dbPath: string,
  targetCount = 300
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
          slice: tmpl.slice,
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

    // 生成後に exact query duplicate を除去
    const seen = new Set<string>();
    const deduped = cases.filter((c) => {
      const key = c.query.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return deduped;
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
  const cases = generateSelfEvalCases(resolvedDb, 300);
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
