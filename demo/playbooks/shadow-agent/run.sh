#!/usr/bin/env bash
# Playbook: shadow-agent discovery via the audit sweep (ADR 0007).
#
# Plants an unlabeled, unregistered A2A agent into the demo cluster, then waits
# for the audit sweep to discover it and shows it landing in the catalog as
# `discovery: probe`. Run it against an already-up demo (./demo/up.sh +
# ./demo/backstage.sh). The sweep is off by default — see the note printed at
# the end if it hasn't been enabled yet.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${DEMO_BACKSTAGE_BACKEND_PORT:-7008}"
FRONTEND_PORT="${DEMO_BACKSTAGE_PORT:-3001}"
BACKEND="http://localhost:${BACKEND_PORT}"
NS="shadow-team"
NAME="shadow-invoice-bot"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
need kubectl
need curl
need node

echo "==> Planting the shadow agent ($NAME) — unlabeled, unowned, no CRD..."
kubectl apply -f "$HERE/manifest.yaml"
kubectl -n "$NS" rollout status deploy/"$NAME" --timeout=120s

# A guest token, the same way the fleet page authenticates.
guest_token() {
  curl -fsS -X POST "$BACKEND/api/auth/guest/refresh" -H 'content-type: application/json' 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).backstageIdentity.token)}catch{process.stdout.write("")}})'
}

# Is the shadow agent in the catalog yet, marked discovery: probe?
probe_found() {
  local token="$1"
  curl -fsS "$BACKEND/api/catalog/entities?filter=kind=Component,metadata.annotations.agentcatalog.io/discovery=probe" \
    -H "authorization: Bearer $token" 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);process.exit(a.some(e=>e.metadata.title==="'"$NAME"'")?0:1)}catch{process.exit(1)}})'
}

echo
echo "==> Waiting for the audit sweep to notice it (up to ~2 min)..."
token="$(guest_token || true)"
if [[ -z "$token" ]]; then
  echo "Could not reach the demo Backstage backend at $BACKEND." >&2
  echo "Start it first: ./demo/backstage.sh (with the sweep on — see below)." >&2
fi

found=0
if [[ -n "$token" ]]; then
  for _ in $(seq 1 24); do
    token="$(guest_token || true)"
    if [[ -n "$token" ]] && probe_found "$token"; then found=1; break; fi
    sleep 5
  done
fi

echo
if [[ "$found" == 1 ]]; then
  cat <<EOF
✅ The sweep found it.

   '$NAME' is now in the catalog as a probed agent — nobody registered it,
   yet there it is, serving a card in namespace '$NS'. Open the fleet and
   filter/scan for discovery = probe:

     http://localhost:${FRONTEND_PORT}/agents

   That is shadow discovery: the agents nobody told you about.
EOF
else
  cat <<EOF
The shadow agent is running, but the sweep has not cataloged it.

The audit sweep is OFF by default (it is a port-probing workload). Enable it in
the demo and restart Backstage:

   DEMO_SWEEP=1 ./demo/backstage.sh

Then re-run this script to watch it get discovered:

   ./demo/playbooks/shadow-agent/run.sh

Clean up when done:

   ./demo/playbooks/shadow-agent/cleanup.sh
EOF
fi
