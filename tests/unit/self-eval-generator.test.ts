/**
 * §34 FD-016: self-eval-generator.ts のテスト
 *
 * インメモリSQLiteを使って generateSelfEvalCases を検証する。
 * 50件生成テスト + クエリテンプレート網羅テスト。
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { generateSelfEvalCases, summarizeCases } from "../../memory-server/src/benchmark/self-eval-generator";

// インメモリDBのパスを持つ一時ディレクトリ
let tmpDir: string;
let dbPath: string;

function createTestDb(dbFile: string): void {
  const db = new Database(dbFile);
  // mem_observations テーブルを作成
  db.run(`
    CREATE TABLE IF NOT EXISTS mem_observations (
      id TEXT PRIMARY KEY,
      platform TEXT,
      project TEXT,
      session_id TEXT,
      event_type TEXT,
      title TEXT,
      content TEXT,
      created_at TEXT,
      tags TEXT,
      privacy_tags TEXT
    )
  `);

  // 20セッション × 5〜8エントリを投入（50件生成に十分な量: 20×6=120件生成可能）
  let obsIdx = 0;
  for (let s = 0; s < 20; s++) {
    const sessionId = `session-${String(s).padStart(3, "0")}`;
    const entryCount = 5 + (s % 4); // 5〜8
    for (let e = 0; e < entryCount; e++) {
      obsIdx++;
      const ts = new Date(Date.now() - (entryCount - e) * 60_000 * 30).toISOString();
      db.run(
        `INSERT INTO mem_observations (id, platform, project, session_id, event_type, content, created_at, tags, privacy_tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `obs_${String(obsIdx).padStart(4, "0")}`,
          "claude",
          `project-${s % 3}`,
          sessionId,
          "user_prompt",
          `Task ${e + 1} in session ${s}: worked on feature implementation and testing. Added unit tests for component ${obsIdx}.`,
          ts,
          "[]",
          "[]",
        ]
      );
    }
  }

  // 2件しかないセッション（生成対象外）
  db.run(
    `INSERT INTO mem_observations (id, platform, project, session_id, event_type, content, created_at, tags, privacy_tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["obs_9999", "claude", "project-x", "session-short", "user_prompt", "Short session entry.", new Date().toISOString(), "[]", "[]"]
  );

  db.close();
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "self-eval-test-"));
  dbPath = join(tmpDir, "test.db");
  createTestDb(dbPath);
});

afterAll(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("generateSelfEvalCases", () => {
  test("デフォルト50件生成テスト", () => {
    const cases = generateSelfEvalCases(dbPath, 50);
    // 20セッション × 6テンプレート = 最大120件生成可能 → 50件上限でちょうど50件
    expect(cases.length).toBe(50);
  });

  test("各ケースに必須フィールドが存在する", () => {
    const cases = generateSelfEvalCases(dbPath, 10);
    for (const c of cases) {
      expect(c.id).toBeTruthy();
      expect(c.session_id).toBeTruthy();
      expect(c.query).toBeTruthy();
      expect(c.query_template).toBeTruthy();
      expect(c.entries).toBeInstanceOf(Array);
      expect(c.entries.length).toBeGreaterThanOrEqual(3);
      expect(c.expected_order).toBeInstanceOf(Array);
      expect(c.expected_order.length).toBeGreaterThan(0);
      expect(c.generated_at).toBeTruthy();
    }
  });

  test("エントリはセッション内で時系列昇順", () => {
    const cases = generateSelfEvalCases(dbPath, 20);
    for (const c of cases) {
      const timestamps = c.entries.map((e) => new Date(e.created_at).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    }
  });

  test("expected_order のIDはエントリのIDのサブセット", () => {
    const cases = generateSelfEvalCases(dbPath, 20);
    for (const c of cases) {
      const entryIds = new Set(c.entries.map((e) => e.id));
      for (const orderId of c.expected_order) {
        expect(entryIds.has(orderId)).toBe(true);
      }
    }
  });

  test("プライバシー: エントリのコンテンツが200文字以下に切り詰められている", () => {
    const cases = generateSelfEvalCases(dbPath, 10);
    for (const c of cases) {
      for (const entry of c.entries) {
        expect(entry.content.length).toBeLessThanOrEqual(200);
      }
    }
  });

  test("2件以下のセッション（session-short）は生成対象外", () => {
    const cases = generateSelfEvalCases(dbPath, 50);
    const shortSessions = cases.filter((c) => c.session_id === "session-short");
    expect(shortSessions.length).toBe(0);
  });

  test("複数のクエリテンプレートが使われる", () => {
    const cases = generateSelfEvalCases(dbPath, 50);
    const templates = new Set(cases.map((c) => c.query_template));
    expect(templates.size).toBeGreaterThanOrEqual(2);
  });

  test("DBが空の場合は空配列を返す", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "self-eval-empty-"));
    const emptyDb = join(emptyDir, "empty.db");
    try {
      const db = new Database(emptyDb);
      db.run(`
        CREATE TABLE IF NOT EXISTS mem_observations (
          id TEXT PRIMARY KEY, platform TEXT, project TEXT, session_id TEXT,
          event_type TEXT, title TEXT, content TEXT, created_at TEXT, tags TEXT, privacy_tags TEXT
        )
      `);
      db.close();

      const cases = generateSelfEvalCases(emptyDb, 50);
      expect(cases.length).toBe(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test("生成件数が targetCount を超えない", () => {
    const cases5 = generateSelfEvalCases(dbPath, 5);
    expect(cases5.length).toBeLessThanOrEqual(5);

    const cases20 = generateSelfEvalCases(dbPath, 20);
    expect(cases20.length).toBeLessThanOrEqual(20);
  });

  test("IDが連番でユニーク", () => {
    const cases = generateSelfEvalCases(dbPath, 30);
    const ids = cases.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe("summarizeCases", () => {
  test("コンソール出力なしでエラーが発生しない", () => {
    const cases = generateSelfEvalCases(dbPath, 10);
    expect(() => summarizeCases(cases)).not.toThrow();
  });

  test("空配列でもエラーが発生しない", () => {
    expect(() => summarizeCases([])).not.toThrow();
  });
});
