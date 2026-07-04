import {
  agentUsageId,
  applyUsageAnnotations,
  bucketTokens,
  gatewayResourceEntity,
  usageForEntity,
  type UsageSnapshot,
} from './usage';
import { kagentAgentToEntities } from './transforms';

const OPTS = { clusterName: 'prod-east', defaultOwner: 'group:default/platform-team' };

const snapshot: UsageSnapshot = {
  source: 'litellm',
  windowDays: 7,
  fetchedAt: Date.now(),
  stale: false,
  consumers: [
    {
      alias: 'agents/release-notes-agent',
      teamId: 't1',
      teamAlias: 'platform-team',
      requests: 42,
      totalTokens: 123456,
      spend: 1.234,
      lastActive: '2026-07-04',
    },
    {
      alias: 'platform-team-shared',
      teamId: 't1',
      teamAlias: 'platform-team',
      requests: 900,
      totalTokens: 2_000_000,
      spend: 22.5,
      lastActive: '2026-07-04',
    },
    {
      alias: 'hackathon-bot',
      requests: 7,
      totalTokens: 999,
      spend: 0.01,
      lastActive: '2026-07-01',
    },
  ],
};

function agentEntity(name: string, ns: string) {
  return kagentAgentToEntities(
    { metadata: { name, namespace: ns }, spec: { type: 'Declarative' } },
    OPTS,
  )[0];
}

const ann = (e: any, k: string) => e.metadata.annotations?.[`agentcatalog.io/${k}`];

describe('matching ladder', () => {
  it('alias-matched agent gets per-agent usage', () => {
    const e = agentEntity('release-notes-agent', 'agents');
    expect(agentUsageId(e)).toBe('agents/release-notes-agent');
    const usage = usageForEntity(e, snapshot)!;
    expect(usage.requests).toBe(42);
  });

  it('agents in the same team but without an alias get NOTHING (no smearing)', () => {
    // Same owning team as the shared key, but no per-agent key alias.
    const e = agentEntity('observability-agent', 'default');
    expect(usageForEntity(e, snapshot)).toBeUndefined();
  });
});

describe('applyUsageAnnotations', () => {
  it('stamps requests/tokens/window/last-active; cost only when enabled', () => {
    const e = agentEntity('release-notes-agent', 'agents');
    const usage = usageForEntity(e, snapshot)!;

    applyUsageAnnotations(e, usage, snapshot, false);
    expect(ann(e, 'usage-requests')).toBe('42');
    expect(ann(e, 'usage-tokens')).toBe('123000'); // bucketed
    expect(ann(e, 'usage-window')).toBe('7d');
    expect(ann(e, 'last-active')).toBe('2026-07-04');
    expect(ann(e, 'usage-source')).toBe('litellm');
    expect(ann(e, 'usage-cost-usd')).toBeUndefined();

    applyUsageAnnotations(e, usage, snapshot, true);
    expect(ann(e, 'usage-cost-usd')).toBe('1.23');
  });

  it('marks the source stale when the snapshot is', () => {
    const e = agentEntity('release-notes-agent', 'agents');
    applyUsageAnnotations(
      e,
      usageForEntity(e, snapshot)!,
      { ...snapshot, stale: true },
      false,
    );
    expect(ann(e, 'usage-source')).toBe('litellm (stale)');
  });
});

describe('bucketTokens', () => {
  it('keeps small counts exact, buckets large ones to 3 significant figures', () => {
    expect(bucketTokens(78)).toBe(78);
    expect(bucketTokens(999)).toBe(999);
    expect(bucketTokens(123456)).toBe(123000);
    expect(bucketTokens(2_004_999)).toBe(2_000_000);
  });
});

describe('gatewayResourceEntity', () => {
  const seen = new Set(['agents/release-notes-agent', 'default/k8s-helper']);

  it('team rollups + unattributed list, matched consumers counted', () => {
    const r = gatewayResourceEntity(snapshot, seen, OPTS, false);
    expect(r.kind).toBe('Resource');
    expect(r.spec?.type).toBe('llm-gateway');
    expect(ann(r, 'consumers-total')).toBe('3');
    expect(ann(r, 'consumers-matched')).toBe('1');
    expect(ann(r, 'consumers-unattributed')).toBe('1');

    const gw = (r.spec as any).gateway;
    // team rollup includes ALL of the team's consumers (incl. aliased)
    const team = gw.teams.find((t: any) => t.team === 'platform-team');
    expect(team.requests).toBe(942);
    expect(team.costUsd).toBeUndefined(); // cost off
    // orphan key -> unattributed (the shadow signal)
    expect(gw.unattributed).toEqual([
      expect.objectContaining({ alias: 'hackathon-bot', requests: 7 }),
    ]);
  });

  it('cost appears in rollups only when enabled', () => {
    const r = gatewayResourceEntity(snapshot, seen, OPTS, true);
    const team = (r.spec as any).gateway.teams.find(
      (t: any) => t.team === 'platform-team',
    );
    expect(team.costUsd).toBeCloseTo(23.73, 2);
  });
});
