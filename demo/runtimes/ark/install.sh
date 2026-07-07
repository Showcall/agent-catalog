#!/usr/bin/env bash
# ARK runtime pack: installs the real ARK controller (cert-manager + Gateway
# API prerequisites) and applies sample Agent/Team/Model CRs whose Model
# points at the demo mock provider — real Available conditions, no key.
set -euo pipefail

PACK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="${DEMO_DIR:-$(cd "$PACK_DIR/../.." && pwd)}"
# shellcheck source=demo/lib.sh
source "$DEMO_DIR/lib.sh"

NAMESPACE="${DEMO_NAMESPACE:-agent-catalog-demo}"
INSTALL_PREREQS="${DEMO_ARK_PREREQS:-1}"
ARK_NAMESPACE="${DEMO_ARK_NAMESPACE:-ark-system}"
ARK_RELEASE="${DEMO_ARK_RELEASE:-ark-controller}"
ARK_CHART="${DEMO_ARK_CHART:-oci://ghcr.io/mckinsey/agents-at-scale-ark/charts/ark-controller}"
ARK_VERSION="${DEMO_ARK_VERSION:-}"
GATEWAY_API_URL="${DEMO_GATEWAY_API_INSTALL_URL:-https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.3.0/standard-install.yaml}"
MARKER="$DEMO_DIR/.ark-installed-by-demo"

need helm

install_prerequisites() {
  if [[ "$INSTALL_PREREQS" == "0" || "$INSTALL_PREREQS" == "false" ]]; then
    echo "Skipping ARK prerequisites (DEMO_ARK_PREREQS=$INSTALL_PREREQS)."
    return
  fi
  if helm status cert-manager -n cert-manager >/dev/null 2>&1; then
    echo "Reusing existing cert-manager."
  else
    echo "Installing cert-manager for ARK..."
    helm repo add jetstack https://charts.jetstack.io --force-update
    helm repo update
    helm upgrade --install cert-manager jetstack/cert-manager \
      --namespace cert-manager --create-namespace --set crds.enabled=true
  fi
  kubectl -n cert-manager rollout status deploy/cert-manager --timeout=180s
  kubectl -n cert-manager rollout status deploy/cert-manager-cainjector --timeout=180s
  kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=180s

  if kubectl get crd gatewayclasses.gateway.networking.k8s.io >/dev/null 2>&1; then
    echo "Reusing existing Gateway API CRDs."
  else
    echo "Installing Gateway API CRDs for ARK..."
    kubectl apply -f "$GATEWAY_API_URL"
  fi
}

install_controller() {
  local status
  status="$(helm_release_status "$ARK_RELEASE" "$ARK_NAMESPACE")"
  if [[ "$status" == "deployed" ]]; then
    echo "Reusing existing ARK controller release $ARK_RELEASE."
    return
  fi
  [[ -n "$status" ]] && helm uninstall "$ARK_RELEASE" -n "$ARK_NAMESPACE" >/dev/null 2>&1 || true

  echo "Installing ARK controller into $ARK_NAMESPACE ..."
  adopt_crds_into_release ark.mckinsey.com "$ARK_RELEASE" "$ARK_NAMESPACE"
  local args=(upgrade --install "$ARK_RELEASE" "$ARK_CHART"
    --namespace "$ARK_NAMESPACE" --create-namespace --set rbac.enable=true)
  [[ -n "$ARK_VERSION" ]] && args+=(--version "$ARK_VERSION")
  if ! helm "${args[@]}"; then
    if kubectl get crd agents.ark.mckinsey.com >/dev/null 2>&1; then
      echo "ARK CRDs exist but weren't adopted; retrying without CRD management." >&2
      helm uninstall "$ARK_RELEASE" -n "$ARK_NAMESPACE" >/dev/null 2>&1 || true
      helm "${args[@]}" --skip-crds --set crd.enable=false
    else
      exit 1
    fi
  fi
  echo "$ARK_NAMESPACE/$ARK_RELEASE" >"$MARKER"
}

install_prerequisites
install_controller
kubectl -n "$ARK_NAMESPACE" rollout status "deploy/$ARK_RELEASE" --timeout=180s
wait_server_dry_run "$PACK_DIR/webhook-probe.yaml"

echo "Applying ARK demo resources..."
kubectl apply -f "$PACK_DIR/resources.yaml"
kubectl -n "$NAMESPACE" wait --for=condition=ModelAvailable \
  model.ark.mckinsey.com/agent-catalog-demo-model --timeout=180s
kubectl -n "$NAMESPACE" wait --for=condition=Available \
  agent.ark.mckinsey.com/researcher \
  agent.ark.mckinsey.com/writer \
  team.ark.mckinsey.com/content-team --timeout=180s
echo "ARK runtime ready."
