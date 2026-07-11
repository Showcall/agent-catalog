import type { Entity } from '@backstage/catalog-model';
import { computeHealth } from './health';

function agent(
  annotations: Record<string, string> = {},
  spec: Record<string, unknown> = {},
  name = 'a',
): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name, annotations },
    spec: { type: 'ai-agent', owner: 'group:default/sre', ...spec },
  } as Entity;
}

function gateway(unattributed: Array<{ alias: string }>): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: { name: 'litellm-gateway' },
    spec: { type: 'llm-gateway', gateway: { unattributed } },
  } as Entity;
}

const A = 'agentcatalog.io';

describe('computeHealth', () => {
  it('returns no findings for a clean, owned, reachable fleet', () => {
    const agents = [
      agent({ [`${A}/reachable`]: 'true', [`${A}/interface-status`]: 'in-sync' }),
    ];
    expect(computeHealth(agents, [])).toEqual([]);
  });

  it('flags an unreachable agent as critical', () => {
    const a = agent({ [`${A}/reachable`]: 'false' }, {}, 'triage');
    const findings = computeHealth([a], []);
    const f = findings.find(x => x.id === 'unreachable');
    expect(f).toMatchObject({ severity: 'critical', count: 1 });
    expect(f!.entities[0]).toBe(a);
  });

  it('flags a stale/source-unavailable agent', () => {
    const findings = computeHealth(
      [agent({ [`${A}/source-status`]: 'unavailable' })],
      [],
    );
    expect(findings.map(f => f.id)).toContain('source-unavailable');
  });

  it('flags interface drift', () => {
    const findings = computeHealth(
      [agent({ [`${A}/interface-status`]: 'drift' })],
      [],
    );
    expect(findings.find(f => f.id === 'interface-drift')?.severity).toBe(
      'warning',
    );
  });

  it('treats a missing owner and a default/unowned owner as unowned', () => {
    const noOwner = agent({}, { owner: undefined }, 'no-owner');
    const unowned = agent({}, { owner: 'group:default/unowned' }, 'catch-all');
    const owned = agent({}, { owner: 'group:default/sre' }, 'owned');
    const f = computeHealth([noOwner, unowned, owned], []).find(
      x => x.id === 'unowned',
    );
    expect(f?.count).toBe(2);
    expect(f?.entities).toEqual([noOwner, unowned]);
  });

  it('flags heuristic llm-workloads as unverified, not as no-traction', () => {
    const workload = agent(
      { [`${A}/discovery`]: 'heuristic', [`${A}/usage-requests`]: '0' },
      { type: 'llm-workload' },
      'sentiment-batch',
    );
    const findings = computeHealth([workload], []);
    expect(findings.map(f => f.id)).toContain('unverified-workload');
    expect(findings.map(f => f.id)).not.toContain('no-traction');
  });

  it('flags an attributed-but-idle agent as no-traction, but not one that is simply unattributed', () => {
    const idle = agent({ [`${A}/usage-requests`]: '0' }, {}, 'idle');
    const noAlias = agent({}, {}, 'no-alias'); // usage-requests absent
    const findings = computeHealth([idle, noAlias], []);
    const f = findings.find(x => x.id === 'no-traction');
    expect(f?.count).toBe(1);
    expect(f?.entities[0]).toBe(idle);
  });

  it('surfaces gateway consumers with no catalog identity as text subjects', () => {
    const findings = computeHealth(
      [],
      [gateway([{ alias: 'hackathon-bot' }, { alias: 'scratch-key' }])],
    );
    const f = findings.find(x => x.id === 'unattributed-usage');
    expect(f).toMatchObject({ severity: 'warning', count: 2 });
    expect(f!.subjects).toEqual(['hackathon-bot', 'scratch-key']);
    expect(f!.entities).toEqual([]);
  });

  it('orders findings critical → warning → info', () => {
    const agents = [
      agent({ [`${A}/reachable`]: 'false' }, {}, 'down'), // critical
      agent({ [`${A}/interface-status`]: 'drift' }, {}, 'drifted'), // warning
      agent(
        { [`${A}/discovery`]: 'heuristic' },
        { type: 'llm-workload' },
        'shadow',
      ), // info
    ];
    const severities = computeHealth(agents, []).map(f => f.severity);
    const rank = { critical: 0, warning: 1, info: 2 };
    const ranks = severities.map(s => rank[s]);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
  });
});
