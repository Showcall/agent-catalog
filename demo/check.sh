#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_PORT="${DEMO_BACKSTAGE_PORT:-3001}"
BACKEND_PORT="${DEMO_BACKSTAGE_BACKEND_PORT:-7008}"
LITELLM_PORT="${DEMO_LITELLM_PORT:-4400}"

ok() {
  printf "ok      %s\n" "$1"
}

warn() {
  printf "warn    %s\n" "$1"
}

fail() {
  printf "missing %s\n" "$1"
  missing=1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

port_check() {
  local port="$1"
  local label="$2"
  if have lsof && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    warn "${label} port ${port} is already listening"
  else
    ok "${label} port ${port} looks free"
  fi
}

missing=0

echo "Agent Catalog demo preflight"
echo

for cmd in kubectl helm curl node npx; do
  if have "$cmd"; then
    ok "$cmd"
  else
    fail "$cmd"
  fi
done

if have yarn; then
  ok "yarn"
else
  warn "global yarn not found; demo/backstage.sh can use the Yarn release scaffolded into demo/.backstage-app"
fi

if have minikube; then
  if minikube status >/dev/null 2>&1; then
    ok "minikube is running"
  else
    warn "minikube is installed but not running"
  fi
else
  warn "minikube not found; kind/Docker Desktop/k3d can still work if kubectl points at a cluster"
fi

if have kubectl; then
  if context="$(kubectl config current-context 2>/dev/null)"; then
    ok "kubectl context: ${context}"
  else
    warn "kubectl has no current context"
  fi

  if kubectl get namespace default >/dev/null 2>&1; then
    ok "cluster API reachable"
  else
    warn "cluster API is not reachable with the current kubectl context"
  fi
fi

port_check "$LITELLM_PORT" "mock LiteLLM"
port_check "$FRONTEND_PORT" "Backstage frontend"
port_check "$BACKEND_PORT" "Backstage backend"

if [[ -d "$ROOT_DIR/demo/.backstage-app" ]]; then
  ok "disposable Backstage app exists at demo/.backstage-app"
else
  warn "disposable Backstage app has not been bootstrapped yet"
fi

echo
if [[ "$missing" == "1" ]]; then
  echo "Preflight found missing required commands."
  exit 1
fi

echo "Preflight complete."
