/**
 * KagentEntityProvider
 *
 * Scheduled entity provider: lists kagent Agent + ModelConfig CRDs from each
 * configured cluster and applies a FULL mutation to the catalog. Full
 * mutation = the catalog converges to exactly what exists in the clusters;
 * deleted CRDs disappear from Backstage on the next sync. Simple and
 * self-healing — the right MVP choice over watch streams.
 *
 * On top of the pure CRD transform it runs a live A2A-card enrichment pass
 * (docs/adr/0001): each agent's /.well-known/agent.json is fetched through the
 * kube API-server service proxy and overlaid on its entities, fail-soft.
 *
 * NOTE on @kubernetes/client-node: the 1.x client uses object-style params
 * (used below). If you're on 0.x, the calls take positional args — see
 * README "Kubernetes client version" section.
 */

import { CustomObjectsApi } from '@kubernetes/client-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import {
  kagentAgentToEntities,
  modelConfigToEntity,
  type A2ACard,
} from './transforms';
import { enrichAgentEntities, type CardFetch } from './enrichment';
import { KubeProxyCardFetcher, type CardFetcher } from './cardFetcher';
import { ClusterScanningProvider } from './ClusterScanningProvider';
import type { UsageService } from './UsageService';
import type {
  AgentCatalogConfig,
  ClusterConfig,
  KagentAgent,
  KagentModelConfig,
} from './types';

export class KagentEntityProvider extends ClusterScanningProvider {
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
    return 'kagent-entity-provider';
  }

  /** Resolve an agent's card: live fetch, else last-known (stale), else none. */
  private async resolveCard(
    fetcher: CardFetcher,
    clusterName: string,
    agent: KagentAgent,
  ): Promise<CardFetch> {
    const ns = agent.metadata?.namespace ?? 'default';
    const name = agent.metadata?.name ?? '';
    const key = `${clusterName}/${ns}/${name}`;
    const card = name ? await fetcher.fetch(ns, name) : null;
    if (card) {
      this.cardCache.set(key, { card, fetchedAt: Date.now() });
      return { card, source: 'live' };
    }
    const cached = this.cardCache.get(key);
    if (cached) return { card: cached.card, source: 'stale' };
    return { card: null, source: 'unreachable' };
  }

  protected async collectCluster(cluster: ClusterConfig): Promise<Entity[]> {
    const kc = this.makeKubeConfig(cluster);
    const api = kc.makeApiClient(CustomObjectsApi);
    const { group, version } = this.config.crd;
    const exclude = new Set(this.config.excludeNamespaces ?? []);
    const opts = {
      clusterName: cluster.name,
      defaultOwner: this.config.defaultOwner,
    };
    const ce = this.config.cardEnrichment;
    const fetcher: CardFetcher | undefined = ce.enabled
      ? new KubeProxyCardFetcher(kc, {
          port: ce.port,
          paths: ce.paths,
          timeoutMs: ce.timeoutMs,
        })
      : undefined;

    const entities: Entity[] = [];

    // --- Agents ---
    const agentList = (await api.listCustomObjectForAllNamespaces({
      group,
      version,
      plural: 'agents',
    })) as { items?: KagentAgent[] };

    const agents = (agentList.items ?? []).filter(
      a => !exclude.has(a.metadata?.namespace ?? ''),
    );

    // Fetch all cards concurrently; each fetch is individually timed out, so
    // one slow/hung agent can't stall the refresh. (Bounded concurrency is a
    // future refinement — see the ADR.)
    const cardResults = fetcher
      ? await Promise.all(
          agents.map(a => this.resolveCard(fetcher, cluster.name, a)),
        )
      : undefined;

    let live = 0;
    let stale = 0;
    let unreachable = 0;
    const seenIds: string[] = [];
    agents.forEach((agent, i) => {
      try {
        seenIds.push(
          `${agent.metadata?.namespace ?? 'default'}/${agent.metadata?.name}`,
        );
        let built = kagentAgentToEntities(agent, opts);
        if (cardResults) {
          const fetched = cardResults[i];
          if (fetched.source === 'live') live++;
          else if (fetched.source === 'stale') stale++;
          else unreachable++;
          built = enrichAgentEntities(agent, built, fetched, opts);
        }
        // Per-agent traction annotations for alias-matched consumers
        // (ADR 0008); no-op when usage is disabled or unmatched.
        entities.push(...built.map(e => this.usage?.decorate(e) ?? e));
      } catch (e) {
        this.logger.warn(
          `agent-catalog: skipping agent ${agent.metadata?.namespace}/${agent.metadata?.name}: ${e}`,
        );
      }
    });
    this.usage?.reportSeenAgents(
      `${this.getProviderName()}/${cluster.name}`,
      seenIds,
    );

    if (fetcher) {
      this.logger.info(
        `agent-catalog: cards on ${cluster.name} — live=${live} stale=${stale} unreachable=${unreachable}`,
      );
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

    this.logger.info(
      `agent-catalog: ${entities.length} entities from cluster ${cluster.name}`,
    );
    return entities;
  }
}
