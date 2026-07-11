/**
 * Shared base for cluster-scanning entity providers (ADR 0010).
 *
 * Owns the refresh loop, the per-cluster snapshot cache (ADR 0003: a failed
 * scan preserves the cluster's last successful snapshot; a successful empty
 * scan clears it), kubeconfig handling, and the full mutation under the
 * subclass's locationKey. Subclasses implement one thing: collectCluster().
 */

import { KubeConfig } from '@kubernetes/client-node';
import type {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import { ClusterEntityCache } from './clusterEntityCache';
import type { AgentCatalogConfig, ClusterConfig } from './types';

export abstract class ClusterScanningProvider implements EntityProvider {
  private connection?: EntityProviderConnection;
  private readonly clusterCache = new ClusterEntityCache();

  constructor(
    protected readonly config: AgentCatalogConfig,
    protected readonly logger: LoggerService,
  ) {}

  abstract getProviderName(): string;

  /** Scan one cluster; throw to keep its previous snapshot (ADR 0003). */
  protected abstract collectCluster(cluster: ClusterConfig): Promise<Entity[]>;

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
  }

  async refresh(): Promise<void> {
    if (!this.connection) {
      throw new Error(`${this.getProviderName()} not connected to the catalog`);
    }

    for (const cluster of this.config.clusters) {
      try {
        const entities = await this.collectCluster(cluster);
        this.clusterCache.recordSuccess(cluster.name, entities);
      } catch (e) {
        this.clusterCache.recordFailure(cluster.name);
        this.logger.error(
          `${this.getProviderName()}: failed to scan cluster ${cluster.name}: ${e}`,
        );
      }
    }

    await this.connection.applyMutation({
      type: 'full',
      entities: this.clusterCache.entities().map(entity => ({
        entity,
        locationKey: this.getProviderName(),
      })),
    });
  }

  protected makeKubeConfig(cluster: ClusterConfig): KubeConfig {
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
    return kc;
  }
}
