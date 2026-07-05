#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo"
PID_FILE="$DEMO_DIR/.mock-litellm-port-forward.pid"
NAMESPACE="agent-catalog-demo"

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "Stopping mock LiteLLM port-forward pid $pid"
    kill "$pid"
  fi
  rm -f "$PID_FILE"
fi

if command -v kubectl >/dev/null 2>&1; then
  echo "Deleting namespace $NAMESPACE"
  kubectl delete namespace "$NAMESPACE" --ignore-not-found
else
  echo "kubectl not found; skipping Kubernetes cleanup" >&2
fi
