#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo"
PID_FILE="$DEMO_DIR/.mock-litellm-port-forward.pid"
NAMESPACE="agent-catalog-demo"
ARK_MARKER_FILE="$DEMO_DIR/.ark-installed-by-demo"
KAGENT_CRDS_MARKER_FILE="$DEMO_DIR/.kagent-crds-installed-by-demo"
KAGENT_MARKER_FILE="$DEMO_DIR/.kagent-installed-by-demo"

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

if [[ "${DEMO_UNINSTALL_ARK:-0}" == "1" && -f "$ARK_MARKER_FILE" ]]; then
  if command -v helm >/dev/null 2>&1; then
    ark_ref="$(cat "$ARK_MARKER_FILE")"
    ark_namespace="${ark_ref%%/*}"
    ark_release="${ark_ref#*/}"
    echo "Uninstalling ARK controller Helm release ${ark_release} from namespace ${ark_namespace}"
    helm uninstall "$ark_release" -n "$ark_namespace" || true
    rm -f "$ARK_MARKER_FILE"
  else
    echo "helm not found; leaving ARK controller installed" >&2
  fi
elif [[ -f "$ARK_MARKER_FILE" ]]; then
  echo "Leaving ARK controller installed. Set DEMO_UNINSTALL_ARK=1 to remove the demo-installed Helm release."
  echo "WARNING: if the demo adopted pre-existing ARK CRDs into the Helm release, uninstalling"
  echo "may delete those CRDs — and Kubernetes will then delete EVERY ark.mckinsey.com resource"
  echo "cluster-wide, including ones the demo did not create."
fi

if [[ "${DEMO_UNINSTALL_KAGENT:-0}" == "1" && -f "$KAGENT_MARKER_FILE" ]]; then
  if command -v helm >/dev/null 2>&1; then
    kagent_ref="$(cat "$KAGENT_MARKER_FILE")"
    kagent_namespace="${kagent_ref%%/*}"
    kagent_release="${kagent_ref#*/}"
    echo "Uninstalling kagent Helm release ${kagent_release} from namespace ${kagent_namespace}"
    helm uninstall "$kagent_release" -n "$kagent_namespace" || true
    rm -f "$KAGENT_MARKER_FILE"
    if [[ -f "$KAGENT_CRDS_MARKER_FILE" ]]; then
      kagent_crds_ref="$(cat "$KAGENT_CRDS_MARKER_FILE")"
      kagent_crds_namespace="${kagent_crds_ref%%/*}"
      kagent_crds_release="${kagent_crds_ref#*/}"
      echo "Uninstalling kagent CRD Helm release ${kagent_crds_release} from namespace ${kagent_crds_namespace}"
      helm uninstall "$kagent_crds_release" -n "$kagent_crds_namespace" || true
      rm -f "$KAGENT_CRDS_MARKER_FILE"
    fi
  else
    echo "helm not found; leaving kagent installed" >&2
  fi
elif [[ -f "$KAGENT_MARKER_FILE" ]]; then
  echo "Leaving kagent installed. Set DEMO_UNINSTALL_KAGENT=1 to remove the demo-installed Helm release."
  if [[ -f "$KAGENT_CRDS_MARKER_FILE" ]]; then
    echo "Leaving kagent CRDs installed too; they will be removed with DEMO_UNINSTALL_KAGENT=1."
  fi
fi
