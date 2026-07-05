import type { Entity } from '@backstage/catalog-model';

/**
 * Per-provider, per-cluster snapshots for full mutations.
 *
 * A successful empty refresh means "this cluster currently has no entities"
 * and replaces the previous snapshot with empty. A failed refresh does not
 * touch the snapshot, so a transient cluster outage does not look like all
 * of that cluster's entities were deleted.
 */
export class ClusterEntityCache {
  private readonly byCluster = new Map<string, Entity[]>();

  recordSuccess(clusterName: string, entities: Entity[]): void {
    this.byCluster.set(clusterName, entities);
  }

  entities(): Entity[] {
    return [...this.byCluster.values()].flat();
  }
}
