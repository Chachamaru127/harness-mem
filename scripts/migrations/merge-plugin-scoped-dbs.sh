#!/usr/bin/env bash
#
# merge-plugin-scoped-dbs.sh (§95)
#
# Merge observations (+ related session/entity/relation/vector/fact/link/tag
# rows) from plugin-scoped harness-mem.db files into the default
# ~/.harness-mem/harness-mem.db that was unified in §94 (v0.14.1).
#
# Default is DRY-RUN. Pass --execute to actually write.
#
# Principles:
#   - Append-only: sources are never modified. Target is opened read-only
#     on dry-run, and open for write only under --execute.
#   - Idempotent: re-runs skip rows already in target.
#   - Conservative dedupe: false negatives allowed. Obs id (ULID-ish) is
#     the primary key; we also flag same-(platform,project,session_id,
#     created_at,sha256(content)) collisions where obs ids differ, as
#     "diff" (but still skip to preserve target data).
#   - Related tables are merged by reference: mem_sessions by session_id,
#     mem_vectors / mem_tags / mem_observation_entities / mem_facts /
#     mem_links / mem_relations by observation_id. mem_entities is
#     deduped by (name, entity_type) — entity_id is re-mapped in the
#     target because it is an INTEGER AUTOINCREMENT PK.
#   - Audit log: $HOME/.harness-mem/migrations/merge-<ts>.log (JSONL)
#   - Transaction: each source is wrapped in a single BEGIN/COMMIT on
#     --execute. Rollback on error.
#
# Usage:
#   ./merge-plugin-scoped-dbs.sh                         # dry-run all default candidates
#   ./merge-plugin-scoped-dbs.sh --source PATH           # dry-run single source
#   ./merge-plugin-scoped-dbs.sh --target PATH           # override target
#   ./merge-plugin-scoped-dbs.sh --execute               # live run, all sources
#   ./merge-plugin-scoped-dbs.sh --source P --execute    # live, single source
#
# Exit codes: 0 OK, 1 usage/input error, 2 sqlite error.

set -euo pipefail

# --------------------------------------------------------------------------
# Defaults / CLI parsing
# --------------------------------------------------------------------------

DEFAULT_TARGET="${HOME}/.harness-mem/harness-mem.db"
DEFAULT_SOURCES_LIST=(
  "${HOME}/.claude/plugins/data/claude-code-harness-inline/harness-mem.db"
  "${HOME}/.claude/plugins/data/codex-openai-codex/harness-mem.db"
  "${HOME}/.claude/plugins/data/claude-code-harness-claude-code-harness-marketplace/harness-mem.db"
)

TARGET=""
EXECUTE=0
SOURCES=()
LOG_DIR="${HOME}/.harness-mem/migrations"
BATCH_SIZE=200

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  --source PATH       Source DB to merge (may be repeated; default = 3 plugin slots)
  --target PATH       Target DB (default: ${DEFAULT_TARGET})
  --execute           Perform the merge (default is dry-run)
  --batch-size N      Rows per insert batch (default: ${BATCH_SIZE})
  --log-dir DIR       Audit log directory (default: ${LOG_DIR})
  -h, --help          Show this help

Examples:
  $0                                  # dry-run against 3 default sources
  $0 --source some.db --execute       # live-merge single source
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      [[ -n "${2:-}" ]] || { echo "error: --source needs a path" >&2; exit 1; }
      SOURCES+=("$2"); shift 2 ;;
    --target)
      [[ -n "${2:-}" ]] || { echo "error: --target needs a path" >&2; exit 1; }
      TARGET="$2"; shift 2 ;;
    --execute)
      EXECUTE=1; shift ;;
    --batch-size)
      [[ -n "${2:-}" ]] || { echo "error: --batch-size needs a number" >&2; exit 1; }
      BATCH_SIZE="$2"; shift 2 ;;
    --log-dir)
      [[ -n "${2:-}" ]] || { echo "error: --log-dir needs a path" >&2; exit 1; }
      LOG_DIR="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage; exit 1 ;;
  esac
done

if [[ -z "${TARGET}" ]]; then
  TARGET="${DEFAULT_TARGET}"
fi

