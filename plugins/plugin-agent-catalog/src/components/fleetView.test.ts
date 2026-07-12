import type { AgentSnapshot } from '@showcall/backstage-plugin-agent-catalog-backend';
import { computeFleetStats, isUnowned, filterRows, TILES } from './fleetView';

function snap(partial: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    ref: `component:default/${partial.name ?? 'a'}`,
    name: 'a',
    kind: 'agent',
    owner: 'group:default/sre',
    cluster: 'prod',
    namespace: 'default',
    runtime: 'kagent',
    discovery: 'crd',
    agentType: 'declarative',
    lifecycle: 'production',
    reachable: true,
    sourceStatus: 'available',
    sourceLastSuccessAt: null,
    interfaceStatus: 'in-sync',
    interfaceDrift: null,
    lastObservedAt: null,
    lastActive: null,
    usage: { requests: null, tokens: null, costUsd: null, window: null },
    model: null,
    image: null,
    cardSource: null,
    heuristicSignals: null,
    ...partial,
  };
}

describe('isUnowned', () => {
  it('is true for placeholder / unowned owners, false for a real group', () => {
    expect(isUnowned(snap({ owner: null }))).toBe(true);
    expect(isUnowned(snap({ owner: 'group:default/unowned' }))).toBe(true);
    expect(isUnowned(snap({ owner: 'group:default/sre' }))).toBe(false);
  });
});

describe('computeFleetStats', () => {
  it('counts agents, shadow, unreachable, unowned, and distinct known runtimes', () => {
    const agents = [
      snap({ discovery: 'probe', runtime: null, owner: null }),
      snap({ reachable: false, runtime: 'ark' }),
      snap({ runtime: 'kagent' }),
      snap({ runtime: 'kagent' }),
    ];
    expect(computeFleetStats(agents)).toEqual({
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
  const agents = [
    snap({ name: 'shadow', discovery: 'probe' }),
    snap({ name: 'down', reachable: false }),
    snap({ name: 'orphan', owner: null }),
    snap({ name: 'healthy' }),
  ];
  const byId = (id: string) => TILES.find(t => t.id === id)!.filter!;

  it('shadow tile keeps only probe-discovered agents', () => {
    expect(
      filterRows(agents, { id: 'shadow', label: 'Shadow', match: byId('shadow') }).map(a => a.name),
    ).toEqual(['shadow']);
  });
  it('unreachable tile keeps only reachable=false agents', () => {
    expect(
      filterRows(agents, { id: 'x', label: 'Unreachable', match: byId('unreachable') }).map(a => a.name),
    ).toEqual(['down']);
  });
  it('unowned tile keeps only unowned agents', () => {
    expect(
      filterRows(agents, { id: 'x', label: 'Unowned', match: byId('unowned') }).map(a => a.name),
    ).toEqual(['orphan']);
  });
  it('no filter returns everything', () => {
    expect(filterRows(agents, undefined)).toHaveLength(4);
  });
});
