#!/usr/bin/env bash
# merge-plugin-scoped-dbs-execute.test.sh — §95 regression
#
# Regression test for the §95 --execute logic bug: in production, the
# three plugin-scoped DBs were written with a DIFFERENT column order
# than the default harness-mem.db (columns were added via migrations
# in different sequences over time). The original implementation used
#
#   INSERT OR IGNORE INTO tgt.mem_observations SELECT * FROM src.mem_observations ...
#
# This maps SELECT positions to INSERT positions — the wrong columns
# landed in the wrong target slots (e.g. src.memory_type jammed into
# tgt.observation_type, src.created_at into tgt.user_id, etc.), the
# NOT-NULL constraint on signal_score got tripped, and OR IGNORE
# silently dropped 95% of rows. Dry-run (which only SELECTs, never
# INSERTs) was unaffected.
#
# This test builds a fixture where source and target have the SAME
# tables but DIFFERENT column order (modeling the real production
# divergence) and asserts that --execute inserts all 5 source rows,
# matching the dry-run estimate (obs_new=5). The previous buggy
# implementation would insert 0 on this fixture.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MERGE_BIN="${SCRIPT_DIR}/../scripts/migrations/merge-plugin-scoped-dbs.sh"

if [ ! -x "$MERGE_BIN" ]; then
  echo "FATAL: ${MERGE_BIN} not found or not executable" >&2
  exit 2
fi

PASS=0
FAIL=0

assert_eq() {
  local actual="$1" expected="$2" name="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

assert_ge() {
  local actual="$1" expected="$2" name="$3"
  if [ "$actual" -ge "$expected" ]; then
    echo "  PASS: $name (actual=$actual >= $expected)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (actual=$actual < $expected)"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" name="$3"
  if echo "$haystack" | grep -qF -- "$needle"; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (needle='$needle' not in output)"
    FAIL=$((FAIL + 1))
  fi
}

# -----------------------------------------------------------------------
# Fixture: TARGET schema mirrors the production default DB column order;
# SOURCE schema mirrors the production plugin-scoped DB column order.
# The important thing is that the columns exist on both sides but in
# different orders (+ the target has a few extra columns the source
# doesn't know about, matching reality).
# -----------------------------------------------------------------------

build_target_db() {
  local db="$1"
  sqlite3 "$db" <<'EOS'
CREATE TABLE mem_sessions (
  session_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  project TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT,
  summary_mode TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  correlation_id TEXT,
  user_id TEXT NOT NULL DEFAULT 'default',
  team_id TEXT DEFAULT NULL,
  workspace_uid TEXT NOT NULL DEFAULT ''
);
CREATE TABLE mem_observations (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  platform TEXT NOT NULL,
  project TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  content_redacted TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  privacy_tags_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  observation_type TEXT NOT NULL DEFAULT 'context',
  signal_score REAL NOT NULL DEFAULT 0,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  user_id TEXT NOT NULL DEFAULT 'default',
  team_id TEXT DEFAULT NULL,
  cognitive_sector TEXT NOT NULL DEFAULT 'meta',
  memory_type TEXT NOT NULL DEFAULT 'semantic',
  workspace_uid TEXT NOT NULL DEFAULT '',
  title_fts TEXT,
  content_fts TEXT,
  thread_id TEXT,
  topic TEXT,
  expires_at TEXT,
  branch TEXT,
  raw_text TEXT,
  archived_at TEXT
);
CREATE TABLE mem_tags (
  observation_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  tag_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(observation_id, tag, tag_type)
);
CREATE TABLE mem_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(name, entity_type)
);
CREATE TABLE mem_observation_entities (
  observation_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(observation_id, entity_id)
);
CREATE TABLE mem_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_observation_id TEXT NOT NULL,
  to_observation_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);
CREATE TABLE mem_vectors (
  observation_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(observation_id, model)
);
CREATE TABLE mem_facts (
  fact_id TEXT PRIMARY KEY,
  observation_id TEXT,
  project TEXT NOT NULL,
  session_id TEXT NOT NULL,
  fact_type TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  merged_into_fact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  superseded_by TEXT,
  valid_from TEXT,
  valid_to TEXT
);
CREATE TABLE mem_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  kind TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 1.0,
  observation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
