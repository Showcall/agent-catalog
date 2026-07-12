/**
 * Render tests for AgentInfoCardView: the card is presentation over the
 * backend's neutral AgentSnapshot, so these tests stay independent of the
 * catalog annotation wire format and API transport.
 */

import { renderInTestApp } from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import { screen } from '@testing-library/react';
import type { Entity } from '@backstage/catalog-model';
import type { AgentSnapshot } from '../api/fleetApi';
import { AgentInfoCard, AgentInfoCardView } from './AgentInfoCard';

const mockGetAgents = jest.fn();
jest.mock('../api/fleetApi', () => ({
  useFleetApi: () => ({ getAgents: mockGetAgents }),
}));

function agentSnapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    ref: 'component:default/triage',
    name: 'Incident Triage',
    kind: 'agent',
    owner: 'group:default/sre',
    cluster: null,
    namespace: 'default',
    runtime: null,
    discovery: 'crd',
    agentType: null,
    lifecycle: 'production',
    reachable: null,
    sourceStatus: null,
    sourceLastSuccessAt: null,
    interfaceStatus: null,
    interfaceDrift: null,
    lastObservedAt: null,
    lastActive: null,
    usage: { requests: null, tokens: null, costUsd: null, window: null },
    model: null,
    image: null,
    cardSource: null,
    heuristicSignals: null,
    ...overrides,
  };
}

async function renderCard(snapshot: AgentSnapshot) {
  await renderInTestApp(<AgentInfoCardView snapshot={snapshot} />);
}

async function renderConnectedCard(snapshot: AgentSnapshot) {
  const entity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'triage', namespace: 'default' },
    spec: { type: 'ai-agent', owner: 'group:default/sre' },
  } as Entity;
  mockGetAgents.mockResolvedValue([snapshot]);
  await renderInTestApp(
    <EntityProvider entity={entity}>
      <AgentInfoCard />
    </EntityProvider>,
  );
}

describe('AgentInfoCard', () => {
  it('loads the entity snapshot from the backend fleet API', async () => {
    await renderConnectedCard(
      agentSnapshot({ runtime: 'kagent', reachable: true }),
    );

    expect(await screen.findByText('runtime: kagent')).toBeInTheDocument();
    expect(mockGetAgents).toHaveBeenCalledTimes(1);
  });

  it('explains when the backend has no snapshot for the entity', async () => {
    mockGetAgents.mockResolvedValue([]);
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: 'triage', namespace: 'default' },
      spec: { type: 'ai-agent' },
    } as Entity;

    await renderInTestApp(
      <EntityProvider entity={entity}>
        <AgentInfoCard />
      </EntityProvider>,
    );

    expect(
      await screen.findByText(/No current agent snapshot is available/),
    ).toBeInTheDocument();
  });

  it('explains when the backend request fails', async () => {
    mockGetAgents.mockRejectedValue(new Error('backend unavailable'));
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: 'triage', namespace: 'default' },
      spec: { type: 'ai-agent' },
    } as Entity;

    await renderInTestApp(
      <EntityProvider entity={entity}>
        <AgentInfoCard />
      </EntityProvider>,
    );

    expect(
      await screen.findByText(/Agent status is temporarily unavailable/),
    ).toBeInTheDocument();
    expect(screen.getByText(/backend unavailable/)).toBeInTheDocument();
  });

  it('shows runtime, status chips, and traction for a live agent with usage', async () => {
    await renderCard(
      agentSnapshot({
        cluster: 'prod-west',
        runtime: 'kagent',
        discovery: 'crd',
        reachable: true,
        sourceStatus: 'available',
        lastObservedAt: '2026-07-11T12:00:00.000Z',
        cardSource: 'live',
        interfaceStatus: 'in-sync',
        usage: { requests: 128, tokens: null, costUsd: null, window: '7d' },
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
      agentSnapshot({
        reachable: true,
        sourceStatus: 'unavailable',
        sourceLastSuccessAt: '2026-07-11T12:00:00.000Z',
      }),
    );

    expect(screen.getByText('reachable')).toBeInTheDocument();
    expect(screen.getByText('source: offline')).toBeInTheDocument();
    expect(
      screen.getByText(/Source is currently unavailable/),
    ).toBeInTheDocument();
  });

  it('shows declared-to-live interface drift when the backend reports it', async () => {
    await renderCard(
      agentSnapshot({
        interfaceStatus: 'drift',
        interfaceDrift: 'declared only: triage; live only: do-thing',
      }),
    );

    expect(screen.getByText('interface: drift')).toBeInTheDocument();
    expect(
      screen.getByText(/Declared interface differs from the live card/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('declared only: triage; live only: do-thing'),
    ).toBeInTheDocument();
  });

  it('frames a heuristic finding differently and explains why it was flagged', async () => {
    await renderCard(
      agentSnapshot({
        kind: 'workload',
        discovery: 'heuristic',
        heuristicSignals: 'env:OPENAI_API_KEY',
      }),
    );

    expect(
      screen.getByText('LLM workload (heuristic finding)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Flagged because/)).toBeInTheDocument();
    expect(screen.getByText('env:OPENAI_API_KEY')).toBeInTheDocument();
  });

  it('nudges the user to issue a key alias when there is no per-agent usage', async () => {
    await renderCard(agentSnapshot({ runtime: 'kagent', discovery: 'crd' }));

    expect(screen.getByText(/No per-agent usage/)).toBeInTheDocument();
  });
});
