/**
 * The Entity → AgentSnapshot mapper — the adapter seam.
 *
 * The ONE place that reads the `agentcatalog.io/*` annotation wire format and
 * turns a Backstage catalog entity into a neutral `AgentSnapshot`. Everything
 * downstream (findings, fleet table, info card) consumes the snapshot and
 * never touches an annotation. It sits next to `transforms.ts` on purpose:
 * the writer and the reader of the vocabulary are local, so extracting a
 * shared annotation codec later (candidate 2) is a local move.
 */

import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import {
  AgentKind,
  AgentSnapshot,
  DiscoverySource,
  GatewaySnapshot,
  InterfaceStatus,
  SourceStatus,
} from '../core';
import { ANNOTATION_PREFIX } from './transforms';

const key = (name: string) => `${ANNOTATION_PREFIX}/${name}`;

/** Annotation value → number, treating absent as `null` (distinct from `0`). */
function num(v: string | undefined): number | null {
  return v === undefined ? null : Number(v);
}

function kindOf(specType: unknown): AgentKind {
  switch (specType) {
    case 'ai-agent-team':
      return 'team';
    case 'llm-workload':
      return 'workload';
    default:
      return 'agent';
  }
}

export function entityToSnapshot(entity: Entity): AgentSnapshot {
  const ann = entity.metadata.annotations ?? {};
  const spec = (entity.spec ?? {}) as { type?: unknown; owner?: unknown; lifecycle?: unknown };
  const reachable = ann[key('reachable')];

  return {
    ref: stringifyEntityRef(entity),
    name: entity.metadata.title ?? entity.metadata.name,
    kind: kindOf(spec.type),
    owner: typeof spec.owner === 'string' ? spec.owner : null,
    cluster: ann[key('cluster')] ?? null,
    namespace: ann[key('namespace')] ?? null,
    runtime: ann[key('runtime')] ?? null,
    // Every provider stamps discovery; `crd` is a should-not-happen fallback.
    discovery: (ann[key('discovery')] as DiscoverySource) ?? 'crd',
    agentType: ann[key('agent-type')] ?? null,
    lifecycle: typeof spec.lifecycle === 'string' ? spec.lifecycle : null,
    reachable: reachable === undefined ? null : reachable === 'true',
    sourceStatus: (ann[key('source-status')] as SourceStatus) ?? null,
    sourceLastSuccessAt: ann[key('source-last-success-at')] ?? null,
    interfaceStatus: (ann[key('interface-status')] as InterfaceStatus) ?? null,
    interfaceDrift: ann[key('interface-drift')] ?? null,
    lastObservedAt: ann[key('last-observed-at')] ?? null,
    lastActive: ann[key('last-active')] ?? null,
    usage: {
      requests: num(ann[key('usage-requests')]),
      tokens: num(ann[key('usage-tokens')]),
      costUsd: num(ann[key('usage-cost-usd')]),
      window: ann[key('usage-window')] ?? null,
    },
    model: ann[key('model-config')] ?? ann[key('model')] ?? null,
    image: ann[key('image')] ?? null,
    cardSource: ann[key('card-source')] ?? null,
    heuristicSignals: ann[key('heuristic-signals')] ?? null,
  };
}

/**
 * Project an `llm-gateway` Resource entity's unattributed consumers into a
 * neutral `GatewaySnapshot`. Reads `spec.gateway.unattributed[].alias`.
 */
export function gatewayToSnapshot(entity: Entity): GatewaySnapshot {
  const list = (entity.spec as { gateway?: { unattributed?: unknown } } | undefined)
    ?.gateway?.unattributed;
  const aliases: string[] = [];
  if (Array.isArray(list)) {
    for (const c of list) {
      const alias = (c as { alias?: unknown }).alias;
      if (typeof alias === 'string' && alias.trim()) aliases.push(alias.trim());
    }
  }
  return { unattributedAliases: aliases };
}
