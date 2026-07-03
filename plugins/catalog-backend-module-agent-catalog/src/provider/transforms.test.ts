import {
  kagentAgentToEntities,
  modelConfigToEntity,
  resolveOwner,
  sanitizeName,
  extractToolRefs,
} from './transforms';
import type { KagentAgent, KagentModelConfig } from './types';

const OPTS = { clusterName: 'prod-east', defaultOwner: 'group:default/platform-team' };

const fullAgent: KagentAgent = {
  apiVersion: 'kagent.dev/v1alpha2',
  kind: 'Agent',
  metadata: {
    name: 'incident-triage',
    namespace: 'ops',
    // Owner is an entity ref -> must be an annotation (invalid label value).
    annotations: { 'backstage.io/owner': 'group:default/sre' },
  },
  spec: {
    type: 'Declarative',
    description: 'Triage pages, correlate traces, draft runbooks',
    declarative: {
      systemMessage: 'You are an SRE triage agent...',
      modelConfig: 'anthropic-sonnet',
      tools: [
        { type: 'McpServer', mcpServer: { name: 'k8s-tools', toolNames: ['get_pods'] } },
        { type: 'McpServer', mcpServer: { name: 'grafana-tools' } },
        { type: 'Agent', agent: { name: 'rollback-agent' } },
      ],
      a2aConfig: {
        skills: [
          { id: 'triage', name: 'Triage alerts', description: 'Correlates and triages', tags: ['ops'] },
        ],
      },
    },
  },
  status: { conditions: [{ type: 'Ready', status: 'True' }] },
};

describe('sanitizeName', () => {
  it('lowercases and strips invalid chars', () => {
    expect(sanitizeName('My Agent (v2)!')).toBe('my-agent--v2');
  });
  it('caps at 63 chars', () => {
    expect(sanitizeName('x'.repeat(100))).toHaveLength(63);
  });
});

describe('resolveOwner', () => {
  it('prefers backstage.io/owner annotation', () => {
    expect(resolveOwner(fullAgent, 'group:default/fallback')).toBe('group:default/sre');
  });
  it('falls back to default', () => {
    expect(resolveOwner({ metadata: {} }, 'group:default/fallback')).toBe(
      'group:default/fallback',
    );
  });
});

describe('extractToolRefs', () => {
  it('collects tool servers and agent refs, deduped', () => {
    const { toolServers, agents } = extractToolRefs(fullAgent);
    expect(toolServers).toEqual(['k8s-tools', 'grafana-tools']);
    expect(agents).toEqual(['rollback-agent']);
  });
});

describe('kagentAgentToEntities', () => {
  it('emits a Component and an API for an a2a-enabled agent', () => {
    const entities = kagentAgentToEntities(fullAgent, OPTS);
    expect(entities).toHaveLength(2);

    const [component, api] = entities;
    expect(component.kind).toBe('Component');
    expect(component.spec?.type).toBe('ai-agent');
    expect(component.spec?.owner).toBe('group:default/sre');
    expect(component.spec?.lifecycle).toBe('production');
    expect(component.metadata.name).toBe('incident-triage-prod-east');
    expect(component.metadata.annotations?.['agentcatalog.io/cluster']).toBe('prod-east');
    expect(component.spec?.providesApis).toEqual(['incident-triage-a2a-prod-east']);
    expect(component.spec?.dependsOn).toEqual(
      expect.arrayContaining([
        'resource:default/anthropic-sonnet-prod-east',
        'resource:default/k8s-tools-prod-east',
        'component:default/rollback-agent-prod-east',
      ]),
    );

    expect(api.kind).toBe('API');
    expect(api.spec?.type).toBe('a2a');
    const card = JSON.parse(String(api.spec?.definition));
    expect(card.skills[0].id).toBe('triage');
  });

  it('survives a nearly-empty CRD without throwing', () => {
    const entities = kagentAgentToEntities({ metadata: { name: 'bare' } }, OPTS);
    expect(entities).toHaveLength(1);
    expect(entities[0].spec?.lifecycle).toBe('experimental');
    expect(entities[0].spec?.owner).toBe(OPTS.defaultOwner);
  });

  it('always sets managed-by-location annotations', () => {
    const [component] = kagentAgentToEntities(fullAgent, OPTS);
    expect(
      component.metadata.annotations?.['backstage.io/managed-by-location'],
    ).toBe('kagent://prod-east/ops/Agent/incident-triage');
  });
});

describe('modelConfigToEntity', () => {
  it('emits a Resource with provider/model annotations', () => {
    const mc: KagentModelConfig = {
      metadata: { name: 'anthropic-sonnet', namespace: 'kagent' },
      spec: { provider: 'Anthropic', model: 'claude-sonnet-4-5' },
    };
    const entity = modelConfigToEntity(mc, OPTS);
    expect(entity.kind).toBe('Resource');
    expect(entity.spec?.type).toBe('llm-model-config');
    expect(entity.metadata.annotations?.['agentcatalog.io/model']).toBe(
      'claude-sonnet-4-5',
    );
  });
});
