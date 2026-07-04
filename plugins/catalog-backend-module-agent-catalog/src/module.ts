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
import { A2ADiscoveryProvider } from './provider/A2ADiscoveryProvider';
import { GatewayUsageProvider, UsageService } from './provider/UsageService';
import { LiteLLMUsageSource } from './provider/litellmUsageSource';
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
      // Fallback chain: A2A v1.0 well-known first, then the older path
      // kagent serves (kagent answers on both). See ADR 0006.
      paths: root.getOptionalStringArray('cardEnrichment.paths') ?? [
        '/.well-known/agent-card.json',
        '/.well-known/agent.json',
      ],
    },
    a2aDiscovery: {
      enabled: root.getOptionalBoolean('a2aDiscovery.enabled') ?? true,
      labelSelector:
        root.getOptionalString('a2aDiscovery.labelSelector') ??
        'agentcatalog.io/a2a=true',
      claimedBy: root
        .getOptionalConfigArray('a2aDiscovery.claimedBy')
        ?.map(c => ({
          group: c.getString('group'),
          kind: c.getString('kind'),
        })) ?? [{ group: 'kagent.dev', kind: 'Agent' }],
    },
    usage: {
      enabled: root.getOptionalBoolean('usage.enabled') ?? false,
      source: root.getOptionalString('usage.source') ?? 'litellm',
      baseUrl: root.getOptionalString('usage.baseUrl'),
      apiKeyEnv:
        root.getOptionalString('usage.apiKeyEnv') ?? 'LITELLM_SPEND_KEY',
      windowDays: root.getOptionalNumber('usage.windowDays') ?? 7,
      includeCost: root.getOptionalBoolean('usage.includeCost') ?? false,
      schedule: {
        frequencyMinutes:
          root.getOptionalNumber('usage.schedule.frequencyMinutes') ?? 60,
      },
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

        // Gateway-usage integration (ADR 0008): the service holds the
        // windowed ledger snapshot on its own slow schedule; agent
        // providers consult it to stamp per-agent traction annotations.
        let usage: UsageService | undefined;
        if (cfg.usage.enabled) {
          const apiKey = process.env[cfg.usage.apiKeyEnv];
          if (cfg.usage.baseUrl && apiKey) {
            usage = new UsageService(
              new LiteLLMUsageSource({
                baseUrl: cfg.usage.baseUrl,
                apiKey,
                windowDays: cfg.usage.windowDays,
              }),
              cfg.usage.includeCost,
              logger,
            );
          } else {
            logger.warn(
              `gateway-usage: enabled but ${
                cfg.usage.baseUrl ? `env ${cfg.usage.apiKeyEnv} is unset` : 'baseUrl is missing'
              } — skipping`,
            );
          }
        }

        const provider = new KagentEntityProvider(cfg, logger, usage);
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

        // Runtime-agnostic labeled-Service discovery (ADR 0006). Separate
        // provider + locationKey so the two full mutations can't clobber
        // each other.
        if (cfg.a2aDiscovery.enabled) {
          const discovery = new A2ADiscoveryProvider(cfg, logger, usage);
          catalog.addEntityProvider(discovery);

          await scheduler.scheduleTask({
            id: 'agent-catalog-a2a-discovery-refresh',
            frequency: { minutes: cfg.schedule.frequencyMinutes },
            timeout: { minutes: cfg.schedule.timeoutMinutes },
            initialDelay: { seconds: 15 },
            fn: async () => {
              await discovery.refresh();
            },
          });
        }

        if (usage) {
          const gatewayProvider = new GatewayUsageProvider(
            usage,
            cfg.usage.includeCost,
            // Gateway entity is cluster-independent; use the first cluster
            // name only for TransformOptions shape.
            {
              clusterName: cfg.clusters[0]?.name ?? 'default',
              defaultOwner: cfg.defaultOwner,
            },
            logger,
          );
          catalog.addEntityProvider(gatewayProvider);

          // Two tasks, deliberately ordered around the agent providers:
          // the snapshot lands BEFORE their first refresh (so per-agent
          // annotations apply from cycle one), the summary Resource lands
          // AFTER it (so its matched/unattributed split sees their reports).
          await scheduler.scheduleTask({
            id: 'agent-catalog-gateway-usage-snapshot',
            frequency: { minutes: cfg.usage.schedule.frequencyMinutes },
            timeout: { minutes: cfg.schedule.timeoutMinutes },
            initialDelay: { seconds: 5 },
            fn: async () => {
              await usage!.refresh();
            },
          });
          await scheduler.scheduleTask({
            id: 'agent-catalog-gateway-usage-resource',
            frequency: { minutes: cfg.usage.schedule.frequencyMinutes },
            timeout: { minutes: cfg.schedule.timeoutMinutes },
            initialDelay: { seconds: 60 },
            fn: async () => {
              await gatewayProvider.refresh();
            },
          });
        }
      },
    });
  },
});