EOS
}

# SOURCE db — identical table list but DIFFERENT column order for the
# three offenders (mem_observations, mem_sessions, mem_facts). Models
# the real plugin-scoped DBs shipped before §94.
build_source_db() {
  local db="$1"
  sqlite3 "$db" <<'EOS'
CREATE TABLE mem_sessions (
  session_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  project TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT,
  summary_mode TEXT,
  correlation_id TEXT,
  user_id TEXT NOT NULL DEFAULT 'default',
  team_id TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  workspace_uid TEXT NOT NULL DEFAULT ''
);
CREATE TABLE mem_observations (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  platform TEXT NOT NULL,
  project TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  content_redacted TEXT NOT NULL,
  observation_type TEXT NOT NULL DEFAULT 'context',
  memory_type TEXT NOT NULL DEFAULT 'semantic',
  tags_json TEXT NOT NULL,
  privacy_tags_json TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'default',
  team_id TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  signal_score REAL NOT NULL DEFAULT 0,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  cognitive_sector TEXT NOT NULL DEFAULT 'meta',
  workspace_uid TEXT NOT NULL DEFAULT '',
  title_fts TEXT,
  content_fts TEXT,
  raw_text TEXT,
  thread_id TEXT,
  topic TEXT,
  expires_at TEXT,
  branch TEXT,
  archived_at TEXT
);
CREATE TABLE mem_tags (
  observation_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  tag_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(observation_id, tag, tag_type)
);
CREATE TABLE mem_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(name, entity_type)
);
CREATE TABLE mem_observation_entities (
  observation_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(observation_id, entity_id)
);
CREATE TABLE mem_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_observation_id TEXT NOT NULL,
  to_observation_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);
CREATE TABLE mem_vectors (
  observation_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(observation_id, model)
);
CREATE TABLE mem_facts (
  fact_id TEXT PRIMARY KEY,
  observation_id TEXT,
  project TEXT NOT NULL,
  session_id TEXT NOT NULL,
  fact_type TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  superseded_by TEXT,
  valid_from TEXT,
  valid_to TEXT,
  merged_into_fact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE mem_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  kind TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 1.0,
  observation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
EOS
}

TMPDIR_CUSTOM="$(mktemp -d -t merge-s95-exec-test.XXXXXX)"
trap 'rm -rf "${TMPDIR_CUSTOM}"' EXIT

TARGET="${TMPDIR_CUSTOM}/target.db"
SOURCE="${TMPDIR_CUSTOM}/source.db"

build_target_db "${TARGET}"
build_source_db "${SOURCE}"

# -----------------------------------------------------------------------
# Populate target with 2 pre-existing observations and sessions.
# Populate source with 5 new observations that MUST land in target.
# Also include: 1 session, 2 vectors, 2 tags, 1 fact, 1 link, 1 entity.
#
# The source inserts use POSITIONAL VALUES ordering matching the source
# schema (which differs from target) — this is what real plugin DBs
# look like.
# -----------------------------------------------------------------------

sqlite3 "${TARGET}" <<'EOS'
INSERT INTO mem_sessions(session_id,platform,project,started_at,created_at,updated_at)
  VALUES('tgt_s1','cc','proj','2026-04-01','2026-04-01','2026-04-01');
INSERT INTO mem_observations(id,event_id,platform,project,session_id,content,content_redacted,tags_json,privacy_tags_json,created_at,updated_at)
  VALUES('tgt_obs1','tgt_evt1','cc','proj','tgt_s1','hello','hello','[]','[]','2026-04-01','2026-04-01');
EOS

sqlite3 "${SOURCE}" <<'EOS'
-- session
INSERT INTO mem_sessions(session_id,platform,project,started_at,created_at,updated_at)
  VALUES('src_s1','cc','proj','2026-04-22','2026-04-22','2026-04-22');

