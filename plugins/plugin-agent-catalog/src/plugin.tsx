/**
 * agent-catalog frontend plugin (new frontend system).
 *
 * Two extensions, deliberately thin (see the roadmap's frontend scope):
 *  - /agents: the fleet page — every AI agent across all sources
 *  - an "Agent" info card on ai-agent Component pages (traction + status)
 *
 * Discovered automatically via `app.packages: all`; the fleet page's
 * title/icon surface it in the sidebar through the app's nav module.
 * Classic/custom sidebars can import AgentCatalogSidebarItem.
 */

import { PageBlueprint, createFrontendPlugin } from '@backstage/frontend-plugin-api';
import { EntityCardBlueprint } from '@backstage/plugin-catalog-react/alpha';
import type { Entity } from '@backstage/catalog-model';
import AndroidIcon from '@material-ui/icons/Android';
import { agentCatalogNavItem } from './nav';

const agentFleetPage = PageBlueprint.make({
  params: {
    path: agentCatalogNavItem.path,
    title: agentCatalogNavItem.title,
    icon: <AndroidIcon />,
    loader: () =>
      import('./components/FleetPage').then(m => <m.FleetPage />),
  },
});

const agentInfoCard = EntityCardBlueprint.make({
  name: 'agent-info',
  params: {
    filter: (entity: Entity) =>
      entity.kind === 'Component' &&
      ['ai-agent', 'ai-agent-team', 'llm-workload'].includes(
        (entity.spec as { type?: string })?.type ?? '',
      ),
    loader: () =>
      import('./components/AgentInfoCard').then(m => <m.AgentInfoCard />),
  },
});

export default createFrontendPlugin({
  pluginId: 'agent-catalog',
  extensions: [agentFleetPage, agentInfoCard],
});
