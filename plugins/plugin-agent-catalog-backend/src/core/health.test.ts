import { computeHealth } from './health';
import type { AgentSnapshot, GatewaySnapshot } from './snapshot';

/** A clean, owned, reachable, in-sync agent — override one field per case. */
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

function gateway(...aliases: string[]): GatewaySnapshot {
  return { unattributedAliases: aliases };
}

describe('computeHealth', () => {
  it('returns no findings for a clean, owned, reachable fleet', () => {
    expect(computeHealth([snap()], [])).toEqual([]);
  });

  it('flags an unreachable agent as critical', () => {
    const a = snap({ name: 'triage', reachable: false });
    const f = computeHealth([a], []).find(x => x.id === 'unreachable');
    expect(f).toMatchObject({ severity: 'critical', count: 1 });
    expect(f!.agentRefs[0]).toBe(a.ref);
  });

  it('flags a stale/source-unavailable agent', () => {
    const findings = computeHealth([snap({ sourceStatus: 'unavailable' })], []);
    expect(findings.map(f => f.id)).toContain('source-unavailable');
  });

  it('flags interface drift', () => {
    const findings = computeHealth([snap({ interfaceStatus: 'drift' })], []);
    expect(findings.find(f => f.id === 'interface-drift')?.severity).toBe(
      'warning',
    );
  });

  it('treats a missing owner and a default/unowned owner as unowned', () => {
    const noOwner = snap({ name: 'no-owner', owner: null });
    const unowned = snap({ name: 'catch-all', owner: 'group:default/unowned' });
    const owned = snap({ name: 'owned', owner: 'group:default/sre' });
    const f = computeHealth([noOwner, unowned, owned], []).find(
      x => x.id === 'unowned',
    );
    expect(f?.count).toBe(2);
    expect(f?.agentRefs).toEqual([noOwner.ref, unowned.ref]);
  });

  it('flags heuristic llm-workloads as unverified, not as no-traction', () => {
    const workload = snap({
      name: 'sentiment-batch',
      kind: 'workload',
      discovery: 'heuristic',
      usage: { requests: 0, tokens: null, costUsd: null, window: '7d' },
    });
    const findings = computeHealth([workload], []);
    expect(findings.map(f => f.id)).toContain('unverified-workload');
    expect(findings.map(f => f.id)).not.toContain('no-traction');
  });

  it('flags an attributed-but-idle agent as no-traction, but not one that is simply unattributed', () => {
    const idle = snap({
      name: 'idle',
      usage: { requests: 0, tokens: null, costUsd: null, window: '7d' },
    });
    const noAlias = snap({ name: 'no-alias' }); // usage.requests === null (absent)
    const f = computeHealth([idle, noAlias], []).find(x => x.id === 'no-traction');
    expect(f?.count).toBe(1);
    expect(f?.agentRefs[0]).toBe(idle.ref);
  });

  it('surfaces gateway consumers with no catalog identity as text subjects', () => {
    const f = computeHealth([], [gateway('hackathon-bot', 'scratch-key')]).find(
      x => x.id === 'unattributed-usage',
    );
    expect(f).toMatchObject({ severity: 'warning', count: 2 });
    expect(f!.subjects).toEqual(['hackathon-bot', 'scratch-key']);
    expect(f!.agentRefs).toEqual([]);
  });

  it('orders findings critical → warning → info', () => {
    const agents = [
      snap({ name: 'down', reachable: false }), // critical
      snap({ name: 'drifted', interfaceStatus: 'drift' }), // warning
      snap({ name: 'shadow', kind: 'workload', discovery: 'heuristic' }), // info
    ];
    const ranks = computeHealth(agents, []).map(
      f => ({ critical: 0, warning: 1, info: 2 })[f.severity],
    );
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
  });
});
