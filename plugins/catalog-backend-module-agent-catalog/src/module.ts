/**
 * Backend module: wires KagentEntityProvider into the catalog using the
 * new Backstage backend system, on a scheduled task runner.
 *
 * In packages/backend/src/index.ts:
 *   backend.add(import('@internal/catalog-backend-module-agent-catalog'));
 */

import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node/alpha';
import type { Config } from '@backstage/config';
import { KagentEntityProvider } from './provider/KagentEntityProvider';
import type { AgentCatalogConfig } from './provider/types';

export function readAgentCatalogConfig(config: Config): AgentCatalogConfig {
  const root = config.getConfig('agentCatalog');
  return {
    defaultOwner: root.getOptionalString('defaultOwner') ?? 'group:default/platform-team',
    excludeNamespaces: root.getOptionalStringArray('excludeNamespaces'),
    crd: {
      group: root.getOptionalString('crd.group') ?? 'kagent.dev',
      version: root.getOptionalString('crd.version') ?? 'v1alpha2',
    },
    schedule: {
      frequencyMinutes:
        root.getOptionalNumber('schedule.frequencyMinutes') ?? 5,
      timeoutMinutes: root.getOptionalNumber('schedule.timeoutMinutes') ?? 2,
    },
    cardEnrichment: {
      enabled: root.getOptionalBoolean('cardEnrichment.enabled') ?? true,
      timeoutMs: root.getOptionalNumber('cardEnrichment.timeoutMs') ?? 2000,
      port: root.getOptionalNumber('cardEnrichment.port') ?? 8080,
      path:
        root.getOptionalString('cardEnrichment.path') ??
        '/.well-known/agent.json',
    },
    clusters: root.getConfigArray('clusters').map(c => ({
      name: c.getString('name'),
      kubeconfigPath: c.getOptionalString('kubeconfigPath'),
      context: c.getOptionalString('context'),
      inCluster: c.getOptionalBoolean('inCluster'),
    })),
  };
}

export const catalogModuleAgentCatalog = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'agent-catalog',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ catalog, config, logger, scheduler }) {
        const cfg = readAgentCatalogConfig(config);
        const provider = new KagentEntityProvider(cfg, logger);
        catalog.addEntityProvider(provider);

        await scheduler.scheduleTask({
          id: 'agent-catalog-kagent-refresh',
          frequency: { minutes: cfg.schedule.frequencyMinutes },
          timeout: { minutes: cfg.schedule.timeoutMinutes },
          initialDelay: { seconds: 10 },
          fn: async () => {
            await provider.refresh();
          },
        });
      },
    });
  },
});
