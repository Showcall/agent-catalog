<img src="docs/banner.svg" alt="agent-catalog — your Backstage catalog knows every service. Now it knows every AI agent too." width="100%"/>

# backstage-agent-catalog (MVP)

Your Backstage catalog already knows every service you run. Now it knows every
**AI agent** too.

This is the MVP skeleton from the project plan: a catalog backend module that
ingests **kagent** CRDs (Agents, ModelConfigs) from your clusters as Backstage
entities, plus a golden-path scaffolder template that creates new agents via
GitOps PR — which then appear in the catalog automatically. That closed loop
is the demo.

## Documentation

New to agents, A2A, or MCP? Start with the primer. Diagrams throughout.

- [concepts.md](docs/concepts.md) — glossary + how each concept maps into Backstage
- [architecture.md](docs/architecture.md) — the closed loop; why the catalog is never in the deploy path
- [governance.md](docs/governance.md) — the three kinds of agent sprawl and what this actually solves
- [docs/adr/](docs/adr/README.md) — every significant decision, with alternatives and consequences

## Entity model

Targets kagent CRD **v1alpha2** (group `kagent.dev`). In v1alpha2 the
declarative config lives under `spec.declarative.*`; tool refs are object
refs keyed by `name`. (v1alpha1 had these flat on `spec` with
`mcpServer.toolServer`/`agent.ref` — see git history if you need it.)

| Source | Backstage entity | Notes |
|---|---|---|
| kagent `Agent` CRD | `kind: Component`, `spec.type: ai-agent` | owner from `backstage.io/owner` **annotation**, lifecycle from Ready condition |
| `spec.declarative.a2aConfig` | `kind: API`, `spec.type: a2a` | synthesized card in `spec.definition`; agent `providesApis` it |
| kagent `ModelConfig` CRD | `kind: Resource`, `spec.type: llm-model-config` | agents `dependsOn` it |
| `spec.declarative.tools[].mcpServer` | `dependsOn` relations | governance view: what may this agent call |

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
     clusters:
       - name: local
         # uses default kubeconfig loading; or:
         # kubeconfigPath: /home/you/.kube/config
         # context: kind-kagent-demo
         # inCluster: true   # when Backstage runs in the cluster
   ```
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
- **Synthesized A2A card** from the CRD, not fetched from
  `/.well-known/agent.json`. A live-card enrichment provider is the natural
  next step (and makes the API entity work for non-kagent runtimes).
- **No frontend plugin yet**: entities render fine on stock catalog pages via
  annotations/tags. The dedicated agent entity page (card viewer, tools
  panel, fleet view) is Phase 2.
- **Scaffolder PR flow** assumes GitHub; swap the publish action for GitLab
  etc. as needed.

## Legal hygiene

Clean-room project: personal time, personal equipment, no employer code or
configs. Apache-2.0.
