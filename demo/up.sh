#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo"
NAMESPACE="agent-catalog-demo"
# Local port for the mock ledger; 4400 avoids colliding with a real LiteLLM on 4000.
LITELLM_PORT="${DEMO_LITELLM_PORT:-4400}"
INSTALL_ARK="${DEMO_INSTALL_ARK:-1}"
INSTALL_ARK_PREREQS="${DEMO_INSTALL_ARK_PREREQS:-1}"
ADOPT_EXISTING_ARK_CRDS="${DEMO_ARK_ADOPT_EXISTING_CRDS:-1}"
ARK_NAMESPACE="${DEMO_ARK_NAMESPACE:-ark-system}"
ARK_RELEASE="${DEMO_ARK_RELEASE:-ark-controller}"
ARK_CHART="${DEMO_ARK_CHART:-oci://ghcr.io/mckinsey/agents-at-scale-ark/charts/ark-controller}"
ARK_VERSION="${DEMO_ARK_VERSION:-}"
GATEWAY_API_INSTALL_URL="${DEMO_GATEWAY_API_INSTALL_URL:-https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.3.0/standard-install.yaml}"
PID_FILE="$DEMO_DIR/.mock-litellm-port-forward.pid"
LOG_FILE="$DEMO_DIR/.mock-litellm-port-forward.log"
ARK_MARKER_FILE="$DEMO_DIR/.ark-installed-by-demo"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need kubectl
need curl

install_ark_prerequisites() {
  if [[ "$INSTALL_ARK_PREREQS" == "0" || "$INSTALL_ARK_PREREQS" == "false" ]]; then
    echo "Skipping ARK prerequisites because DEMO_INSTALL_ARK_PREREQS=${INSTALL_ARK_PREREQS}."
    return
  fi

  if helm status cert-manager -n cert-manager >/dev/null 2>&1; then
    echo "Reusing existing cert-manager Helm release."
  else
    echo "Installing cert-manager for ARK..."
    helm repo add jetstack https://charts.jetstack.io --force-update
    helm repo update
    helm upgrade --install cert-manager jetstack/cert-manager \
      --namespace cert-manager \
      --create-namespace \
      --set crds.enabled=true
  fi

  echo "Waiting for cert-manager rollout..."
  kubectl -n cert-manager rollout status deploy/cert-manager --timeout=180s
  kubectl -n cert-manager rollout status deploy/cert-manager-cainjector --timeout=180s
  kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=180s

  if kubectl get crd gatewayclasses.gateway.networking.k8s.io >/dev/null 2>&1; then
    echo "Reusing existing Gateway API CRDs."
  else
    echo "Installing Gateway API CRDs for ARK..."
    kubectl apply -f "$GATEWAY_API_INSTALL_URL"
  fi
}

adopt_existing_ark_crds() {
  if [[ "$ADOPT_EXISTING_ARK_CRDS" == "0" || "$ADOPT_EXISTING_ARK_CRDS" == "false" ]]; then
    return
  fi

  existing_crds="$(
    kubectl get crd \
      -o jsonpath='{range .items[?(@.spec.group=="ark.mckinsey.com")]}{.metadata.name}{"\n"}{end}'
  )"
  if [[ -z "$existing_crds" ]]; then
    return
  fi

  echo "Adopting existing ARK CRDs into Helm release ${ARK_RELEASE} so missing CRDs can be installed."
  while IFS= read -r crd; do
    [[ -z "$crd" ]] && continue
    kubectl label "crd/${crd}" app.kubernetes.io/managed-by=Helm --overwrite
    kubectl annotate "crd/${crd}" \
      "meta.helm.sh/release-name=${ARK_RELEASE}" \
      "meta.helm.sh/release-namespace=${ARK_NAMESPACE}" \
      --overwrite
  done <<<"$existing_crds"
}

wait_for_ark_webhook() {
  echo "Waiting for ARK admission webhook..."
  for _ in {1..30}; do
    if kubectl apply --dry-run=server -f "$DEMO_DIR/manifests/ark-webhook-probe.yaml" >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done

  echo "Timed out waiting for the ARK admission webhook to accept demo resources." >&2
  exit 1
}

wait_for_ark_resources() {
  echo "Waiting for ARK demo resources to become available..."
  kubectl -n "$NAMESPACE" wait \
    --for=condition=ModelAvailable \
    model.ark.mckinsey.com/agent-catalog-demo-model \
    --timeout=180s
  kubectl -n "$NAMESPACE" wait \
    --for=condition=Available \
    agent.ark.mckinsey.com/researcher \
    agent.ark.mckinsey.com/writer \
    team.ark.mckinsey.com/content-team \
    --timeout=180s
}

