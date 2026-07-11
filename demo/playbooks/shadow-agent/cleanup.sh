#!/usr/bin/env bash
# Remove the shadow-agent playbook resources.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Removing the shadow agent (namespace shadow-team)..."
kubectl delete -f "$HERE/manifest.yaml" --ignore-not-found
echo "Done. (The sweep's next run drops it from the catalog — it reflects reality.)"
