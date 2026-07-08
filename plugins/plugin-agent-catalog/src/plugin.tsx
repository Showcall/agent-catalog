/**
 * agent-catalog frontend plugin (new frontend system).
 *
 * Two extensions, deliberately thin (see the roadmap's frontend scope):
 *  - /agents: the fleet page — every AI agent across all sources
 *  - an "Agent" info card on ai-agent Component pages (traction + status)
 *
 * Discovered automatically via `app.packages: all`. The app's nav module
 * (AppNav) turns a page into a sidebar item only when that page emits a
 * routeRef *and* a title *and* an icon — a page without a routeRef is
 * routable but never appears in the sidebar. That's why agentsRouteRef is
 * passed below; without it the "Agents" nav item silently goes missing.
 * Classic/custom sidebars can instead import AgentCatalogSidebarItem.
 */

import {
  PageBlueprint,
  createFrontendPlugin,
  createRouteRef,
} from '@backstage/frontend-plugin-api';
import { EntityCardBlueprint } from '@backstage/plugin-catalog-react/alpha';
import type { Entity } from '@backstage/catalog-model';
import AndroidIcon from '@material-ui/icons/Android';
import { agentCatalogNavItem } from './nav';

/** Route to the fleet page; presence of this ref is what surfaces the nav item. */
export const agentsRouteRef = createRouteRef();

const agentFleetPage = PageBlueprint.make({
  params: {
    path: agentCatalogNavItem.path,
    routeRef: agentsRouteRef,
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
