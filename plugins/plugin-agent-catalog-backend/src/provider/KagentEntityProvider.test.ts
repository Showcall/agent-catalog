/**
 * Provider-wiring tests for KagentEntityProvider: mock the Kubernetes client
 * and drive a full refresh(), asserting the CRD list -> transform -> full
 * mutation path (not the transforms themselves — those have their own tests).
 */

import type { EntityProviderConnection } from '@backstage/plugin-catalog-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';

// The mock defines the list fn inside the factory (avoids TDZ) and re-exports
// it so tests can program per-call responses. Every makeApiClient() hands back
// the same list fn, so agents + modelconfigs are two sequential calls to it.
jest.mock('@kubernetes/client-node', () => {
  const listCustomObjectForAllNamespaces = jest.fn();
  return {
    __listMock: listCustomObjectForAllNamespaces,
    CustomObjectsApi: class CustomObjectsApi {},
    CoreV1Api: class CoreV1Api {},
    KubeConfig: class KubeConfig {
      loadFromDefault() {}
      loadFromCluster() {}
      loadFromFile() {}
      setCurrentContext() {}
      makeApiClient() {
        return { listCustomObjectForAllNamespaces };
      }
    },
  };
});

import { KagentEntityProvider } from './KagentEntityProvider';
import type {
  AgentCatalogConfig,
  KagentAgent,
  KagentModelConfig,
} from './types';

const mockList = jest.requireMock('@kubernetes/client-node')
  .__listMock as jest.Mock;

function baseConfig(
  overrides: Partial<AgentCatalogConfig> = {},
): AgentCatalogConfig {
  return {
    clusters: [{ name: 'prod-east' }],
    defaultOwner: 'group:default/platform-team',
    excludeNamespaces: [],
    crd: { group: 'kagent.dev', version: 'v1alpha2' },
    schedule: { frequencyMinutes: 5, timeoutMinutes: 2 },
    // Card enrichment off: keeps the test on the CRD path (enrichment.ts and
    // cardFetcher.ts are covered separately) and needs no proxy client.
    cardEnrichment: { enabled: false, timeoutMs: 2000, port: 8080, paths: [] },
    a2aDiscovery: { enabled: true, labelSelector: 'x', claimedBy: [] },
    usage: {
      enabled: false,
      source: 'litellm',
      apiKeyEnv: 'X',
      windowDays: 7,
      includeCost: false,
      schedule: { frequencyMinutes: 60 },
    },
    heuristics: { enabled: true, envNamePatterns: [], imagePatterns: [] },
    sweep: { enabled: false, namespaceDenylist: [], maxPorts: 3 },
    ark: { enabled: true, group: 'ark.mckinsey.com', version: 'v1alpha1' },
    ...overrides,
  };
}

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
} as unknown as LoggerService;
(logger.child as jest.Mock).mockReturnValue(logger);

function makeConnection(): EntityProviderConnection {
  return {
    applyMutation: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
  } as unknown as EntityProviderConnection;
}

function agent(name: string, namespace = 'ops'): KagentAgent {
  return {
    apiVersion: 'kagent.dev/v1alpha2',
    kind: 'Agent',
    metadata: { name, namespace },
    spec: {
      type: 'Declarative',
      description: `${name} agent`,
      declarative: { modelConfig: 'demo-model' },
    },
  };
}

function modelConfig(name: string, namespace = 'ops'): KagentModelConfig {
  return {
    apiVersion: 'kagent.dev/v1alpha2',
    kind: 'ModelConfig',
    metadata: { name, namespace },
    spec: { provider: 'OpenAI', model: 'gpt-4o' },
  };
}

type DeferredEntity = { entity: Entity; locationKey: string };

function lastMutation(conn: EntityProviderConnection) {
  const calls = (conn.applyMutation as jest.Mock).mock.calls;
  return calls[calls.length - 1][0] as {
    type: string;
    entities: DeferredEntity[];
  };
}

const titles = (m: { entities: DeferredEntity[] }, kind: string) =>
  m.entities
    .filter(d => d.entity.kind === kind)
    .map(d => d.entity.metadata.title ?? d.entity.metadata.name);

beforeEach(() => {
  mockList.mockReset();
  jest.clearAllMocks();
  (logger.child as jest.Mock).mockReturnValue(logger);
});

