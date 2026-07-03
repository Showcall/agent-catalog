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
  it('collects tool servers and agent refs with namespaces, deduped', () => {
    const { toolServers, agents } = extractToolRefs(fullAgent);
    expect(toolServers).toEqual([{ name: 'k8s-tools' }, { name: 'grafana-tools' }]);
    expect(agents).toEqual([{ name: 'rollback-agent' }]);
  });

  it('keeps namespace-qualified refs distinct from bare ones', () => {
    const agent: KagentAgent = {
      spec: {
        declarative: {
          tools: [
            { type: 'McpServer', mcpServer: { name: 'tools', namespace: 'shared' } },
            { type: 'McpServer', mcpServer: { name: 'tools' } },
          ],
        },
      },
    };
    expect(extractToolRefs(agent).toolServers).toEqual([
      { name: 'tools', namespace: 'shared' },
      { name: 'tools' },
    ]);
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
    // Names carry k8s namespace + cluster — see docs/adr/0005-entity-naming.md
    expect(component.metadata.name).toBe('incident-triage-ops-prod-east');
    expect(component.metadata.annotations?.['agentcatalog.io/cluster']).toBe('prod-east');
    expect(component.spec?.providesApis).toEqual(['incident-triage-a2a-ops-prod-east']);
    expect(component.spec?.dependsOn).toEqual(
      expect.arrayContaining([
        // bare refs resolve in the agent's namespace (ops)
        'resource:default/anthropic-sonnet-ops-prod-east',
        'resource:default/k8s-tools-ops-prod-east',
        'component:default/rollback-agent-ops-prod-east',
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

  it('same agent name in different namespaces yields distinct entities (ADR 0005)', () => {
    const a = kagentAgentToEntities(
      { metadata: { name: 'observability-agent', namespace: 'default' } },
      OPTS,
    );
    const b = kagentAgentToEntities(
      { metadata: { name: 'observability-agent', namespace: 'kagent' } },
      OPTS,
    );
    expect(a[0].metadata.name).toBe('observability-agent-default-prod-east');
    expect(b[0].metadata.name).toBe('observability-agent-kagent-prod-east');
    expect(a[0].metadata.name).not.toBe(b[0].metadata.name);
  });

  it('honors an explicitly namespace-qualified modelConfig ref', () => {
    const [component] = kagentAgentToEntities(
      {
        metadata: { name: 'x', namespace: 'ops' },
        spec: { declarative: { modelConfig: 'shared/big-model' } },
      },
      OPTS,
    );
    expect(component.spec?.dependsOn).toEqual([
      'resource:default/big-model-shared-prod-east',
    ]);
  });
});

describe('kagentAgentToEntities (BYO)', () => {
  const byoAgent: KagentAgent = {
    metadata: {
      name: 'custom-bot',
      namespace: 'team-x',
      annotations: { 'backstage.io/owner': 'group:default/team-x' },
    },
    spec: {
      type: 'BYO',
      description: 'Bring-your-own container agent',
      byo: {
        deployment: {
          image: 'ghcr.io/team-x/custom-bot:1.4.2',
          replicas: 2,
          env: [
            { name: 'OPENAI_API_KEY', valueFrom: { secretKeyRef: {} } },
            { name: 'LOG_LEVEL', value: 'debug' },
          ],
          resources: { requests: { cpu: '100m', memory: '256Mi' } },
        },
      },
    },
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
  };

  it('emits a Component only — interface plane comes from the live card', () => {
    const entities = kagentAgentToEntities(byoAgent, OPTS);
    expect(entities).toHaveLength(1);
    const [component] = entities;
    expect(component.kind).toBe('Component');
    expect(component.metadata.name).toBe('custom-bot-team-x-prod-east');
    expect(component.metadata.tags).toContain('byo');
    expect(
      component.metadata.annotations?.['agentcatalog.io/agent-type'],
    ).toBe('byo');
    expect(component.metadata.annotations?.['agentcatalog.io/image']).toBe(
      'ghcr.io/team-x/custom-bot:1.4.2',
    );
    expect(component.spec?.lifecycle).toBe('production');
    expect(component.spec?.owner).toBe('group:default/team-x');
  });

  it('projects env NAMES only — never values or valueFrom', () => {
    const [component] = kagentAgentToEntities(byoAgent, OPTS);
    const agentSpec = component.spec?.agent as Record<string, unknown>;
    expect(agentSpec.envNames).toEqual(['OPENAI_API_KEY', 'LOG_LEVEL']);
    const serialized = JSON.stringify(component);
    expect(serialized).not.toContain('debug'); // env value must not leak
    expect(serialized).not.toContain('secretKeyRef');
  });

  it('classifies by shape when spec.type is omitted', () => {
    const shapeOnly: KagentAgent = {
      metadata: { name: 'shape', namespace: 'x' },
      spec: { byo: { deployment: { image: 'img:1' } } },
    };
    const entities = kagentAgentToEntities(shapeOnly, OPTS);
    expect(
      entities[0].metadata.annotations?.['agentcatalog.io/agent-type'],
    ).toBe('byo');
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