-- 5 observations with event_id set (production-style). Uses source column
-- order — observation_type and memory_type sit BEFORE tags_json here.
INSERT INTO mem_observations(id,event_id,platform,project,session_id,content,content_redacted,observation_type,memory_type,tags_json,privacy_tags_json,user_id,team_id,created_at,updated_at,signal_score,access_count)
  VALUES('src_obs1','src_evt1','cc','proj','src_s1','row1','row1','context','semantic','["t"]','[]','default',NULL,'2026-04-22','2026-04-22',0.5,0);
INSERT INTO mem_observations(id,event_id,platform,project,session_id,content,content_redacted,observation_type,memory_type,tags_json,privacy_tags_json,user_id,team_id,created_at,updated_at,signal_score,access_count)
  VALUES('src_obs2','src_evt2','cc','proj','src_s1','row2','row2','decision','episodic','[]','[]','default',NULL,'2026-04-22','2026-04-22',0.8,1);
INSERT INTO mem_observations(id,event_id,platform,project,session_id,content,content_redacted,observation_type,memory_type,tags_json,privacy_tags_json,user_id,team_id,created_at,updated_at,signal_score,access_count)
  VALUES('src_obs3','src_evt3','cc','proj','src_s1','row3','row3','context','semantic','[]','[]','default',NULL,'2026-04-22','2026-04-22',0.1,0);
INSERT INTO mem_observations(id,event_id,platform,project,session_id,content,content_redacted,observation_type,memory_type,tags_json,privacy_tags_json,user_id,team_id,created_at,updated_at,signal_score,access_count)
  VALUES('src_obs4',NULL,'cc','proj','src_s1','row4_null_evt','row4_null_evt','context','semantic','[]','[]','default',NULL,'2026-04-22','2026-04-22',0.2,0);
INSERT INTO mem_observations(id,event_id,platform,project,session_id,content,content_redacted,observation_type,memory_type,tags_json,privacy_tags_json,user_id,team_id,created_at,updated_at,signal_score,access_count)
  VALUES('src_obs5','src_evt5','cc','proj','src_s1','row5','row5','context','procedural','[]','[]','default',NULL,'2026-04-22','2026-04-22',0.3,0);

-- vectors (for src_obs1, src_obs2)
INSERT INTO mem_vectors VALUES('src_obs1','ruri-v3',4,'[0.1,0.2,0.3,0.4]','2026-04-22','2026-04-22');
INSERT INTO mem_vectors VALUES('src_obs2','ruri-v3',4,'[0.5,0.6,0.7,0.8]','2026-04-22','2026-04-22');

-- tags
INSERT INTO mem_tags VALUES('src_obs1','auto','kind','2026-04-22');
INSERT INTO mem_tags VALUES('src_obs2','manual','kind','2026-04-22');

-- entity + link from entity
INSERT INTO mem_entities VALUES(1,'Alice','person','2026-04-22');
INSERT INTO mem_observation_entities VALUES('src_obs1',1,'2026-04-22');

-- link
INSERT INTO mem_links VALUES(1,'src_obs1','src_obs2','follows',1.0,'2026-04-22');

-- fact (source column order — superseded_by BEFORE merged_into_fact_id)
INSERT INTO mem_facts(fact_id,observation_id,project,session_id,fact_type,fact_key,fact_value,confidence,superseded_by,valid_from,valid_to,merged_into_fact_id,created_at,updated_at)
  VALUES('src_f1','src_obs1','proj','src_s1','k','greet','hi',0.9,NULL,NULL,NULL,NULL,'2026-04-22','2026-04-22');
EOS

# -----------------------------------------------------------------------
# Test 1: dry-run estimates 5 new observations across schema-divergent DBs
# -----------------------------------------------------------------------
echo "Test 1: dry-run counts are accurate even with divergent column order"

DRY_OUT="$(HOME="${TMPDIR_CUSTOM}" "${MERGE_BIN}" --target "${TARGET}" --source "${SOURCE}" 2>&1)"
assert_contains "${DRY_OUT}" "obs: 5 new" "dry-run: obs=5 new"
assert_contains "${DRY_OUT}" "AGGREGATE (dry-run): obs_new=5" "dry-run: aggregate obs_new=5"