describe('KagentEntityProvider', () => {
  it('lists agents then modelconfigs and emits them as one full mutation', async () => {
    mockList
      .mockResolvedValueOnce({ items: [agent('triage')] })
      .mockResolvedValueOnce({ items: [modelConfig('demo-model')] });

    const provider = new KagentEntityProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(mockList).toHaveBeenNthCalledWith(1, {
      group: 'kagent.dev',
      version: 'v1alpha2',
      plural: 'agents',
    });
    expect(mockList).toHaveBeenNthCalledWith(2, {
      group: 'kagent.dev',
      version: 'v1alpha2',
      plural: 'modelconfigs',
    });

    const mutation = lastMutation(conn);
    expect(mutation.type).toBe('full');
    expect(titles(mutation, 'Component')).toContain('triage');
    expect(mutation.entities.some(d => d.entity.kind === 'Resource')).toBe(true);
    // Every emitted entity is tagged with this provider's locationKey.
    expect(
      mutation.entities.every(d => d.locationKey === 'kagent-entity-provider'),
    ).toBe(true);
  });

  it('drops agents and modelconfigs in excluded namespaces', async () => {
    mockList
      .mockResolvedValueOnce({
        items: [agent('kept', 'team'), agent('dropped', 'ops')],
      })
      .mockResolvedValueOnce({ items: [modelConfig('m', 'ops')] });

    const provider = new KagentEntityProvider(
      baseConfig({ excludeNamespaces: ['ops'] }),
      logger,
    );
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    const mutation = lastMutation(conn);
    expect(titles(mutation, 'Component')).toEqual(['kept']);
    // The only modelconfig was in an excluded namespace.
    expect(mutation.entities.some(d => d.entity.kind === 'Resource')).toBe(
      false,
    );
  });

  it('preserves an empty snapshot and does not throw when the agent list fails', async () => {
    mockList.mockRejectedValueOnce(new Error('api down'));

    const provider = new KagentEntityProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);

    await expect(provider.refresh()).resolves.toBeUndefined();

    const mutation = lastMutation(conn);
    expect(mutation.type).toBe('full');
    expect(mutation.entities).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('marks the prior snapshot source unavailable when a later scan fails', async () => {
    mockList
      .mockResolvedValueOnce({ items: [agent('triage')] })
      .mockResolvedValueOnce({ items: [] })
      .mockRejectedValueOnce(new Error('api down'));

    const provider = new KagentEntityProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();
    await provider.refresh();

    const component = lastMutation(conn).entities.find(
      d => d.entity.kind === 'Component',
    )!.entity;
    expect(component.metadata.annotations?.['agentcatalog.io/source-status']).toBe(
      'unavailable',
    );
    expect(
      component.metadata.annotations?.['agentcatalog.io/last-observed-at'],
    ).toBeDefined();
  });

  it('still emits agents when only the modelconfig list fails', async () => {
    mockList
      .mockResolvedValueOnce({ items: [agent('triage')] })
      .mockRejectedValueOnce(new Error('no modelconfigs CRD'));

    const provider = new KagentEntityProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    const mutation = lastMutation(conn);
    expect(titles(mutation, 'Component')).toContain('triage');
    expect(mutation.entities.some(d => d.entity.kind === 'Resource')).toBe(
      false,
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('merges entities across multiple clusters', async () => {
    mockList
      .mockResolvedValueOnce({ items: [agent('east-a')] }) // east agents
      .mockResolvedValueOnce({ items: [] }) // east modelconfigs
      .mockResolvedValueOnce({ items: [agent('west-a')] }) // west agents
      .mockResolvedValueOnce({ items: [] }); // west modelconfigs

    const provider = new KagentEntityProvider(
      baseConfig({ clusters: [{ name: 'prod-east' }, { name: 'prod-west' }] }),
      logger,
    );
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    const componentTitles = titles(lastMutation(conn), 'Component');
    expect(componentTitles).toContain('east-a');
    expect(componentTitles).toContain('west-a');
  });

  it('throws if refreshed before being connected', async () => {
    const provider = new KagentEntityProvider(baseConfig(), logger);
    await expect(provider.refresh()).rejects.toThrow(/not connected/);
  });
});
