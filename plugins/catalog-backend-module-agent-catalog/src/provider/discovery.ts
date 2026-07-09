/**
 * Pure transforms for runtime-agnostic A2A discovery (ADR 0006):
 * labeled Kubernetes Services -> catalog entities.
 *
 * A discovered agent's governance plane comes from its Service metadata
 * (owner ladder per ADR 0004, applied to the Service's annotations/labels;
 * lifecycle from endpoints readiness). Its interface plane comes from the
 * live card via the shared enrichment pass — deliberately reusing the
 * kagent path so the two sources can never drift.
 */

import type { Entity } from '@backstage/catalog-model';
import type { ClaimedByRef, DiscoveredService, KagentAgent } from './types';
import {
  AGENT_COMPONENT_TYPE,
  ANNOTATION_PREFIX,
  locationOf,
  qualifiedEntityName,
  resolveOwner,
  type TransformOptions,
} from './transforms';
import { sanitizeCardPath } from './cardFetcher';

export const DISCOVERY_LOCATION_SCHEME = 'a2a-discovery';

/** Default opt-in selector (ADR 0006). */
export const DEFAULT_A2A_LABEL_SELECTOR = 'agentcatalog.io/a2a=true';

/**
 * A Service owned by a known runtime CR is that runtime provider's job —
 * cataloging it here would double-catalog the agent with a thinner plane.
 */
export function isClaimed(
  svc: DiscoveredService,
  claimedBy: ClaimedByRef[],
): boolean {
  for (const ref of svc.metadata?.ownerReferences ?? []) {
    const group = (ref.apiVersion ?? '').split('/')[0];
    if (claimedBy.some(c => c.group === group && c.kind === ref.kind)) {
      return true;
    }
  }
  return false;
}

/**
 * Card port: annotation override, else the Service's first port, else 8080.
 * The annotation is untrusted (set by whoever labels the Service), so it must
 * parse to a valid TCP port (1–65535); anything else falls back.
 */
export function discoveredCardPort(svc: DiscoveredService): number {
  const ann = svc.metadata?.annotations?.[`${ANNOTATION_PREFIX}/a2a-port`];
  const parsed = ann ? Number(ann) : NaN;
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) return parsed;
  const first = svc.spec?.ports?.[0]?.port;
  return typeof first === 'number' ? first : 8080;
}

/**
 * Card path override: annotation replaces the default fallback chain. The
 * annotation is untrusted, so it is sanitized (see `sanitizeCardPath`); an
 * unsafe value is ignored, falling back to the well-known default paths rather
 * than becoming a malformed apiserver request.
 */
export function discoveredCardPaths(svc: DiscoveredService): string[] | undefined {
  const ann = svc.metadata?.annotations?.[`${ANNOTATION_PREFIX}/a2a-path`];
  if (!ann) return undefined;
  const safe = sanitizeCardPath(ann);
  return safe ? [safe] : undefined;
}

/**
 * Adapt a Service (+ its endpoints readiness) into the agent-shaped object
 * the shared transforms consume: `resolveOwner`/`readyLifecycle` read
 * metadata and a Ready condition, and the enrichment pass needs name/ns.
 * Endpoints readiness plays the role kagent's Ready condition plays —
 * "Kubernetes says something is answering" — and stays distinct from
 * `reachable` (the card fetch), per governance.md.
 */
export function pseudoAgentFor(
  svc: DiscoveredService,
  endpointsReady: boolean,
): KagentAgent {
  return {
    metadata: svc.metadata,
    status: {
      conditions: [
        { type: 'Ready', status: endpointsReady ? 'True' : 'False' },
      ],
    },
  };
}

/** Build the Component for a discovered (non-CRD) agent Service. */
export function discoveredServiceToComponent(
  svc: DiscoveredService,
  endpointsReady: boolean,
  opts: TransformOptions,
): Entity {
  const ns = svc.metadata?.namespace ?? 'default';
  const rawName = svc.metadata?.name ?? 'unknown-service';
  const runtime =
    svc.metadata?.annotations?.[`${ANNOTATION_PREFIX}/runtime`] ?? 'unknown';
  const lifecycleOverride =
    svc.metadata?.annotations?.[`${ANNOTATION_PREFIX}/lifecycle`] ??
    svc.metadata?.labels?.[`${ANNOTATION_PREFIX}/lifecycle`];

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: qualifiedEntityName(rawName, ns, opts.clusterName),
      title: rawName,
      description:
        svc.metadata?.annotations?.[`${ANNOTATION_PREFIX}/description`] ??
        'A2A agent (discovered via labeled Service)',
      annotations: {
        ...locationOf(
          opts.clusterName,
          ns,
          'Service',
          rawName,
          DISCOVERY_LOCATION_SCHEME,
        ),
        [`${ANNOTATION_PREFIX}/runtime`]: runtime,
        [`${ANNOTATION_PREFIX}/discovery`]: 'label',
        [`${ANNOTATION_PREFIX}/cluster`]: opts.clusterName,
        [`${ANNOTATION_PREFIX}/namespace`]: ns,
      },
      tags: ['ai-agent', 'a2a', 'discovered'],
    },
    spec: {
      type: AGENT_COMPONENT_TYPE,
      lifecycle:
        lifecycleOverride ?? (endpointsReady ? 'production' : 'experimental'),
      owner: resolveOwner({ metadata: svc.metadata }, opts.defaultOwner),
      // No dependsOn: nothing declares a discovered agent's model or tools.
      // The visible richness gap vs CRD-managed agents is deliberate — it is
      // the incentive toward the golden path (ADR 0006).
      agent: {
        runtime,
        discovery: 'label',
        cluster: opts.clusterName,
        namespace: ns,
        service: rawName,
        port: discoveredCardPort(svc),
      },
    } as Entity['spec'],
  };
}