# -----------------------------------------------------------------------
# Test 2: --execute actually inserts all 5 obs (regression — used to be 0)
# -----------------------------------------------------------------------
echo "Test 2: --execute inserts the full dry-run estimate despite column-order divergence"

OBS_PRE="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_observations;')"
SESS_PRE="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_sessions;')"
VEC_PRE="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_vectors;')"
FACT_PRE="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_facts;')"

EXEC_OUT="$(HOME="${TMPDIR_CUSTOM}" "${MERGE_BIN}" --target "${TARGET}" --source "${SOURCE}" --execute 2>&1)"

OBS_POST="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_observations;')"
SESS_POST="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_sessions;')"
VEC_POST="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_vectors;')"
FACT_POST="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_facts;')"
TAG_POST="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_tags;')"
LINK_POST="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_links;')"
ENT_POST="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_entities;')"
OBSENT_POST="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_observation_entities;')"

OBS_DELTA=$(( OBS_POST - OBS_PRE ))
SESS_DELTA=$(( SESS_POST - SESS_PRE ))
VEC_DELTA=$(( VEC_POST - VEC_PRE ))
FACT_DELTA=$(( FACT_POST - FACT_PRE ))

assert_eq "${OBS_DELTA}"  "5" "execute: observations inserted = dry-run estimate"
assert_eq "${SESS_DELTA}" "1" "execute: sessions inserted"
assert_eq "${VEC_DELTA}"  "2" "execute: vectors inserted"
assert_eq "${FACT_DELTA}" "1" "execute: facts inserted"
assert_eq "${TAG_POST}"   "2" "execute: tags inserted"
assert_eq "${LINK_POST}"  "1" "execute: links inserted"
assert_eq "${ENT_POST}"   "1" "execute: entities inserted"
assert_eq "${OBSENT_POST}" "1" "execute: observation_entities inserted"

# -----------------------------------------------------------------------
# Test 3: values actually land in the correct target columns
# (before the fix, src.memory_type would land in tgt.observation_type etc.)
# -----------------------------------------------------------------------
echo "Test 3: column values are preserved across schema-divergent merge"

OBS_TYPE="$(sqlite3 "${TARGET}" "SELECT observation_type FROM mem_observations WHERE id='src_obs2';")"
MEM_TYPE="$(sqlite3 "${TARGET}" "SELECT memory_type FROM mem_observations WHERE id='src_obs2';")"
SIG="$(sqlite3 "${TARGET}" "SELECT signal_score FROM mem_observations WHERE id='src_obs2';")"
CONTENT="$(sqlite3 "${TARGET}" "SELECT content FROM mem_observations WHERE id='src_obs2';")"
EVT_ID="$(sqlite3 "${TARGET}" "SELECT event_id FROM mem_observations WHERE id='src_obs2';")"

assert_eq "${OBS_TYPE}" "decision"  "execute: observation_type preserved"
assert_eq "${MEM_TYPE}" "episodic"  "execute: memory_type preserved"
assert_eq "${SIG}"      "0.8"       "execute: signal_score preserved"
assert_eq "${CONTENT}"  "row2"      "execute: content preserved"
assert_eq "${EVT_ID}"   "src_evt2"  "execute: event_id preserved"

# fact — source column order places superseded_by before merged_into_fact_id.
FACT_KEY="$(sqlite3 "${TARGET}" "SELECT fact_key FROM mem_facts WHERE fact_id='src_f1';")"
FACT_CONF="$(sqlite3 "${TARGET}" "SELECT confidence FROM mem_facts WHERE fact_id='src_f1';")"
assert_eq "${FACT_KEY}"  "greet" "execute: fact_key preserved"
assert_eq "${FACT_CONF}" "0.9"   "execute: fact.confidence preserved"

# -----------------------------------------------------------------------
# Test 4: idempotency — second --execute should not duplicate anything
# -----------------------------------------------------------------------
echo "Test 4: re-running --execute is a no-op"

