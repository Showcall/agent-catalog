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

export interface InterfaceDrift {
  status: 'in-sync' | 'drift';
  declaredSkillIds: string[];
  liveSkillIds: string[];
  declaredOnly: string[];
  liveOnly: string[];
}

function setAnnotation(entity: Entity, key: string, value: string): void {
  entity.metadata.annotations = {
    ...(entity.metadata.annotations ?? {}),
    [`${ANNOTATION_PREFIX}/${key}`]: value,
  };
}

function skillIds(skills: unknown[] | undefined): string[] {
  return [
    ...new Set(
      (skills ?? []).flatMap(skill => {
        if (!skill || typeof skill !== 'object') return [];
        const id = (skill as Record<string, unknown>).id;
        return typeof id === 'string' && id.trim() ? [id.trim()] : [];
      }),
    ),
  ].sort();
}

/** Compare the declarative kagent skill IDs with a freshly fetched live card. */
export function compareInterfaceSkills(
  declaredSkills: unknown[] | undefined,
  liveSkills: unknown[] | undefined,
): InterfaceDrift | undefined {
  const declaredSkillIds = skillIds(declaredSkills);
  if (!declaredSkillIds.length) return undefined;

  const liveSkillIds = skillIds(liveSkills);
  const live = new Set(liveSkillIds);
  const declared = new Set(declaredSkillIds);
  const declaredOnly = declaredSkillIds.filter(id => !live.has(id));
  const liveOnly = liveSkillIds.filter(id => !declared.has(id));

  return {
    status: declaredOnly.length || liveOnly.length ? 'drift' : 'in-sync',
    declaredSkillIds,
    liveSkillIds,
    declaredOnly,
    liveOnly,
  };
}

function applyInterfaceDrift(
  component: Entity,
  agent: KagentAgent,
  card: A2ACard,
): void {
  const drift = compareInterfaceSkills(
    agent.spec?.declarative?.a2aConfig?.skills,
    card.skills,
  );
  if (!drift) return;

  setAnnotation(component, 'interface-status', drift.status);
  if (drift.status === 'drift') {
    const detail = [
      drift.declaredOnly.length
        ? `declared only: ${drift.declaredOnly.join(', ')}`
        : '',
      drift.liveOnly.length ? `live only: ${drift.liveOnly.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    setAnnotation(component, 'interface-drift', detail);
  }

  const spec = component.spec ?? {};
  const existingAgent = spec.agent;
  const agentSpec =
    existingAgent &&
    typeof existingAgent === 'object' &&
    !Array.isArray(existingAgent)
      ? existingAgent
      : {};
  component.spec = {
    ...spec,
    agent: {
      ...agentSpec,
      interface: {
        status: drift.status,
        declaredSkillIds: drift.declaredSkillIds,
        liveSkillIds: drift.liveSkillIds,
        declaredOnly: drift.declaredOnly,
        liveOnly: drift.liveOnly,
      },
    },
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
  locationScheme = 'kagent',
): Entity[] {
  const component = crdEntities.find(e => e.kind === 'Component');
  if (!component) return crdEntities; // defensive: nothing to anchor to

  const nonApi = crdEntities.filter(e => e.kind !== 'API');
  const synthesizedApi = crdEntities.find(e => e.kind === 'API');

  if (fetched.card) {
    const api = a2aApiEntity(
      agent,
      opts,
      fetched.card,
      fetched.source,
      locationScheme,
    );
    (component.spec as Record<string, unknown>).providesApis = [
      a2aApiName(agent, opts.clusterName),
    ];
    setAnnotation(component, 'card-source', fetched.source);
    setAnnotation(component, 'reachable', String(fetched.source === 'live'));
    if (fetched.source === 'live') {
      applyInterfaceDrift(component, agent, fetched.card);
    }
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
