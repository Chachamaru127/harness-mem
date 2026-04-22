#!/usr/bin/env bash
# merge-plugin-scoped-dbs-dryrun.test.sh — §95
#
# Unit tests for scripts/migrations/merge-plugin-scoped-dbs.sh. Verifies
# dry-run computation on fixture DBs and confirms that dry-run never
# mutates the target. Also exercises the --execute path on a fixture to
# prove basic correctness (idempotency, session / obs / tag / vector /
# entity / observation_entities merge).
#
# No network, no daemon. sqlite3 only.

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
  local actual="$1"
  local expected="$2"
  local name="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local name="$3"
  if echo "$haystack" | grep -qF -- "$needle"; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (needle='$needle' not in output)"
    FAIL=$((FAIL + 1))
  fi
}

# -----------------------------------------------------------------------
# Build fixture: minimal harness-mem schema subset used by the merge
# script. Column lists must match what INSERT OR IGNORE (SELECT *) will
# see, so keep them close to the real default DB schema.
# -----------------------------------------------------------------------

build_db() {
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
  tags_json TEXT NOT NULL,
  privacy_tags_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  observation_type TEXT NOT NULL DEFAULT 'context',
  user_id TEXT NOT NULL DEFAULT 'default',
  team_id TEXT DEFAULT NULL
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

TMPDIR_CUSTOM="$(mktemp -d -t merge-s95-test.XXXXXX)"
trap 'rm -rf "${TMPDIR_CUSTOM}"' EXIT

TARGET="${TMPDIR_CUSTOM}/target.db"
SOURCE="${TMPDIR_CUSTOM}/source.db"

build_db "${TARGET}"
build_db "${SOURCE}"

# Target: 1 session + 1 obs that will be duplicated in source.
sqlite3 "${TARGET}" <<'EOS'
INSERT INTO mem_sessions VALUES('s1','cc','proj','2026-04-01',NULL,NULL,NULL,NULL,'default',NULL,'2026-04-01','2026-04-01','');
INSERT INTO mem_observations VALUES('obs_shared','e1','cc','proj','s1','t1','c1','c1','[]','[]','2026-04-01','2026-04-01','context','default',NULL);
EOS

# Source: 1 shared + 2 new obs, extra session, vector, entity, tag, fact,
# link.
sqlite3 "${SOURCE}" <<'EOS'
INSERT INTO mem_sessions VALUES('s1','cc','proj','2026-04-01',NULL,NULL,NULL,NULL,'default',NULL,'2026-04-01','2026-04-01','');
INSERT INTO mem_sessions VALUES('s2','cc','proj','2026-04-02',NULL,NULL,NULL,NULL,'default',NULL,'2026-04-02','2026-04-02','');
INSERT INTO mem_observations VALUES('obs_shared','e1','cc','proj','s1','t1','c1','c1','[]','[]','2026-04-01','2026-04-01','context','default',NULL);
INSERT INTO mem_observations VALUES('obs_new1','e2','cc','proj','s2','t2','c2','c2','[]','[]','2026-04-02','2026-04-02','context','default',NULL);
INSERT INTO mem_observations VALUES('obs_new2','e3','cc','proj','s2','t3','c3','c3','[]','[]','2026-04-02','2026-04-02','context','default',NULL);
INSERT INTO mem_vectors VALUES('obs_new1','m1',4,'[0,0,0,0]','2026-04-02','2026-04-02');
INSERT INTO mem_entities VALUES(1,'foo','person','2026-04-02');
INSERT INTO mem_observation_entities VALUES('obs_new1',1,'2026-04-02');
INSERT INTO mem_tags VALUES('obs_new1','auto','kind','2026-04-02');
INSERT INTO mem_facts VALUES('f1','obs_new1','proj','s2','k','greet','hi',0.9,NULL,'2026-04-02','2026-04-02',NULL,NULL,NULL);
INSERT INTO mem_links VALUES(1,'obs_new1','obs_new2','follows',1.0,'2026-04-02');
INSERT INTO mem_relations VALUES(1,'foo','bar','mentions',1.0,'obs_new1','2026-04-02');
EOS

# -----------------------------------------------------------------------
# Test 1: dry-run does not modify target
# -----------------------------------------------------------------------
echo "Test 1: dry-run leaves target untouched"

OBS_BEFORE="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_observations;')"
SESS_BEFORE="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_sessions;')"
ENT_BEFORE="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_entities;')"

OUT="$(HOME="${TMPDIR_CUSTOM}" "${MERGE_BIN}" --target "${TARGET}" --source "${SOURCE}" 2>&1)"

OBS_AFTER="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_observations;')"
SESS_AFTER="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_sessions;')"
ENT_AFTER="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_entities;')"

assert_eq "${OBS_AFTER}" "${OBS_BEFORE}" "dry-run: mem_observations count unchanged"
assert_eq "${SESS_AFTER}" "${SESS_BEFORE}" "dry-run: mem_sessions count unchanged"
assert_eq "${ENT_AFTER}" "${ENT_BEFORE}" "dry-run: mem_entities count unchanged"

# -----------------------------------------------------------------------
# Test 2: dry-run reports accurate new/dup counts
# -----------------------------------------------------------------------
echo "Test 2: dry-run output reports the right counts"

assert_contains "${OUT}" "obs: 2 new / 1 dup" "dry-run: obs counts"
assert_contains "${OUT}" "sessions: 1 new / 1 dup" "dry-run: sessions counts"
assert_contains "${OUT}" "vectors for new obs: 1" "dry-run: vector count"
assert_contains "${OUT}" "entities: 1 new" "dry-run: entity count"
assert_contains "${OUT}" "tags: 1 new" "dry-run: tag count"
assert_contains "${OUT}" "AGGREGATE (dry-run): obs_new=2" "dry-run: aggregate total"
assert_contains "${OUT}" "Target was NOT modified" "dry-run: explicit no-write message"

# -----------------------------------------------------------------------
# Test 3: audit log is written as JSONL
# -----------------------------------------------------------------------
echo "Test 3: audit log written"

LOG_FILES=("${TMPDIR_CUSTOM}"/.harness-mem/migrations/merge-*.log)
if [ -f "${LOG_FILES[0]}" ]; then
  LOG_CONTENT="$(cat "${LOG_FILES[0]}")"
  assert_contains "${LOG_CONTENT}" '"kind":"run_start"' "log: has run_start event"
  assert_contains "${LOG_CONTENT}" '"kind":"source_summary"' "log: has source_summary event"
  assert_contains "${LOG_CONTENT}" '"kind":"run_end"' "log: has run_end event"
  assert_contains "${LOG_CONTENT}" '"mode":"dry-run"' "log: records dry-run mode"
else
  echo "  FAIL: audit log file not found"
  FAIL=$((FAIL + 1))
fi

# -----------------------------------------------------------------------
# Test 4: --execute merges correctly and is idempotent
# -----------------------------------------------------------------------
echo "Test 4: --execute merges rows; second run is a no-op"

HOME="${TMPDIR_CUSTOM}" "${MERGE_BIN}" --target "${TARGET}" --source "${SOURCE}" --execute >/dev/null 2>&1

OBS_E1="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_observations;')"
SESS_E1="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_sessions;')"
VEC_E1="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_vectors;')"
TAG_E1="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_tags;')"
ENT_E1="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_entities;')"
OBS_ENT_E1="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_observation_entities;')"
LINK_E1="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_links;')"
REL_E1="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_relations;')"
FACT_E1="$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_facts;')"

assert_eq "${OBS_E1}" "3" "execute: 2 new obs merged (1 dup + 2 new = 3 total)"
assert_eq "${SESS_E1}" "2" "execute: 1 new session merged"
assert_eq "${VEC_E1}" "1" "execute: 1 vector merged for new obs"
assert_eq "${TAG_E1}" "1" "execute: 1 tag merged"
assert_eq "${ENT_E1}" "1" "execute: 1 entity merged"
assert_eq "${OBS_ENT_E1}" "1" "execute: observation_entities remapped and merged"
assert_eq "${LINK_E1}" "1" "execute: 1 link merged"
assert_eq "${REL_E1}" "1" "execute: 1 relation merged"
assert_eq "${FACT_E1}" "1" "execute: 1 fact merged"

# Idempotency — second execute run should not change any counts.
HOME="${TMPDIR_CUSTOM}" "${MERGE_BIN}" --target "${TARGET}" --source "${SOURCE}" --execute >/dev/null 2>&1

assert_eq "$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_observations;')" "${OBS_E1}" "idempotent: mem_observations stable"
assert_eq "$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_sessions;')" "${SESS_E1}" "idempotent: mem_sessions stable"
assert_eq "$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_vectors;')" "${VEC_E1}" "idempotent: mem_vectors stable"
assert_eq "$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_entities;')" "${ENT_E1}" "idempotent: mem_entities stable"
assert_eq "$(sqlite3 "${TARGET}" 'SELECT COUNT(*) FROM mem_links;')" "${LINK_E1}" "idempotent: mem_links stable"

# -----------------------------------------------------------------------
# Test 5: missing source is a soft-skip (not fatal)
# -----------------------------------------------------------------------
echo "Test 5: missing source is handled"

OUT2="$(HOME="${TMPDIR_CUSTOM}" "${MERGE_BIN}" --target "${TARGET}" --source "${TMPDIR_CUSTOM}/nonexistent.db" 2>&1 || true)"
assert_contains "${OUT2}" "skip (not found)" "missing source: soft-skip message"

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