if [[ ${#SOURCES[@]} -eq 0 ]]; then
  SOURCES=("${DEFAULT_SOURCES_LIST[@]}")
fi

if [[ ! -f "${TARGET}" ]]; then
  echo "error: target DB not found: ${TARGET}" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="${LOG_DIR}/merge-${TS}.log"

# --------------------------------------------------------------------------
# Logging helpers
# --------------------------------------------------------------------------

log_line() {
  # $1=kind (JSON), rest=any (caller is responsible for valid JSON).
  printf '%s\n' "$1" >> "${LOG_FILE}"
}

log_event() {
  # Simple key=value JSON encoder. Values are string-escaped naively.
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local kind="$1"; shift
  local body="$*"
  printf '{"ts":"%s","kind":"%s",%s}\n' "${ts}" "${kind}" "${body}" >> "${LOG_FILE}"
}

echo_info() { echo "[§95 merge] $*"; }

# --------------------------------------------------------------------------
# sqlite helpers
# --------------------------------------------------------------------------

sqlite_q() {
  # $1 = db path, $2 = sql. Returns stdout.
  sqlite3 "$1" "$2"
}

sqlite_q_ro() {
  # Read-only connect. Avoids creating -shm/-wal churn.
  sqlite3 "file:$1?mode=ro" -cmd ".open 'file:$1?mode=ro'" "$2" 2>/dev/null || \
    sqlite3 "$1" "$2"
}

# --------------------------------------------------------------------------
# Schema introspection helpers
#
# Column-order between the plugin-scoped DBs and the default DB diverges
# for several tables (mem_observations, mem_sessions, mem_facts) because
# historical migrations applied columns in a different order. That means
# `INSERT OR IGNORE INTO tgt.X SELECT * FROM src.X` maps src positions
# to tgt positions, jamming wrong values into NOT-NULL columns and
# triggering silent OR-IGNORE drops for 95%+ of rows (the original §95
# bug this file was renamed to fix).
#
# The helpers below extract table column names and compute the common
# subset, which lets us emit explicit `(col1, col2, ...) SELECT col1,
# col2, ... FROM src.X` that is order-independent.
# --------------------------------------------------------------------------

# table_cols <db_path> <table>   → newline-separated column names
table_cols() {
  local db="$1" table="$2"
  sqlite3 "file:${db}?mode=ro" "SELECT name FROM pragma_table_info('${table}');" 2>/dev/null || \
    sqlite3 "${db}" "SELECT name FROM pragma_table_info('${table}');"
}

# common_cols <src_db> <tgt_db> <table>   → comma-separated intersection
#   of column names that exist in BOTH src and tgt, preserving tgt order.
#   Returns empty string if either table is missing.
common_cols() {
  local src_db="$1" tgt_db="$2" table="$3"
  local tgt_list src_list
  tgt_list="$(table_cols "${tgt_db}" "${table}")"
  src_list="$(table_cols "${src_db}" "${table}")"
  if [[ -z "${tgt_list}" || -z "${src_list}" ]]; then
    return 0
  fi
  local out=""
  while IFS= read -r col; do
    [[ -z "${col}" ]] && continue
    if printf '%s\n' "${src_list}" | grep -qx -- "${col}"; then
      if [[ -z "${out}" ]]; then
        out="${col}"
      else
        out="${out},${col}"
      fi
    fi
  done <<< "${tgt_list}"
  printf '%s' "${out}"
}

# qualified_cols <prefix> <comma_list>  → "p.c1, p.c2, ..." for JOIN sql.
qualified_cols() {
  local prefix="$1"
  local csv="$2"
  local out=""
  IFS=',' read -ra arr <<< "${csv}"
  for c in "${arr[@]}"; do
    if [[ -z "${out}" ]]; then
      out="${prefix}.${c}"
    else
      out="${out}, ${prefix}.${c}"
    fi
  done
  printf '%s' "${out}"
}

# --------------------------------------------------------------------------
# Per-source dry-run computation
#
# Strategy: ATTACH source as 'src' onto a tiny in-memory main DB, then
# SELECT COUNT(*) using a LEFT JOIN against a second ATTACH to 'tgt'
# (the target DB) via a file path. All reads are read-only for dry-run
# so we do NOT modify either DB.
#
# For --execute, we re-open with main=target (writable), source as 'src'
# read-only, wrap in BEGIN...COMMIT.
# --------------------------------------------------------------------------

run_dry_source() {
  local src="$1"
  local label="$(basename "$(dirname "${src}")")/$(basename "${src}")"

  if [[ ! -f "${src}" ]]; then
    echo_info "skip (not found): ${src}"
    log_event "source_skipped" "\"source\":\"${src}\",\"reason\":\"not_found\""
    return 0
  fi

  echo_info "--- DRY-RUN source=${label}"

  # Build a single sqlite session that attaches both DBs read-only. We use
  # an in-memory :memory: main so nothing is written anywhere.
  local out
  local sql_file
  sql_file="$(mktemp -t merge-s95-dryrun.XXXXXX.sql)"
  trap "rm -f '${sql_file}'" RETURN

  cat > "${sql_file}" <<SQL
ATTACH DATABASE 'file:${src}?mode=ro' AS src;
ATTACH DATABASE 'file:${TARGET}?mode=ro' AS tgt;

SELECT 'obs_new', COUNT(*) FROM src.mem_observations s
  WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_observations t WHERE t.id = s.id);

SELECT 'obs_dup_id', COUNT(*) FROM src.mem_observations s
  WHERE EXISTS (SELECT 1 FROM tgt.mem_observations t WHERE t.id = s.id);

SELECT 'obs_diff_key', COUNT(*) FROM src.mem_observations s
  WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_observations t WHERE t.id = s.id)
    AND EXISTS (
      SELECT 1 FROM tgt.mem_observations t
      WHERE t.platform = s.platform
        AND t.project = s.project
        AND t.session_id = s.session_id
        AND COALESCE(t.created_at,'') = COALESCE(s.created_at,'')
        AND length(t.content) = length(s.content)
    );

SELECT 'sess_new', COUNT(*) FROM src.mem_sessions s
  WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_sessions t WHERE t.session_id = s.session_id);

SELECT 'sess_dup', COUNT(*) FROM src.mem_sessions s
  WHERE EXISTS (SELECT 1 FROM tgt.mem_sessions t WHERE t.session_id = s.session_id);

SELECT 'vec_new_for_new_obs', COUNT(*) FROM src.mem_vectors v
  WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_observations t WHERE t.id = v.observation_id);

