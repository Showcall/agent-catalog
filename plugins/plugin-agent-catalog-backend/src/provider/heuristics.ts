/**
 * Pure logic for heuristic discovery (ADR 0009): Deployments whose pod
 * specs advertise LLM consumption -> `llm-workload` Components with the
 * matching evidence stamped on the entity.
 *
 * Honesty rules:
 *  - env NAMES only; values / valueFrom are never read;
 *  - findings are `llm-workload`, not `ai-agent` — the evidence proves
 *    consumption, not agent-ness;
 *  - yield-order: runtime-CR-owned -> CRD provider's; selected by an
 *    a2a-labeled Service -> label discovery's; a2a="false" -> suppressed.
 */

import type { Entity } from '@backstage/catalog-model';
import type {
  DiscoveredService,
  DiscoveredWorkload,
  HeuristicsConfig,
} from './types';
import {
  ANNOTATION_PREFIX,
  locationOf,
  qualifiedEntityName,
  resolveOwner,
  type TransformOptions,
} from './transforms';

export const HEURISTIC_LOCATION_SCHEME = 'heuristic';
export const LLM_WORKLOAD_TYPE = 'llm-workload';

export const DEFAULT_ENV_NAME_PATTERNS = [
  '^(OPENAI|AZURE_OPENAI|ANTHROPIC|GEMINI|GOOGLE_GENAI|MISTRAL|COHERE|GROQ|TOGETHER|DEEPSEEK|XAI|OPENROUTER|LITELLM)_(API_KEY|AUTH_TOKEN|KEY)$',
  '^(OPENAI_API_BASE|OPENAI_BASE_URL|ANTHROPIC_BASE_URL|LLM_GATEWAY_URL)$',
];

export const DEFAULT_IMAGE_PATTERNS = [
  'langchain|langgraph|crewai|autogen|llama-?index|semantic-kernel|adk-|strands',
];

/** Signals like `env:ANTHROPIC_API_KEY` / `image:langgraph` — the evidence. */
export function matchWorkload(
  workload: DiscoveredWorkload,
  cfg: Pick<HeuristicsConfig, 'envNamePatterns' | 'imagePatterns'>,
): string[] {
  const envRes = cfg.envNamePatterns.map(p => new RegExp(p));
  const imgRes = cfg.imagePatterns.map(p => new RegExp(p, 'i'));
  const signals = new Set<string>();

  for (const c of workload.spec?.template?.spec?.containers ?? []) {
    for (const e of c.env ?? []) {
      if (typeof e?.name === 'string' && envRes.some(r => r.test(e.name!))) {
        signals.add(`env:${e.name}`);
      }
    }
    if (typeof c.image === 'string') {
      for (const r of imgRes) {
        const m = c.image.match(r);
        if (m) signals.add(`image:${m[0].toLowerCase()}`);
      }
    }
  }
  return [...signals].slice(0, 8);
}

/** Is this workload's pod template selected by the given (labeled) Service? */
export function serviceSelectsWorkload(
  svc: DiscoveredService,
  workload: DiscoveredWorkload,
): boolean {
  if (svc.metadata?.namespace !== workload.metadata?.namespace) return false;
  const selector = (svc.spec as { selector?: Record<string, string> })
    ?.selector;
  if (!selector || Object.keys(selector).length === 0) return false;
  const podLabels = workload.spec?.template?.metadata?.labels ?? {};
  return Object.entries(selector).every(([k, v]) => podLabels[k] === v);
}

/** `agentcatalog.io/a2a: "false"` suppression, honored on Deployments too. */
export function isSuppressed(workload: DiscoveredWorkload): boolean {
  return (
    workload.metadata?.labels?.[`${ANNOTATION_PREFIX}/a2a`] === 'false' ||
    workload.metadata?.annotations?.[`${ANNOTATION_PREFIX}/a2a`] === 'false'
  );
}

/** Build the llm-workload Component for a heuristic finding. */
export function workloadToComponent(
  workload: DiscoveredWorkload,
  signals: string[],
  opts: TransformOptions,
): Entity {
  const ns = workload.metadata?.namespace ?? 'default';
  const rawName = workload.metadata?.name ?? 'unknown-workload';
  const ready = (workload.status?.readyReplicas ?? 0) > 0;
  const lifecycleOverride =
    workload.metadata?.annotations?.[`${ANNOTATION_PREFIX}/lifecycle`] ??
    workload.metadata?.labels?.[`${ANNOTATION_PREFIX}/lifecycle`];

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: qualifiedEntityName(rawName, ns, opts.clusterName),
      title: rawName,
      description:
        'LLM-consuming workload (found by heuristic discovery — see signals).',
      annotations: {
        ...locationOf(
          opts.clusterName,
          ns,
          'Deployment',
          rawName,
          HEURISTIC_LOCATION_SCHEME,
        ),
        [`${ANNOTATION_PREFIX}/discovery`]: 'heuristic',
        [`${ANNOTATION_PREFIX}/heuristic-signals`]: signals.join(','),
        [`${ANNOTATION_PREFIX}/cluster`]: opts.clusterName,
        [`${ANNOTATION_PREFIX}/namespace`]: ns,
      },
      tags: ['llm-workload', 'heuristic'],
    },
    spec: {
      type: LLM_WORKLOAD_TYPE,
      lifecycle: lifecycleOverride ?? (ready ? 'production' : 'experimental'),
      owner: resolveOwner({ metadata: workload.metadata }, opts.defaultOwner),
      agent: {
        discovery: 'heuristic',
        cluster: opts.clusterName,
        namespace: ns,
        signals,
      },
    } as Entity['spec'],
  };
}
