<img src="docs/banner.svg" alt="agent-catalog — your Backstage catalog knows every service. Now it knows every AI agent too." width="100%"/>

# backstage-agent-catalog

> *It's 10 PM. Do you know where your agents are?*

AI agents are becoming ordinary production workloads — and most
organizations can't answer the basics about them: *what agents are running,
who owns each one, which model and tools is it allowed to use, is it
actually alive?* Your Backstage catalog already answers exactly these
questions for services. This plugin makes it answer them for agents.

## What you get

- **Agents as catalog citizens.** Every agent becomes a `Component`
  (`spec.type: ai-agent`) with an owner, a lifecycle derived from what's
  actually running, and dependency edges to its model config and the tool
  servers it may call.
- **The live agent card, not a guess.** Each agent's A2A card is fetched
  from the running agent and cataloged as an `API` entity — the catalog
  shows what an agent *actually serves*, and flags the ones that stop
  answering.
- **Any runtime.** kagent agents get the deepest integration (full
  dependency graph, BYO image provenance). Any other agent — LangGraph,
  ADK, CrewAI, a hand-rolled container — is one Service label away from
  being cataloged.
- **A golden path.** The scaffolder template turns "I want a new agent"
  into a GitOps PR; once merged and deployed, the agent appears in the
  catalog on its own. No registration step exists to forget.
- **Governance you can query.** Unowned agents, unreachable agents,
  deprecated models, over-privileged tool access — all standard catalog
  queries ([governance.md](docs/governance.md)).

## The demo

