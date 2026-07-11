import type { Entity } from '@backstage/catalog-model';
import { ClusterEntityCache } from './clusterEntityCache';

function entity(name: string): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name },
    spec: { type: 'service', lifecycle: 'production', owner: 'group:default/platform' },
  };
}

describe('ClusterEntityCache', () => {
  it('retains a cluster snapshot until a later successful refresh replaces it', () => {
    const cache = new ClusterEntityCache();

    cache.recordSuccess('prod-east', [entity('old-east')], '2026-07-11T12:00:00.000Z');
    cache.recordSuccess('prod-west', [entity('old-west')], '2026-07-11T12:00:00.000Z');
    cache.recordSuccess('prod-west', [entity('new-west')], '2026-07-11T12:05:00.000Z');

    expect(cache.entities().map(e => e.metadata.name)).toEqual(['old-east', 'new-west']);
    expect(cache.entities()[0].metadata.annotations).toMatchObject({
      'agentcatalog.io/last-observed-at': '2026-07-11T12:00:00.000Z',
      'agentcatalog.io/source-status': 'available',
    });
  });

  it('clears a cluster only after a successful empty refresh', () => {
    const cache = new ClusterEntityCache();

    cache.recordSuccess('prod-east', [entity('old-east')], '2026-07-11T12:00:00.000Z');
    cache.recordSuccess('prod-east', [], '2026-07-11T12:05:00.000Z');

    expect(cache.entities()).toEqual([]);
  });

  it('marks a preserved snapshot unavailable after a failed scan', () => {
    const cache = new ClusterEntityCache();

    cache.recordSuccess('prod-east', [entity('triage')], '2026-07-11T12:00:00.000Z');
    cache.recordFailure('prod-east', '2026-07-11T12:05:00.000Z');

    expect(cache.entities()[0].metadata.annotations).toMatchObject({
      'agentcatalog.io/last-observed-at': '2026-07-11T12:00:00.000Z',
      'agentcatalog.io/source-status': 'unavailable',
      'agentcatalog.io/source-last-success-at': '2026-07-11T12:00:00.000Z',
      'agentcatalog.io/source-last-failure-at': '2026-07-11T12:05:00.000Z',
    });
  });
});
