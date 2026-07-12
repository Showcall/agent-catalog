import type { Entity } from '@backstage/catalog-model';
import { entityToSnapshot, gatewayToSnapshot } from './snapshotFromEntity';
import { ANNOTATION_PREFIX as A } from './transforms';

function agent(
  annotations: Record<string, string> = {},
  spec: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {},
): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'foo', namespace: 'default', annotations, ...metadata },
    spec: { type: 'ai-agent', owner: 'group:default/sre', ...spec },
  } as Entity;
}

describe('entityToSnapshot', () => {
  it('reads the ref, display name, kind, and owner', () => {
    const s = entityToSnapshot(
      agent({}, { type: 'llm-workload' }, { title: 'Sentiment Batch' }),
    );
    expect(s.ref).toBe('component:default/foo');
    expect(s.name).toBe('Sentiment Batch');
    expect(s.kind).toBe('workload');
    expect(s.owner).toBe('group:default/sre');
  });

  it('maps ai-agent-team to team and a missing owner to null', () => {
    const s = entityToSnapshot(agent({}, { type: 'ai-agent-team', owner: undefined }));
    expect(s.kind).toBe('team');
    expect(s.owner).toBeNull();
  });

  it('coerces reachable to a boolean, absent to null', () => {
    expect(entityToSnapshot(agent({ [`${A}/reachable`]: 'true' })).reachable).toBe(true);
    expect(entityToSnapshot(agent({ [`${A}/reachable`]: 'false' })).reachable).toBe(false);
    expect(entityToSnapshot(agent()).reachable).toBeNull();
  });

  it('distinguishes zero requests from an absent alias', () => {
    expect(entityToSnapshot(agent({ [`${A}/usage-requests`]: '0' })).usage.requests).toBe(0);
    expect(entityToSnapshot(agent()).usage.requests).toBeNull();
  });

  it('carries the full annotation field set through', () => {
    const s = entityToSnapshot(
      agent({
        [`${A}/cluster`]: 'prod',
        [`${A}/namespace`]: 'team-a',
        [`${A}/runtime`]: 'kagent',
        [`${A}/discovery`]: 'probe',
        [`${A}/agent-type`]: 'byo',
        [`${A}/source-status`]: 'unavailable',
        [`${A}/interface-status`]: 'drift',
        [`${A}/interface-drift`]: 'skill x removed',
        [`${A}/last-active`]: '2026-07-10',
        [`${A}/usage-tokens`]: '1200',
        [`${A}/usage-window`]: '7d',
        [`${A}/model-config`]: 'default/gpt4',
        [`${A}/image`]: 'ghcr.io/acme/bot:1',
        [`${A}/card-source`]: 'live',
        [`${A}/heuristic-signals`]: 'OPENAI_API_KEY env',
      }),
    );
    expect(s).toMatchObject({
      cluster: 'prod',
      runtime: 'kagent',
      discovery: 'probe',
      agentType: 'byo',
      sourceStatus: 'unavailable',
      interfaceStatus: 'drift',
      interfaceDrift: 'skill x removed',
      lastActive: '2026-07-10',
      model: 'default/gpt4',
      image: 'ghcr.io/acme/bot:1',
      cardSource: 'live',
      heuristicSignals: 'OPENAI_API_KEY env',
    });
    expect(s.usage).toEqual({ requests: null, tokens: 1200, costUsd: null, window: '7d' });
  });

  it('falls back to crd discovery when unstamped', () => {
    expect(entityToSnapshot(agent()).discovery).toBe('crd');
  });
});

describe('gatewayToSnapshot', () => {
  it('extracts trimmed unattributed aliases, ignoring junk', () => {
    const gw = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: { name: 'litellm' },
      spec: {
        type: 'llm-gateway',
        gateway: { unattributed: [{ alias: ' hackathon-bot ' }, { alias: '' }, { nope: 1 }] },
      },
    } as Entity;
    expect(gatewayToSnapshot(gw).unattributedAliases).toEqual(['hackathon-bot']);
  });

  it('is empty when there is no unattributed list', () => {
    const gw = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: { name: 'litellm' },
      spec: { type: 'llm-gateway' },
    } as Entity;
    expect(gatewayToSnapshot(gw).unattributedAliases).toEqual([]);
  });
});
