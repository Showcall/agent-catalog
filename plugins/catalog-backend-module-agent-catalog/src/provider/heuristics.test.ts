import {
  DEFAULT_ENV_NAME_PATTERNS,
  DEFAULT_IMAGE_PATTERNS,
  isSuppressed,
  matchWorkload,
  serviceSelectsWorkload,
  workloadToComponent,
} from './heuristics';
import type { DiscoveredService, DiscoveredWorkload } from './types';

const CFG = {
  envNamePatterns: DEFAULT_ENV_NAME_PATTERNS,
  imagePatterns: DEFAULT_IMAGE_PATTERNS,
};
const OPTS = { clusterName: 'prod-east', defaultOwner: 'group:default/platform-team' };

const scriptWorkload: DiscoveredWorkload = {
  metadata: { name: 'sentiment-batch', namespace: 'data' },
  spec: {
    template: {
      metadata: { labels: { app: 'sentiment-batch' } },
      spec: {
        containers: [
          {
            name: 'job',
            image: 'python:3.12-alpine',
            env: [
              { name: 'ANTHROPIC_API_KEY', valueFrom: { secretKeyRef: { key: 'k' } } },
              { name: 'LOG_LEVEL', value: 'super-secret-value' },
            ],
          },
        ],
      },
    },
  },
  status: { readyReplicas: 1 },
};

describe('matchWorkload', () => {
  it('flags provider-key env names and framework images, with evidence', () => {
    expect(matchWorkload(scriptWorkload, CFG)).toEqual(['env:ANTHROPIC_API_KEY']);

    const framework: DiscoveredWorkload = {
      spec: {
        template: {
          spec: { containers: [{ image: 'ghcr.io/acme/langgraph-runner:2.1' }] },
        },
      },
    };
    expect(matchWorkload(framework, CFG)).toEqual(['image:langgraph']);
  });

  it('does not flag ordinary workloads (STRIPE_API_KEY is not an LLM)', () => {
    const shop: DiscoveredWorkload = {
      spec: {
        template: {
          spec: {
            containers: [
              { image: 'nginx:1.25', env: [{ name: 'STRIPE_API_KEY' }] },
            ],
          },
        },
      },
    };
    expect(matchWorkload(shop, CFG)).toEqual([]);
  });
});

describe('yield order helpers', () => {
  it('serviceSelectsWorkload matches selector-subset in same namespace', () => {
    const svc: DiscoveredService = {
      metadata: { name: 'sentiment-batch', namespace: 'data' },
      spec: { selector: { app: 'sentiment-batch' } } as DiscoveredService['spec'],
    };
    expect(serviceSelectsWorkload(svc, scriptWorkload)).toBe(true);
    expect(
      serviceSelectsWorkload(
        { ...svc, metadata: { ...svc.metadata, namespace: 'other' } },
        scriptWorkload,
      ),
    ).toBe(false);
  });

  it('a2a=false suppression is honored on Deployments', () => {
    expect(
      isSuppressed({
        metadata: { labels: { 'agentcatalog.io/a2a': 'false' } },
      }),
    ).toBe(true);
    expect(isSuppressed(scriptWorkload)).toBe(false);
  });
});

describe('workloadToComponent', () => {
  it('emits an honest llm-workload with evidence, never ai-agent', () => {
    const c = workloadToComponent(
      scriptWorkload,
      ['env:ANTHROPIC_API_KEY'],
      OPTS,
    );
    expect(c.spec?.type).toBe('llm-workload');
    expect(c.metadata.name).toBe('sentiment-batch-data-prod-east'); // ADR 0005
    expect(c.metadata.annotations?.['agentcatalog.io/discovery']).toBe('heuristic');
    expect(c.metadata.annotations?.['agentcatalog.io/heuristic-signals']).toBe(
      'env:ANTHROPIC_API_KEY',
    );
    expect(c.spec?.lifecycle).toBe('production'); // readyReplicas > 0
    expect(c.metadata.tags).toContain('heuristic');
  });

  it('never leaks env values or valueFrom', () => {
    const c = workloadToComponent(scriptWorkload, ['env:ANTHROPIC_API_KEY'], OPTS);
    const s = JSON.stringify(c);
    expect(s).not.toContain('super-secret-value');
    expect(s).not.toContain('secretKeyRef');
  });
});