HOME="${TMPDIR_CUSTOM}" "${MERGE_BIN}" --target "${TARGET}" --source "${SOURCE}" --execute >/dev/null 2>&1

assert_eq "$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_observations;')" "${OBS_POST}" "idempotent: observations stable"
assert_eq "$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_sessions;')"     "${SESS_POST}" "idempotent: sessions stable"
assert_eq "$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_vectors;')"      "${VEC_POST}" "idempotent: vectors stable"
assert_eq "$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_facts;')"        "${FACT_POST}" "idempotent: facts stable"

# -----------------------------------------------------------------------
# Test 5: event_id-based dedupe — if target already has an obs with the
# same event_id (but a different id), a new source row with that
# event_id is NOT re-inserted.
# -----------------------------------------------------------------------
echo "Test 5: event_id is a dedupe key (prevents cross-DB duplicate on re-run from different source id)"

TARGET2="${TMPDIR_CUSTOM}/target2.db"
SOURCE2="${TMPDIR_CUSTOM}/source2.db"
build_target_db "${TARGET2}"
build_source_db "${SOURCE2}"

# Target: observation with event_id=shared_evt, id=tgt_id.
sqlite3 "${TARGET2}" <<'EOS'
INSERT INTO mem_sessions(session_id,platform,project,started_at,created_at,updated_at)
  VALUES('s','cc','p','2026-04-01','2026-04-01','2026-04-01');
INSERT INTO mem_observations(id,event_id,platform,project,session_id,content,content_redacted,tags_json,privacy_tags_json,created_at,updated_at)
  VALUES('tgt_id','shared_evt','cc','p','s','hello','hello','[]','[]','2026-04-01','2026-04-01');
EOS

# Source: same event_id but a different id. Should NOT be inserted.
sqlite3 "${SOURCE2}" <<'EOS'
INSERT INTO mem_sessions(session_id,platform,project,started_at,created_at,updated_at)
  VALUES('s','cc','p','2026-04-01','2026-04-01','2026-04-01');
INSERT INTO mem_observations(id,event_id,platform,project,session_id,content,content_redacted,observation_type,memory_type,tags_json,privacy_tags_json,user_id,team_id,created_at,updated_at,signal_score,access_count)
  VALUES('different_id','shared_evt','cc','p','s','hello','hello','context','semantic','[]','[]','default',NULL,'2026-04-01','2026-04-01',0,0);
-- and one genuinely new row
INSERT INTO mem_observations(id,event_id,platform,project,session_id,content,content_redacted,observation_type,memory_type,tags_json,privacy_tags_json,user_id,team_id,created_at,updated_at,signal_score,access_count)
  VALUES('brand_new','brand_new_evt','cc','p','s','fresh','fresh','context','semantic','[]','[]','default',NULL,'2026-04-22','2026-04-22',0,0);
EOS

HOME="${TMPDIR_CUSTOM}" "${MERGE_BIN}" --target "${TARGET2}" --source "${SOURCE2}" --execute >/dev/null 2>&1

OBS_T2="$(sqlite3 "${TARGET2}" 'SELECT COUNT(*) FROM mem_observations;')"
DIFF_ID_EXISTS="$(sqlite3 "${TARGET2}" "SELECT COUNT(*) FROM mem_observations WHERE id='different_id';")"
BRAND_NEW_EXISTS="$(sqlite3 "${TARGET2}" "SELECT COUNT(*) FROM mem_observations WHERE id='brand_new';")"

assert_eq "${OBS_T2}"         "2" "event_id dedupe: only 1 row added (not 2)"
assert_eq "${DIFF_ID_EXISTS}" "0" "event_id dedupe: src with duplicate event_id skipped"
assert_eq "${BRAND_NEW_EXISTS}" "1" "event_id dedupe: src with novel event_id inserted"

# -----------------------------------------------------------------------
# Results
# -----------------------------------------------------------------------
TOTAL=$((PASS + FAIL))
echo ""
echo "Results: ${PASS}/${TOTAL} PASS"
if [ "${FAIL}" -gt 0 ]; then
  echo "         ${FAIL} FAIL"
  exit 1
fi
exit 0
