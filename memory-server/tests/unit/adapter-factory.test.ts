/**
 * PG-005: adapter-factory の createRepositories() ユニットテスト
 *
 * PG 接続自体は不要。モック PgClientLike を使って Repository 選択ロジックを検証する。
 *
 * テスト方針:
 *   1. HARNESS_MEM_PG_URL 設定時に Pg*Repository が選択されること
 *   2. HARNESS_MEM_PG_URL 未設定時に Sqlite*Repository が選択されること
 *   3. 生成された Repository が正しいインターフェースを実装していること
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createRepositories } from "../../src/db/adapter-factory";
import type { IObservationRepository } from "../../src/db/repositories/IObservationRepository";
import type { ISessionRepository } from "../../src/db/repositories/ISessionRepository";
import type { IVectorRepository } from "../../src/db/repositories/IVectorRepository";

// ---------------------------------------------------------------------------
// テスト前後処理
// ---------------------------------------------------------------------------

let originalPgUrl: string | undefined;

beforeEach(() => {
  originalPgUrl = process.env.HARNESS_MEM_PG_URL;
});

afterEach(() => {
  if (originalPgUrl === undefined) {
    delete process.env.HARNESS_MEM_PG_URL;
  } else {
    process.env.HARNESS_MEM_PG_URL = originalPgUrl;
  }
});

// ---------------------------------------------------------------------------
// helper: IObservationRepository / ISessionRepository / IVectorRepository の
//         メソッドが存在するか検証するアサーション
// ---------------------------------------------------------------------------

function assertObservationRepoInterface(repo: IObservationRepository): void {
  expect(typeof repo.insert).toBe("function");
  expect(typeof repo.findById).toBe("function");
  expect(typeof repo.findByIds).toBe("function");
  expect(typeof repo.findMany).toBe("function");
  expect(typeof repo.updatePrivacyTags).toBe("function");
  expect(typeof repo.delete).toBe("function");
  expect(typeof repo.count).toBe("function");
}

function assertSessionRepoInterface(repo: ISessionRepository): void {
  expect(typeof repo.upsert).toBe("function");
  expect(typeof repo.findById).toBe("function");
  expect(typeof repo.findMany).toBe("function");
  expect(typeof repo.finalize).toBe("function");
  expect(typeof repo.findByCorrelationId).toBe("function");
  expect(typeof repo.count).toBe("function");
}

function assertVectorRepoInterface(repo: IVectorRepository): void {
  expect(typeof repo.upsert).toBe("function");
  expect(typeof repo.findByObservationId).toBe("function");
  expect(typeof repo.findByObservationIds).toBe("function");
  expect(typeof repo.findLegacyObservationIds).toBe("function");
  expect(typeof repo.coverage).toBe("function");
  expect(typeof repo.delete).toBe("function");
}

// ---------------------------------------------------------------------------
// テスト 1: HARNESS_MEM_PG_URL 未設定 → SQLite Repository が返ること
// ---------------------------------------------------------------------------

describe("createRepositories — SQLite mode (no PG_URL)", () => {
  test("HARNESS_MEM_PG_URL が未設定の場合は SQLite Repository を返す", () => {
    delete process.env.HARNESS_MEM_PG_URL;
    const db = new Database(":memory:");

    const bundle = createRepositories(db);

    // コンストラクタ名で SQLite 実装であることを確認
    expect(bundle.observation.constructor.name).toBe("SqliteObservationRepository");
    expect(bundle.session.constructor.name).toBe("SqliteSessionRepository");
    expect(bundle.vector.constructor.name).toBe("SqliteVectorRepository");

    db.close();
  });

  test("明示的に pgUrl=undefined を渡した場合も SQLite Repository を返す", () => {
    delete process.env.HARNESS_MEM_PG_URL;
    const db = new Database(":memory:");

    const bundle = createRepositories(db, undefined, 768);

    expect(bundle.observation.constructor.name).toBe("SqliteObservationRepository");
    expect(bundle.session.constructor.name).toBe("SqliteSessionRepository");
    expect(bundle.vector.constructor.name).toBe("SqliteVectorRepository");

    db.close();
  });
});

// ---------------------------------------------------------------------------
// テスト 2: HARNESS_MEM_PG_URL 設定時 → PG Repository が返ること
//           (pg パッケージ不要: pg のモックを require キャッシュへ注入)
// ---------------------------------------------------------------------------

describe("createRepositories — PostgreSQL mode (PG_URL set)", () => {
  /**
   * pg パッケージをモックする。
   * require() で "pg" が呼ばれたとき、テスト用のダミー Pool を返す。
   */
  function withPgMock(fn: () => void): void {
    // Bun の Module キャッシュへ pg をモックとして注入する
    // (bun:test の mock.module を使用)
    const { mock } = require("bun:test") as { mock: { module: (path: string, factory: () => unknown) => void } };

    const fakePool = {
      query: async () => ({ rows: [], rowCount: 0 }),
      end: async () => {},
    };

    mock.module("pg", () => ({
      Pool: class FakePool {
        constructor(_opts: unknown) {}
        query = fakePool.query;
        end = fakePool.end;
      },
    }));

    fn();
  }

  test("HARNESS_MEM_PG_URL が設定されている場合は Pg*Repository を返す", () => {
    process.env.HARNESS_MEM_PG_URL = "postgres://user:pass@localhost:5432/test_db";
    const db = new Database(":memory:");

    // pg パッケージのモックを注入して createRepositories を呼ぶ
    withPgMock(() => {
      const bundle = createRepositories(db);

      expect(bundle.observation.constructor.name).toBe("PgObservationRepository");
      expect(bundle.session.constructor.name).toBe("PgSessionRepository");
      expect(bundle.vector.constructor.name).toBe("PgVectorRepository");
    });

    db.close();
  });

  test("pgUrl を直接渡した場合も Pg*Repository を返す", () => {
    delete process.env.HARNESS_MEM_PG_URL;
    const db = new Database(":memory:");

    withPgMock(() => {
      const bundle = createRepositories(db, "postgres://user:pass@localhost:5432/test_db", 1536);

      expect(bundle.observation.constructor.name).toBe("PgObservationRepository");
      expect(bundle.session.constructor.name).toBe("PgSessionRepository");
      expect(bundle.vector.constructor.name).toBe("PgVectorRepository");
    });

    db.close();
  });
});

// ---------------------------------------------------------------------------
// テスト 3: 生成された Repository が正しいインターフェースを実装していること
// ---------------------------------------------------------------------------

describe("createRepositories — interface compliance", () => {
  test("SQLite Repository がすべての必須メソッドを持つ", () => {
    delete process.env.HARNESS_MEM_PG_URL;
    const db = new Database(":memory:");

    const bundle = createRepositories(db);

    assertObservationRepoInterface(bundle.observation);
    assertSessionRepoInterface(bundle.session);
    assertVectorRepoInterface(bundle.vector);

    db.close();
  });
});
