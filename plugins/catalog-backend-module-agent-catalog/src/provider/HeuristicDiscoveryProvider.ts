/**
 * HeuristicDiscoveryProvider (ADR 0009): flags Deployments whose pod specs
 * advertise LLM consumption. Zero network calls to workloads — it reads
 * specs the kubeconfig can already list, which is why (unlike the probe
 * sweep) it's on by default.
 */

import { KubeConfig, AppsV1Api, CoreV1Api } from '@kubernetes/client-node';
import type {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import { isClaimed } from './discovery';
import {
  isSuppressed,
  matchWorkload,
  serviceSelectsWorkload,
  workloadToComponent,
} from './heuristics';
import type {
  AgentCatalogConfig,
  ClusterConfig,
  DiscoveredService,
  DiscoveredWorkload,
} from './types';
import type { UsageService } from './UsageService';

export class HeuristicDiscoveryProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly config: AgentCatalogConfig,
    private readonly logger: LoggerService,
    private readonly usage?: UsageService,
  ) {}

  getProviderName(): string {
    return 'heuristic-discovery-provider';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
  }

  async refresh(): Promise<void> {
    if (!this.connection) {
      throw new Error('HeuristicDiscoveryProvider not connected to the catalog');
    }
    const allEntities: Entity[] = [];
    for (const cluster of this.config.clusters) {
      try {
        allEntities.push(...(await this.collectCluster(cluster)));
      } catch (e) {
        this.logger.error(
          `heuristics: failed to scan cluster ${cluster.name}: ${e}`,
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

  private makeKubeConfig(cluster: ClusterConfig): KubeConfig {
    const kc = new KubeConfig();
    if (cluster.inCluster) kc.loadFromCluster();
    else if (cluster.kubeconfigPath) kc.loadFromFile(cluster.kubeconfigPath);
    else kc.loadFromDefault();
    if (cluster.context) kc.setCurrentContext(cluster.context);
    return kc;
  }

  private async collectCluster(cluster: ClusterConfig): Promise<Entity[]> {
    const kc = this.makeKubeConfig(cluster);
    const apps = kc.makeApiClient(AppsV1Api);
    const core = kc.makeApiClient(CoreV1Api);
    const exclude = new Set(this.config.excludeNamespaces ?? []);
    const opts = {
      clusterName: cluster.name,
      defaultOwner: this.config.defaultOwner,
    };

    const [deployList, labeledSvcList] = await Promise.all([
      apps.listDeploymentForAllNamespaces({}) as Promise<{
        items?: DiscoveredWorkload[];
      }>,
      core.listServiceForAllNamespaces({
        labelSelector: this.config.a2aDiscovery.labelSelector,
      }) as Promise<{ items?: DiscoveredService[] }>,
    ]);
    const labeledServices = labeledSvcList.items ?? [];

    const entities: Entity[] = [];
    const seenIds: string[] = [];
    let found = 0;
    let yielded = 0;

    for (const w of deployList.items ?? []) {
      const ns = w.metadata?.namespace ?? 'default';
      const name = w.metadata?.name ?? '';
      if (!name || exclude.has(ns)) continue;
      if (isSuppressed(w)) continue;

      // Yield to richer sources: runtime CRDs, then label discovery.
      if (
        isClaimed(w as DiscoveredService, this.config.a2aDiscovery.claimedBy) ||
        labeledServices.some(svc => serviceSelectsWorkload(svc, w))
      ) {
        yielded++;
        continue;
      }

      const signals = matchWorkload(w, this.config.heuristics);
      if (signals.length === 0) continue;

      seenIds.push(`${ns}/${name}`);
      const component = workloadToComponent(w, signals, opts);
      // Traction applies here too (ADR 0008): an alias-matched unregistered
      // script with heavy usage is exactly the flagship finding.
      entities.push(this.usage?.decorate(component) ?? component);
      found++;
    }
    this.usage?.reportSeenAgents(
      `${this.getProviderName()}/${cluster.name}`,
      seenIds,
    );

    this.logger.info(
      `heuristics: ${cluster.name} — flagged=${found} yielded-to-other-sources=${yielded}`,
    );
    return entities;
  }
}
