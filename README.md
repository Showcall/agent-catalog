<img src="docs/banner.svg" alt="agent-catalog — your Backstage catalog knows every service. Now it knows every AI agent too." width="100%"/>

# backstage-agent-catalog (MVP)

Your Backstage catalog already knows every service you run. Now it knows every
**AI agent** too — **whatever runtime it runs on.**

Agents enter the catalog three ways, at three depths:

| How agents enter | What the catalog knows | Runtimes |
|---|---|---|
| **Supported runtime integration** (CRD provider) | The full governance plane: model + tool dependencies (`dependsOn`), lifecycle from runtime conditions, BYO image provenance, plus a golden-path scaffolder | **kagent** today · ARK, Dapr Agents on the [roadmap](docs/roadmap.md) |
| **Runtime-agnostic A2A discovery** — one Service label ([ADR 0006](docs/adr/0006-a2a-label-discovery.md)) | Identity, ownership, lifecycle from Service metadata; real skills/capabilities from the live agent card | Anything serving an agent card: ADK, LangGraph, CrewAI, custom containers, … |
| **Audit sweep** — probe for unlabeled agents ([ADR 0007](docs/adr/0007-audit-sweep.md)) | Same as discovery, marked `discovery: probe` — the shadow-agent hunt | designed, implementation pending |

The depths are deliberate: a runtime the catalog *knows* (kagent, today)
gets the richest experience — the dependency graph, accurate lifecycle,
provenance, and the scaffolder's GitOps closed loop. A runtime it merely
*discovers* still gets governed, but with a visibly thinner declared plane.
That gap is the incentive, not a bug: **any agent can be cataloged; agents
on a supported runtime are cataloged best.**

A golden-path scaffolder template creates new agents via GitOps PR, which
then appear in the catalog automatically. That closed loop is the demo.

## Where this sits (not an agent runtime)

