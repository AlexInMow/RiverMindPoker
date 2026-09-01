#!/bin/bash
set -euo pipefail

LABEL="com.rivermind.poker"
PORT="3001"
USER_ID="$(id -u)"
DOMAIN="gui/${USER_ID}"
TARGET="${DOMAIN}/${LABEL}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE_PATH="${PROJECT_DIR}/launchd/${LABEL}.plist.template"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/RiverMindPoker"
STDOUT_LOG="${LOG_DIR}/server.log"
STDERR_LOG="${LOG_DIR}/server-error.log"
NODE_BIN="${RIVERMIND_NODE_BIN:-$(command -v node || true)}"
NPM_BIN="${RIVERMIND_NPM_BIN:-$(command -v npm || true)}"

is_loaded() {
  launchctl print "${TARGET}" >/dev/null 2>&1
}

require_runtime() {
  if [[ -z "${NODE_BIN}" || "${NODE_BIN}" != /* || ! -x "${NODE_BIN}" ]]; then
    echo "Node.js executable was not found. Set RIVERMIND_NODE_BIN to an absolute path." >&2
    exit 1
  fi
  if [[ -z "${NPM_BIN}" || "${NPM_BIN}" != /* || ! -x "${NPM_BIN}" ]]; then
    echo "npm executable was not found. Set RIVERMIND_NPM_BIN to an absolute path." >&2
    exit 1
  fi
}

render_plist() {
  mkdir -p "${PLIST_DIR}" "${LOG_DIR}"
  cp "${TEMPLATE_PATH}" "${PLIST_PATH}"
  plutil -insert ProgramArguments.0 -string "${NODE_BIN}" "${PLIST_PATH}"
  plutil -insert ProgramArguments.1 -string "${PROJECT_DIR}/dist/server/index.js" "${PLIST_PATH}"
  plutil -replace WorkingDirectory -string "${PROJECT_DIR}" "${PLIST_PATH}"
  plutil -replace EnvironmentVariables.PATH -string "$(dirname "${NODE_BIN}"):/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" "${PLIST_PATH}"
  plutil -replace StandardOutPath -string "${STDOUT_LOG}" "${PLIST_PATH}"
  plutil -replace StandardErrorPath -string "${STDERR_LOG}" "${PLIST_PATH}"
  chmod 644 "${PLIST_PATH}"
  plutil -lint "${PLIST_PATH}" >/dev/null
}

start_service() {
  if is_loaded; then
    launchctl kickstart -k "${TARGET}"
  else
    launchctl bootstrap "${DOMAIN}" "${PLIST_PATH}"
    launchctl enable "${TARGET}"
    launchctl kickstart "${TARGET}"
  fi
}

case "${1:-}" in
  install)
    require_runtime
    "${NPM_BIN}" run build
    if is_loaded; then launchctl bootout "${TARGET}"; fi
    render_plist
    start_service
    echo "RiverMindPoker service installed: ${PLIST_PATH}"
    echo "Application: http://localhost:${PORT}"
    ;;
  start)
    [[ -f "${PLIST_PATH}" ]] || { echo "Service is not installed. Run: npm run service:install" >&2; exit 1; }
    start_service
    ;;
  stop)
    if is_loaded; then launchctl bootout "${TARGET}"; fi
    ;;
  restart)
    [[ -f "${PLIST_PATH}" ]] || { echo "Service is not installed. Run: npm run service:install" >&2; exit 1; }
    start_service
    ;;
  status)
    launchctl print "${TARGET}"
    ;;
  logs)
    mkdir -p "${LOG_DIR}"
    touch "${STDOUT_LOG}" "${STDERR_LOG}"
    tail -n 100 "${STDOUT_LOG}" "${STDERR_LOG}"
    ;;
  uninstall)
    if is_loaded; then launchctl bootout "${TARGET}"; fi
    rm -f "${PLIST_PATH}"
    echo "RiverMindPoker autostart disabled. Logs remain in ${LOG_DIR}."
    ;;
  *)
    echo "Usage: $0 {install|start|stop|restart|status|logs|uninstall}" >&2
    exit 2
    ;;
esac
