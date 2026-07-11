# @showcall/backstage-plugin-agent-catalog

> _It's 10 PM. Do you know where your agents are?_

The frontend package for
[Showcall Agent Catalog](https://github.com/Showcall/agent-catalog), an
inventory of AI agents running across kagent, ARK, and arbitrary A2A services
in Backstage.

This package adds:

- an **Agents** sidebar item and `/agents` fleet page
- owner, runtime, discovery source, reachability, and LLM-gateway usage columns
- an Agent status and traction card on supported catalog entity pages

Agent Catalog is currently a **technical preview** (`0.1.x`). Package APIs and
configuration may change before `1.0`.

## Compatibility

The fleet page and entity card require Backstage's **new frontend system**. The
companion backend module uses Backstage's new backend system.

## Install

From the root of your Backstage app:

```bash
yarn --cwd packages/app add @showcall/backstage-plugin-agent-catalog
```

Most installations should also install the
[backend module](https://www.npmjs.com/package/@showcall/backstage-plugin-catalog-backend-module-agent-catalog),
which discovers agents and writes them into the Backstage catalog.

## Register the plugin

When your app uses `app.packages: all`, the new frontend system discovers the
installed plugin automatically.

For an explicitly composed frontend, add the package's default export to the
app features:

```tsx
import agentCatalogPlugin from '@showcall/backstage-plugin-agent-catalog';

export default createApp({
  features: [
    // your existing features
    agentCatalogPlugin,
  ],
});
```

The plugin registers the `/agents` page, its navigation metadata, and the Agent
entity card.

### Custom sidebar

If your app composes a classic or custom sidebar explicitly, add:

```tsx
import { AgentCatalogSidebarItem } from '@showcall/backstage-plugin-agent-catalog';

<AgentCatalogSidebarItem />;
```

The page and entity-card extensions still require the new frontend system.

## Related packages

- [`@showcall/backstage-plugin-catalog-backend-module-agent-catalog`](https://www.npmjs.com/package/@showcall/backstage-plugin-catalog-backend-module-agent-catalog)
  discovers agents, model configurations, A2A cards, heuristic workloads, and
  gateway usage.
- [`@showcall/backstage-plugin-agent-catalog`](https://www.npmjs.com/package/@showcall/backstage-plugin-agent-catalog)
  provides this fleet and entity UI.

## Documentation

- [Project overview and complete setup](https://github.com/Showcall/agent-catalog#readme)
- [Local demo](https://github.com/Showcall/agent-catalog/blob/main/demo/README.md)
- [Architecture](https://github.com/Showcall/agent-catalog/blob/main/docs/architecture.md)
- [Roadmap](https://github.com/Showcall/agent-catalog/blob/main/docs/roadmap.md)
- [Issues](https://github.com/Showcall/agent-catalog/issues)

Apache-2.0 licensed. See the
[project license](https://github.com/Showcall/agent-catalog/blob/main/LICENSE).
