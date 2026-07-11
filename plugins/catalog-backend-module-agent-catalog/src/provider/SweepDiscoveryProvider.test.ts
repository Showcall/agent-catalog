/**
 * Provider-wiring tests for SweepDiscoveryProvider (ADR 0007): mock CoreV1Api
 * and drive refresh(), asserting the funnel — probe a card-serving unlabeled
 * Service (discovery: probe, own locationKey), skip labeled/claimed/suppressed
 * Services, stay silent on a cardless Service, and cap probed ports.
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

import { SweepDiscoveryProvider } from './SweepDiscoveryProvider';
import type { AgentCatalogConfig, DiscoveredService } from './types';

const k8s = jest.requireMock('@kubernetes/client-node');
const mockSvcList = k8s.__svcList as jest.Mock;
const mockEndpoints = k8s.__endpoints as jest.Mock;
const mockProxy = k8s.__proxy as jest.Mock;

const A = 'agentcatalog.io';

function baseConfig(
  overrides: Partial<AgentCatalogConfig> = {},
): AgentCatalogConfig {
  return {
    clusters: [{ name: 'prod-east' }],
    defaultOwner: 'group:default/platform-team',
    excludeNamespaces: [],
    crd: { group: 'kagent.dev', version: 'v1alpha2' },
    schedule: { frequencyMinutes: 5, timeoutMinutes: 2 },
    // Non-empty paths so the fetcher actually probes the mocked proxy.
    cardEnrichment: {
      enabled: true,
      timeoutMs: 2000,
      port: 8080,
      paths: ['/.well-known/agent-card.json'],
    },
    a2aDiscovery: {
      enabled: true,
      labelSelector: 'agentcatalog.io/a2a=true',
      claimedBy: [{ group: 'kagent.dev', kind: 'Agent' }],
    },
    sweep: { enabled: true, namespaceDenylist: [], maxPorts: 3 },
    usage: {
      enabled: false,
      source: 'litellm',
      apiKeyEnv: 'X',
      windowDays: 7,
      includeCost: false,
      schedule: { frequencyMinutes: 60 },
    },
    heuristics: { enabled: true, envNamePatterns: [], imagePatterns: [] },
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
  opts: {
    namespace?: string;
    labels?: Record<string, string>;
    ownerReferences?: Array<{ apiVersion?: string; kind?: string }>;
    ports?: number[];
  } = {},
): DiscoveredService {
  return {
    metadata: {
      name,
      namespace: opts.namespace ?? 'team',
      ...(opts.labels ? { labels: opts.labels } : {}),
      ...(opts.ownerReferences ? { ownerReferences: opts.ownerReferences } : {}),
    },
    spec: { ports: (opts.ports ?? [8080]).map(port => ({ port })) },
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
const components = (m: { entities: DeferredEntity[] }) =>
  m.entities.filter(d => d.entity.kind === 'Component');
const titles = (m: { entities: DeferredEntity[] }) =>
  components(m).map(d => d.entity.metadata.title ?? d.entity.metadata.name);

const CARD = JSON.stringify({ name: 'agent', protocolVersion: '1.0', skills: [] });

beforeEach(() => {
  jest.clearAllMocks();
  (logger.child as jest.Mock).mockReturnValue(logger);
  mockEndpoints.mockResolvedValue({
    subsets: [{ addresses: [{ ip: '10.0.0.1' }] }],
  });
  // Default: every probe serves a valid card.
  mockProxy.mockResolvedValue(CARD);
});

describe('SweepDiscoveryProvider', () => {
  it('probes an unlabeled Service and catalogs it as discovery: probe', async () => {
    mockSvcList.mockResolvedValueOnce({ items: [service('mystery-agent')] });

    const provider = new SweepDiscoveryProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    // Lists everything — no label selector.
    expect(mockSvcList).toHaveBeenCalledWith();
    const mutation = lastMutation(conn);
    expect(titles(mutation)).toContain('mystery-agent');
    const comp = components(mutation)[0].entity;
    expect(comp.metadata.annotations?.[`${A}/discovery`]).toBe('probe');
    expect(
      mutation.entities.every(d => d.locationKey === 'a2a-sweep-provider'),
    ).toBe(true);
  });

  it('skips labeled (Tier A), claimed (CRD), and suppressed Services', async () => {
    mockSvcList.mockResolvedValueOnce({
      items: [
        service('labeled', { labels: { [`${A}/a2a`]: 'true' } }),
        service('suppressed', { labels: { [`${A}/a2a`]: 'false' } }),
        service('claimed', {
          ownerReferences: [{ apiVersion: 'kagent.dev/v1alpha2', kind: 'Agent' }],
        }),
        service('shadow'),
      ],
    });

    const provider = new SweepDiscoveryProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    const found = titles(lastMutation(conn));
    expect(found).toEqual(['shadow']);
    expect(found).not.toContain('labeled');
    expect(found).not.toContain('suppressed');
    expect(found).not.toContain('claimed');
  });

  it('stays silent on an unlabeled Service that serves no card', async () => {
    mockProxy.mockRejectedValue(new Error('connection refused'));
    mockSvcList.mockResolvedValueOnce({ items: [service('just-a-webservice')] });

    const provider = new SweepDiscoveryProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    // No card => not a finding: no entities emitted.
    expect(lastMutation(conn).entities).toEqual([]);
  });

  it('probes at most maxPorts declared ports before giving up', async () => {
    mockProxy.mockRejectedValue(new Error('no card'));
    mockSvcList.mockResolvedValueOnce({
      items: [service('many-ports', { ports: [1111, 2222, 3333, 4444, 5555] })],
    });

    const provider = new SweepDiscoveryProvider(
      baseConfig({
        sweep: { enabled: true, namespaceDenylist: [], maxPorts: 2 },
      }),
      logger,
    );
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    // One proxy call per candidate port (one path configured), capped at 2.
    expect(mockProxy).toHaveBeenCalledTimes(2);
    const probedNames = mockProxy.mock.calls.map(c => c[0].name);
    expect(probedNames).toEqual(['http:many-ports:1111', 'http:many-ports:2222']);
  });

  it('honors the sweep namespace denylist on top of excludeNamespaces', async () => {
    mockSvcList.mockResolvedValueOnce({
      items: [
        service('kept', { namespace: 'team' }),
        service('denied', { namespace: 'kube-system' }),
      ],
    });

    const provider = new SweepDiscoveryProvider(
      baseConfig({
        sweep: {
          enabled: true,
          namespaceDenylist: ['kube-system'],
          maxPorts: 3,
        },
      }),
      logger,
    );
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(titles(lastMutation(conn))).toEqual(['kept']);
  });
});
