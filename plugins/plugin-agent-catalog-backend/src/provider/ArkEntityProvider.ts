/**
 * ArkEntityProvider (ADR 0010, Tier B): ingests ARK (ark.mckinsey.com)
 * Agents, Teams, and Models as catalog entities — the second fully-supported
 * runtime, same entity model as kagent.
 *
 * A cluster without the ARK CRDs is normal, not an error: the agents list
 * returning 404 is treated as "no ARK here" (a successful empty scan, which
 * clears any previous snapshot per ADR 0003).
 */

import { CustomObjectsApi } from '@kubernetes/client-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import { ClusterScanningProvider } from './ClusterScanningProvider';
import {
  arkAgentToComponent,
  arkModelToResource,
  arkTeamToComponent,
} from './arkTransforms';
import type {
  AgentCatalogConfig,
  ArkAgent,
  ArkModel,
  ArkTeam,
  ClusterConfig,
} from './types';
import type { UsageService } from './UsageService';

function isNotFound(e: unknown): boolean {
  const code = (e as { code?: number; statusCode?: number }) ?? {};
  return code.code === 404 || code.statusCode === 404;
}

export class ArkEntityProvider extends ClusterScanningProvider {
  constructor(
    config: AgentCatalogConfig,
    logger: LoggerService,
    /** Optional gateway-usage integration (ADR 0008). */
    private readonly usage?: UsageService,
  ) {
    super(config, logger);
  }

  getProviderName(): string {
    return 'ark-entity-provider';
  }

  protected async collectCluster(cluster: ClusterConfig): Promise<Entity[]> {
    const kc = this.makeKubeConfig(cluster);
    const api = kc.makeApiClient(CustomObjectsApi);
    const { group, version } = this.config.ark;
    const exclude = new Set(this.config.excludeNamespaces ?? []);
    const opts = {
      clusterName: cluster.name,
      defaultOwner: this.config.defaultOwner,
    };

    const list = async <T>(plural: string): Promise<T[]> => {
      const res = (await api.listCustomObjectForAllNamespaces({
        group,
        version,
        plural,
      })) as { items?: T[] };
      return (res.items ?? []).filter(
        (o: unknown) =>
          !exclude.has(
            (o as { metadata?: { namespace?: string } }).metadata?.namespace ??
              '',
          ),
      );
    };

    let agents: ArkAgent[];
    try {
      agents = await list<ArkAgent>('agents');
    } catch (e) {
      if (isNotFound(e)) return []; // no ARK on this cluster — fine
      throw e;
    }

    const entities: Entity[] = [];
    const seenIds: string[] = [];

    for (const agent of agents) {
      try {
        seenIds.push(
          `${agent.metadata?.namespace ?? 'default'}/${agent.metadata?.name}`,
        );
        const component = arkAgentToComponent(agent, opts);
        entities.push(this.usage?.decorate(component) ?? component);
      } catch (e) {
        this.logger.warn(
          `ark: skipping agent ${agent.metadata?.namespace}/${agent.metadata?.name}: ${e}`,
        );
      }
    }

    // Teams and Models are enrichment — fail soft, keep the agents.
    try {
      for (const team of await list<ArkTeam>('teams')) {
        seenIds.push(
          `${team.metadata?.namespace ?? 'default'}/${team.metadata?.name}`,
        );
        const component = arkTeamToComponent(team, opts);
        entities.push(this.usage?.decorate(component) ?? component);
      }
    } catch (e) {
      this.logger.warn(`ark: could not list teams on ${cluster.name}: ${e}`);
    }
    try {
      for (const model of await list<ArkModel>('models')) {
        entities.push(arkModelToResource(model, opts));
      }
    } catch (e) {
      this.logger.warn(`ark: could not list models on ${cluster.name}: ${e}`);
    }

    this.usage?.reportSeenAgents(
      `${this.getProviderName()}/${cluster.name}`,
      seenIds,
    );
    this.logger.info(
      `ark: ${entities.length} entities from cluster ${cluster.name}`,
    );
    return entities;
  }
}