install_ark_controller() {
  if [[ "$INSTALL_ARK" == "0" || "$INSTALL_ARK" == "false" ]]; then
    echo "Skipping ARK controller install because DEMO_INSTALL_ARK=${INSTALL_ARK}."
    return
  fi

  need helm
  install_ark_prerequisites

  release_status=""
  if helm status "$ARK_RELEASE" -n "$ARK_NAMESPACE" >/dev/null 2>&1; then
    release_status="$(
      helm status "$ARK_RELEASE" -n "$ARK_NAMESPACE" | sed -n 's/^STATUS: //p'
    )"
  fi

  if [[ "$release_status" == "deployed" ]]; then
    echo "Reusing existing ARK controller Helm release ${ARK_RELEASE} in namespace ${ARK_NAMESPACE}."
  else
    if [[ -n "$release_status" ]]; then
      echo "Existing ARK controller Helm release is ${release_status}; reinstalling it for the demo."
      helm uninstall "$ARK_RELEASE" -n "$ARK_NAMESPACE" >/dev/null 2>&1 || true
    fi
    echo "Installing ARK controller into namespace ${ARK_NAMESPACE} ..."
    adopt_existing_ark_crds
    helm_args=(
      upgrade --install "$ARK_RELEASE" "$ARK_CHART"
      --namespace "$ARK_NAMESPACE"
      --create-namespace
      --set rbac.enable=true
    )
    if [[ -n "$ARK_VERSION" ]]; then
      helm_args+=(--version "$ARK_VERSION")
    fi
    if ! helm "${helm_args[@]}"; then
      if kubectl get crd agents.ark.mckinsey.com >/dev/null 2>&1; then
        echo "ARK CRDs already exist but could not be adopted by Helm; retrying controller install without CRD management." >&2
        helm uninstall "$ARK_RELEASE" -n "$ARK_NAMESPACE" >/dev/null 2>&1 || true
        helm "${helm_args[@]}" --skip-crds --set crd.enable=false
      else
        exit 1
      fi
    fi
    echo "${ARK_NAMESPACE}/${ARK_RELEASE}" >"$ARK_MARKER_FILE"
  fi

  echo "Waiting for ARK controller rollout..."
  kubectl -n "$ARK_NAMESPACE" rollout status "deploy/${ARK_RELEASE}" --timeout=180s
  wait_for_ark_webhook
}

mock_ledger_ready() {
  curl -fsS \
    -H "Authorization: Bearer demo-token" \
    "http://localhost:${LITELLM_PORT}/user/daily/activity" \
    >/dev/null 2>&1
}

wait_for_mock_ledger() {
  echo "Waiting for mock LiteLLM ledger on http://localhost:${LITELLM_PORT} ..."
  for _ in {1..20}; do
    if mock_ledger_ready; then
      return
    fi
    if [[ -f "$PID_FILE" ]]; then
      pid="$(cat "$PID_FILE")"
      if ! kill -0 "$pid" >/dev/null 2>&1; then
        echo "Mock LiteLLM port-forward exited before it became ready." >&2
        [[ -f "$LOG_FILE" ]] && tail -20 "$LOG_FILE" >&2
        rm -f "$PID_FILE"
        exit 1
      fi
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

install_ark_controller

if [[ "$INSTALL_ARK" == "0" || "$INSTALL_ARK" == "false" ]]; then
  echo "Skipping ARK sample resources because ARK install is disabled."
else
  echo "Applying ARK demo resources..."
  kubectl apply -f "$DEMO_DIR/manifests/ark.yaml"
  wait_for_ark_resources
fi

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE")"
  if kill -0 "$old_pid" >/dev/null 2>&1; then
    if mock_ledger_ready; then
      echo "Mock LiteLLM port-forward already running with pid $old_pid"
    else
      echo "Restarting stale mock LiteLLM port-forward with pid $old_pid"
      kill "$old_pid" >/dev/null 2>&1 || true
      rm -f "$PID_FILE"
    fi
  else
    rm -f "$PID_FILE"
  fi
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "Starting mock LiteLLM port-forward on http://localhost:${LITELLM_PORT} ..."
  nohup kubectl -n "$NAMESPACE" port-forward svc/mock-litellm "${LITELLM_PORT}:4000" >"$LOG_FILE" 2>&1 &
  forward_pid="$!"
  echo "$forward_pid" >"$PID_FILE"
  disown "$forward_pid" >/dev/null 2>&1 || true
fi

wait_for_mock_ledger

cat <<EOF

Demo cluster is ready.

Backstage demo config:
  $DEMO_DIR/backstage/app-config.demo.yaml

Environment:
  export LITELLM_SPEND_KEY=demo-token

Mock ledger: http://localhost:${LITELLM_PORT}
(If you changed DEMO_LITELLM_PORT, update usage.baseUrl in the demo config.)

Expected findings after the catalog refreshes:
  - release-notes-agent: labeled A2A agent with a live card and usage
  - sentiment-batch: heuristic llm-workload with usage
  - researcher/writer/content-team: ARK CRD runtime entities from the ARK controller
  - litellm gateway Resource: team rollups plus one unattributed consumer

Open Backstage's /agents page after starting your local Backstage app.
EOF
