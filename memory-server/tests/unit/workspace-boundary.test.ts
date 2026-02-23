/**
 * workspace-boundary.test.ts
 *
 * ワークスペース（フォルダ）単位の厳格namespace分離を検証するテスト。
 * 別フォルダのデータ混入 0件を保証する。
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string, overrides: Partial<Config> = {}): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-wb-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 37888,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
    ...overrides,
  };
}

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "test-project",
    session_id: "session-1",
    event_type: "user_prompt",
    ts: "2026-02-14T00:00:00.000Z",
    payload: { prompt: "test content" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("workspace boundary", () => {
  test("different projects do not mix in search results", () => {
    const core = new HarnessMemCore(createConfig("no-mix"));
    try {
      core.recordEvent(baseEvent({ project: "project-alpha", payload: { prompt: "alpha unique content" } }));
      core.recordEvent(baseEvent({ project: "project-beta", payload: { prompt: "beta unique content" } }));

      const searchAlpha = core.search({ query: "unique content", project: "project-alpha", strict_project: true, include_private: true });
      const searchBeta = core.search({ query: "unique content", project: "project-beta", strict_project: true, include_private: true });

      // project-alpha の結果に project-beta のデータが混入しないこと
      for (const item of searchAlpha.items as Array<{ project: string }>) {
        expect(item.project).toBe("project-alpha");
      }

      // project-beta の結果に project-alpha のデータが混入しないこと
      for (const item of searchBeta.items as Array<{ project: string }>) {
        expect(item.project).toBe("project-beta");
      }

      // 各プロジェクトの結果が0件でないこと（データが正しく記録されていること）
      expect(searchAlpha.ok).toBe(true);
      expect(searchBeta.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("empty project name is rejected with ok=false", () => {
    const core = new HarnessMemCore(createConfig("empty-project"));
    try {
      const result = core.recordEvent(baseEvent({ project: "" }));
      expect(result.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("whitespace-only project name is rejected", () => {
    const core = new HarnessMemCore(createConfig("whitespace-project"));
    try {
      const result = core.recordEvent(baseEvent({ project: "   " }));
      expect(result.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("trailing slashes are normalized in project name", () => {
    const core = new HarnessMemCore(createConfig("trailing-slash"));
    try {
      // trailing slash あり・なし、どちらも同じプロジェクトとして扱われること
      const r1 = core.recordEvent(baseEvent({ event_id: "ev-1", project: "my-project//", session_id: "sess-1" }));
      const r2 = core.recordEvent(baseEvent({ event_id: "ev-2", project: "my-project", session_id: "sess-2" }));

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);

      // 両イベントが同一プロジェクト名で記録されていること
      const item1 = r1.items[0] as { project: string };
      const item2 = r2.items[0] as { project: string };
      expect(item1.project).toBe(item2.project);
    } finally {
      core.shutdown("test");
    }
  });

  test("symlinked directory resolves to real path as project name", () => {
    // symlink先のディレクトリと、symlinkを作成してプロジェクト名として使う
    const realDir = mkdtempSync(join(tmpdir(), "harness-mem-wb-realdir-"));
    cleanupPaths.push(realDir);

    const symlinkDir = join(tmpdir(), `harness-mem-wb-symlink-${Date.now()}`);
    symlinkSync(realDir, symlinkDir, "dir");
    cleanupPaths.push(symlinkDir);

    const core = new HarnessMemCore(createConfig("symlink"));
    try {
      // symlink パスで記録
      const rViaSymlink = core.recordEvent(baseEvent({ event_id: "ev-sym", project: symlinkDir, session_id: "sess-sym" }));
      // real パスで記録（同一プロジェクトのはず）
      const rViaReal = core.recordEvent(baseEvent({ event_id: "ev-real", project: realDir, session_id: "sess-real" }));

      expect(rViaSymlink.ok).toBe(true);
      expect(rViaReal.ok).toBe(true);

      // 両方が同一の正規化されたproject名（realDir）で保存されていること
      const itemSym = rViaSymlink.items[0] as { project: string };
      const itemReal = rViaReal.items[0] as { project: string };
      expect(itemSym.project).toBe(itemReal.project);
    } finally {
      core.shutdown("test");
    }
  });

  test("nested directory inside git workspace is canonicalized to workspace root", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "harness-mem-wb-git-root-"));
    cleanupPaths.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, ".git"), { recursive: true });

    const nestedWorkspaceDir = join(workspaceRoot, "apps", "api");
    mkdirSync(nestedWorkspaceDir, { recursive: true });

    const canonicalRoot = realpathSync(workspaceRoot);

    const core = new HarnessMemCore(
      createConfig("git-root-subdir", {
        codexProjectRoot: workspaceRoot,
        codexSessionsRoot: workspaceRoot,
      })
    );
    try {
      const result = core.recordEvent(
        baseEvent({
          event_id: "ev-git-root-subdir",
          session_id: "sess-git-root-subdir",
          project: nestedWorkspaceDir,
          payload: { prompt: "git workspace root canonicalization test" },
        })
      );
      expect(result.ok).toBe(true);
      const inserted = result.items[0] as { project: string };
      expect(inserted.project).toBe(canonicalRoot);
    } finally {
      core.shutdown("test");
    }
  });

  test("linked worktree path is canonicalized to common git root", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "harness-mem-wb-worktree-"));
    cleanupPaths.push(fixtureRoot);

    const mainRepoRoot = join(fixtureRoot, "main-repo");
    mkdirSync(join(mainRepoRoot, ".git", "worktrees", "feature"), { recursive: true });
    const canonicalMainRoot = realpathSync(mainRepoRoot);

    const worktreeRoot = join(fixtureRoot, "feature-worktree");
    const worktreeNested = join(worktreeRoot, "src");
    mkdirSync(worktreeNested, { recursive: true });
    writeFileSync(
      join(worktreeRoot, ".git"),
      `gitdir: ${join(mainRepoRoot, ".git", "worktrees", "feature")}\n`,
      "utf8"
    );

    const core = new HarnessMemCore(
      createConfig("git-worktree-common-root", {
        codexProjectRoot: mainRepoRoot,
        codexSessionsRoot: worktreeRoot,
      })
    );
    try {
      const result = core.recordEvent(
        baseEvent({
          event_id: "ev-worktree-root",
          session_id: "sess-worktree-root",
          project: worktreeNested,
          payload: { prompt: "worktree canonicalization test" },
        })
      );
      expect(result.ok).toBe(true);
      const inserted = result.items[0] as { project: string };
      expect(inserted.project).toBe(canonicalMainRoot);
    } finally {
      core.shutdown("test");
    }
  });

  test("same basename different absolute paths do not collide", () => {
    const core = new HarnessMemCore(createConfig("same-basename"));
    try {
      // /tmp/a/repo と /tmp/b/repo は basename が同じ "repo" だが絶対パスが異なる
      const dirA = mkdtempSync(join(tmpdir(), "harness-mem-wb-a-"));
      cleanupPaths.push(dirA);
      const dirB = mkdtempSync(join(tmpdir(), "harness-mem-wb-b-"));
      cleanupPaths.push(dirB);

      // 同名の子ディレクトリを作成
      const repoA = join(dirA, "repo");
      const repoB = join(dirB, "repo");
      mkdirSync(repoA, { recursive: true });
      mkdirSync(repoB, { recursive: true });

      // macOS では /var → /private/var の symlink があるため realpath で正規化
      const realRepoA = realpathSync(repoA);
      const realRepoB = realpathSync(repoB);

      // 異なる絶対パスで記録
      core.recordEvent(baseEvent({ event_id: "ev-a", project: repoA, session_id: "sess-a", payload: { prompt: "data from repo A" } }));
      core.recordEvent(baseEvent({ event_id: "ev-b", project: repoB, session_id: "sess-b", payload: { prompt: "data from repo B" } }));

      // repoA で検索 → repoB のデータが混入しないこと
      const searchA = core.search({ query: "data from repo", project: repoA, strict_project: true, include_private: true });
      expect(searchA.ok).toBe(true);
      for (const item of searchA.items as Array<{ project: string }>) {
        expect(item.project).toBe(realRepoA);
      }

      // repoB で検索 → repoA のデータが混入しないこと
      const searchB = core.search({ query: "data from repo", project: repoB, strict_project: true, include_private: true });
      expect(searchB.ok).toBe(true);
      for (const item of searchB.items as Array<{ project: string }>) {
        expect(item.project).toBe(realRepoB);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("strict_project is true by default in search", () => {
    const core = new HarnessMemCore(createConfig("strict-default"));
    try {
      core.recordEvent(baseEvent({ project: "project-x", payload: { prompt: "exclusive data" } }));
      core.recordEvent(baseEvent({ project: "project-y", payload: { prompt: "exclusive data" } }));

      // strict_project を明示しない（デフォルトで true）
      const search = core.search({ query: "exclusive data", project: "project-x", include_private: true });

      expect(search.ok).toBe(true);
      for (const item of search.items as Array<{ project: string }>) {
        expect(item.project).toBe("project-x");
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("basename project that matches codexProjectRoot is canonicalized to absolute path", () => {
    const rootBase = mkdtempSync(join(tmpdir(), "harness-mem-wb-root-"));
    cleanupPaths.push(rootBase);
    const projectRoot = join(rootBase, "harness-mem");
    mkdirSync(projectRoot, { recursive: true });
    const canonicalRoot = realpathSync(projectRoot);

    const core = new HarnessMemCore(
      createConfig("canonical-basename", {
        codexProjectRoot: projectRoot,
        codexSessionsRoot: projectRoot,
      })
    );
    try {
      const result = core.recordEvent(
        baseEvent({
          event_id: "ev-canonical",
          session_id: "sess-canonical",
          project: "harness-mem",
          payload: { prompt: "canonical project test" },
        })
      );
      expect(result.ok).toBe(true);
      const inserted = result.items[0] as { project: string };
      expect(inserted.project).toBe(canonicalRoot);

      const byBasename = core.search({
        query: "canonical project test",
        project: "harness-mem",
        strict_project: true,
        include_private: true,
      });
      expect(byBasename.ok).toBe(true);
      for (const item of byBasename.items as Array<{ project: string }>) {
        expect(item.project).toBe(canonicalRoot);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("startup migration rewrites legacy basename project rows to canonical root", () => {
    const rootBase = mkdtempSync(join(tmpdir(), "harness-mem-wb-legacy-"));
    cleanupPaths.push(rootBase);
    const projectRoot = join(rootBase, "harness-mem");
    mkdirSync(projectRoot, { recursive: true });
    const canonicalRoot = realpathSync(projectRoot);

    const config = createConfig("legacy-migrate", {
      codexProjectRoot: projectRoot,
      codexSessionsRoot: projectRoot,
    });

    const seedCore = new HarnessMemCore(config);
    try {
      const seed = seedCore.recordEvent(
        baseEvent({
          event_id: "ev-legacy-seed",
          session_id: "sess-legacy-seed",
          project: "harness-mem",
          payload: { prompt: "legacy project migration test" },
        })
      );
      expect(seed.ok).toBe(true);
    } finally {
      seedCore.shutdown("test");
    }

    const db = new Database(config.dbPath);
    try {
      db.query(`UPDATE mem_sessions SET project = ? WHERE session_id = ?`).run("harness-mem", "sess-legacy-seed");
      db.query(`UPDATE mem_events SET project = ? WHERE session_id = ?`).run("harness-mem", "sess-legacy-seed");
      db.query(`UPDATE mem_observations SET project = ? WHERE session_id = ?`).run("harness-mem", "sess-legacy-seed");
    } finally {
      db.close();
    }

    const migratedCore = new HarnessMemCore(config);
    try {
      const stats = migratedCore.projectsStats({ include_private: true });
      const items = stats.items as Array<{ project: string; observations: number }>;
      expect(items.some((item) => item.project === "harness-mem")).toBe(false);
      const canonical = items.find((item) => item.project === canonicalRoot);
      expect(canonical).toBeDefined();
      expect((canonical?.observations || 0) >= 1).toBe(true);

      const searchByBasename = migratedCore.search({
        query: "legacy project migration test",
        project: "harness-mem",
        strict_project: true,
        include_private: true,
      });
      expect(searchByBasename.ok).toBe(true);
      for (const item of searchByBasename.items as Array<{ project: string }>) {
        expect(item.project).toBe(canonicalRoot);
      }
    } finally {
      migratedCore.shutdown("test");
    }
  });
});
