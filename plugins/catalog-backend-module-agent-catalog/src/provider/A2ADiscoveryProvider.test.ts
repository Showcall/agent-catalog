/**
 * Provider-wiring tests for A2ADiscoveryProvider: mock CoreV1Api and drive
 * refresh(), asserting labeled-Service discovery, claimed-Service skipping,
 * namespace exclusion, and the full mutation under its own locationKey.
 * Card fetching degrades to "unreachable" here (no proxy) — enrichment has
 * its own tests.
 */

import type { EntityProviderConnection } from '@backstage/plugin-catalog-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';

jest.mock('@kubernetes/client-node', () => {
  const listServiceForAllNamespaces = jest.fn();
  const readNamespacedEndpoints = jest.fn();
  const connectGetNamespacedServiceProxyWithPath = jest.fn();
  return {
    __svcList: listServiceForAllNamespaces,
    __endpoints: readNamespacedEndpoints,
    __proxy: connectGetNamespacedServiceProxyWithPath,
    CoreV1Api: class CoreV1Api {},
    KubeConfig: class KubeConfig {
      loadFromDefault() {}
      loadFromCluster() {}
      loadFromFile() {}
      setCurrentContext() {}
      makeApiClient() {
        return {
          listServiceForAllNamespaces,
          readNamespacedEndpoints,
          connectGetNamespacedServiceProxyWithPath,
        };
      }
    },
  };
});

import { A2ADiscoveryProvider } from './A2ADiscoveryProvider';
import type {
  AgentCatalogConfig,
  ClaimedByRef,
  DiscoveredService,
} from './types';

const k8s = jest.requireMock('@kubernetes/client-node');
const mockSvcList = k8s.__svcList as jest.Mock;
const mockEndpoints = k8s.__endpoints as jest.Mock;
const mockProxy = k8s.__proxy as jest.Mock;

function baseConfig(
  overrides: Partial<AgentCatalogConfig> = {},
): AgentCatalogConfig {
  return {
    clusters: [{ name: 'prod-east' }],
    defaultOwner: 'group:default/platform-team',
    excludeNamespaces: [],
    crd: { group: 'kagent.dev', version: 'v1alpha2' },
    schedule: { frequencyMinutes: 5, timeoutMinutes: 2 },
    cardEnrichment: { enabled: true, timeoutMs: 2000, port: 8080, paths: [] },
    a2aDiscovery: {
      enabled: true,
      labelSelector: 'agentcatalog.io/a2a=true',
      claimedBy: [],
    },
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

function service(
  name: string,
  namespace = 'team',
  ownerReferences?: Array<{ apiVersion?: string; kind?: string; name?: string }>,
): DiscoveredService {
  return {
    metadata: { name, namespace, ...(ownerReferences ? { ownerReferences } : {}) },
    spec: { ports: [{ port: 8080 }] },
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
  jest.clearAllMocks();
  (logger.child as jest.Mock).mockReturnValue(logger);
  // Endpoints ready by default; no live card (unreachable) by default.
  mockEndpoints.mockResolvedValue({ subsets: [{ addresses: [{ ip: '10.0.0.1' }] }] });
  mockProxy.mockRejectedValue(new Error('no card served'));
});

describe('A2ADiscoveryProvider', () => {
  it('lists labeled Services and emits a Component for each', async () => {
    mockSvcList.mockResolvedValueOnce({ items: [service('release-notes-agent')] });

    const provider = new A2ADiscoveryProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(mockSvcList).toHaveBeenCalledWith({
      labelSelector: 'agentcatalog.io/a2a=true',
    });
    const mutation = lastMutation(conn);
    expect(titles(mutation, 'Component')).toContain('release-notes-agent');
    expect(
      mutation.entities.every(d => d.locationKey === 'a2a-discovery-provider'),
    ).toBe(true);
  });

  it('skips Services owned by a claimed runtime CR', async () => {
    const claimedBy: ClaimedByRef[] = [{ group: 'kagent.dev', kind: 'Agent' }];
    mockSvcList.mockResolvedValueOnce({
      items: [
        service('unclaimed'),
        service('claimed', 'team', [
          { apiVersion: 'kagent.dev/v1alpha2', kind: 'Agent', name: 'x' },
        ]),
      ],
    });

    const provider = new A2ADiscoveryProvider(
      baseConfig({
        a2aDiscovery: {
          enabled: true,
          labelSelector: 'agentcatalog.io/a2a=true',
          claimedBy,
        },
      }),
      logger,
    );
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    const componentTitles = titles(lastMutation(conn), 'Component');
    expect(componentTitles).toContain('unclaimed');
    expect(componentTitles).not.toContain('claimed');
  });

  it('drops Services in excluded namespaces', async () => {
    mockSvcList.mockResolvedValueOnce({
      items: [service('kept', 'team'), service('dropped', 'ops')],
    });

    const provider = new A2ADiscoveryProvider(
      baseConfig({ excludeNamespaces: ['ops'] }),
      logger,
    );
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(titles(lastMutation(conn), 'Component')).toEqual(['kept']);
  });

  it('merges discovered Services across multiple clusters', async () => {
    mockSvcList
      .mockResolvedValueOnce({ items: [service('east-agent')] })
      .mockResolvedValueOnce({ items: [service('west-agent')] });

    const provider = new A2ADiscoveryProvider(
      baseConfig({ clusters: [{ name: 'prod-east' }, { name: 'prod-west' }] }),
      logger,
    );
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    const componentTitles = titles(lastMutation(conn), 'Component');
    expect(componentTitles).toContain('east-agent');
    expect(componentTitles).toContain('west-agent');
  });
});
