/**
 * KagentEntityProvider
 *
 * Scheduled entity provider: lists kagent Agent + ModelConfig CRDs from each
 * configured cluster and applies a FULL mutation to the catalog. Full
 * mutation = the catalog converges to exactly what exists in the clusters;
 * deleted CRDs disappear from Backstage on the next sync. Simple and
 * self-healing — the right MVP choice over watch streams.
 *
 * NOTE on @kubernetes/client-node: the 1.x client uses object-style params
 * (used below). If you're on 0.x, the calls take positional args — see
 * README "Kubernetes client version" section.
 */

import { KubeConfig, CustomObjectsApi } from '@kubernetes/client-node';
import type {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import {
  kagentAgentToEntities,
  modelConfigToEntity,
} from './transforms';
import type {
  AgentCatalogConfig,
  ClusterConfig,
  KagentAgent,
  KagentModelConfig,
} from './types';

export class KagentEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly config: AgentCatalogConfig,
    private readonly logger: LoggerService,
  ) {}

  getProviderName(): string {
    return 'kagent-entity-provider';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
  }

  /** Called by the scheduled task runner (wired in module.ts). */
  async refresh(): Promise<void> {
    if (!this.connection) {
      throw new Error('KagentEntityProvider not connected to the catalog');
    }

    const allEntities: Entity[] = [];

    for (const cluster of this.config.clusters) {
      try {
        const entities = await this.collectCluster(cluster);
        allEntities.push(...entities);
        this.logger.info(
          `agent-catalog: ${entities.length} entities from cluster ${cluster.name}`,
        );
      } catch (e) {
        // One unreachable cluster must not wipe entities from the others —
        // but note: with full mutation, skipping a failed cluster WILL drop
        // its previously-synced entities. MVP tradeoff; delta mutations or
        // per-cluster providers fix this later.
        this.logger.error(
          `agent-catalog: failed to sync cluster ${cluster.name}: ${e}`,
        );
      }
    }

    await this.connection.applyMutation({
      type: 'full',
      entities: allEntities.map(entity => ({
        entity,
        locationKey: this.getProviderName(),
      })),
    });
  }

  private makeApi(cluster: ClusterConfig): CustomObjectsApi {
    const kc = new KubeConfig();
    if (cluster.inCluster) {
      kc.loadFromCluster();
    } else if (cluster.kubeconfigPath) {
      kc.loadFromFile(cluster.kubeconfigPath);
    } else {
      kc.loadFromDefault();
    }
    if (cluster.context) {
      kc.setCurrentContext(cluster.context);
    }
    return kc.makeApiClient(CustomObjectsApi);
  }

  private async collectCluster(cluster: ClusterConfig): Promise<Entity[]> {
    const api = this.makeApi(cluster);
    const { group, version } = this.config.crd;
    const exclude = new Set(this.config.excludeNamespaces ?? []);
    const opts = {
      clusterName: cluster.name,
      defaultOwner: this.config.defaultOwner,
    };

    const entities: Entity[] = [];

    // --- Agents ---
    const agentList = (await api.listCustomObjectForAllNamespaces({
      group,
      version,
      plural: 'agents',
    })) as { items?: KagentAgent[] };

    for (const agent of agentList.items ?? []) {
      if (exclude.has(agent.metadata?.namespace ?? '')) continue;
      try {
        entities.push(...kagentAgentToEntities(agent, opts));
      } catch (e) {
        this.logger.warn(
          `agent-catalog: skipping agent ${agent.metadata?.namespace}/${agent.metadata?.name}: ${e}`,
        );
      }
    }

    // --- ModelConfigs ---
    try {
      const mcList = (await api.listCustomObjectForAllNamespaces({
        group,
        version,
        plural: 'modelconfigs',
      })) as { items?: KagentModelConfig[] };

      for (const mc of mcList.items ?? []) {
        if (exclude.has(mc.metadata?.namespace ?? '')) continue;
        entities.push(modelConfigToEntity(mc, opts));
      }
    } catch (e) {
      // ModelConfigs are enrichment, not essential — log and continue.
      this.logger.warn(
        `agent-catalog: could not list modelconfigs on ${cluster.name}: ${e}`,
      );
    }

    return entities;
  }
}
