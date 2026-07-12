/**
 * A2ADiscoveryProvider (ADR 0006)
 *
 * Runtime-agnostic agent discovery: lists Services carrying the opt-in
 * label (default `agentcatalog.io/a2a=true`) on each configured cluster,
 * skips Services claimed by known runtime CRs (their CRD provider owns
 * them, with a richer governance plane), and catalogs the rest — Component
 * from Service metadata, API from the live card via the shared rung-2
 * enrichment path.
 *
 * Own provider, own locationKey: its full mutations and the kagent
 * provider's cannot clobber each other (ADR 0003).
 */

import { CoreV1Api } from '@kubernetes/client-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import type { A2ACard } from './transforms';
import { enrichAgentEntities, type CardFetch } from './enrichment';
import { KubeProxyCardFetcher } from './cardFetcher';
import { ClusterScanningProvider } from './ClusterScanningProvider';
import {
  DISCOVERY_LOCATION_SCHEME,
  discoveredCardPaths,
  discoveredCardPort,
  discoveredServiceToComponent,
  isClaimed,
  pseudoAgentFor,
} from './discovery';
import type {
  AgentCatalogConfig,
  ClusterConfig,
  DiscoveredService,
} from './types';
import type { UsageService } from './UsageService';

export class A2ADiscoveryProvider extends ClusterScanningProvider {
  /** Fail-soft cache of last-known cards, keyed by cluster/ns/name. */
  private readonly cardCache = new Map<
    string,
    { card: A2ACard; fetchedAt: number }
  >();

  constructor(
    config: AgentCatalogConfig,
    logger: LoggerService,
    /** Optional gateway-usage integration (ADR 0008). */
    private readonly usage?: UsageService,
  ) {
    super(config, logger);
  }

  getProviderName(): string {
    return 'a2a-discovery-provider';
  }

  /** "Kubernetes says something is answering": any ready endpoint address. */
  private async endpointsReady(
    core: CoreV1Api,
    namespace: string,
    name: string,
  ): Promise<boolean> {
    try {
      const eps = (await core.readNamespacedEndpoints({ name, namespace })) as {
        subsets?: Array<{ addresses?: unknown[] }>;
      };
      return (eps.subsets ?? []).some(s => (s.addresses ?? []).length > 0);
    } catch {
      return false;
    }
  }

  protected async collectCluster(cluster: ClusterConfig): Promise<Entity[]> {
    const kc = this.makeKubeConfig(cluster);
    const core = kc.makeApiClient(CoreV1Api);
    const cfg = this.config.a2aDiscovery;
    const exclude = new Set(this.config.excludeNamespaces ?? []);
    const opts = {
      clusterName: cluster.name,
      defaultOwner: this.config.defaultOwner,
    };
    const ce = this.config.cardEnrichment;
    const fetcher = new KubeProxyCardFetcher(kc, {
      port: ce.port,
      paths: ce.paths,
      timeoutMs: ce.timeoutMs,
    });

    const list = (await core.listServiceForAllNamespaces({
      labelSelector: cfg.labelSelector,
    })) as { items?: DiscoveredService[] };

    const services = (list.items ?? []).filter(
      s => !exclude.has(s.metadata?.namespace ?? ''),
    );

    const entities: Entity[] = [];
    const seenIds: string[] = [];
    let discovered = 0;
    let claimed = 0;
    let unreachable = 0;

    for (const svc of services) {
      const ns = svc.metadata?.namespace ?? 'default';
      const name = svc.metadata?.name ?? '';
      if (!name) continue;

      if (isClaimed(svc, cfg.claimedBy)) {
        claimed++;
        continue;
      }

      try {
        const ready = await this.endpointsReady(core, ns, name);
        const component = discoveredServiceToComponent(svc, ready, opts);

        const key = `${cluster.name}/${ns}/${name}`;
        const card = await fetcher.fetch(ns, name, {
          port: discoveredCardPort(svc),
          paths: discoveredCardPaths(svc),
        });
        let fetched: CardFetch;
        if (card) {
          this.cardCache.set(key, { card, fetchedAt: Date.now() });
          fetched = { card, source: 'live' };
        } else {
          const cached = this.cardCache.get(key);
          fetched = cached
            ? { card: cached.card, source: 'stale' }
            : { card: null, source: 'unreachable' };
          unreachable++;
        }

        seenIds.push(`${ns}/${name}`);
        const built = enrichAgentEntities(
          pseudoAgentFor(svc, ready),
          [component],
          fetched,
          opts,
          DISCOVERY_LOCATION_SCHEME,
        );
        // Per-agent traction for alias-matched consumers (ADR 0008).
        entities.push(...built.map(e => this.usage?.decorate(e) ?? e));
        discovered++;
      } catch (e) {
        this.logger.warn(`a2a-discovery: skipping ${ns}/${name}: ${e}`);
      }
    }
    this.usage?.reportSeenAgents(
      `${this.getProviderName()}/${cluster.name}`,
      seenIds,
    );

    this.logger.info(
      `a2a-discovery: ${cluster.name} — discovered=${discovered} claimed-skipped=${claimed} unreachable=${unreachable}`,
    );
    return entities;
  }
}