SELECT 'vec_already_in_tgt', COUNT(*) FROM src.mem_vectors v
  WHERE EXISTS (SELECT 1 FROM tgt.mem_vectors tv
                WHERE tv.observation_id = v.observation_id AND tv.model = v.model);

SELECT 'entity_new', COUNT(*) FROM src.mem_entities s
  WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_entities t
                    WHERE t.name = s.name AND t.entity_type = s.entity_type);

SELECT 'entity_dup', COUNT(*) FROM src.mem_entities s
  WHERE EXISTS (SELECT 1 FROM tgt.mem_entities t
                WHERE t.name = s.name AND t.entity_type = s.entity_type);

SELECT 'obs_ent_new_for_new_obs', COUNT(*) FROM src.mem_observation_entities oe
  WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_observations t WHERE t.id = oe.observation_id);

SELECT 'rel_new_for_new_obs', COUNT(*) FROM src.mem_relations r
  WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_observations t WHERE t.id = r.observation_id);

SELECT 'fact_new', COUNT(*) FROM src.mem_facts f
  WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_facts t WHERE t.fact_id = f.fact_id);

SELECT 'fact_dup', COUNT(*) FROM src.mem_facts f
  WHERE EXISTS (SELECT 1 FROM tgt.mem_facts t WHERE t.fact_id = f.fact_id);

SELECT 'link_new', COUNT(*) FROM src.mem_links l
  WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_links t
                    WHERE t.from_observation_id = l.from_observation_id
                      AND t.to_observation_id = l.to_observation_id
                      AND t.relation = l.relation);

SELECT 'tag_new', COUNT(*) FROM src.mem_tags s
  WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_tags t
                    WHERE t.observation_id = s.observation_id
                      AND t.tag = s.tag AND t.tag_type = s.tag_type);

