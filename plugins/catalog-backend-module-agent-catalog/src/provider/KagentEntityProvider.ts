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
  type A2ACard,
} from './transforms';
import { enrichAgentEntities, type CardFetch } from './enrichment';
import { KubeProxyCardFetcher, type CardFetcher } from './cardFetcher';
import type { UsageService } from './UsageService';
import type {
  AgentCatalogConfig,
  ClusterConfig,
  KagentAgent,
  KagentModelConfig,
} from './types';

export class KagentEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;
  /** Fail-soft cache of last-known cards, keyed by cluster/ns/name. */
  private readonly cardCache = new Map<
    string,
    { card: A2ACard; fetchedAt: number }
  >();

  constructor(
    private readonly config: AgentCatalogConfig,
    private readonly logger: LoggerService,
    /** Optional gateway-usage integration (ADR 0008). */
    private readonly usage?: UsageService,
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

  private makeClients(cluster: ClusterConfig): {
    custom: CustomObjectsApi;
    kc: KubeConfig;
  } {
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
    return { custom: kc.makeApiClient(CustomObjectsApi), kc };
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

  private async collectCluster(cluster: ClusterConfig): Promise<Entity[]> {
    const { custom: api, kc } = this.makeClients(cluster);
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

    return entities;
  }
}
