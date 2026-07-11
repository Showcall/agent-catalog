import type { Entity } from '@backstage/catalog-model';
import type { AgentRow } from './rows';
import {
  computeFleetStats,
  isUnownedRow,
  filterRows,
  TILES,
} from './fleetView';

function row(partial: Partial<AgentRow>): AgentRow {
  return {
    entity: {} as Entity,
    name: 'a',
    owner: 'group:default/sre',
    cluster: 'prod',
    runtime: 'kagent',
    discovery: 'crd',
    lifecycle: 'production',
    reachable: 'true',
    sourceStatus: 'available',
    interfaceStatus: '—',
    lastObservedAt: '—',
    lastActive: '—',
    requests: undefined,
    window: '',
    ...partial,
  };
}

describe('isUnownedRow', () => {
  it('is true for placeholder / unowned owners, false for a real group', () => {
    expect(isUnownedRow(row({ owner: '—' }))).toBe(true);
    expect(isUnownedRow(row({ owner: 'group:default/unowned' }))).toBe(true);
    expect(isUnownedRow(row({ owner: 'group:default/sre' }))).toBe(false);
  });
});

describe('computeFleetStats', () => {
  it('counts agents, shadow, unreachable, unowned, and distinct known runtimes', () => {
    const rows = [
      row({ discovery: 'probe', runtime: 'unknown', owner: '—' }),
      row({ reachable: 'false', runtime: 'ark' }),
      row({ runtime: 'kagent' }),
      row({ runtime: 'kagent' }),
    ];
    expect(computeFleetStats(rows)).toEqual({
      agents: 4,
      shadow: 1,
      unreachable: 1,
      unowned: 1,
      runtimes: 2,
    });
  });

  it('is all zeros for an empty fleet', () => {
    expect(computeFleetStats([])).toEqual({
      agents: 0,
      shadow: 0,
      unreachable: 0,
      unowned: 0,
      runtimes: 0,
    });
  });
});

describe('tile filters', () => {
  const rows = [
    row({ name: 'shadow', discovery: 'probe' }),
    row({ name: 'down', reachable: 'false' }),
    row({ name: 'orphan', owner: '—' }),
    row({ name: 'healthy' }),
  ];
  const byId = (id: string) => TILES.find(t => t.id === id)!.filter!;

  it('shadow tile keeps only probe-discovered rows', () => {
    expect(filterRows(rows, { id: 'shadow', label: 'Shadow', match: byId('shadow') }).map(r => r.name)).toEqual(['shadow']);
  });
  it('unreachable tile keeps only reachable=false rows', () => {
    expect(filterRows(rows, { id: 'x', label: 'Unreachable', match: byId('unreachable') }).map(r => r.name)).toEqual(['down']);
  });
  it('unowned tile keeps only unowned rows', () => {
    expect(filterRows(rows, { id: 'x', label: 'Unowned', match: byId('unowned') }).map(r => r.name)).toEqual(['orphan']);
  });
  it('no filter returns everything', () => {
    expect(filterRows(rows, undefined)).toHaveLength(4);
  });
});
