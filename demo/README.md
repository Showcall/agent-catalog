# Agent Catalog Demo

This demo gives you a small but complete agent estate:

- `release-notes-agent`: a runtime-agnostic A2A agent discovered from a labeled Service.
- `researcher`, `writer`, and `content-team`: ARK Agent/Team CRDs reconciled by a real ARK controller.
- `sentiment-batch`: an unlabeled LLM-consuming workload found by heuristics.
- `mock-litellm`: a LiteLLM-shaped usage ledger and OpenAI-compatible fake provider that lights up traction and keeps the ARK sample no-key.

It requires no real LLM provider key. By default it installs a real ARK
controller so the catalog demonstrates multiple runtimes in one cluster.

## Prerequisites

- A local Kubernetes cluster, such as kind, minikube, Docker Desktop, or k3d.
- `kubectl` pointed at that cluster.
- `helm` for the default ARK controller install.
- Network access to pull the ARK Helm chart and its prerequisites.
- A Backstage app with these two local plugins installed:
  - `plugins/catalog-backend-module-agent-catalog`
  - `plugins/plugin-agent-catalog`

## Start The Demo Workloads

From the `agent-catalog` repo root:

```bash
./demo/up.sh
```

The script applies `demo/manifests/demo.yaml`, restarts the mock provider when
its ConfigMap changes, waits for the three demo Deployments, installs/reuses
ARK in `ark-system`, applies `demo/manifests/ark.yaml`, waits for the ARK
resources to become available, and starts a port-forward for the mock LiteLLM
ledger at `http://localhost:4400` (override with `DEMO_LITELLM_PORT`; 4400
avoids colliding with a real LiteLLM proxy on 4000).

Useful switches:

```bash
DEMO_INSTALL_ARK=0 ./demo/up.sh              # lightweight demo, no ARK install
DEMO_INSTALL_ARK_PREREQS=0 ./demo/up.sh      # reuse existing cert-manager/Gateway API
DEMO_ARK_VERSION=0.1.50 ./demo/up.sh         # pin the ARK controller chart
```

## Configure Backstage

Use `demo/backstage/app-config.demo.yaml` as a config overlay for your local
Backstage app.

If your Backstage app is the sibling `backstage-app` workspace used during
development, run from that app:

```bash
export LITELLM_SPEND_KEY=demo-token
node .yarn/releases/yarn-4.13.0.cjs start --config app-config.yaml --config ../agent-catalog/demo/backstage/app-config.demo.yaml
```

For another Backstage app, copy the relevant `agentCatalog` block and adjust
the `catalog.locations[0].target` path to point at:

```text
demo/backstage/org.yaml
```

## What You Should See

After the catalog providers refresh, open `/agents`.

Expected rows:

| Name | Discovery | Type | Why it appears |
|---|---|---|---|
| `release-notes-agent` | `label` | `ai-agent` | Service is labeled `agentcatalog.io/a2a=true` and serves an A2A card |
| `researcher` / `writer` | `crd` | `ai-agent` | ARK Agent CRDs reconciled by the ARK controller |
| `content-team` | `crd` | `ai-agent-team` | ARK Team CRD with member relationships |
| `sentiment-batch` | `heuristic` | `llm-workload` | Deployment has an `ANTHROPIC_API_KEY` env name |

The usage ledger should add:

- requests and last-active on `release-notes-agent`
- requests and last-active on `sentiment-batch`
- a `litellm-gateway` Resource with team rollups
- one unattributed consumer: `hackathon-bot`

That is the intended “aha”: known agents, shadow workloads, and unattributed
LLM usage all show up in one Backstage-native catalog.

## Cleanup

```bash
./demo/down.sh
```

This stops the mock LiteLLM port-forward and deletes the `agent-catalog-demo`
namespace.

If this demo installed ARK and you want to remove that cluster-wide Helm
release too:

```bash
DEMO_UNINSTALL_ARK=1 ./demo/down.sh
```
