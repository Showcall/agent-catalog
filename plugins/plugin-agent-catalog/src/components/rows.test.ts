import type { Entity } from '@backstage/catalog-model';
import { toRow } from './rows';

function entity(
  annotations: Record<string, string> = {},
  spec: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {},
): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'triage', annotations, ...metadata },
    spec: { type: 'ai-agent', ...spec },
  } as Entity;
}

describe('toRow', () => {
  it('projects annotations and spec into a fleet row', () => {
    const row = toRow(
      entity(
        {
          'agentcatalog.io/cluster': 'prod-west',
          'agentcatalog.io/runtime': 'kagent',
          'agentcatalog.io/discovery': 'crd',
          'agentcatalog.io/reachable': 'true',
          'agentcatalog.io/source-status': 'available',
          'agentcatalog.io/interface-status': 'in-sync',
          'agentcatalog.io/last-observed-at': '2026-07-11T12:00:00.000Z',
          'agentcatalog.io/last-active': '2026-07-01',
          'agentcatalog.io/usage-requests': '128',
          'agentcatalog.io/usage-window': '7d',
        },
        { owner: 'group:default/sre', lifecycle: 'production' },
        { title: 'Incident Triage' },
      ),
    );

    expect(row).toMatchObject({
      name: 'Incident Triage',
      owner: 'group:default/sre',
      cluster: 'prod-west',
      runtime: 'kagent',
      discovery: 'crd',
      lifecycle: 'production',
      reachable: 'true',
      sourceStatus: 'available',
      interfaceStatus: 'in-sync',
      lastObservedAt: '2026-07-11T12:00:00.000Z',
      lastActive: '2026-07-01',
      requests: 128,
      window: '7d',
    });
  });

  it('falls back to metadata.name when title is absent', () => {
    expect(toRow(entity()).name).toBe('triage');
  });

  it('defaults every missing field to a placeholder', () => {
    const row = toRow(entity());
    expect(row).toMatchObject({
      owner: '—',
      cluster: '—',
      runtime: 'unknown',
      discovery: '—',
      lifecycle: '—',
      reachable: '—',
      sourceStatus: '—',
      interfaceStatus: '—',
      lastObservedAt: '—',
      lastActive: '—',
      window: '',
    });
  });

  it('parses usage-requests to a number, or leaves it undefined when absent', () => {
    expect(toRow(entity({ 'agentcatalog.io/usage-requests': '42' })).requests).toBe(42);
    expect(toRow(entity()).requests).toBeUndefined();
  });

  it('keeps a reference to the source entity for the table link', () => {
    const e = entity();
    expect(toRow(e).entity).toBe(e);
  });
});
