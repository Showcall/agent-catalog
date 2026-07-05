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

    cache.recordSuccess('prod-east', [entity('old-east')]);
    cache.recordSuccess('prod-west', [entity('old-west')]);
    cache.recordSuccess('prod-west', [entity('new-west')]);

    expect(cache.entities()).toEqual([
      entity('old-east'),
      entity('new-west'),
    ]);
  });

  it('clears a cluster only after a successful empty refresh', () => {
    const cache = new ClusterEntityCache();

    cache.recordSuccess('prod-east', [entity('old-east')]);
    cache.recordSuccess('prod-east', []);

    expect(cache.entities()).toEqual([]);
  });
});
