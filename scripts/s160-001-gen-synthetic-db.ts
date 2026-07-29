#!/usr/bin/env bun
/**
 * §160-001: recordEvent 1 件のコストを DB サイズ別に測るためのベンチ準備スクリプト。
 *
 * 本番 DB (~/.harness-mem/) には一切触れない。合成データを bulk insert して
 * 任意サイズの SQLite ファイルをスクラッチ領域に作る。
 *
 * 生成される行は本番スキーマ (memory-server/src/db/schema.ts) と同じ列・同じ
 * トリガー (FTS5) ・同じ vec0 仮想テーブルを使う。recordEvent() 自体は 1 行ごとに
 * entity 抽出や auto-linker まで走るため大量件数の bulk 生成には使わず、
 * ここでは observation_insert 相当の生 SQL を batched transaction で流す
 * （FTS トリガーは通常どおり発火する = 本番と同じ形で mem_observations_fts も育つ）。
 *
 * Usage:
 *   bun scripts/s160-001-gen-synthetic-db.ts --out <path.db> --target-bytes <n> [--vector-dimension 256]
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import {
  configureDatabase,
  initFtsIndex,
  initSchema,
  migrateSchema,
} from "../memory-server/src/db/schema";
import { segmentJapaneseForFts } from "../memory-server/src/core/core-utils";
import { upsertSqliteVecRow } from "../memory-server/src/vector/providers";

const WORDS = [
  "harness", "mem", "daemon", "ingest", "tick", "budget", "event", "loop", "sqlite",
  "index", "vector", "embedding", "session", "observation", "payload", "recall",
  "search", "consolidation", "worker", "queue", "checkpoint", "audit", "fts",
  "記憶", "検索", "同期", "処理", "書き込み", "計測", "分解", "区間", "実測", "支配",
  "セッション", "イベント", "ページ", "キャッシュ", "遅延", "解析", "抽出", "設定",
  "config", "schema", "migration", "trigger", "rowid", "dedupe", "hash", "content",
];

function pseudoRandomContent(seed: number, targetWords: number): string {
  // xorshift32 — deterministic, no crypto RNG overhead in the hot loop.
  let x = (seed * 2654435761) ^ 0x9e3779b9;
  const words: string[] = [];
  for (let i = 0; i < targetWords; i++) {
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    const idx = Math.abs(x) % WORDS.length;
    words.push(WORDS[idx]);
  }
  return words.join(" ");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function fixedVectorJson(dimension: number): string {
  const arr: number[] = [];
  let x = 12345;
  for (let i = 0; i < dimension; i++) {
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    arr.push(((x % 2000) - 1000) / 1000);
  }
  return JSON.stringify(arr);
}

interface Args {
  out: string;
  targetBytes: number;
  vectorDimension: number;
  batchSize: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let out = "";
  let targetBytes = 0;
  let vectorDimension = 256;
  let batchSize = 1000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i];
    else if (args[i] === "--target-bytes") targetBytes = Number(args[++i]);
    else if (args[i] === "--vector-dimension") vectorDimension = Number(args[++i]);
    else if (args[i] === "--batch-size") batchSize = Number(args[++i]);
  }
  if (!out || !targetBytes) {
    throw new Error("Usage: --out <path.db> --target-bytes <n> [--vector-dimension 256] [--batch-size 1000]");
  }
  return { out, targetBytes, vectorDimension, batchSize };
}

function currentSizeBytes(dbPath: string): number {
  let total = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) total += statSync(p).size;
  }
  return total;
}

async function main(): Promise<void> {
  const { out, targetBytes, vectorDimension, batchSize } = parseArgs();

  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(`${out}${suffix}`)) rmSync(`${out}${suffix}`);
  }

  const db = new Database(out, { create: true });
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  initFtsIndex(db);

  // fallback embedding provider の実テーブル名に合わせるため、model 文字列は
  // 本番と同じ "fallback_local_hash_v3" 系にしておく（vec0 の model 別テーブルを
  // ベンチ本体 (s160-001-recordevent-cost-by-db-size.ts) の実 recordEvent() 呼び出しと
  // 一致させ、埋め込み先の vec テーブルが空にならないようにする）。
  const model = process.env.HARNESS_MEM_BENCH_VECTOR_MODEL || "fallback_local_hash_v3";
  const vectorJson = fixedVectorJson(vectorDimension);

  const insertSession = db.query(`
    INSERT OR IGNORE INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
    VALUES (?, 'bench', 's160-synthetic', ?, ?, ?)
  `);
  const insertEvent = db.query(`
    INSERT INTO mem_events(
      event_id, platform, project, session_id, event_type, ts,
      payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, correlation_id,
      user_id, team_id, metadata_json, created_at
    ) VALUES (?, 'bench', 's160-synthetic', ?, 'user_prompt', ?, ?, '[]', '[]', ?, ?, NULL, 'default', NULL, '{}', ?)
  `);
  const insertObs = db.query(`
    INSERT INTO mem_observations(
      id, event_id, platform, project, session_id,
      title, content, content_redacted, content_dedupe_hash, raw_text, observation_type, memory_type,
      tags_json, privacy_tags_json,
      signal_score, user_id, team_id,
      event_time, observed_at, valid_from, valid_to, supersedes, invalidated_at,
      thread_id, topic, expires_at, branch,
      title_fts, content_fts,
      created_at, updated_at
    ) VALUES (?, ?, 'bench', 's160-synthetic', ?, ?, ?, ?, ?, NULL, 'context', 'semantic', '[]', '[]', 0.5, 'default', NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
  `);
  const insertVector = db.query(`
    INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertAudit = db.query(`
    INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
    VALUES ('privacy_filter', 'bench', 'event', ?, ?, ?)
  `);

  const startedAt = Date.now();
  let rowIndex = 0;
  let lastReportedAt = Date.now();
  let lastSize = currentSizeBytes(out);

  while (lastSize < targetBytes) {
    const tx = db.transaction((count: number) => {
      for (let i = 0; i < count; i++) {
        const idx = rowIndex;
        rowIndex += 1;
        const now = new Date(Date.now()).toISOString();
        const sessionId = `s160-synthetic-session-${Math.floor(idx / 20)}`;
        insertSession.run(sessionId, now, now, now);

        const eventId = `s160-synthetic-evt-${idx}`;
        const observationId = `s160-synthetic-obs-${idx}`;
        const content = pseudoRandomContent(idx, 160); // ~900-1100 bytes
        const title = pseudoRandomContent(idx * 7 + 1, 6);
        const payloadJson = JSON.stringify({ prompt: content });
        const dedupeHash = sha256(`event:${idx}:${content}`);
        const contentDedupeHash = sha256(`content:${idx}:${content}`);
        const titleFts = segmentJapaneseForFts(title);
        const contentFts = segmentJapaneseForFts(content);

        insertEvent.run(eventId, sessionId, now, payloadJson, dedupeHash, observationId, now);
        insertObs.run(
          observationId, eventId, sessionId,
          title, content, content, contentDedupeHash,
          now, // observed_at
          titleFts, contentFts,
          now, now,
        );
        insertVector.run(observationId, model, vectorDimension, vectorJson, now, now);
        upsertSqliteVecRow(db, observationId, vectorJson, now, { model, vectorDimension });

        if (idx % 5 === 0) {
          insertAudit.run(eventId, JSON.stringify({ reason: "private_tag", path: `bench/s160-synthetic` }), now);
        }
      }
    });
    tx(batchSize);

    lastSize = currentSizeBytes(out);
    if (Date.now() - lastReportedAt > 3000) {
      const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
      process.stdout.write(
        `[s160-gen] rows=${rowIndex} size=${(lastSize / 1e6).toFixed(1)}MB target=${(targetBytes / 1e6).toFixed(0)}MB elapsed=${elapsedS}s\n`,
      );
      lastReportedAt = Date.now();
    }
  }

  // WAL の中身を main file に確定させてから正確なサイズを再確認する。
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  const finalSize = currentSizeBytes(out);
  process.stdout.write(
    `[s160-gen] done rows=${rowIndex} final_size=${(finalSize / 1e6).toFixed(1)}MB path=${out}\n`,
  );
  db.close();
}

main().catch((error) => {
  process.stderr.write(`[s160-gen] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
