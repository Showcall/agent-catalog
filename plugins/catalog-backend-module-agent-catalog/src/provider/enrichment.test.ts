import { kagentAgentToEntities } from './transforms';
import { enrichAgentEntities, type CardFetch } from './enrichment';
import type { KagentAgent } from './types';

const OPTS = { clusterName: 'prod-east', defaultOwner: 'group:default/platform-team' };

const declarativeAgent: KagentAgent = {
  metadata: { name: 'triage', namespace: 'ops' },
  spec: {
    type: 'Declarative',
    description: 'Triage agent',
    declarative: {
      modelConfig: 'anthropic-sonnet',
      a2aConfig: { skills: [{ id: 'triage', name: 'Triage' }] },
    },
  },
  status: { conditions: [{ type: 'Ready', status: 'True' }] },
};

// A BYO agent: the CRD transform emits only a Component (no a2aConfig).
const byoAgent: KagentAgent = {
  metadata: { name: 'custom-bot', namespace: 'team-x' },
  spec: { type: 'BYO', description: 'Bring-your-own container' },
  status: { conditions: [{ type: 'Ready', status: 'True' }] },
};

const liveCard = {
  name: 'custom_bot',
  description: 'A real live agent',
  protocolVersion: '0.3',
  capabilities: { streaming: true },
  skills: [{ id: 'do-thing', name: 'Do Thing' }],
};

const ann = (e: any, k: string) =>
  e.metadata.annotations?.[`agentcatalog.io/${k}`];

describe('enrichAgentEntities', () => {
  it('overlays the live card onto a declarative agent (replaces synthesized)', () => {
    const crd = kagentAgentToEntities(declarativeAgent, OPTS);
    const fetched: CardFetch = { card: liveCard, source: 'live' };

    const out = enrichAgentEntities(declarativeAgent, crd, fetched, OPTS);

    const component = out.find(e => e.kind === 'Component')!;
    const api = out.find(e => e.kind === 'API')!;
    expect(ann(component, 'card-source')).toBe('live');
    expect(ann(component, 'reachable')).toBe('true');
    expect(component.spec?.providesApis).toEqual(['triage-a2a-ops-prod-east']);

    const card = JSON.parse(String(api.spec?.definition));
    expect(card.protocolVersion).toBe('0.3'); // real card, not the synthesized one
    expect(ann(api, 'card-source')).toBe('live');
  });

  it('gives a BYO agent an API entity from its live card', () => {
    const crd = kagentAgentToEntities(byoAgent, OPTS);
    expect(crd).toHaveLength(1); // Component only, no CRD-side card

    const out = enrichAgentEntities(
      byoAgent,
      crd,
      { card: liveCard, source: 'live' },
      OPTS,
    );

    const component = out.find(e => e.kind === 'Component')!;
    const api = out.find(e => e.kind === 'API')!;
    expect(api).toBeDefined();
    expect(component.spec?.providesApis).toEqual([
      'custom-bot-a2a-team-x-prod-east',
    ]);
    expect(JSON.parse(String(api.spec?.definition)).skills[0].id).toBe('do-thing');
  });

  it('declarative unreachable -> keeps synthesized card, flagged not reachable', () => {
    const crd = kagentAgentToEntities(declarativeAgent, OPTS);
    const out = enrichAgentEntities(
      declarativeAgent,
      crd,
      { card: null, source: 'unreachable' },
      OPTS,
    );

    const component = out.find(e => e.kind === 'Component')!;
    const api = out.find(e => e.kind === 'API')!;
    expect(ann(component, 'reachable')).toBe('false');
    expect(ann(component, 'card-source')).toBe('synthesized');
    expect(api).toBeDefined(); // synthesized fallback retained
  });

  it('BYO unreachable -> no API entity, Component flagged not reachable', () => {
    const crd = kagentAgentToEntities(byoAgent, OPTS);
    const out = enrichAgentEntities(
      byoAgent,
      crd,
      { card: null, source: 'unreachable' },
      OPTS,
    );

    expect(out.filter(e => e.kind === 'API')).toHaveLength(0);
    const component = out.find(e => e.kind === 'Component')!;
    expect(ann(component, 'reachable')).toBe('false');
    expect(ann(component, 'card-source')).toBe('none');
  });

  it('stale card is applied but marked not reachable', () => {
    const crd = kagentAgentToEntities(declarativeAgent, OPTS);
    const out = enrichAgentEntities(
      declarativeAgent,
      crd,
      { card: liveCard, source: 'stale' },
      OPTS,
    );
    const component = out.find(e => e.kind === 'Component')!;
    const api = out.find(e => e.kind === 'API')!;
    expect(ann(component, 'card-source')).toBe('stale');
    expect(ann(component, 'reachable')).toBe('false');
    expect(ann(api, 'card-source')).toBe('stale');
  });
});
