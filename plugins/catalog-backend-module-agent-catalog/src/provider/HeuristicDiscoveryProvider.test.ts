/**
 * Provider-wiring tests for HeuristicDiscoveryProvider: mock AppsV1Api +
 * CoreV1Api and drive refresh(), asserting env/image signal matching, the
 * suppression and claimed-yield escape hatches, namespace exclusion, and the
 * full mutation under its own locationKey.
 */

import type { EntityProviderConnection } from '@backstage/plugin-catalog-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';

jest.mock('@kubernetes/client-node', () => {
  const listDeploymentForAllNamespaces = jest.fn();
  const listServiceForAllNamespaces = jest.fn();
  return {
    __deployList: listDeploymentForAllNamespaces,
    __svcList: listServiceForAllNamespaces,
    AppsV1Api: class AppsV1Api {},
    CoreV1Api: class CoreV1Api {},
    KubeConfig: class KubeConfig {
      loadFromDefault() {}
      loadFromCluster() {}
      loadFromFile() {}
      setCurrentContext() {}
      makeApiClient() {
        return { listDeploymentForAllNamespaces, listServiceForAllNamespaces };
      }
    },
  };
});

import { HeuristicDiscoveryProvider } from './HeuristicDiscoveryProvider';
import type { AgentCatalogConfig, DiscoveredWorkload } from './types';

const k8s = jest.requireMock('@kubernetes/client-node');
const mockDeployList = k8s.__deployList as jest.Mock;
const mockSvcList = k8s.__svcList as jest.Mock;

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
    heuristics: {
      enabled: true,
      envNamePatterns: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
      imagePatterns: [],
    },
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

function deploy(
  name: string,
  opts: {
    namespace?: string;
    envNames?: string[];
    labels?: Record<string, string>;
    ownerReferences?: Array<{ apiVersion?: string; kind?: string; name?: string }>;
  } = {},
): DiscoveredWorkload {
  const { namespace = 'apps', envNames = [], labels, ownerReferences } = opts;
  return {
    metadata: {
      name,
      namespace,
      ...(labels ? { labels } : {}),
      ...(ownerReferences ? { ownerReferences } : {}),
    },
    spec: {
      template: {
        spec: {
          containers: [
            { name: 'main', image: 'ghcr.io/acme/app:1', env: envNames.map(n => ({ name: n })) },
          ],
        },
      },
    },
    status: { readyReplicas: 1 },
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
const titles = (m: { entities: DeferredEntity[] }) =>
  m.entities.map(d => d.entity.metadata.title ?? d.entity.metadata.name);

beforeEach(() => {
  jest.clearAllMocks();
  (logger.child as jest.Mock).mockReturnValue(logger);
  // No labeled Services in the way, by default.
  mockSvcList.mockResolvedValue({ items: [] });
});

describe('HeuristicDiscoveryProvider', () => {
  it('flags a Deployment whose env name matches an LLM pattern', async () => {
    mockDeployList.mockResolvedValueOnce({
      items: [deploy('sentiment-batch', { envNames: ['ANTHROPIC_API_KEY'] })],
    });

    const provider = new HeuristicDiscoveryProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    const mutation = lastMutation(conn);
    expect(titles(mutation)).toContain('sentiment-batch');
    expect(mutation.entities[0].entity.spec?.type).toBe('llm-workload');
    expect(mutation.entities[0].locationKey).toBe('heuristic-discovery-provider');
  });

  it('ignores a Deployment with no LLM signals', async () => {
    mockDeployList.mockResolvedValueOnce({
      items: [deploy('plain-web', { envNames: ['PORT', 'LOG_LEVEL'] })],
    });

    const provider = new HeuristicDiscoveryProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(lastMutation(conn).entities).toEqual([]);
  });

  it('respects the suppression opt-out even when signals match', async () => {
    mockDeployList.mockResolvedValueOnce({
      items: [
        deploy('opted-out', {
          envNames: ['OPENAI_API_KEY'],
          labels: { 'agentcatalog.io/a2a': 'false' },
        }),
      ],
    });

    const provider = new HeuristicDiscoveryProvider(baseConfig(), logger);
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(lastMutation(conn).entities).toEqual([]);
  });

  it('yields a matching Deployment owned by a claimed runtime CR', async () => {
    mockDeployList.mockResolvedValueOnce({
      items: [
        deploy('kagent-owned', {
          envNames: ['OPENAI_API_KEY'],
          ownerReferences: [
            { apiVersion: 'kagent.dev/v1alpha2', kind: 'Agent', name: 'x' },
          ],
        }),
      ],
    });

    const provider = new HeuristicDiscoveryProvider(
      baseConfig({
        a2aDiscovery: {
          enabled: true,
          labelSelector: 'agentcatalog.io/a2a=true',
          claimedBy: [{ group: 'kagent.dev', kind: 'Agent' }],
        },
      }),
      logger,
    );
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(lastMutation(conn).entities).toEqual([]);
  });

  it('drops Deployments in excluded namespaces', async () => {
    mockDeployList.mockResolvedValueOnce({
      items: [
        deploy('kept', { namespace: 'apps', envNames: ['ANTHROPIC_API_KEY'] }),
        deploy('dropped', { namespace: 'kube-system', envNames: ['ANTHROPIC_API_KEY'] }),
      ],
    });

    const provider = new HeuristicDiscoveryProvider(
      baseConfig({ excludeNamespaces: ['kube-system'] }),
      logger,
    );
    const conn = makeConnection();
    await provider.connect(conn);
    await provider.refresh();

    expect(titles(lastMutation(conn))).toEqual(['kept']);
  });
});