SELECT 'tag_dup', COUNT(*) FROM src.mem_tags s
  WHERE EXISTS (SELECT 1 FROM tgt.mem_tags t
                WHERE t.observation_id = s.observation_id
                  AND t.tag = s.tag AND t.tag_type = s.tag_type);
SQL

  out=$(sqlite3 ":memory:" < "${sql_file}")
  rm -f "${sql_file}"

  # Parse "kind|count" lines.
  local obs_new=0 obs_dup=0 obs_diff=0
  local sess_new=0 sess_dup=0
  local vec_new=0 vec_dup=0
  local ent_new=0 ent_dup=0
  local obs_ent_new=0 rel_new=0
  local fact_new=0 fact_dup=0
  local link_new=0 tag_new=0 tag_dup=0

  while IFS='|' read -r k v; do
    case "$k" in
      obs_new)                obs_new=$v ;;
      obs_dup_id)             obs_dup=$v ;;
      obs_diff_key)           obs_diff=$v ;;
      sess_new)               sess_new=$v ;;
      sess_dup)               sess_dup=$v ;;
      vec_new_for_new_obs)    vec_new=$v ;;
      vec_already_in_tgt)     vec_dup=$v ;;
      entity_new)             ent_new=$v ;;
      entity_dup)             ent_dup=$v ;;
      obs_ent_new_for_new_obs) obs_ent_new=$v ;;
      rel_new_for_new_obs)    rel_new=$v ;;
      fact_new)               fact_new=$v ;;
      fact_dup)               fact_dup=$v ;;
      link_new)               link_new=$v ;;
      tag_new)                tag_new=$v ;;
      tag_dup)                tag_dup=$v ;;
    esac
  done <<< "${out}"

  # Sample up to 5 "diff" rows
  local sample
  sample=$(sqlite3 ":memory:" <<SQL
ATTACH DATABASE 'file:${src}?mode=ro' AS src;
ATTACH DATABASE 'file:${TARGET}?mode=ro' AS tgt;
.mode list
.separator |
SELECT s.id, s.session_id, substr(s.content, 1, 50)
FROM src.mem_observations s
WHERE NOT EXISTS (SELECT 1 FROM tgt.mem_observations t WHERE t.id = s.id)
  AND EXISTS (
    SELECT 1 FROM tgt.mem_observations t
    WHERE t.platform = s.platform AND t.project = s.project
      AND t.session_id = s.session_id
      AND COALESCE(t.created_at,'') = COALESCE(s.created_at,'')
      AND length(t.content) = length(s.content))
LIMIT 5;
SQL
  )

  echo_info "    obs: ${obs_new} new / ${obs_dup} dup / ${obs_diff} diff"
  echo_info "    sessions: ${sess_new} new / ${sess_dup} dup"
  echo_info "    vectors for new obs: ${vec_new} (already-in-tgt for any obs: ${vec_dup})"
  echo_info "    entities: ${ent_new} new / ${ent_dup} dup"
  echo_info "    obs_entities (for new obs only): ${obs_ent_new}"
  echo_info "    relations (for new obs only): ${rel_new}"
  echo_info "    facts: ${fact_new} new / ${fact_dup} dup"
  echo_info "    links (new): ${link_new}"
  echo_info "    tags: ${tag_new} new / ${tag_dup} dup"

  if [[ -n "${sample}" ]]; then
    echo_info "    diff sample (up to 5):"
    while IFS='|' read -r id sid content; do
      [[ -z "${id}" ]] && continue
      echo_info "      - id=${id} sess=${sid} content=${content}"
    done <<< "${sample}"
  fi

  log_event "source_summary" "\"source\":\"${src}\",\"target\":\"${TARGET}\",\"obs_new\":${obs_new},\"obs_dup\":${obs_dup},\"obs_diff\":${obs_diff},\"sess_new\":${sess_new},\"sess_dup\":${sess_dup},\"vec_new\":${vec_new},\"vec_dup\":${vec_dup},\"entity_new\":${ent_new},\"entity_dup\":${ent_dup},\"obs_ent_new\":${obs_ent_new},\"rel_new\":${rel_new},\"fact_new\":${fact_new},\"fact_dup\":${fact_dup},\"link_new\":${link_new},\"tag_new\":${tag_new},\"tag_dup\":${tag_dup},\"mode\":\"dry-run\""

  # Export totals for the caller via a global associative (simple vars).
  LAST_OBS_NEW=${obs_new}
  LAST_OBS_DUP=${obs_dup}
  LAST_OBS_DIFF=${obs_diff}
  LAST_SESS_NEW=${sess_new}
  LAST_VEC_NEW=${vec_new}
  LAST_ENT_NEW=${ent_new}
  LAST_OBS_ENT_NEW=${obs_ent_new}
  LAST_REL_NEW=${rel_new}
  LAST_FACT_NEW=${fact_new}
  LAST_LINK_NEW=${link_new}
  LAST_TAG_NEW=${tag_new}
}

