/**
 * Render tests for AgentInfoCard: it's pure presentation over
 * agentcatalog.io/* annotations, so we render it in a test app with an entity
 * and assert the chips/stats/hints it derives.
 */

import { renderInTestApp } from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { screen } from '@testing-library/react';
import type { Entity } from '@backstage/catalog-model';
import { AgentInfoCard } from './AgentInfoCard';

function agentEntity(annotations: Record<string, string>): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'triage', title: 'Incident Triage', annotations },
    spec: { type: 'ai-agent', owner: 'group:default/sre' },
  } as Entity;
}

async function renderCard(entity: Entity) {
  await renderInTestApp(
    <EntityProvider entity={entity}>
      <AgentInfoCard />
    </EntityProvider>,
  );
}

describe('AgentInfoCard', () => {
  it('shows runtime, status chips, and traction for a live agent with usage', async () => {
    await renderCard(
      agentEntity({
        'agentcatalog.io/cluster': 'prod-west',
        'agentcatalog.io/runtime': 'kagent',
        'agentcatalog.io/discovery': 'crd',
        'agentcatalog.io/reachable': 'true',
        'agentcatalog.io/source-status': 'available',
        'agentcatalog.io/last-observed-at': '2026-07-11T12:00:00.000Z',
        'agentcatalog.io/card-source': 'live',
        'agentcatalog.io/interface-status': 'in-sync',
        'agentcatalog.io/usage-requests': '128',
        'agentcatalog.io/usage-window': '7d',
      }),
    );

    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('runtime: kagent')).toBeInTheDocument();
    expect(screen.getByText('cluster: prod-west')).toBeInTheDocument();
    expect(screen.getByText('discovery: crd')).toBeInTheDocument();
    expect(screen.getByText('reachable')).toBeInTheDocument();
    expect(screen.getByText('source: online')).toBeInTheDocument();
    expect(screen.getByText('card: live')).toBeInTheDocument();
    expect(screen.getByText('interface: in sync')).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
  });

  it('separates an unavailable source from an unreachable agent', async () => {
    await renderCard(
      agentEntity({
        'agentcatalog.io/reachable': 'true',
        'agentcatalog.io/source-status': 'unavailable',
        'agentcatalog.io/source-last-success-at': '2026-07-11T12:00:00.000Z',
      }),
    );

    expect(screen.getByText('reachable')).toBeInTheDocument();
    expect(screen.getByText('source: offline')).toBeInTheDocument();
    expect(screen.getByText(/Source is currently unavailable/)).toBeInTheDocument();
  });

  it('shows declared-to-live interface drift when the backend reports it', async () => {
    await renderCard(
      agentEntity({
        'agentcatalog.io/interface-status': 'drift',
        'agentcatalog.io/interface-drift': 'declared only: triage; live only: do-thing',
      }),
    );

    expect(screen.getByText('interface: drift')).toBeInTheDocument();
    expect(screen.getByText(/Declared interface differs from the live card/)).toBeInTheDocument();
    expect(screen.getByText('declared only: triage; live only: do-thing')).toBeInTheDocument();
  });

  it('frames a heuristic finding differently and explains why it was flagged', async () => {
    await renderCard(
      agentEntity({
        'agentcatalog.io/discovery': 'heuristic',
        'agentcatalog.io/heuristic-signals': 'env:OPENAI_API_KEY',
      }),
    );

    expect(
      screen.getByText('LLM workload (heuristic finding)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Flagged because/)).toBeInTheDocument();
    expect(screen.getByText('env:OPENAI_API_KEY')).toBeInTheDocument();
  });

  it('nudges the user to issue a key alias when there is no per-agent usage', async () => {
    await renderCard(
      agentEntity({
        'agentcatalog.io/runtime': 'kagent',
        'agentcatalog.io/discovery': 'crd',
      }),
    );

    expect(screen.getByText(/No per-agent usage/)).toBeInTheDocument();
  });
});
