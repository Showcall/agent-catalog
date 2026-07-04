import {
  discoveredCardPaths,
  discoveredCardPort,
  discoveredServiceToComponent,
  isClaimed,
  pseudoAgentFor,
  DISCOVERY_LOCATION_SCHEME,
} from './discovery';
import { enrichAgentEntities } from './enrichment';
import { isValidCard } from './cardFetcher';
import type { DiscoveredService } from './types';

const OPTS = { clusterName: 'prod-east', defaultOwner: 'group:default/platform-team' };

const labeledService: DiscoveredService = {
  metadata: {
    name: 'weather-bot',
    namespace: 'ml',
    labels: { 'agentcatalog.io/a2a': 'true' },
    annotations: {
      'backstage.io/owner': 'group:default/ml-platform',
      'agentcatalog.io/runtime': 'langgraph',
    },
  },
  spec: { ports: [{ port: 9000 }] },
};

const kagentOwnedService: DiscoveredService = {
  metadata: {
    name: 'k8s-helper',
    namespace: 'default',
    ownerReferences: [
      { apiVersion: 'kagent.dev/v1alpha2', kind: 'Agent', name: 'k8s-helper' },
    ],
  },
};

const liveCard = {
  name: 'weather_bot',
  protocolVersion: '0.3',
  capabilities: { streaming: false },
  skills: [{ id: 'forecast', name: 'Forecast' }],
};

const ann = (e: any, k: string) => e.metadata.annotations?.[`agentcatalog.io/${k}`];

describe('isClaimed', () => {
  it('skips Services owned by a known runtime CR', () => {
    expect(isClaimed(kagentOwnedService, [{ group: 'kagent.dev', kind: 'Agent' }])).toBe(true);
  });
  it('does not skip unowned Services', () => {
    expect(isClaimed(labeledService, [{ group: 'kagent.dev', kind: 'Agent' }])).toBe(false);
  });
  it('matches group, not full apiVersion', () => {
    const svc: DiscoveredService = {
      metadata: {
        ownerReferences: [{ apiVersion: 'kagent.dev/v9', kind: 'Agent' }],
      },
    };
    expect(isClaimed(svc, [{ group: 'kagent.dev', kind: 'Agent' }])).toBe(true);
  });
});

describe('card port and path resolution', () => {
  it('uses the first service port by default', () => {
    expect(discoveredCardPort(labeledService)).toBe(9000);
  });
  it('annotation override wins', () => {
    const svc = {
      ...labeledService,
      metadata: {
        ...labeledService.metadata,
        annotations: { 'agentcatalog.io/a2a-port': '7777' },
      },
    };
    expect(discoveredCardPort(svc)).toBe(7777);
  });
  it('falls back to 8080 with no ports at all', () => {
    expect(discoveredCardPort({ metadata: {} })).toBe(8080);
  });
  it('path annotation replaces the fallback chain', () => {
    const svc = {
      metadata: { annotations: { 'agentcatalog.io/a2a-path': '/card.json' } },
    };
    expect(discoveredCardPaths(svc)).toEqual(['/card.json']);
    expect(discoveredCardPaths(labeledService)).toBeUndefined();
  });
});

describe('discoveredServiceToComponent', () => {
  it('builds the governance plane from Service metadata', () => {
    const c = discoveredServiceToComponent(labeledService, true, OPTS);
    expect(c.metadata.name).toBe('weather-bot-ml-prod-east'); // ADR 0005 naming
    expect(c.spec?.owner).toBe('group:default/ml-platform'); // ADR 0004 ladder
    expect(c.spec?.lifecycle).toBe('production'); // endpoints ready
    expect(ann(c, 'discovery')).toBe('label');
    expect(ann(c, 'runtime')).toBe('langgraph');
    expect(c.metadata.annotations?.['backstage.io/managed-by-location']).toBe(
      `${DISCOVERY_LOCATION_SCHEME}://prod-east/ml/Service/weather-bot`,
    );
    expect(c.spec?.dependsOn).toBeUndefined(); // honest thinness
  });

  it('endpoints not ready -> experimental', () => {
    const c = discoveredServiceToComponent(labeledService, false, OPTS);
    expect(c.spec?.lifecycle).toBe('experimental');
  });
});

describe('discovered agents through the shared enrichment pass', () => {
  it('live card -> API entity with the discovery location scheme', () => {
    const component = discoveredServiceToComponent(labeledService, true, OPTS);
    const out = enrichAgentEntities(
      pseudoAgentFor(labeledService, true),
      [component],
      { card: liveCard, source: 'live' },
      OPTS,
      DISCOVERY_LOCATION_SCHEME,
    );
    const api = out.find(e => e.kind === 'API')!;
    expect(api.metadata.name).toBe('weather-bot-a2a-ml-prod-east');
    expect(api.metadata.annotations?.['backstage.io/managed-by-location']).toContain(
      `${DISCOVERY_LOCATION_SCHEME}://`,
    );
    const comp = out.find(e => e.kind === 'Component')!;
    expect(comp.spec?.providesApis).toEqual(['weather-bot-a2a-ml-prod-east']);
    expect(ann(comp, 'card-source')).toBe('live');
  });

  it('labeled but no card -> surfaced flagged, no API (the governance finding)', () => {
    const component = discoveredServiceToComponent(labeledService, true, OPTS);
    const out = enrichAgentEntities(
      pseudoAgentFor(labeledService, true),
      [component],
      { card: null, source: 'unreachable' },
      OPTS,
      DISCOVERY_LOCATION_SCHEME,
    );
    expect(out.filter(e => e.kind === 'API')).toHaveLength(0);
    const comp = out.find(e => e.kind === 'Component')!;
    expect(ann(comp, 'reachable')).toBe('false');
    expect(ann(comp, 'card-source')).toBe('none');
  });
});

describe('isValidCard', () => {
  it('accepts real cards', () => {
    expect(isValidCard(liveCard)).toBe(true);
    expect(isValidCard({ name: 'x', protocolVersion: '0.3' })).toBe(true);
  });
  it('rejects HTML-ish and lookalike payloads', () => {
    expect(isValidCard('<html>hello</html>')).toBe(false);
    expect(isValidCard({ title: 'not a card' })).toBe(false);
    expect(isValidCard({ name: 'x' })).toBe(false); // name alone isn't enough
    expect(isValidCard(null)).toBe(false);
    expect(isValidCard([{ name: 'x' }])).toBe(false);
  });
});