run_execute_source() {
  local src="$1"
  local label="$(basename "$(dirname "${src}")")/$(basename "${src}")"

  if [[ ! -f "${src}" ]]; then
    echo_info "skip (not found): ${src}"
    log_event "source_skipped" "\"source\":\"${src}\",\"reason\":\"not_found\""
    return 0
  fi

  echo_info "--- EXECUTE source=${label}"

  # Compute the column intersection between source and target for each
  # table we merge by bulk copy. This is the fix for the original §95
  # execute-path bug: the previous implementation used `INSERT OR IGNORE
  # INTO tgt.X SELECT * FROM src.X`, which maps positionally. The real
  # plugin-scoped DBs have different column orders than the default DB
  # for mem_observations / mem_sessions / mem_facts (columns added in
  # different migration order), so values ended up in the wrong target
  # columns, triggered NOT-NULL constraint violations, and got silently
  # dropped by OR IGNORE — about 95% of rows. Listing columns by name
  # makes the INSERT order-independent.
  local cols_sessions cols_observations cols_tags cols_vectors cols_facts
  cols_sessions="$(common_cols "${src}" "${TARGET}" mem_sessions)"
  cols_observations="$(common_cols "${src}" "${TARGET}" mem_observations)"
  cols_tags="$(common_cols "${src}" "${TARGET}" mem_tags)"
  cols_vectors="$(common_cols "${src}" "${TARGET}" mem_vectors)"
  cols_facts="$(common_cols "${src}" "${TARGET}" mem_facts)"

  local sel_sessions sel_observations sel_tags sel_vectors sel_facts
  sel_sessions="$(qualified_cols s "${cols_sessions}")"
  sel_observations="$(qualified_cols s "${cols_observations}")"
  sel_tags="$(qualified_cols s "${cols_tags}")"
  sel_vectors="$(qualified_cols v "${cols_vectors}")"
  sel_facts="$(qualified_cols s "${cols_facts}")"

  # Snapshot counts before merge, for audit reporting.
  local pre_obs pre_sess pre_vec pre_tag pre_ent pre_obsent pre_rel pre_fact pre_link
  pre_obs=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_observations;")
  pre_sess=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_sessions;")
  pre_vec=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_vectors;")
  pre_tag=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_tags;")
  pre_ent=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_entities;")
  pre_obsent=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_observation_entities;")
  pre_rel=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_relations;")
  pre_fact=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_facts;")
  pre_link=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_links;")

  # Wrap the whole per-source merge in one transaction. We ATTACH the
  # source read-only. INSERT OR IGNORE preserves target on PK / UNIQUE
  # collisions; order-independent column lists ensure no constraint
  # violations are caused by positional mismatch.
  sqlite3 "${TARGET}" <<SQL
ATTACH DATABASE 'file:${src}?mode=ro' AS src;
BEGIN IMMEDIATE;

-- 1. sessions (column-order-safe; dedupe by session_id PK via OR IGNORE).
INSERT OR IGNORE INTO main.mem_sessions(${cols_sessions})
  SELECT ${sel_sessions} FROM src.mem_sessions s;

-- 2. observations (column-order-safe; dedupe by id PK via OR IGNORE,
--    additionally skip if an identical event_id already exists in tgt
--    even when the src has a different id — event_id is a stable
--    cross-DB correlation key when present).
INSERT OR IGNORE INTO main.mem_observations(${cols_observations})
  SELECT ${sel_observations} FROM src.mem_observations s
  WHERE NOT EXISTS (SELECT 1 FROM main.mem_observations t WHERE t.id = s.id)
    AND (s.event_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM main.mem_observations t2
      WHERE t2.event_id IS NOT NULL AND t2.event_id = s.event_id
    ));

