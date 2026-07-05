import {
  arkAgentToComponent,
  arkModelToResource,
  arkTeamToComponent,
} from './arkTransforms';
import type { ArkAgent, ArkModel, ArkTeam } from './types';

const OPTS = { clusterName: 'prod-east', defaultOwner: 'group:default/platform-team' };

const ann = (e: any, k: string) => e.metadata.annotations?.[`agentcatalog.io/${k}`];

describe('arkAgentToComponent', () => {
  const agent: ArkAgent = {
    metadata: {
      name: 'researcher',
      namespace: 'ml',
      annotations: { 'backstage.io/owner': 'group:default/ml-platform' },
    },
    spec: {
      description: 'Researches topics',
      prompt: 'You research.',
      modelRef: { name: 'claude-default', namespace: 'shared' },
      tools: [
        { name: 'writer', type: 'agent' },
        { name: 'search-tools', type: 'mcp' },
        { name: 'noop', type: 'built-in' },
      ],
    },
    status: { conditions: [{ type: 'Available', status: 'True' }] },
  };

  it('maps to an ai-agent Component with runtime ark and namespace-aware deps', () => {
    const c = arkAgentToComponent(agent, OPTS);
    expect(c.spec?.type).toBe('ai-agent');
    expect(ann(c, 'runtime')).toBe('ark');
    expect(ann(c, 'discovery')).toBe('crd');
    expect(c.metadata.name).toBe('researcher-ml-prod-east'); // ADR 0005
    expect(c.spec?.owner).toBe('group:default/ml-platform'); // ADR 0004 ladder
    expect(c.spec?.lifecycle).toBe('production'); // Available=True
    expect(c.spec?.dependsOn).toEqual([
      // modelRef carries an explicit namespace — honored
      'resource:default/claude-default-shared-prod-east',
      // agent-as-tool -> component; mcp tool -> resource; built-in -> none
      'component:default/writer-ml-prod-east',
      'resource:default/search-tools-ml-prod-east',
    ]);
    expect(c.metadata.annotations?.['backstage.io/managed-by-location']).toBe(
      'ark://prod-east/ml/Agent/researcher',
    );
  });

  it('survives a nearly-empty CRD', () => {
    const c = arkAgentToComponent({ metadata: { name: 'bare' } }, OPTS);
    expect(c.spec?.lifecycle).toBe('experimental');
    expect(c.spec?.owner).toBe(OPTS.defaultOwner);
  });
});

describe('arkTeamToComponent', () => {
  const team: ArkTeam = {
    metadata: { name: 'content-team', namespace: 'ml' },
    spec: {
      description: 'Research then write',
      strategy: 'sequential',
      members: [
        { name: 'researcher', type: 'agent' },
        { name: 'writer', type: 'agent' },
        { name: 'review-team', type: 'team' },
      ],
    },
  };

  it('maps to ai-agent-team with member dependency edges', () => {
    const c = arkTeamToComponent(team, OPTS);
    expect(c.spec?.type).toBe('ai-agent-team');
    expect(ann(c, 'team-strategy')).toBe('sequential');
    // members (agents AND nested teams) are Components either way
    expect(c.spec?.dependsOn).toEqual([
      'component:default/researcher-ml-prod-east',
      'component:default/writer-ml-prod-east',
      'component:default/review-team-ml-prod-east',
    ]);
    expect((c.spec as any).agent.members).toEqual([
      'researcher',
      'writer',
      'review-team',
    ]);
  });
});

describe('arkModelToResource', () => {
  it('maps to llm-model-config with provider/model annotations', () => {
    const model: ArkModel = {
      metadata: { name: 'claude-default', namespace: 'shared' },
      spec: {
        type: 'anthropic',
        provider: 'anthropic',
        model: { value: 'claude-sonnet-4-5' },
      },
    };
    const r = arkModelToResource(model, OPTS);
    expect(r.kind).toBe('Resource');
    expect(r.spec?.type).toBe('llm-model-config');
    expect(r.metadata.name).toBe('claude-default-shared-prod-east');
    expect(ann(r, 'provider')).toBe('anthropic');
    expect(ann(r, 'model')).toBe('claude-sonnet-4-5');
    expect(ann(r, 'runtime')).toBe('ark');
  });
});
