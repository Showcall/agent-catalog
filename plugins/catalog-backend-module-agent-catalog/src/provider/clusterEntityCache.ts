import type { Entity } from '@backstage/catalog-model';

const A = 'agentcatalog.io';

interface ClusterSnapshot {
  entities: Entity[];
  lastSuccessAt: string;
}

function withLifecycleAnnotations(
  entity: Entity,
  annotations: Record<string, string>,
): Entity {
  return {
    ...entity,
    metadata: {
      ...entity.metadata,
      annotations: {
        ...(entity.metadata.annotations ?? {}),
        ...annotations,
      },
    },
  };
}

/**
 * Per-provider, per-cluster snapshots for full mutations.
 *
 * A successful empty refresh means "this cluster currently has no entities"
 * and replaces the previous snapshot with empty. A failed refresh does not
 * touch the snapshot, so a transient cluster outage does not look like all
 * of that cluster's entities were deleted.
 */
export class ClusterEntityCache {
  private readonly byCluster = new Map<string, ClusterSnapshot>();

  recordSuccess(
    clusterName: string,
    entities: Entity[],
    observedAt = new Date().toISOString(),
  ): void {
    this.byCluster.set(clusterName, {
      entities: entities.map(entity =>
        withLifecycleAnnotations(entity, {
          [`${A}/last-observed-at`]: observedAt,
          [`${A}/source-status`]: 'available',
          [`${A}/source-last-success-at`]: observedAt,
        }),
      ),
      lastSuccessAt: observedAt,
    });
  }

  /** Keep the last good snapshot visible, but make its source outage explicit. */
  recordFailure(
    clusterName: string,
    failedAt = new Date().toISOString(),
  ): void {
    const snapshot = this.byCluster.get(clusterName);
    if (!snapshot) return;

    snapshot.entities = snapshot.entities.map(entity =>
      withLifecycleAnnotations(entity, {
        [`${A}/source-status`]: 'unavailable',
        [`${A}/source-last-success-at`]: snapshot.lastSuccessAt,
        [`${A}/source-last-failure-at`]: failedAt,
      }),
    );
  }

  entities(): Entity[] {
    return [...this.byCluster.values()].flatMap(snapshot => snapshot.entities);
  }
}