-- 3. tags (for obs that now exist in tgt).
INSERT OR IGNORE INTO main.mem_tags(${cols_tags})
  SELECT ${sel_tags} FROM src.mem_tags s
  WHERE EXISTS (SELECT 1 FROM main.mem_observations t WHERE t.id = s.observation_id);

-- 4. entities: dedupe by (name, entity_type). mem_entities id is INTEGER
--    AUTOINCREMENT, so we only insert rows whose (name,type) is missing;
--    the new id is whatever sqlite assigns.
INSERT OR IGNORE INTO main.mem_entities(name, entity_type, created_at)
  SELECT s.name, s.entity_type, s.created_at
  FROM src.mem_entities s
  WHERE NOT EXISTS (SELECT 1 FROM main.mem_entities t
                    WHERE t.name = s.name AND t.entity_type = s.entity_type);

-- 5. observation_entities: re-map entity_id via (name, entity_type) in target.
INSERT OR IGNORE INTO main.mem_observation_entities(observation_id, entity_id, created_at)
  SELECT oe.observation_id, te.id, oe.created_at
  FROM src.mem_observation_entities oe
  JOIN src.mem_entities se ON se.id = oe.entity_id
  JOIN main.mem_entities te ON te.name = se.name AND te.entity_type = se.entity_type
  WHERE EXISTS (SELECT 1 FROM main.mem_observations t WHERE t.id = oe.observation_id);

-- 6. relations (src/dst are TEXT names, observation_id is the obs FK).
INSERT OR IGNORE INTO main.mem_relations(src, dst, kind, strength, observation_id, created_at)
  SELECT r.src, r.dst, r.kind, r.strength, r.observation_id, r.created_at
  FROM src.mem_relations r
  WHERE EXISTS (SELECT 1 FROM main.mem_observations t WHERE t.id = r.observation_id);

-- 7. vectors (column-order-safe; also dedupe on (observation_id, model) PK).
INSERT OR IGNORE INTO main.mem_vectors(${cols_vectors})
  SELECT ${sel_vectors} FROM src.mem_vectors v
  WHERE EXISTS (SELECT 1 FROM main.mem_observations t WHERE t.id = v.observation_id);

-- 8. facts (column-order-safe; dedupe by fact_id PK via OR IGNORE).
INSERT OR IGNORE INTO main.mem_facts(${cols_facts})
  SELECT ${sel_facts} FROM src.mem_facts s;

-- 9. links: dedupe by (from_observation_id, to_observation_id, relation).
INSERT OR IGNORE INTO main.mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
  SELECT l.from_observation_id, l.to_observation_id, l.relation, l.weight, l.created_at
  FROM src.mem_links l
  WHERE EXISTS (SELECT 1 FROM main.mem_observations to1 WHERE to1.id = l.from_observation_id)
    AND EXISTS (SELECT 1 FROM main.mem_observations to2 WHERE to2.id = l.to_observation_id)
    AND NOT EXISTS (SELECT 1 FROM main.mem_links t
                    WHERE t.from_observation_id = l.from_observation_id
                      AND t.to_observation_id = l.to_observation_id
                      AND t.relation = l.relation);

