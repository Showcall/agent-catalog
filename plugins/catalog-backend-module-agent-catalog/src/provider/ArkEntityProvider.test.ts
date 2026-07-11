/**
 * Provider-wiring tests for ArkEntityProvider: mock the Kubernetes client and
 * drive refresh(), asserting the agents/teams/models list -> transform -> full
 * mutation path, plus the "404 = no ARK here" vs. real-error distinction.
 */

import type { EntityProviderConnection } from '@backstage/plugin-catalog-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';

jest.mock('@kubernetes/client-node', () => {
  const listCustomObjectForAllNamespaces = jest.fn();
  return {
    __listMock: listCustomObjectForAllNamespaces,
    CustomObjectsApi: class CustomObjectsApi {},
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

import { ArkEntityProvider } from './ArkEntityProvider';
import type {
  AgentCatalogConfig,
  ArkAgent,
  ArkModel,
  ArkTeam,
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

function makeConnection(): EntityProviderConnection {
  return {
    applyMutation: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
  } as unknown as EntityProviderConnection;
}

const arkAgent = (name: string, namespace = 'ops'): ArkAgent => ({
  metadata: { name, namespace },
  spec: { description: `${name} agent`, modelRef: { name: 'demo-model' } },
});
const arkTeam = (name: string, namespace = 'ops'): ArkTeam => ({
  metadata: { name, namespace },
  spec: { strategy: 'round-robin', members: [] },
});
const arkModel = (name: string, namespace = 'ops'): ArkModel => ({
  metadata: { name, namespace },
  spec: { type: 'openai', provider: 'openai', model: { value: 'gpt-4o' } },
});

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
const notFound = () => Object.assign(new Error('the server could not find'), { code: 404 });

beforeEach(() => {
  mockList.mockReset();
  jest.clearAllMocks();
  (logger.child as jest.Mock).mockReturnValue(logger);
});

describe('ArkEntityProvider', () => {
  it('emits agents and teams as Components and models as Resources', async () => {
    mockList
      .mockResolvedValueOnce({ items: [arkAgent('researcher')] })
      .mockResolvedValueOnce({ items: [arkTeam('content-team')] })
      .mockResolvedValueOnce({ items: [arkModel('demo-model')] });

    const provider = new ArkEntityProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(mockList).toHaveBeenNthCalledWith(1, {
      group: 'ark.mckinsey.com',
      version: 'v1alpha1',
      plural: 'agents',
    });
    expect(mockList).toHaveBeenNthCalledWith(2, expect.objectContaining({ plural: 'teams' }));
    expect(mockList).toHaveBeenNthCalledWith(3, expect.objectContaining({ plural: 'models' }));

    const mutation = lastMutation(conn);
    expect(titles(mutation, 'Component')).toEqual(
      expect.arrayContaining(['researcher', 'content-team']),
    );
    expect(mutation.entities.some(d => d.entity.kind === 'Resource')).toBe(true);
    expect(
      mutation.entities.every(d => d.locationKey === 'ark-entity-provider'),
    ).toBe(true);
  });

  it('treats a 404 on the agent list as "no ARK here" — empty, not an error', async () => {
    mockList.mockRejectedValueOnce(notFound());

    const provider = new ArkEntityProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(lastMutation(conn).entities).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and preserves an empty snapshot on a non-404 agent-list error', async () => {
    mockList.mockRejectedValueOnce(new Error('connection refused'));

    const provider = new ArkEntityProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(lastMutation(conn).entities).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('still emits agents when the teams list fails', async () => {
    mockList
      .mockResolvedValueOnce({ items: [arkAgent('researcher')] })
      .mockRejectedValueOnce(new Error('no teams CRD'))
      .mockResolvedValueOnce({ items: [] });

    const provider = new ArkEntityProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(titles(lastMutation(conn), 'Component')).toContain('researcher');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('drops entities in excluded namespaces', async () => {
    mockList
      .mockResolvedValueOnce({
        items: [arkAgent('kept', 'team'), arkAgent('dropped', 'ops')],
      })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });

    const provider = new ArkEntityProvider(
      baseConfig({ excludeNamespaces: ['ops'] }),
      logger,
    );
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(titles(lastMutation(conn), 'Component')).toEqual(['kept']);
  });
});
