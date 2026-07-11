/**
 * SweepDiscoveryProvider (ADR 0007) — the audit sweep.
 *
 * Tier A ([ADR 0006](../../docs/adr/0006-a2a-label-discovery.md)) answers
 * "will teams register their agents?"; the sweep answers the one governance
 * loses sleep over: *"what's running that nobody registered?"* — the shadow
 * agents.
 *
 * It lists every Service on a cluster and, after skipping the ones that are
 * already someone else's job (labeled `a2a=true` → Tier A; owned by a runtime
 * CR → that provider; suppressed `a2a=false` → confirmed not-an-agent), probes
 * the rest for a live A2A card: GET-only, well-known paths, each Service's
 * *declared* ports (capped), through the kube-apiserver proxy. A valid card
 * becomes a catalog entity marked `discovery: probe`; **an unlabeled Service
 * with no card is silence, not a finding** — that asymmetry keeps the signal
 * at exactly "agents nobody registered".
 *
 * Off by default; own provider, own locationKey (`a2a-sweep-provider`) so its
 * full mutation and the label provider's never clobber each other (ADR 0003).
 *
 * Note for operators: this is a port-probing workload. Tell your security team
 * before enabling — all probes route through the API server, attributable to
 * Backstage's ServiceAccount in the audit log.
 */

import { CoreV1Api } from '@kubernetes/client-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import { ANNOTATION_PREFIX } from './transforms';
import { enrichAgentEntities } from './enrichment';
import { KubeProxyCardFetcher } from './cardFetcher';
import { ClusterScanningProvider } from './ClusterScanningProvider';
import {
  SWEEP_LOCATION_SCHEME,
  discoveredCardPaths,
  discoveredCardPort,
  discoveredServiceToComponent,
  isClaimed,
  pseudoAgentFor,
} from './discovery';
import type { AgentCatalogConfig, ClusterConfig, DiscoveredService } from './types';
import type { UsageService } from './UsageService';

const A2A_LABEL = `${ANNOTATION_PREFIX}/a2a`;

export class SweepDiscoveryProvider extends ClusterScanningProvider {
  constructor(
    config: AgentCatalogConfig,
    logger: LoggerService,
    /** Optional gateway-usage integration (ADR 0008). */
    private readonly usage?: UsageService,
  ) {
    super(config, logger);
  }

  getProviderName(): string {
    return 'a2a-sweep-provider';
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

  /**
   * Ports to probe: the annotation/first-port choice first, then the remaining
   * declared ports, de-duplicated and capped. Declared ports only — never a
   * range or a guess (ADR 0007: "well-known paths on declared ports only").
   */
  private candidatePorts(svc: DiscoveredService, maxPorts: number): number[] {
    const declared = (svc.spec?.ports ?? [])
      .map(p => p.port)
      .filter((p): p is number => typeof p === 'number');
    const ordered = [discoveredCardPort(svc), ...declared];
    return [...new Set(ordered)].slice(0, Math.max(1, maxPorts));
  }

  protected async collectCluster(cluster: ClusterConfig): Promise<Entity[]> {
    const kc = this.makeKubeConfig(cluster);
    const core = kc.makeApiClient(CoreV1Api);
    const cfg = this.config.sweep;
    const exclude = new Set([
      ...(this.config.excludeNamespaces ?? []),
      ...(cfg.namespaceDenylist ?? []),
    ]);
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

    // No label selector: the sweep looks at everything, then filters.
    const list = (await core.listServiceForAllNamespaces()) as {
      items?: DiscoveredService[];
    };
    const services = (list.items ?? []).filter(
      s => !exclude.has(s.metadata?.namespace ?? ''),
    );

    const entities: Entity[] = [];
    const seenIds: string[] = [];
    let probed = 0;
    let skippedLabeled = 0;
    let skippedClaimed = 0;
    let suppressed = 0;
    let silent = 0;

    for (const svc of services) {
      const ns = svc.metadata?.namespace ?? 'default';
      const name = svc.metadata?.name ?? '';
      if (!name) continue;

      const label = svc.metadata?.labels?.[A2A_LABEL];
      if (label === 'true') {
        skippedLabeled++; // Tier A's job (ADR 0006)
        continue;
      }
      if (label === 'false') {
        suppressed++; // confirmed not-an-agent (ADR 0007 §5)
        continue;
      }
      if (isClaimed(svc, this.config.a2aDiscovery.claimedBy)) {
        skippedClaimed++; // owned by a runtime CR — that provider's job
        continue;
      }

      try {
        const paths = discoveredCardPaths(svc);
        let card = null;
        for (const port of this.candidatePorts(svc, cfg.maxPorts)) {
          card = await fetcher.fetch(ns, name, { port, paths });
          if (card) break;
        }
        if (!card) {
          silent++; // unlabeled + cardless = just a web service, not a finding
          continue;
        }

        const ready = await this.endpointsReady(core, ns, name);
        const component = discoveredServiceToComponent(svc, ready, opts, 'probe');
        const built = enrichAgentEntities(
          pseudoAgentFor(svc, ready),
          [component],
          { card, source: 'live' },
          opts,
          SWEEP_LOCATION_SCHEME,
        );
        seenIds.push(`${ns}/${name}`);
        entities.push(...built.map(e => this.usage?.decorate(e) ?? e));
        probed++;
      } catch (e) {
        this.logger.warn(`a2a-sweep: skipping ${ns}/${name}: ${e}`);
      }
    }
    this.usage?.reportSeenAgents(
      `${this.getProviderName()}/${cluster.name}`,
      seenIds,
    );

    this.logger.info(
      `a2a-sweep: ${cluster.name} — probed-found=${probed} labeled-skipped=${skippedLabeled} claimed-skipped=${skippedClaimed} suppressed=${suppressed} no-card=${silent}`,
    );
    return entities;
  }
}
