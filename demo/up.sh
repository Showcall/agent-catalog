#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo"
NAMESPACE="agent-catalog-demo"
# Local port for the mock ledger; 4400 avoids colliding with a real LiteLLM on 4000.
LITELLM_PORT="${DEMO_LITELLM_PORT:-4400}"
# Runtime packs to install, in order. Default: kagent. Multi-runtime: "kagent ark".
# Empty ("") skips controllers entirely (runtimes then need annotated sample CRs).
RUNTIMES="${DEMO_RUNTIMES:-kagent}"
PID_FILE="$DEMO_DIR/.mock-litellm-port-forward.pid"
LOG_FILE="$DEMO_DIR/.mock-litellm-port-forward.log"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}
need kubectl
need curl

mock_ledger_ready() {
  curl -fsS -H "Authorization: Bearer demo-token" \
    "http://localhost:${LITELLM_PORT}/user/daily/activity" >/dev/null 2>&1
}

wait_for_mock_ledger() {
  echo "Waiting for mock LiteLLM ledger on http://localhost:${LITELLM_PORT} ..."
  for _ in {1..20}; do
    mock_ledger_ready && return 0
    if [[ -f "$PID_FILE" ]] && ! kill -0 "$(cat "$PID_FILE")" >/dev/null 2>&1; then
      echo "Mock LiteLLM port-forward exited before it became ready." >&2
      [[ -f "$LOG_FILE" ]] && tail -20 "$LOG_FILE" >&2
      rm -f "$PID_FILE"; exit 1
    fi
    sleep 1
  done
  echo "Timed out waiting for mock LiteLLM ledger on port ${LITELLM_PORT}." >&2
  [[ -f "$LOG_FILE" ]] && tail -20 "$LOG_FILE" >&2
  exit 1
}

echo "Applying demo workloads to the current Kubernetes context:"
kubectl config current-context
kubectl apply -f "$DEMO_DIR/manifests/demo.yaml"
kubectl -n "$NAMESPACE" rollout restart deploy/mock-litellm

echo "Waiting for demo deployments..."
kubectl -n "$NAMESPACE" rollout status deploy/release-notes-agent --timeout=120s
kubectl -n "$NAMESPACE" rollout status deploy/sentiment-batch --timeout=120s
kubectl -n "$NAMESPACE" rollout status deploy/mock-litellm --timeout=120s

# --- Runtime packs (see demo/runtimes/<name>/) ---
for rt in $RUNTIMES; do
  pack="$DEMO_DIR/runtimes/$rt/install.sh"
  if [[ ! -f "$pack" ]]; then
    echo "Unknown runtime '$rt' (no demo/runtimes/$rt/install.sh)." >&2
    echo "Available: $(cd "$DEMO_DIR/runtimes" 2>/dev/null && ls -d */ | tr -d /)" >&2
    exit 1
  fi
  echo
  echo "=== runtime pack: $rt ==="
  DEMO_DIR="$DEMO_DIR" DEMO_NAMESPACE="$NAMESPACE" bash "$pack"
done
[[ -z "${RUNTIMES// }" ]] && echo "No runtime packs selected (DEMO_RUNTIMES is empty)."

# --- Mock ledger port-forward for the host Backstage ---
if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE")"
  if kill -0 "$old_pid" >/dev/null 2>&1 && mock_ledger_ready; then
    echo "Mock LiteLLM port-forward already running with pid $old_pid"
  else
    kill "$old_pid" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"
  fi
fi
if [[ ! -f "$PID_FILE" ]]; then
  echo "Starting mock LiteLLM port-forward on http://localhost:${LITELLM_PORT} ..."
  nohup kubectl -n "$NAMESPACE" port-forward svc/mock-litellm "${LITELLM_PORT}:4000" \
    >"$LOG_FILE" 2>&1 &
  forward_pid="$!"
  echo "$forward_pid" >"$PID_FILE"
  disown "$forward_pid" >/dev/null 2>&1 || true
fi
wait_for_mock_ledger

runtime_lines=""
for rt in $RUNTIMES; do
  case "$rt" in
    kagent) runtime_lines+="  - support-triage / docs-assistant: kagent agents (live A2A cards, production)"$'\n' ;;
    ark)    runtime_lines+="  - researcher / writer / content-team: ARK agents + team (production)"$'\n' ;;
    *)      runtime_lines+="  - $rt runtime entities"$'\n' ;;
  esac
done

cat <<EOF

Demo cluster is ready.

Runtimes installed: ${RUNTIMES:-none}
Mock ledger:        http://localhost:${LITELLM_PORT}

Expected findings after the catalog refreshes:
  - release-notes-agent: labeled A2A agent with a live card and usage
  - sentiment-batch: heuristic llm-workload with usage
${runtime_lines}  - litellm gateway Resource: team rollups plus one unattributed consumer

Next step:
  ./demo/backstage.sh

That starts the disposable Backstage app at:
  http://localhost:3001/agents
EOF
