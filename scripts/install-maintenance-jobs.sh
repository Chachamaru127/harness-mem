#!/bin/bash
# Install the forget-maintenance launchd jobs for this Mac.
#
# Usage:
#   scripts/install-maintenance-jobs.sh                 # install hourly-archive + weekly-monitor + monthly-vacuum
#   scripts/install-maintenance-jobs.sh --jobs hourly-archive,weekly-monitor
#   scripts/install-maintenance-jobs.sh --print         # render plists, change nothing
#   scripts/install-maintenance-jobs.sh --uninstall
#
# All jobs are report-only except hourly-archive, which starts the existing
# archive loop only when none is running. Hard purge and VACUUM stay manual:
# see docs/forget-maintenance-runbook.md.
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
STATE_DIR="${HARNESS_MEM_HOME:-$HOME/.harness-mem}"
LOG_DIR="${STATE_DIR}/maintenance"
AGENT_DIR="${HOME}/Library/LaunchAgents"
ALL_JOBS=(hourly-archive weekly-monitor monthly-vacuum)
JOBS=("${ALL_JOBS[@]}")
MODE="install"

usage() {
  sed -n '3,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --jobs)
      IFS=',' read -r -a JOBS <<< "${2:?--jobs needs a comma-separated list}"
      shift 2
      ;;
    --print) MODE="print"; shift ;;
    --uninstall) MODE="uninstall"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

BUN_BIN="${HARNESS_MEM_BUN_BIN:-$(command -v bun || true)}"
if [ -z "${BUN_BIN}" ]; then
  echo "bun not found; set HARNESS_MEM_BUN_BIN" >&2
  exit 1
fi

label_for() {
  echo "jp.canai.harness-mem.maintenance-$1"
}

render() {
  local job="$1"
  local template="${REPO_ROOT}/launchd/$(label_for "${job}").plist.template"
  if [ ! -f "${template}" ]; then
    echo "missing template: ${template}" >&2
    exit 1
  fi
  sed -e "s|__BUN__|${BUN_BIN}|g" \
      -e "s|__REPO_ROOT__|${REPO_ROOT}|g" \
      -e "s|__LOG_DIR__|${LOG_DIR}|g" \
      "${template}"
}

if [ "${MODE}" = "uninstall" ]; then
  for job in "${JOBS[@]}"; do
    label="$(label_for "${job}")"
    plist="${AGENT_DIR}/${label}.plist"
    launchctl bootout "gui/$(id -u)/${label}" >/dev/null 2>&1 || true
    if [ -f "${plist}" ]; then
      rm -f "${plist}"
      echo "removed ${plist}"
    else
      echo "not installed: ${label}"
    fi
  done
  exit 0
fi

if [ "${MODE}" = "print" ]; then
  for job in "${JOBS[@]}"; do
    echo "===== ${job} ====="
    render "${job}"
  done
  exit 0
fi

mkdir -p "${LOG_DIR}" "${AGENT_DIR}"
for job in "${JOBS[@]}"; do
  label="$(label_for "${job}")"
  plist="${AGENT_DIR}/${label}.plist"
  render "${job}" > "${plist}"
  launchctl bootout "gui/$(id -u)/${label}" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "${plist}"
  echo "installed ${label} (${plist})"
done
echo "reports: ${LOG_DIR}/reports"
