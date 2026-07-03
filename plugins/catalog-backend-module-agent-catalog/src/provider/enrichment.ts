/**
 * Live A2A-card enrichment (pure). Overlays a fetched agent card onto the
 * entities the CRD transform produced. Kept free of I/O so it stays
 * fixture-testable — the provider owns fetching, timeout and caching.
 *
 * See docs/adr/0001-agent-metadata-sources.md for the two-plane model:
 *   CRD  -> governance plane (owner, lifecycle, dependsOn)  [transforms.ts]
 *   card -> interface plane (real skills/capabilities)      [here]
 */

import type { Entity } from '@backstage/catalog-model';
import type { KagentAgent } from './types';
import {
  ANNOTATION_PREFIX,
  a2aApiEntity,
  a2aApiName,
  type A2ACard,
  type TransformOptions,
} from './transforms';

/** Result of trying to fetch an agent's live card. */
export type CardFetch =
  | { card: A2ACard; source: 'live' | 'stale' }
  | { card: null; source: 'unreachable' };

function setAnnotation(entity: Entity, key: string, value: string): void {
  entity.metadata.annotations = {
    ...(entity.metadata.annotations ?? {}),
    [`${ANNOTATION_PREFIX}/${key}`]: value,
  };
}

/**
 * Merge a fetched card into an agent's CRD-derived entities.
 *
 *  - card fetched (live | stale) -> the API entity's definition becomes the
 *    real card; the Component `providesApis` it. Works for BYO agents too,
 *    which have no synthesized API from the CRD.
 *  - unreachable, declarative -> keep the synthesized API (fallback).
 *  - unreachable, BYO -> no API entity; Component flagged not reachable.
 *
 * The Component is always annotated with `card-source` and `reachable` so the
 * catalog surfaces "declared but not answering".
 */
export function enrichAgentEntities(
  agent: KagentAgent,
  crdEntities: Entity[],
  fetched: CardFetch,
  opts: TransformOptions,
): Entity[] {
  const component = crdEntities.find(e => e.kind === 'Component');
  if (!component) return crdEntities; // defensive: nothing to anchor to

  const nonApi = crdEntities.filter(e => e.kind !== 'API');
  const synthesizedApi = crdEntities.find(e => e.kind === 'API');

  if (fetched.card) {
    const api = a2aApiEntity(agent, opts, fetched.card, fetched.source);
    (component.spec as Record<string, unknown>).providesApis = [
      a2aApiName(agent, opts.clusterName),
    ];
    setAnnotation(component, 'card-source', fetched.source);
    setAnnotation(component, 'reachable', String(fetched.source === 'live'));
    return [...nonApi, api];
  }

  // Unreachable: fall back.
  setAnnotation(component, 'reachable', 'false');
  if (synthesizedApi) {
    setAnnotation(component, 'card-source', 'synthesized');
    return [...nonApi, synthesizedApi];
  }
  setAnnotation(component, 'card-source', 'none');
  return nonApi;
}
