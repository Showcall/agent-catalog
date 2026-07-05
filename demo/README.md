# Agent Catalog Demo

This demo gives you a small but complete agent estate:

- `release-notes-agent`: a runtime-agnostic A2A agent discovered from a labeled Service.
- `sentiment-batch`: an unlabeled LLM-consuming workload found by heuristics.
- `mock-litellm`: a LiteLLM-shaped usage ledger that lights up traction and shadow usage.

It requires no real LLM provider key and no real agent runtime.

## Prerequisites

- A local Kubernetes cluster, such as kind, minikube, Docker Desktop, or k3d.
- `kubectl` pointed at that cluster.
- A Backstage app with these two local plugins installed:
  - `plugins/catalog-backend-module-agent-catalog`
  - `plugins/plugin-agent-catalog`

## Start The Demo Workloads

From the `agent-catalog` repo root:

```bash
./demo/up.sh
```

The script applies `demo/manifests/demo.yaml`, waits for the three demo
Deployments, and starts a port-forward for the mock LiteLLM ledger at
`http://localhost:4400` (override with `DEMO_LITELLM_PORT`; 4400 avoids
colliding with a real LiteLLM proxy on 4000).

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
