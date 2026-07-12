/**
 * Backend plugin: serves the fleet's snapshots and findings over HTTP under
 * /api/agent-catalog/*. Ships in the same package as the catalog module (the
 * module ingests → catalog; this plugin reads catalog → serves). See ADR 0011.
 *
 * In packages/backend/src/index.ts:
 *   import { agentCatalogPlugin } from '@showcall/backstage-plugin-agent-catalog-backend';
 *   backend.add(import('@showcall/backstage-plugin-agent-catalog-backend')); // module (default)
 *   backend.add(agentCatalogPlugin);                                         // this plugin
 */

import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { createRouter } from './router';

export const agentCatalogPlugin = createBackendPlugin({
  pluginId: 'agent-catalog',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        catalog: catalogServiceRef,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, catalog, logger }) {
        httpRouter.use(createRouter({ catalog, httpAuth, logger }));
      },
    });
  },
});
