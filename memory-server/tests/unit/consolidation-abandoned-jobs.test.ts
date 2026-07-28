import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, getConfig } from "../../src/core/harness-mem-core";

/**
 * §160-004: daemon が job 実行中に落ちると `mem_consolidation_queue` の行が
 * `running` のまま残り、誰も片付けないので単調に増える。
 *
 * 2026-07-28 の本番で 49 件の孤児が溜まっており (最古 2026-05-17、最新 2026-07-26)、
 * これを見た調査エージェントが「worker pool がスタック」と誤診して本番 daemon の
 * 再起動を推奨した。実際は 7 分で 3 件完了・pending 0 の健全な状態だった。
 *
 * 起動時に回収されることを固定する。
 */
describe("§160-004 起動時に abandoned consolidation job を回収する", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeCore(dbPath: string): HarnessMemCore {
    return new HarnessMemCore({
      ...getConfig(),
      dbPath,
      backgroundWorkersEnabled: false,
    });
  }

  test("running のまま残った行を failed へ倒し、理由を残す", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-abandoned-"));
    dirs.push(dir);
    const dbPath = join(dir, "t.db");

    // 1 回目の起動でスキーマを作る
    const first = makeCore(dbPath);
    first.shutdown("test");

    // daemon が job 実行中に落ちた状態を作る
    const db = new Database(dbPath);
    db.query(
      `INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at, started_at)
       VALUES (?, ?, ?, 'running', ?, ?)`,
    ).run("p", "s1", "finalize", "2026-06-25T00:00:00.000Z", "2026-06-25T00:00:01.000Z");
    db.query(
      `INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at, started_at)
       VALUES (?, ?, ?, 'running', ?, ?)`,
    ).run("p", "s2", "dreaming", "2026-07-26T00:00:00.000Z", "2026-07-26T00:00:01.000Z");
    // 完了済みの行は触られてはいけない
    db.query(
      `INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at, finished_at)
       VALUES (?, ?, ?, 'completed', ?, ?)`,
    ).run("p", "s3", "finalize", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:05.000Z");
    // pending は次サイクルで拾われるので触られてはいけない
    db.query(
      `INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at)
       VALUES (?, ?, ?, 'pending', ?)`,
    ).run("p", "s4", "finalize", "2026-07-27T00:00:00.000Z");
    db.close(false);

    // 2 回目の起動で回収される
    const second = makeCore(dbPath);
    try {
      const verify = new Database(dbPath, { readonly: true });
      const counts = verify
        .query(`SELECT status, count(*) AS n FROM mem_consolidation_queue GROUP BY status`)
        .all() as Array<{ status: string; n: number }>;
      const byStatus = Object.fromEntries(counts.map((r) => [r.status, r.n]));

      expect(byStatus.running ?? 0).toBe(0);
      expect(byStatus.failed).toBe(2);
      // 他の状態は変えない
      expect(byStatus.completed).toBe(1);
      expect(byStatus.pending).toBe(1);

      const failed = verify
        .query(`SELECT error, finished_at FROM mem_consolidation_queue WHERE status = 'failed'`)
        .all() as Array<{ error: string; finished_at: string }>;
      for (const row of failed) {
        // 何が起きたか分かる理由を残す (単なる failed だと原因が読めない)
        expect(row.error).toContain("abandoned");
        expect(row.finished_at).toBeTruthy();
      }
      verify.close(false);
    } finally {
      second.shutdown("test");
    }
  });

  test("軽量 child プロセスでは回収しない (親の実行中 job を壊さない)", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-abandoned-child-"));
    dirs.push(dir);
    const dbPath = join(dir, "t.db");

    const first = makeCore(dbPath);
    first.shutdown("test");

    // 親 daemon が実行中の job を模す
    const db = new Database(dbPath);
    db.query(
      `INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at, started_at)
       VALUES (?, ?, ?, 'running', ?, ?)`,
    ).run("p", "s1", "finalize", "2026-07-28T00:00:00.000Z", "2026-07-28T00:00:01.000Z");
    db.close(false);

    // child は同じ DB に対して HarnessMemCore を作るが、回収してはいけない
    const original = process.env.HARNESS_MEM_SEARCH_CHILD_PROCESS;
    process.env.HARNESS_MEM_SEARCH_CHILD_PROCESS = "1";
    let child: HarnessMemCore | null = null;
    try {
      child = makeCore(dbPath);
      const verify = new Database(dbPath, { readonly: true });
      const row = verify
        .query(`SELECT status FROM mem_consolidation_queue`)
        .get() as { status: string };
      // running のまま = 親の job を壊していない
      expect(row.status).toBe("running");
      verify.close(false);
    } finally {
      child?.shutdown("test");
      if (original === undefined) delete process.env.HARNESS_MEM_SEARCH_CHILD_PROCESS;
      else process.env.HARNESS_MEM_SEARCH_CHILD_PROCESS = original;
    }
  });

  test("running が無ければ何も変えない (冪等)", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-abandoned-noop-"));
    dirs.push(dir);
    const dbPath = join(dir, "t.db");

    const first = makeCore(dbPath);
    first.shutdown("test");

    const db = new Database(dbPath);
    db.query(
      `INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at, finished_at)
       VALUES (?, ?, ?, 'completed', ?, ?)`,
    ).run("p", "s1", "finalize", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:05.000Z");
    db.close(false);

    const second = makeCore(dbPath);
    try {
      const verify = new Database(dbPath, { readonly: true });
      const row = verify
        .query(`SELECT status, error FROM mem_consolidation_queue`)
        .get() as { status: string; error: string | null };
      expect(row.status).toBe("completed");
      expect(row.error).toBeNull();
      verify.close(false);
    } finally {
      second.shutdown("test");
    }
  });
});
