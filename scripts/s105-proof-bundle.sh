#!/bin/bash
# S105 release-readiness proof bundle.

set -uo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_SOURCE" ]; do
  SCRIPT_SOURCE_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  SCRIPT_TARGET="$(readlink "$SCRIPT_SOURCE")"
  if [[ "$SCRIPT_TARGET" != /* ]]; then
    SCRIPT_SOURCE="${SCRIPT_SOURCE_DIR}/${SCRIPT_TARGET}"
  else
    SCRIPT_SOURCE="$SCRIPT_TARGET"
  fi
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT_DIR="${HARNESS_MEM_S105_PROOF_DIR:-${ROOT}/artifacts/s105-proof-bundle}"
SKIP_RUNTIME=0
ISOLATED_HOME=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out-dir)
      shift
      OUT_DIR="${1:-}"
      ;;
    --skip-runtime)
      SKIP_RUNTIME=1
      ;;
    --isolated-home)
      ISOLATED_HOME=1
      ;;
    *)
      echo "Usage: $0 [--out-dir <dir>] [--skip-runtime] [--isolated-home]" >&2
      exit 2
      ;;
  esac
  shift || true
done

if ! command -v jq >/dev/null 2>&1; then
  echo "[s105-proof-bundle] jq is required but not found" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

PACK_JSON="${OUT_DIR}/npm-pack-dry-run.json"
DOCTOR_JSON="${OUT_DIR}/doctor-codex.json"
MCP_JSON="${OUT_DIR}/mcp-smoke.json"
HEALTH_JSON="${OUT_DIR}/post-health.json"
SUMMARY_JSON="${OUT_DIR}/summary.json"
SETUP_JSON="${OUT_DIR}/setup-codex.json"
SETUP_STDOUT="${OUT_DIR}/setup.stdout"

(cd "$ROOT" && npm pack --dry-run --json > "$PACK_JSON" 2>"${OUT_DIR}/npm-pack.stderr")
PACK_CODE=$?

PROOF_HOME="${HOME}"
PROOF_HMEM_HOME="${HARNESS_MEM_HOME:-${HOME}/.harness-mem}"
SETUP_CODE=0
if [ "$ISOLATED_HOME" -eq 1 ]; then
  PROOF_HOME="${OUT_DIR}/home"
  PROOF_HMEM_HOME="${PROOF_HOME}/.harness-mem"
  mkdir -p "$PROOF_HOME"
  HOME="$PROOF_HOME" \
    HARNESS_MEM_HOME="$PROOF_HMEM_HOME" \
    HARNESS_MEM_NON_INTERACTIVE=1 \
    bash "${ROOT}/scripts/harness-mem" setup --platform codex --skip-start --skip-smoke --skip-quality --skip-version-check --quiet \
    > "$SETUP_STDOUT" 2>"${OUT_DIR}/setup.stderr"
  SETUP_CODE=$?
  if [ -s "$SETUP_STDOUT" ] && jq -e . "$SETUP_STDOUT" >/dev/null 2>&1; then
    jq -c . "$SETUP_STDOUT" > "$SETUP_JSON"
  else
    jq -n \
      --argjson exit_code "$SETUP_CODE" \
      --arg stdout_artifact "$SETUP_STDOUT" \
      '{ok: ($exit_code == 0), exit_code: $exit_code, stdout_artifact: $stdout_artifact}' \
      > "$SETUP_JSON"
  fi
else
  jq -n '{skipped:true, reason:"using caller HOME"}' > "$SETUP_JSON"
fi

HOME="$PROOF_HOME" \
  HARNESS_MEM_HOME="$PROOF_HMEM_HOME" \
  HARNESS_MEM_NON_INTERACTIVE=1 \
  bash "${ROOT}/scripts/harness-mem" doctor --platform codex --json --skip-version-check > "$DOCTOR_JSON" 2>"${OUT_DIR}/doctor.stderr"
DOCTOR_CODE=$?

MCP_CODE=0
if [ -x "${ROOT}/bin/harness-mcp-server" ]; then
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s105-proof-bundle","version":"1"}}}\n' \
    | "${ROOT}/bin/harness-mcp-server" > "$MCP_JSON" 2>"${OUT_DIR}/mcp.stderr"
  MCP_CODE=$?
else
  jq -n '{ok:false, skipped:true, reason:"bin/harness-mcp-server is not executable in this checkout"}' > "$MCP_JSON"
fi

HEALTH_CODE=0
if [ "$SKIP_RUNTIME" -eq 1 ]; then
  jq -n '{ok:false, skipped:true, reason:"--skip-runtime"}' > "$HEALTH_JSON"
else
  curl --silent --show-error --max-time 2 "http://${HARNESS_MEM_HOST:-127.0.0.1}:${HARNESS_MEM_PORT:-37888}/health" > "$HEALTH_JSON" 2>"${OUT_DIR}/health.stderr"
  HEALTH_CODE=$?
fi

jq -n \
  --arg schema_version "s105-proof-bundle.v1" \
  --argjson pack_code "$PACK_CODE" \
  --argjson setup_code "$SETUP_CODE" \
  --argjson doctor_code "$DOCTOR_CODE" \
  --argjson mcp_code "$MCP_CODE" \
  --argjson health_code "$HEALTH_CODE" \
  --slurpfile pack "$PACK_JSON" \
  --slurpfile setup "$SETUP_JSON" \
  --slurpfile doctor "$DOCTOR_JSON" \
  --slurpfile mcp "$MCP_JSON" \
  --slurpfile health "$HEALTH_JSON" \
  '
  def paths_from_pack:
    (($pack[0][0].files // []) | map(.path));
  def has_path($p): (paths_from_pack | index($p)) != null;
  {
    schema_version: $schema_version,
    generated_at: now | todate,
    release_ready: (
      $pack_code == 0
      and $setup_code == 0
      and $doctor_code == 0
      and ($doctor[0].all_green == true)
      and $mcp_code == 0
      and ($health_code == 0 or ($health[0].skipped // false))
      and ((($mcp[0].result.serverInfo // $mcp[0].serverInfo // null) != null) or ($mcp[0].skipped // false))
      and has_path("bin/harness-mcp-server")
      and has_path("scripts/harness-mem")
      and has_path("codex/skills/harness-mem/SKILL.md")
      and has_path("codex/skills/harness-recall/SKILL.md")
    ),
    package_inclusion: {
      npm_pack_dry_run: ($pack_code == 0),
      bin_harness_mcp_server: has_path("bin/harness-mcp-server"),
      scripts_harness_mem: has_path("scripts/harness-mem"),
      codex_skill_harness_mem: has_path("codex/skills/harness-mem/SKILL.md"),
      codex_skill_harness_recall: has_path("codex/skills/harness-recall/SKILL.md")
    },
    setup: {
      isolated_home: ('"$ISOLATED_HOME"' == 1),
      exit_code: $setup_code,
      artifact: "'"$SETUP_JSON"'"
    },
    doctor: {
      exit_code: $doctor_code,
      schema_version: ($doctor[0].schema_version // null),
      status: ($doctor[0].status // null),
      overall_status: ($doctor[0].overall_status // null),
      all_green: ($doctor[0].all_green // false),
      codex_skill_drift: (($doctor[0].checks // []) | map(select(.name == "codex_skill_drift")) | .[0] // null),
      post_health_check: (($doctor[0].checks // []) | map(select(.name == "codex_post_doctor_liveness")) | .[0] // null)
    },
    mcp_smoke: {
      exit_code: $mcp_code,
      server_info_seen: ((($mcp[0].result.serverInfo // $mcp[0].serverInfo // null) != null)),
      skipped: ($mcp[0].skipped // false)
    },
    runtime: {
      post_health_exit_code: $health_code,
      post_health_check: $health[0]
    },
    artifacts: {
      npm_pack: "'"$PACK_JSON"'",
      setup: "'"$SETUP_JSON"'",
      setup_stdout: "'"$SETUP_STDOUT"'",
      doctor: "'"$DOCTOR_JSON"'",
      mcp_smoke: "'"$MCP_JSON"'",
      post_health: "'"$HEALTH_JSON"'"
    },
    s108_release_surface: {
      retrieval_ablation: "docs/benchmarks/artifacts/s108-retrieval-ablation-2026-05-07/",
      competitive_audit: "docs/benchmarks/competitive-audit-2026-05-07.md",
      temporal_graph_design: "docs/benchmarks/temporal-graph-selective-import-2026-05-07.md",
      readme_claim_ceiling_test: "tests/readme-claim-ceiling.test.ts",
      developer_domain_thresholds: "docs/benchmarks/developer-domain-thresholds.json"
    }
  }' > "$SUMMARY_JSON"

cat "$SUMMARY_JSON"
