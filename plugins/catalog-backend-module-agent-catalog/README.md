# @showcall/backstage-plugin-catalog-backend-module-agent-catalog

> _It's 10 PM. Do you know where your agents are?_

The backend discovery module for
[Showcall Agent Catalog](https://github.com/Showcall/agent-catalog), an
inventory of AI agents running across Kubernetes runtimes and A2A services in
Backstage.

This package discovers and catalogs:

- kagent agents, model configurations, tools, and live A2A cards
- ARK agents, teams, and models
- arbitrary Kubernetes Services labeled as A2A agents
- unlabeled workloads that exhibit configurable agent and LLM signals
- optional LiteLLM gateway usage and traction

Agent Catalog is currently a **technical preview** (`0.1.x`). Package APIs and
configuration may change before `1.0`.

## Install

From the root of your Backstage app:

```bash
yarn --cwd packages/backend add @showcall/backstage-plugin-catalog-backend-module-agent-catalog
```

Register the module in `packages/backend/src/index.ts`:

```ts
backend.add(
  import('@showcall/backstage-plugin-catalog-backend-module-agent-catalog'),
);
```

## Configure

Add at least one cluster to `app-config.yaml`:

```yaml
agentCatalog:
  defaultOwner: group:default/platform-team
  excludeNamespaces:
    - kube-system
  clusters:
    - name: production
      inCluster: true
```

For a Backstage backend running outside Kubernetes, point the module at a
kubeconfig instead:

```yaml
agentCatalog:
  clusters:
    - name: production
      kubeconfigPath: /home/backstage/.kube/config
      context: production
```

The module uses credentials provided by Kubernetes or the kubeconfig. Bind the
included
[read-only RBAC policy](https://github.com/Showcall/agent-catalog/blob/main/deploy/rbac.yaml)
to the identity used by your Backstage backend; do not use an administrator
kubeconfig.

Runtime discovery, live-card enrichment, heuristics, scheduling, and LiteLLM
usage are configurable under `agentCatalog`. See the
[complete configuration example](https://github.com/Showcall/agent-catalog#quick-start-into-an-existing-backstage-app).

## Add the UI

Install
[`@showcall/backstage-plugin-agent-catalog`](https://www.npmjs.com/package/@showcall/backstage-plugin-agent-catalog)
to add the Agents navigation item, `/agents` fleet page, and per-agent entity
card.

The backend module can also run without the frontend package; discovered agents
will still be ordinary Backstage catalog entities.

## Related packages

- [`@showcall/backstage-plugin-catalog-backend-module-agent-catalog`](https://www.npmjs.com/package/@showcall/backstage-plugin-catalog-backend-module-agent-catalog)
  provides this discovery module.
- [`@showcall/backstage-plugin-agent-catalog`](https://www.npmjs.com/package/@showcall/backstage-plugin-agent-catalog)
  provides the fleet and entity UI.

## Documentation

- [Project overview and complete setup](https://github.com/Showcall/agent-catalog#readme)
- [Local demo](https://github.com/Showcall/agent-catalog/blob/main/demo/README.md)
- [Entity model](https://github.com/Showcall/agent-catalog#entity-model)
- [Governance](https://github.com/Showcall/agent-catalog/blob/main/docs/governance.md)
- [Issues](https://github.com/Showcall/agent-catalog/issues)

Apache-2.0 licensed. See the
[project license](https://github.com/Showcall/agent-catalog/blob/main/LICENSE).
