/**
 * UsageService + GatewayUsageProvider (ADR 0008).
 *
 * The service holds the current ledger snapshot (refreshed on its own,
 * slower schedule) and the set of agent ids the entity providers currently
 * see. Agent providers consult it during their refreshes to stamp
 * per-agent annotations; the GatewayUsageProvider emits the gateway
 * summary Resource (team rollups + unattributed consumers) under its own
 * locationKey.
 *
 * Fail-soft like the card fetch: ledger unreachable -> keep the last
 * snapshot, mark it stale.
 */

import type {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import type { UsageSource } from './litellmUsageSource';
import {
  applyUsageAnnotations,
  gatewayResourceEntity,
  usageForEntity,
  type UsageSnapshot,
} from './usage';
import type { TransformOptions } from './transforms';

export class UsageService {
  private snapshot?: UsageSnapshot;
  /** Seen agent ids per reporting provider — unioned in `seen`. */
  private seenByReporter = new Map<string, Set<string>>();

  constructor(
    private readonly source: UsageSource,
    private readonly includeCost: boolean,
    private readonly logger: LoggerService,
  ) {}

  async refresh(): Promise<void> {
    const s = await this.source.fetch();
    if (s) {
      this.snapshot = s;
      this.logger.info(
        `gateway-usage: snapshot — ${s.consumers.length} consumers over ${s.windowDays}d`,
      );
    } else if (this.snapshot) {
      this.snapshot = { ...this.snapshot, stale: true };
      this.logger.warn('gateway-usage: ledger unreachable — serving stale snapshot');
    } else {
      this.logger.warn('gateway-usage: ledger unreachable — no snapshot yet');
    }
  }

  get current(): UsageSnapshot | undefined {
    return this.snapshot;
  }

  /** Agent providers report the `<ns>/<name>` handles they currently see. */
  reportSeenAgents(reporter: string, ids: Iterable<string>): void {
    this.seenByReporter.set(reporter, new Set(ids));
  }

  get seen(): Set<string> {
    const union = new Set<string>();
    for (const ids of this.seenByReporter.values()) {
      for (const id of ids) union.add(id);
    }
    return union;
  }

  /**
   * Stamp per-agent usage onto an alias-matched Component; no-op for
   * everything else (team totals are never smeared across agents).
   */
  decorate(entity: Entity): Entity {
    if (!this.snapshot || entity.kind !== 'Component') return entity;
    const usage = usageForEntity(entity, this.snapshot);
    if (!usage) return entity;
    return applyUsageAnnotations(entity, usage, this.snapshot, this.includeCost);
  }
}

export class GatewayUsageProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly service: UsageService,
    private readonly includeCost: boolean,
    private readonly opts: TransformOptions,
    private readonly logger: LoggerService,
  ) {}

  getProviderName(): string {
    return 'gateway-usage-provider';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
  }

  async refresh(): Promise<void> {
    if (!this.connection) {
      throw new Error('GatewayUsageProvider not connected to the catalog');
    }
    const snapshot = this.service.current;
    const entities = snapshot
      ? [
          gatewayResourceEntity(
            snapshot,
            this.service.seen,
            this.opts,
            this.includeCost,
          ),
        ]
      : [];
    if (snapshot) {
      const gw = entities[0].spec as {
        gateway?: { teams?: unknown[]; unattributed?: unknown[] };
      };
      this.logger.info(
        `gateway-usage: resource — teams=${gw.gateway?.teams?.length ?? 0} unattributed=${gw.gateway?.unattributed?.length ?? 0}`,
      );
    }
    await this.connection.applyMutation({
      type: 'full',
      entities: entities.map(entity => ({
        entity,
        locationKey: this.getProviderName(),
      })),
    });
  }
}
