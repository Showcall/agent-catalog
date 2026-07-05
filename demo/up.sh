#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo"
NAMESPACE="agent-catalog-demo"
PID_FILE="$DEMO_DIR/.mock-litellm-port-forward.pid"
LOG_FILE="$DEMO_DIR/.mock-litellm-port-forward.log"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need kubectl

echo "Applying demo workloads to the current Kubernetes context:"
kubectl config current-context
kubectl apply -f "$DEMO_DIR/manifests/demo.yaml"

echo "Waiting for demo deployments..."
kubectl -n "$NAMESPACE" rollout status deploy/release-notes-agent --timeout=120s
kubectl -n "$NAMESPACE" rollout status deploy/sentiment-batch --timeout=120s
kubectl -n "$NAMESPACE" rollout status deploy/mock-litellm --timeout=120s

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE")"
  if kill -0 "$old_pid" >/dev/null 2>&1; then
    echo "Mock LiteLLM port-forward already running with pid $old_pid"
  else
    rm -f "$PID_FILE"
  fi
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "Starting mock LiteLLM port-forward on http://localhost:4000 ..."
  kubectl -n "$NAMESPACE" port-forward svc/mock-litellm 4000:4000 >"$LOG_FILE" 2>&1 &
  echo "$!" >"$PID_FILE"
  sleep 2
fi

cat <<EOF

Demo cluster is ready.

Backstage demo config:
  $DEMO_DIR/backstage/app-config.demo.yaml

Environment:
  export LITELLM_SPEND_KEY=demo-token

Expected findings after the catalog refreshes:
  - release-notes-agent: labeled A2A agent with a live card and usage
  - sentiment-batch: heuristic llm-workload with usage
  - litellm gateway Resource: team rollups plus one unattributed consumer

Open Backstage's /agents page after starting your local Backstage app.
EOF
