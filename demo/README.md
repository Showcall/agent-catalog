# Agent Catalog Demo

This demo gives you a small but complete agent estate:

- `support-triage`, `docs-assistant`: kagent Agents reconciled by a real
  kagent controller — `production`, serving live A2A cards.
- `release-notes-agent`: a runtime-agnostic A2A agent discovered from a labeled Service.
- `sentiment-batch`: an unlabeled LLM-consuming workload found by heuristics.
- `mock-litellm`: a LiteLLM-shaped usage ledger and OpenAI-compatible fake provider that lights up traction.
- optional `researcher`, `writer`, and `content-team`: ARK Agent/Team CRDs reconciled by a real ARK controller.

It requires no real LLM provider key. Runtimes are installed by **packs**
under `demo/runtimes/<name>/`, selected with `DEMO_RUNTIMES` (default
`kagent`). Each pack installs the runtime's real controller and points its
model at the demo mock provider, so agents genuinely reconcile with no key.
Set `DEMO_RUNTIMES="kagent ark"` to demonstrate multiple runtimes in one
cluster.

## Prerequisites

- A local Kubernetes cluster, such as kind, minikube, Docker Desktop, or k3d.
- `kubectl` pointed at that cluster.
- `helm` and network access to pull the kagent Helm charts.
- Node.js, `npx`, and `yarn` for the disposable Backstage app.
- Optional: network access to pull ARK charts and prerequisites when
  installing the ARK add-on.

Known-good minikube start:

```bash
minikube start --cpus=4 --memory=8192
```

## Run The Full Demo

From the `agent-catalog` repo root:

```bash
./demo/check.sh
./demo/up.sh
./demo/backstage.sh
```

`demo/check.sh` verifies required commands, the current Kubernetes context,
cluster connectivity, and likely port conflicts.

`demo/up.sh` applies `demo/manifests/demo.yaml` (mock ledger + the labeled
and heuristic workloads), then runs each runtime pack in `DEMO_RUNTIMES`,
and starts a port-forward for the mock LiteLLM ledger at
`http://localhost:4400` (override with `DEMO_LITELLM_PORT`; 4400 avoids
colliding with a real LiteLLM proxy on 4000). It intentionally stops there so
you can either run the disposable Backstage app below or point an existing
Backstage app at the same demo cluster.

`demo/backstage.sh` creates/reuses a disposable Backstage app under
`demo/.backstage-app`, syncs these local plugins into that app, installs
dependencies, writes a demo config overlay, exports `LITELLM_SPEND_KEY`, and
starts Backstage at `http://localhost:3001/agents`.

To demonstrate multiple runtimes (kagent + ARK) in the same cluster:

```bash
DEMO_RUNTIMES="kagent ark" ./demo/up.sh
```

Each runtime is a self-contained pack under `demo/runtimes/<name>/`
(an `install.sh` plus its sample `resources.yaml`). Adding a runtime is a
new pack, not more `up.sh`.

Useful switches:

```bash
DEMO_RUNTIMES="ark" ./demo/up.sh             # a single non-default runtime
DEMO_RUNTIMES="" ./demo/up.sh                # no controllers (label + heuristic only)
DEMO_KAGENT_VERSION=0.9.11 ./demo/up.sh      # pin the kagent charts
DEMO_ARK_VERSION=0.1.50 ./demo/up.sh         # pin the ARK controller chart
DEMO_ARK_PREREQS=0 DEMO_RUNTIMES="kagent ark" ./demo/up.sh  # reuse cert-manager/Gateway API
DEMO_BACKSTAGE_PORT=3002 ./demo/backstage.sh # move the disposable Backstage frontend
DEMO_BACKSTAGE_NO_START=1 ./demo/backstage.sh # prepare app without starting it
# Scan several clusters (one agentCatalog.clusters entry per kubectl context):
DEMO_CLUSTER_CONTEXTS="kind-a,kind-b,kind-c" ./demo/backstage.sh
```

`demo/backstage.sh` regenerates the app-config overlay on every run. By default
it scans your current kubectl context as a single `demo` cluster; set
`DEMO_CLUSTER_CONTEXTS` to a comma-separated list of contexts to scan several at
once (the generated `agentCatalog.clusters` list replaces, rather than merges
with, any lower config layer).

## Existing Backstage App

The full demo does not mutate your Backstage app. For real adoption, install
these two local plugins into your app instead:

- `plugins/plugin-agent-catalog-backend`
- `plugins/plugin-agent-catalog`

Then use `demo/backstage/app-config.demo.yaml` as a config overlay for your
local Backstage app.

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
| `support-triage` / `docs-assistant` | `crd` | `ai-agent` | kagent Agents (default runtime), reconciled to `production`, serving live A2A cards |
| `release-notes-agent` | `label` | `ai-agent` | Service is labeled `agentcatalog.io/a2a=true` and serves an A2A card |
| `sentiment-batch` | `heuristic` | `llm-workload` | Deployment has an `ANTHROPIC_API_KEY` env name |
| `researcher` / `writer` | `crd` | `ai-agent` | With `DEMO_RUNTIMES="kagent ark"`: ARK Agent CRDs reconciled by the ARK controller |
| `content-team` | `crd` | `ai-agent-team` | With `DEMO_RUNTIMES="kagent ark"`: ARK Team CRD with member relationships |

The usage ledger should add:

- requests and last-active on `release-notes-agent`
- requests and last-active on `sentiment-batch`
- a `litellm-gateway` Resource with team rollups
- one unattributed consumer: `hackathon-bot`

That is the intended “aha”: known agents, shadow workloads, and unattributed
LLM usage all show up in one Backstage-native catalog.

## Playbooks

Once the demo is up, [`demo/playbooks/`](playbooks/) has short, self-contained
scenarios that show off one capability end-to-end on top of the running demo —
"watch this happen", not just a table. First up:

```bash
# find an agent nobody registered (audit sweep / ADR 0007):
DEMO_SWEEP=1 ./demo/backstage.sh          # enable the sweep (off by default)
./demo/playbooks/shadow-agent/run.sh      # plant a shadow agent, watch it get discovered
./demo/playbooks/shadow-agent/cleanup.sh  # remove it
```

See [demo/playbooks/README.md](playbooks/README.md) for the list and how to add
your own.

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

If this demo installed kagent and you want to remove that cluster-wide Helm
release too:

```bash
DEMO_UNINSTALL_KAGENT=1 ./demo/down.sh
```