1. `kind create cluster` + install [kagent](https://kagent.dev) — any
   existing agents appear in the catalog within one sync cycle, tagged
   `ai-agent`, with owners and model/tool dependencies.
2. Run the **New kagent Agent** template → it opens a GitOps PR.
3. Merge. Argo CD applies the manifest; the agent starts.
4. Next sync, the new agent is in the catalog — owned, discoverable,
   card fetched live. Nobody registered anything.

The same loop works without kagent: deploy any container that serves an
A2A card, label its Service `agentcatalog.io/a2a: "true"`, and it shows up
too.

## Quick start (into an existing Backstage app)

1. Copy `plugins/catalog-backend-module-agent-catalog` into your repo's
   `plugins/` and add it to the workspace.
2. Wire it into `packages/backend/src/index.ts`:
   ```ts
   backend.add(import('@internal/catalog-backend-module-agent-catalog'));
   ```
3. Configure `app-config.yaml`:
   ```yaml
   agentCatalog:
     defaultOwner: group:default/platform-team
     excludeNamespaces: [kube-system]
     schedule: { frequencyMinutes: 5, timeoutMinutes: 2 }
     clusters:
       - name: local
         # uses default kubeconfig loading; or:
         # kubeconfigPath: /home/you/.kube/config
         # context: kind-kagent-demo
         # inCluster: true   # when Backstage runs in the cluster
     # cardEnrichment:            # live A2A-card fetching (on by default)
     #   timeoutMs: 2000
     #   port: 8080
     #   paths: ['/.well-known/agent-card.json', '/.well-known/agent.json']
     # a2aDiscovery:              # labeled-Service discovery (on by default)
     #   labelSelector: agentcatalog.io/a2a=true
     #   claimedBy: [{ group: kagent.dev, kind: Agent }]
     # usage:                     # traction from the LLM-gateway ledger (ADR 0008)
     #   enabled: true
     #   source: litellm
     #   baseUrl: http://litellm.gateway:4000
     #   apiKeyEnv: LITELLM_SPEND_KEY   # spend-scoped key, via env
     #   windowDays: 7
     #   includeCost: false
   ```
4. Register the scaffolder template (catalog locations or the UI):
   `templates/new-kagent-agent/template.yaml`

**RBAC:** the kubeconfig needs `list` on services, `get` on
`services/proxy` (card fetches), and `get` on endpoints. Use a
least-privilege ServiceAccount, not an admin config.

### Before you trust it (10 minutes)

The transforms target kagent CRD **v1alpha2** (group `kagent.dev`), but
kagent is a young project — verify the shapes against *your* cluster and
adjust `src/provider/types.ts` / `transforms.ts` if fields moved:

```bash
kubectl get crd agents.kagent.dev -o jsonpath='{.spec.group} {.spec.versions[*].name}'
kubectl get agents.kagent.dev -A -o yaml | head -80
```

Check specifically: `spec.declarative.modelConfig` (string),
`spec.declarative.tools[].mcpServer.name`, `spec.declarative.a2aConfig.skills`,
and the Ready condition type. kagent's CRD uses conversion strategy `None`,
so always author manifests in the storage version — a v1alpha2 cluster
silently prunes flat v1alpha1 fields. The unit tests use fixtures; update
them to match your real CRDs and keep them honest.

Code targets `@kubernetes/client-node` 1.x (object-style params); on 0.x
the list calls take positional args.

## Entity model

| Source | Backstage entity | Notes |
|---|---|---|
| kagent `Agent` CRD | `Component`, `spec.type: ai-agent` | owner from `backstage.io/owner` **annotation**, lifecycle from Ready condition |
| Live A2A card (`/.well-known/agent-card.json`, fallback `agent.json`) | `API`, `spec.type: a2a` | the real served card; synthesized from the CRD only as unreachable fallback |
| kagent `ModelConfig` CRD | `Resource`, `spec.type: llm-model-config` | agents `dependsOn` it |
| Tool / MCP references | `dependsOn` relations | the governance view: what may this agent call |
| Any `Service` labeled `agentcatalog.io/a2a=true` | `Component` + `API` from its live card | runtime-agnostic; owner/lifecycle from Service metadata; runtime-owned Services skipped |

Agents are Components rather than a custom kind on purpose: the entire
plugin ecosystem — scorecards, search, ownership, orphan reports — keys off
the well-known kinds ([ADR 0002](docs/adr/0002-component-not-custom-kind.md)).
Flat, greppable facts live in `agentcatalog.io/*` annotations; rich
structured data rides in `spec.agent`.

## Where this sits

**Not an agent runtime.** Runtimes — [kagent](https://kagent.dev)
(Solo.io), ARK, Dapr Agents, the hosted platforms — run, reconcile, and
operate agents. This project runs nothing: it's the org-wide catalog view
across all of them, next to the services, APIs, and teams already in your
portal. kagent is the first fully-supported runtime (deepest integration),
not the boundary of the project.

**Not an agent registry either.** A registry is where teams *publish*
agents for others to use; this catalog *observes* what actually runs —
including what was never registered anywhere. Registries are planned
catalog sources, not rivals
([registries vs. catalogs](docs/concepts.md#registries-vs-catalogs--two-different-questions)).

## Documentation

New to agents, A2A, or MCP? Start with the primer.

- [concepts.md](docs/concepts.md) — glossary + how each concept maps into Backstage
- [architecture.md](docs/architecture.md) — the closed loop; why the catalog is never in the deploy path
- [governance.md](docs/governance.md) — the three kinds of agent sprawl and what this actually solves
- [roadmap.md](docs/roadmap.md) — supported runtimes, discovery tiers, what's deliberately out of scope
- [docs/adr/](docs/adr/README.md) — significant decisions recorded as
  Architecture Decision Records, the same practice
  [Backstage itself follows](https://backstage.io/docs/architecture-decisions/):
  each one states the context, the alternatives, and the consequences.

## Current limitations (deliberate)

- **Full mutation per refresh**: a cluster that fails to sync drops its
  entities until the next successful pass
  ([ADR 0003](docs/adr/0003-full-mutation-per-refresh.md)); move to
  per-cluster providers at multi-cluster scale.
- **No frontend plugin yet**: entities render fine on stock catalog pages
  via annotations/tags. A dedicated agent page (card viewer, tools panel,
  fleet view) is future work.
- **Scaffolder PR flow assumes GitHub**; swap the publish action for
  GitLab etc. as needed.

## License

Apache-2.0