Runtimes — [kagent](https://kagent.dev) (Solo.io), ARK, Dapr Agents, the
hosted platforms — run, reconcile, and operate agents, with their own UIs
for building and invoking them. **This project runs nothing.** It is a
consumer of runtimes: a Backstage integration that mirrors their agents
into the org-wide software catalog, alongside the services, APIs, and teams
that already live there. It replaces nothing and competes with nothing —
runtimes are where agents *run*; this is where the rest of the org
*finds out they exist*. kagent is called out throughout as the first
fully-supported runtime (deepest integration), not as the boundary of
the project.

## Documentation

New to agents, A2A, or MCP? Start with the primer. Diagrams throughout.

- [concepts.md](docs/concepts.md) — glossary + how each concept maps into Backstage
- [architecture.md](docs/architecture.md) — the closed loop; why the catalog is never in the deploy path
- [governance.md](docs/governance.md) — the three kinds of agent sprawl and what this actually solves
- [docs/adr/](docs/adr/README.md) — every significant decision, with alternatives and consequences
- [roadmap.md](docs/roadmap.md) — the rungs: runtime landscape and what's deliberately out of scope

## Entity model

Targets kagent CRD **v1alpha2** (group `kagent.dev`). In v1alpha2 the
declarative config lives under `spec.declarative.*`; tool refs are object
refs keyed by `name`. (v1alpha1 had these flat on `spec` with
`mcpServer.toolServer`/`agent.ref` — see git history if you need it.)

| Source | Backstage entity | Notes |
|---|---|---|
| kagent `Agent` CRD | `kind: Component`, `spec.type: ai-agent` | owner from `backstage.io/owner` **annotation**, lifecycle from Ready condition |
| Live A2A card (`/.well-known/agent-card.json`, fallback `agent.json`) | `kind: API`, `spec.type: a2a` | real card in `spec.definition`; synthesized from `a2aConfig` only as unreachable fallback |
| kagent `ModelConfig` CRD | `kind: Resource`, `spec.type: llm-model-config` | agents `dependsOn` it |
| `spec.declarative.tools[].mcpServer` | `dependsOn` relations | governance view: what may this agent call |
| Any `Service` labeled `agentcatalog.io/a2a=true` | `Component` + `API` from its live card | runtime-agnostic discovery; owner/lifecycle from Service metadata; kagent-owned Services skipped ([ADR 0006](docs/adr/0006-a2a-label-discovery.md)) |

Flat/greppable data lives in `agentcatalog.io/*` annotations; rich structured
data rides in `spec.agent`. Rationale for Component-over-custom-kind: the
entire plugin ecosystem (scorecards, search, ownership, orphan reports) keys
off well-known kinds — a custom kind opts out of exactly the governance
tooling that makes this valuable.

## Install (into an existing Backstage app)

1. Copy `plugins/catalog-backend-module-agent-catalog` into your repo's
   `plugins/` and add it to the workspace.
2. Wire it in `packages/backend/src/index.ts`:
   ```ts
   backend.add(import('@internal/catalog-backend-module-agent-catalog'));
   ```
3. Configure `app-config.yaml`:
   ```yaml
   agentCatalog:
     defaultOwner: group:default/platform-team
     excludeNamespaces: [kube-system]
     # crd: { group: kagent.dev, version: v1alpha1 }   # override if needed
     schedule: { frequencyMinutes: 5, timeoutMinutes: 2 }
     # cardEnrichment:
     #   enabled: true
     #   timeoutMs: 2000
     #   port: 8080
     #   paths: ['/.well-known/agent-card.json', '/.well-known/agent.json']
     # a2aDiscovery:               # runtime-agnostic labeled-Service discovery
     #   enabled: true
     #   labelSelector: agentcatalog.io/a2a=true
     #   claimedBy: [{ group: kagent.dev, kind: Agent }]
     clusters:
       - name: local
         # uses default kubeconfig loading; or:
         # kubeconfigPath: /home/you/.kube/config
         # context: kind-kagent-demo
         # inCluster: true   # when Backstage runs in the cluster
   ```

   RBAC: the kubeconfig needs `list` on services, `get` on
   `services/proxy` (card fetches), and `get` on endpoints — use a
   least-privilege ServiceAccount, not an admin config.
4. Register the template (catalog locations or the UI):
   `templates/new-kagent-agent/template.yaml`

## Verify before trusting (10 minutes, do this first)

The transforms are written against kagent's documented CRD shapes, but kagent
is a young project — **verify against your cluster** and adjust
`src/provider/types.ts` / `transforms.ts` if fields moved:

```bash
kubectl get crd agents.kagent.dev -o jsonpath='{.spec.group} {.spec.versions[*].name}'
kubectl get agents.kagent.dev -A -o yaml | head -80
kubectl get modelconfigs.kagent.dev -A -o yaml | head -40
```

Check specifically (v1alpha2): `spec.declarative.modelConfig` (string),
`spec.declarative.tools[].mcpServer.name`, `spec.declarative.a2aConfig.skills`,
and the Ready condition type. Note kagent's CRD uses conversion strategy
`None`, so a cluster whose storage version is v1alpha2 will silently prune
any flat v1alpha1 fields you write — always author manifests in the storage
version. The unit tests in `transforms.test.ts` use fixtures — update the
fixtures to match your real CRDs and keep the tests honest.

**Kubernetes client version:** code targets `@kubernetes/client-node` 1.x
(object-style params). On 0.x, `listCustomObjectForAllNamespaces(group,
version, plural)` takes positional args.

## The demo loop (the whole pitch, ~3 min screen recording)

1. `kind create cluster && helm install kagent ...` (kagent quick start)
2. Run Backstage with this module → existing agents appear in the catalog,
   tagged `ai-agent`, with owners and model/tool dependencies.
3. Run the **New kagent Agent** template → GitOps PR → merge → apply.
4. Within one sync cycle the new agent appears in the catalog on its own.
   No manual registration. That moment is the product.

## Known MVP tradeoffs (deliberate)

- **Full mutation per refresh**: a cluster that fails to sync drops its
  entities until the next successful pass. Fine for MVP; move to per-cluster
  providers or delta mutations later.
- ~~Synthesized A2A card~~ **Fixed**: the live card is fetched via the kube
  API-server proxy (`/.well-known/agent-card.json`, falling back to
  `/.well-known/agent.json`) and overlaid on every agent, fail-soft
  ([ADR 0001](docs/adr/0001-agent-metadata-sources.md));
  the synthesized card remains only as the unreachable-agent fallback.
- **No frontend plugin yet**: entities render fine on stock catalog pages via
  annotations/tags. The dedicated agent entity page (card viewer, tools
  panel, fleet view) is Phase 2.
- **Scaffolder PR flow** assumes GitHub; swap the publish action for GitLab
  etc. as needed.

## License

Apache-2.0
