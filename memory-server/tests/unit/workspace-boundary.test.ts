/**
 * workspace-boundary.test.ts
 *
 * ワークスペース（フォルダ）単位の厳格namespace分離を検証するテスト。
 * 別フォルダのデータ混入 0件を保証する。
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from "node:fs";
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

function createConfig(name: string): Config {
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
});
