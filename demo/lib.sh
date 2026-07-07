#!/usr/bin/env bash
# Shared helpers for demo runtime packs. Sourced by runtimes/<name>/install.sh,
# never executed directly.

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

# Prints a helm release's STATUS (e.g. "deployed"), or nothing if absent.
helm_release_status() {
  local release="$1" ns="$2"
  helm status "$release" -n "$ns" 2>/dev/null | sed -n 's/^STATUS: //p'
}

# Wait until the API server accepts a probe manifest — i.e. the runtime's
# admission webhook is live. A server-side dry-run is the correct signal;
# a fixed sleep is not.
wait_server_dry_run() {
  local manifest="$1" tries="${2:-30}"
  echo "Waiting for the admission webhook to accept resources..."
  for _ in $(seq 1 "$tries"); do
    if kubectl apply --dry-run=server -f "$manifest" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for the admission webhook." >&2
  return 1
}

# Adopt pre-existing CRDs of an API group into a helm release so a chart that
# also ships those CRDs can be installed without ownership conflicts.
adopt_crds_into_release() {
  local group="$1" release="$2" ns="$3"
  local crds
  crds="$(kubectl get crd \
    -o jsonpath="{range .items[?(@.spec.group==\"$group\")]}{.metadata.name}{\"\n\"}{end}")"
  [[ -z "$crds" ]] && return 0
  echo "Adopting existing $group CRDs into Helm release $release..."
  while IFS= read -r crd; do
    [[ -z "$crd" ]] && continue
    kubectl label "crd/$crd" app.kubernetes.io/managed-by=Helm --overwrite >/dev/null
    kubectl annotate "crd/$crd" \
      "meta.helm.sh/release-name=$release" \
      "meta.helm.sh/release-namespace=$ns" --overwrite >/dev/null
  done <<<"$crds"
}
