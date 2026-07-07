#!/usr/bin/env bash
# kagent runtime pack (demo default): installs the real kagent controller with
# the built-in agent fleet and the two heaviest optional components disabled
# (the built-in fleet is a known CPU hog on a small cluster), then applies
# sample Agents whose ModelConfig points at the demo mock provider. kagent
# marks agents Ready on deployment, so they reach `production` and serve live
# A2A cards with no real key.
set -euo pipefail

PACK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="${DEMO_DIR:-$(cd "$PACK_DIR/../.." && pwd)}"
# shellcheck source=demo/lib.sh
source "$DEMO_DIR/lib.sh"

NAMESPACE="${DEMO_NAMESPACE:-agent-catalog-demo}"
KAGENT_NAMESPACE="${DEMO_KAGENT_NAMESPACE:-kagent}"
KAGENT_VERSION="${DEMO_KAGENT_VERSION:-0.9.11}"
CRDS_CHART="${DEMO_KAGENT_CRDS_CHART:-oci://ghcr.io/kagent-dev/kagent/helm/kagent-crds}"
CHART="${DEMO_KAGENT_CHART:-oci://ghcr.io/kagent-dev/kagent/helm/kagent}"
MARKER="$DEMO_DIR/.kagent-installed-by-demo"
CRDS_MARKER="$DEMO_DIR/.kagent-crds-installed-by-demo"

need helm

# Disable the built-in agent fleet (CPU guard) plus the two heaviest optional
# components. Controller, postgres, tools, and kmcp remain.
DISABLE_FLEET=(
  k8s-agent kgateway-agent istio-agent promql-agent observability-agent
  argo-rollouts-agent helm-agent cilium-policy-agent cilium-manager-agent
  cilium-debug-agent
)
SET_ARGS=(--set grafana-mcp.enabled=false --set querydoc.enabled=false)
for a in "${DISABLE_FLEET[@]}"; do SET_ARGS+=(--set "${a}.enabled=false"); done

install_crds() {
  if [[ "$(helm_release_status kagent-crds "$KAGENT_NAMESPACE")" == "deployed" ]]; then
    echo "Reusing existing kagent CRD release."
  else
    echo "Installing kagent CRDs..."
    helm upgrade --install kagent-crds "$CRDS_CHART" \
      -n "$KAGENT_NAMESPACE" --create-namespace --version "$KAGENT_VERSION"
    echo "$KAGENT_NAMESPACE/kagent-crds" >"$CRDS_MARKER"
  fi
  kubectl wait --for=condition=Established \
    crd/agents.kagent.dev crd/modelconfigs.kagent.dev --timeout=120s
}

install_controller() {
  local status
  status="$(helm_release_status kagent "$KAGENT_NAMESPACE")"
  if [[ "$status" == "deployed" ]]; then
    echo "Reusing existing kagent controller release."
    return
  fi
  [[ -n "$status" ]] && helm uninstall kagent -n "$KAGENT_NAMESPACE" >/dev/null 2>&1 || true

  echo "Installing kagent controller into $KAGENT_NAMESPACE (built-in fleet disabled)..."
  helm upgrade --install kagent "$CHART" \
    -n "$KAGENT_NAMESPACE" --create-namespace --version "$KAGENT_VERSION" "${SET_ARGS[@]}"
  echo "$KAGENT_NAMESPACE/kagent" >"$MARKER"
}

install_crds
install_controller
kubectl -n "$KAGENT_NAMESPACE" rollout status deploy/kagent-controller --timeout=180s

echo "Applying kagent demo resources..."
kubectl apply -f "$PACK_DIR/resources.yaml"

# Accepted = the controller compiled the agent; Ready follows once its pod is
# up. Don't hard-fail the demo on a slow reconcile — the catalog still ingests.
kubectl -n "$NAMESPACE" wait --for=condition=Accepted \
  agent.kagent.dev/support-triage \
  agent.kagent.dev/docs-assistant --timeout=180s || \
  echo "kagent agents not Accepted yet; the catalog will pick them up on refresh." >&2
echo "kagent runtime ready."
