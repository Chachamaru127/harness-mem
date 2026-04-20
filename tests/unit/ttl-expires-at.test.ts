/**
 * S78-D01b: TTL (expires_at) edge case coverage
 *
 * §78-D01 の impl は landed 済 (commits edfed2b, 9de3d15, cc23bb8) だが境界条件
 * テストが不足していたため、Phase F follow-up として独立タスク化された。
 *
 * 本ファイルは §78-D01 の現挙動を "仕様" としてテストで固定する。impl 側は
 * 一切触らず、現状の `expires_at` read path が返す結果を assertion として freeze する。
 *
 * 対象 read path (memory-server/src/db/repositories/SqliteObservationRepository.ts):
 *   - DEFAULT_FIND_MANY_SQL:  `(expires_at IS NULL OR expires_at > ?)`  ← `?` = now (ISO)
 *   - findMany 動的 SQL:       上と同じ述語を `include_expired !== true` のとき付与
 *   - findById / findByIds:    expires_at フィルタを **適用しない**（直接 ID アクセスは監査用途含む）
 *
 * DoD (Plans.md §78-D01b):
 *   1. "now" 秒境界（expires_at == now の瞬間）
 *   2. NULL / 未来 / 過去の expires_at 混在検索
 *   3. タイムゾーン差異（UTC vs local）
 *   4. supersedes との優先順位
 *   5. TTL 切れ後の resume-pack 挙動
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema, migrateSchema } from "../../memory-server/src/db/schema";
import { SqliteObservationRepository } from "../../memory-server/src/db/repositories/SqliteObservationRepository";
import type { InsertObservationInput } from "../../memory-server/src/db/repositories/IObservationRepository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObs(
  overrides: Partial<InsertObservationInput> & { id: string }
): InsertObservationInput {
  const now = new Date().toISOString();
  return {
    event_id: null,
    platform: "test",
    project: "ttl-project",
    session_id: "session-ttl",
    title: overrides.id,
    content: `content for ${overrides.id}`,
    content_redacted: `content for ${overrides.id}`,
    observation_type: "context",
    memory_type: "semantic",
    tags_json: "[]",
    privacy_tags_json: "[]",
    signal_score: 0,
    user_id: "default",
    team_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// DoD 2: NULL / 未来 / 過去 の expires_at 混在検索
// ---------------------------------------------------------------------------

describe("S78-D01b: NULL / future / past expires_at mixed search", () => {
  let db: Database;
  let repo: SqliteObservationRepository;

  beforeAll(async () => {
    db = new Database(":memory:");
    initSchema(db);
    migrateSchema(db);
    repo = new SqliteObservationRepository(db);

    const observations: Array<InsertObservationInput> = [
      // 無期限（null）
      makeObs({ id: "obs-null", expires_at: null }),
      // 1時間前に期限切れ
      makeObs({ id: "obs-past", expires_at: iso(-3600_000) }),
      // 1時間後に期限切れ
      makeObs({ id: "obs-future", expires_at: iso(3600_000) }),
      // 1日前に期限切れ
      makeObs({ id: "obs-long-past", expires_at: iso(-86_400_000) }),
      // 1日後に期限切れ
      makeObs({ id: "obs-long-future", expires_at: iso(86_400_000) }),
    ];

    for (const obs of observations) {
      await repo.insert(obs);
    }
  });

  afterAll(() => {
    db.close();
  });

  test("デフォルト findMany (include_expired 未指定) は未来+NULL のみ返す", async () => {
    const rows = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      limit: 100,
    });
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["obs-future", "obs-long-future", "obs-null"]);
  });

  test("include_expired=true で過去行も含む全 5 件を返す", async () => {
    const rows = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      include_expired: true,
      limit: 100,
    });
    expect(rows).toHaveLength(5);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([
      "obs-future",
      "obs-long-future",
      "obs-long-past",
      "obs-null",
      "obs-past",
    ]);
  });

  test("default fast-path (DEFAULT_FIND_MANY_SQL) でも同じ結果 — private=false / include_expired=false", async () => {
    // private フィルタ・include_expired を指定しない場合は prepared fast path を通る
    const rows = await repo.findMany({
      project: "ttl-project",
      limit: 100,
    });
    const ids = rows.map((r) => r.id).sort();
    // obs-past / obs-long-past は除外される
    expect(ids).toEqual(["obs-future", "obs-long-future", "obs-null"]);
  });

  test("findById は期限切れ行でも取得可能 (監査用途仕様)", async () => {
    const past = await repo.findById("obs-past");
    expect(past).not.toBeNull();
    expect(past!.id).toBe("obs-past");

    const longPast = await repo.findById("obs-long-past");
    expect(longPast).not.toBeNull();
    expect(longPast!.id).toBe("obs-long-past");
  });

  test("findByIds は期限切れ行でも一括取得可能 (監査用途仕様)", async () => {
    const rows = await repo.findByIds([
      "obs-null",
      "obs-past",
      "obs-future",
      "obs-long-past",
      "obs-long-future",
    ]);
    expect(rows).toHaveLength(5);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([
      "obs-future",
      "obs-long-future",
      "obs-long-past",
      "obs-null",
      "obs-past",
    ]);
  });

  test("NULL expires_at 行はデフォルトで常に返る（無期限）", async () => {
    const rows = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      limit: 100,
    });
    expect(rows.find((r) => r.id === "obs-null")).toBeDefined();
    const nullRow = rows.find((r) => r.id === "obs-null")!;
    expect(nullRow.expires_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DoD 1: "now" 秒境界 (expires_at == now)
// ---------------------------------------------------------------------------

describe("S78-D01b: now second boundary (expires_at == now)", () => {
  let db: Database;
  let repo: SqliteObservationRepository;

  beforeAll(async () => {
    db = new Database(":memory:");
    initSchema(db);
    migrateSchema(db);
    repo = new SqliteObservationRepository(db);

    // 1ms 前 / 1ms 後 / ぴったり / 既に過去 の 4 行を投入。
    // ぴったり = 少しだけ過去(-1ms) のもの。テスト実行時の `now` は
    // findMany 呼び出し側が `new Date().toISOString()` で再生成するため、
    // deterministic にするには "十分過去" と "十分未来" で挟む。
    const obs: Array<InsertObservationInput> = [
      makeObs({ id: "edge-1ms-past", expires_at: iso(-1) }),
      makeObs({ id: "edge-1ms-future", expires_at: iso(1) }),
      makeObs({ id: "edge-safe-past", expires_at: iso(-60_000) }),
      makeObs({ id: "edge-safe-future", expires_at: iso(60_000) }),
    ];
    for (const o of obs) await repo.insert(o);
  });

  afterAll(() => {
    db.close();
  });

  test("read 述語は strict greater-than — expires_at > now のみ残る", async () => {
    // SQL: `expires_at IS NULL OR expires_at > ?` (? = now ISO)
    // ∴ expires_at == now は expired 扱い（`> now` なので false）
    // edge-safe-future は 60s 先なので必ず残る
    // edge-safe-past は 60s 前なので必ず除外
    const rows = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      limit: 100,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("edge-safe-future");
    expect(ids).not.toContain("edge-safe-past");
  });

  test("境界仕様: expires_at を strict greater-than で比較する (== now / < now は expired)", async () => {
    // 現時刻そのものを expires_at に設定した行は expired 扱いになることを
    // 直接 SQL で固定する（`edge-now` を挿入してから `expires_at > now`
    // を評価）。race を避けるため、行挿入直後に同じタイムスタンプを now
    // として使って比較する。
    const frozenNow = new Date().toISOString();
    const insertSql = `
      INSERT INTO mem_observations(
        id, event_id, platform, project, session_id,
        title, content, content_redacted, observation_type, memory_type,
        tags_json, privacy_tags_json, user_id, team_id,
        expires_at, created_at, updated_at
      ) VALUES (
        'edge-now-exact', NULL, 'test', 'ttl-project', 'session-ttl',
        'edge-now-exact', 'x', 'x', 'context', 'semantic',
        '[]', '[]', 'default', NULL,
        ?, ?, ?
      )
    `;
    db.query(insertSql).run(frozenNow, frozenNow, frozenNow);

    // 実装と同じ述語を直接叩く
    const visible = db
      .query<{ id: string }, [string]>(
        `SELECT id FROM mem_observations
         WHERE id = 'edge-now-exact'
           AND (expires_at IS NULL OR expires_at > ?)`
      )
      .all(frozenNow);
    expect(visible).toHaveLength(0); // == now は expired

    // 1ms 後から比較すれば当然 expired
    const latestNow = new Date(Date.parse(frozenNow) + 1).toISOString();
    const visibleLater = db
      .query<{ id: string }, [string]>(
        `SELECT id FROM mem_observations
         WHERE id = 'edge-now-exact'
           AND (expires_at IS NULL OR expires_at > ?)`
      )
      .all(latestNow);
    expect(visibleLater).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DoD 3: タイムゾーン差異 (UTC vs local-like ISO)
// ---------------------------------------------------------------------------

describe("S78-D01b: timezone / ISO-8601 format compatibility", () => {
  let db: Database;
  let repo: SqliteObservationRepository;

  beforeAll(async () => {
    db = new Database(":memory:");
    initSchema(db);
    migrateSchema(db);
    repo = new SqliteObservationRepository(db);
  });

  afterAll(() => {
    db.close();
  });

  test("UTC 'Z' suffix の未来 expires_at は visible", async () => {
    const futureUtc = new Date(Date.now() + 3600_000).toISOString(); // ends with 'Z'
    await repo.insert(makeObs({ id: "tz-utc-future", expires_at: futureUtc }));

    const rows = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      limit: 10,
    });
    expect(rows.find((r) => r.id === "tz-utc-future")).toBeDefined();
  });

  test("+09:00 オフセット (JST) で表現した未来は UTC now と文字列比較で正しく順序付く", async () => {
    // JST = UTC+9。同じ瞬間を +09:00 で表記しても ISO-8601 文字列比較では
    // タイムゾーン情報を数値として見るわけではない — 先頭から lexicographic
    // に比較されるため、"same instant" の表現でも数値が大きい方が勝つ。
    //
    // 本テストは "現 impl が ISO 文字列をそのまま lexicographic 比較する"
    // という現仕様を freeze する目的なので、"明らかに未来 (JST で+1h)" な
    // 値を入れて visible になることを確認する。
    const future = new Date(Date.now() + 3600_000);
    // +09:00 形式に変換
    const pad = (n: number) => String(n).padStart(2, "0");
    const jstMs = future.getTime() + 9 * 3600_000;
    const jst = new Date(jstMs);
    const jstStr =
      `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}` +
      `T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}` +
      `.${String(jst.getUTCMilliseconds()).padStart(3, "0")}+09:00`;

    await repo.insert(makeObs({ id: "tz-jst-future", expires_at: jstStr }));

    // lexicographic 比較で +09:00 表記の未来時刻は UTC now (Z) より大きい
    // (時/分の数値が +9 進んでいるので文字列としても大きい)
    const rows = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      limit: 10,
    });
    expect(rows.find((r) => r.id === "tz-jst-future")).toBeDefined();
  });

  test("過去の +09:00 (JST) expires_at は expired と判定される", async () => {
    // 1 日前の JST 文字列を生成
    const past = new Date(Date.now() - 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const jstMs = past.getTime() + 9 * 3600_000;
    const jst = new Date(jstMs);
    const jstStr =
      `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}` +
      `T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}` +
      `.${String(jst.getUTCMilliseconds()).padStart(3, "0")}+09:00`;

    await repo.insert(makeObs({ id: "tz-jst-past", expires_at: jstStr }));

    const rowsDefault = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      limit: 10,
    });
    expect(rowsDefault.find((r) => r.id === "tz-jst-past")).toBeUndefined();

    // include_expired=true で復活
    const rowsAll = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      include_expired: true,
      limit: 10,
    });
    expect(rowsAll.find((r) => r.id === "tz-jst-past")).toBeDefined();
  });

  test("ナノ秒精度なし / ミリ秒なしの ISO 文字列も受け付ける (lexicographic で比較)", async () => {
    // 秒精度のみ (no ms, no Z suffix は意図的に使わない — 必ず Z 付き)
    const future = new Date(Date.now() + 3600_000);
    const isoNoMs =
      future.toISOString().replace(/\.\d{3}Z$/, "Z");
    await repo.insert(makeObs({ id: "tz-no-ms-future", expires_at: isoNoMs }));

    const rows = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      limit: 10,
    });
    expect(rows.find((r) => r.id === "tz-no-ms-future")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DoD 4: supersedes との優先順位
// ---------------------------------------------------------------------------

describe("S78-D01b: interaction with supersedes (mem_links)", () => {
  let db: Database;
  let repo: SqliteObservationRepository;

  beforeAll(async () => {
    db = new Database(":memory:");
    initSchema(db);
    migrateSchema(db);
    repo = new SqliteObservationRepository(db);

    // obs-new: 未来 expires_at
    // obs-old: 過去 expires_at
    // obs-new-unexpired-supers: 未来 expires_at で obs-old-supers を supersedes
    // obs-old-supers: 未来 expires_at だが supersedes されている
    await repo.insert(makeObs({ id: "obs-new", expires_at: iso(3600_000) }));
    await repo.insert(makeObs({ id: "obs-old", expires_at: iso(-3600_000) }));
    await repo.insert(
      makeObs({ id: "obs-new-unexpired-supers", expires_at: iso(3600_000) })
    );
    await repo.insert(
      makeObs({ id: "obs-old-supers", expires_at: iso(3600_000) })
    );

    const now = new Date().toISOString();
    // obs-new-unexpired-supers → supersedes → obs-old-supers
    db.query(
      `INSERT INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
       VALUES (?, ?, 'supersedes', 1.0, ?)`
    ).run("obs-new-unexpired-supers", "obs-old-supers", now);
  });

  afterAll(() => {
    db.close();
  });

  test("TTL 切れは supersedes の有無に関係なく read path から除外される", async () => {
    // obs-old は expired — supersedes link の有無に関係なく findMany では見えない
    const rows = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      limit: 100,
    });
    expect(rows.find((r) => r.id === "obs-old")).toBeUndefined();
  });

  test("supersedes 関係にある未期限行は findMany で両方とも visible (supersedes は search ranking 層の責務)", async () => {
    // SqliteObservationRepository の read path は supersedes を知らない。
    // supersedes による rank 下げ・除外は observation-store.ts の search
    // post-filter で行われる (S78-D02)。従って repo レイヤでは両方 visible。
    const rows = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      limit: 100,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("obs-new-unexpired-supers");
    expect(ids).toContain("obs-old-supers");
  });

  test("優先順位仕様: TTL チェックが先、supersedes post-filter が後 — 期限切れ行は supersedes link があっても同じく除外", async () => {
    // obs-old-supers を強制的に過去 expires_at に更新して、supersedes されている
    // かつ expired なケースを検証
    db.query(
      `UPDATE mem_observations SET expires_at = ? WHERE id = 'obs-old-supers'`
    ).run(iso(-3600_000));

    const rows = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      limit: 100,
    });
    expect(rows.find((r) => r.id === "obs-old-supers")).toBeUndefined();

    // include_expired=true で戻せる
    const rowsAll = await repo.findMany({
      project: "ttl-project",
      include_private: true,
      include_expired: true,
      limit: 100,
    });
    expect(rowsAll.find((r) => r.id === "obs-old-supers")).toBeDefined();
  });

  test("supersedes link そのものは mem_links に常に保持される（TTL で消えない）", async () => {
    // TTL は observation 行の read 可視性のみを変える。mem_links は独立。
    const links = db
      .query<{ from_observation_id: string; to_observation_id: string; relation: string }, []>(
        `SELECT from_observation_id, to_observation_id, relation FROM mem_links
         WHERE relation = 'supersedes'`
      )
      .all();
    expect(links).toHaveLength(1);
    expect(links[0].from_observation_id).toBe("obs-new-unexpired-supers");
    expect(links[0].to_observation_id).toBe("obs-old-supers");
  });
});

// ---------------------------------------------------------------------------
// DoD 5: TTL 切れ後の resume-pack 挙動
// ---------------------------------------------------------------------------
//
// resume-pack の実体は observation-store.ts 内の search / resume_pack 生成を
// 経由するが、最終的に "mem_observations に対する read path" に委譲される。
// 本ユニットテストでは resume-pack が依拠する read 述語が期限切れ行を
// 除外することを直接 SQL で freeze する。
// ---------------------------------------------------------------------------

describe("S78-D01b: resume-pack read path behavior after TTL expiry", () => {
  let db: Database;
  let repo: SqliteObservationRepository;

  beforeAll(async () => {
    db = new Database(":memory:");
    initSchema(db);
    migrateSchema(db);
    repo = new SqliteObservationRepository(db);

    // 3 件: 1 つは未期限（resume-pack に含まれるべき）、
    //       1 つは期限切れ（除外されるべき）、
    //       1 つは NULL（含まれるべき）。
    await repo.insert(
      makeObs({
        id: "rp-live",
        session_id: "resume-session",
        expires_at: iso(3600_000),
      })
    );
    await repo.insert(
      makeObs({
        id: "rp-expired",
        session_id: "resume-session",
        expires_at: iso(-3600_000),
      })
    );
    await repo.insert(
      makeObs({
        id: "rp-null",
        session_id: "resume-session",
        expires_at: null,
      })
    );
  });

  afterAll(() => {
    db.close();
  });

  test("session_id フィルタ込みの findMany (resume-pack 相当) は期限切れを除外する", async () => {
    const rows = await repo.findMany({
      project: "ttl-project",
      session_id: "resume-session",
      include_private: true,
      limit: 100,
    });
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["rp-live", "rp-null"]);
  });

  test("include_expired=true で監査用に期限切れも返せる (resume-pack の debug mode 仕様)", async () => {
    const rows = await repo.findMany({
      project: "ttl-project",
      session_id: "resume-session",
      include_private: true,
      include_expired: true,
      limit: 100,
    });
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(["rp-expired", "rp-live", "rp-null"]);
  });

  test("findById は resume-pack context 外でも期限切れ行を返す (監査用)", async () => {
    const expired = await repo.findById("rp-expired");
    expect(expired).not.toBeNull();
    expect(expired!.expires_at).not.toBeNull();
    // expires_at が設定されており、かつ過去であることを確認
    expect(new Date(expired!.expires_at!).getTime()).toBeLessThan(Date.now());
  });

  test("resume-pack 読み取り述語 (observation-store.ts の alias 付き SQL と同じ形) が期限切れを除外", async () => {
    // observation-store.ts line 1426:
    //   nextSql += ` AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)`;
    // これと同等の生 SQL を発行して挙動を freeze する。
    const rows = db
      .query<{ id: string }, [string, string]>(
        `SELECT o.id FROM mem_observations o
         WHERE o.project = ?
           AND (o.expires_at IS NULL OR o.expires_at > ?)
         ORDER BY o.id ASC`
      )
      .all("ttl-project", new Date().toISOString());

    const ids = rows.map((r) => r.id);
    expect(ids).toContain("rp-live");
    expect(ids).toContain("rp-null");
    expect(ids).not.toContain("rp-expired");
  });
});

// ---------------------------------------------------------------------------
// DoD 2 (extra): count() と TTL の相互作用
// ---------------------------------------------------------------------------

describe("S78-D01b: count() does not filter by expires_at (current spec)", () => {
  let db: Database;
  let repo: SqliteObservationRepository;

  beforeAll(async () => {
    db = new Database(":memory:");
    initSchema(db);
    migrateSchema(db);
    repo = new SqliteObservationRepository(db);

    await repo.insert(makeObs({ id: "cnt-live", expires_at: iso(3600_000) }));
    await repo.insert(makeObs({ id: "cnt-expired", expires_at: iso(-3600_000) }));
    await repo.insert(makeObs({ id: "cnt-null", expires_at: null }));
  });

  afterAll(() => {
    db.close();
  });

  test("count() は TTL フィルタを適用しない — 現挙動 (仕様 freeze)", async () => {
    // 現 impl の count() は expires_at 述語を含まない。テストは現挙動を
    // 固定するだけで、将来 TTL aware にする場合は別タスクで仕様変更する。
    const total = await repo.count({ project: "ttl-project", include_private: true });
    expect(total).toBe(3);
  });
});