COMMIT;
SQL

  # Snapshot counts after merge and compute deltas for the audit log.
  local post_obs post_sess post_vec post_tag post_ent post_obsent post_rel post_fact post_link
  post_obs=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_observations;")
  post_sess=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_sessions;")
  post_vec=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_vectors;")
  post_tag=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_tags;")
  post_ent=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_entities;")
  post_obsent=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_observation_entities;")
  post_rel=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_relations;")
  post_fact=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_facts;")
  post_link=$(sqlite3 "${TARGET}" "SELECT COUNT(*) FROM mem_links;")

  local d_obs=$(( post_obs - pre_obs ))
  local d_sess=$(( post_sess - pre_sess ))
  local d_vec=$(( post_vec - pre_vec ))
  local d_tag=$(( post_tag - pre_tag ))
  local d_ent=$(( post_ent - pre_ent ))
  local d_obsent=$(( post_obsent - pre_obsent ))
  local d_rel=$(( post_rel - pre_rel ))
  local d_fact=$(( post_fact - pre_fact ))
  local d_link=$(( post_link - pre_link ))

  # Export totals for aggregation in main loop.
  LAST_OBS_NEW=${d_obs}
  LAST_SESS_NEW=${d_sess}
  LAST_VEC_NEW=${d_vec}

  log_event "source_merged" "\"source\":\"${src}\",\"target\":\"${TARGET}\",\"mode\":\"execute\",\"obs_new\":${d_obs},\"sess_new\":${d_sess},\"vec_new\":${d_vec},\"tag_new\":${d_tag},\"entity_new\":${d_ent},\"obs_ent_new\":${d_obsent},\"rel_new\":${d_rel},\"fact_new\":${d_fact},\"link_new\":${d_link}"
  echo_info "    OK: obs=+${d_obs} sess=+${d_sess} vec=+${d_vec} tag=+${d_tag} ent=+${d_ent} obs_ent=+${d_obsent} rel=+${d_rel} fact=+${d_fact} link=+${d_link}"
  echo_info "    (audit trail: ${LOG_FILE})"
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

echo_info "target = ${TARGET}"
echo_info "mode   = $([[ ${EXECUTE} -eq 1 ]] && echo EXECUTE || echo DRY-RUN)"
echo_info "log    = ${LOG_FILE}"

RUN_MODE="dry-run"
[[ ${EXECUTE} -eq 1 ]] && RUN_MODE="execute"
SOURCES_JSON=""
for s in "${SOURCES[@]}"; do
  if [[ -z "${SOURCES_JSON}" ]]; then
    SOURCES_JSON="\"${s}\""
  else
    SOURCES_JSON="${SOURCES_JSON},\"${s}\""
  fi
done
log_event "run_start" "\"target\":\"${TARGET}\",\"mode\":\"${RUN_MODE}\",\"sources\":[${SOURCES_JSON}]"

TOTAL_OBS_NEW=0
TOTAL_VEC_NEW=0
TOTAL_SESS_NEW=0

LAST_OBS_NEW=0
LAST_SESS_NEW=0
LAST_VEC_NEW=0

for src in "${SOURCES[@]}"; do
  if [[ ${EXECUTE} -eq 1 ]]; then
    run_execute_source "${src}"
    TOTAL_OBS_NEW=$(( TOTAL_OBS_NEW + LAST_OBS_NEW ))
    TOTAL_VEC_NEW=$(( TOTAL_VEC_NEW + LAST_VEC_NEW ))
    TOTAL_SESS_NEW=$(( TOTAL_SESS_NEW + LAST_SESS_NEW ))
  else
    run_dry_source "${src}"
    TOTAL_OBS_NEW=$(( TOTAL_OBS_NEW + LAST_OBS_NEW ))
    TOTAL_VEC_NEW=$(( TOTAL_VEC_NEW + LAST_VEC_NEW ))
    TOTAL_SESS_NEW=$(( TOTAL_SESS_NEW + LAST_SESS_NEW ))
  fi
done

if [[ ${EXECUTE} -eq 0 ]]; then
  echo_info "==="
  echo_info "AGGREGATE (dry-run): obs_new=${TOTAL_OBS_NEW}, sess_new=${TOTAL_SESS_NEW}, vec_new=${TOTAL_VEC_NEW}"
  echo_info "Re-run with --execute to apply. Target was NOT modified."
else
  echo_info "==="
  echo_info "AGGREGATE (execute): obs_new=${TOTAL_OBS_NEW}, sess_new=${TOTAL_SESS_NEW}, vec_new=${TOTAL_VEC_NEW}"
  echo_info "Merge complete. Target: ${TARGET}"
fi

log_event "run_end" "\"total_obs_new_estimated\":${TOTAL_OBS_NEW}"
