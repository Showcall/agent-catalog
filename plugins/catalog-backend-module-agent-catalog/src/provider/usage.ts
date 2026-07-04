/**
 * Pure logic for LLM-gateway usage (ADR 0008): matching ladder, entity
 * annotation, and the gateway summary Resource. No I/O here — the ledger
 * client lives in litellmUsageSource.ts.
 *
 * The ladder, honest at every rung:
 *   key alias `<namespace>/<agent-name>`  -> per-agent annotations
 *   consumer resolvable only to a team    -> team rollup on the gateway Resource
 *   matches nothing                       -> unattributed list (shadow signal)
 * Team totals are NEVER stamped onto individual agents — one busy agent
 * would make its dead siblings look alive.
 */

import type { Entity } from '@backstage/catalog-model';
import {
  ANNOTATION_PREFIX,
  locationOf,
  sanitizeName,
  type TransformOptions,
} from './transforms';

/** One gateway consumer's aggregates over the window. */
export interface ConsumerUsage {
  /** key alias, e.g. `agents/release-notes-agent` — the matching handle. */
  alias?: string;
  teamId?: string;
  teamAlias?: string;
  requests: number;
  totalTokens: number;
  /** USD over the window. Surfaced only when includeCost is on. */
  spend: number;
  /** Last date (YYYY-MM-DD) with at least one request. */
  lastActive?: string;
}

/** A windowed snapshot of the whole ledger. */
export interface UsageSnapshot {
  source: string;
  windowDays: number;
  fetchedAt: number;
  stale: boolean;
  consumers: ConsumerUsage[];
}

/**
 * The matching handle for an agent entity: `<k8s-namespace>/<raw name>`.
 * Uses the namespace annotation + title (the raw, unsanitized agent name)
 * that every agent Component carries.
 */
export function agentUsageId(entity: Entity): string | undefined {
  const ns = entity.metadata.annotations?.[`${ANNOTATION_PREFIX}/namespace`];
  const title = entity.metadata.title;
  return ns && title ? `${ns}/${title}` : undefined;
}

/** Bucket token counts (3 significant figures) so counters don't churn entities. */
export function bucketTokens(n: number): number {
  if (n < 1000) return n;
  const mag = 10 ** (Math.floor(Math.log10(n)) - 2);
  return Math.round(n / mag) * mag;
}

/**
 * Stamp per-agent usage annotations onto an alias-matched Component.
 * Mutates and returns the entity (same style as enrichment.ts).
 */
export function applyUsageAnnotations(
  entity: Entity,
  usage: ConsumerUsage,
  snapshot: UsageSnapshot,
  includeCost: boolean,
): Entity {
  entity.metadata.annotations = {
    ...(entity.metadata.annotations ?? {}),
    [`${ANNOTATION_PREFIX}/usage-requests`]: String(usage.requests),
    [`${ANNOTATION_PREFIX}/usage-tokens`]: String(bucketTokens(usage.totalTokens)),
    [`${ANNOTATION_PREFIX}/usage-window`]: `${snapshot.windowDays}d`,
    [`${ANNOTATION_PREFIX}/usage-source`]: snapshot.stale
      ? `${snapshot.source} (stale)`
      : snapshot.source,
    ...(usage.lastActive
      ? { [`${ANNOTATION_PREFIX}/last-active`]: usage.lastActive }
      : {}),
    ...(includeCost
      ? { [`${ANNOTATION_PREFIX}/usage-cost-usd`]: usage.spend.toFixed(2) }
      : {}),
  };
  return entity;
}

/** Find the alias-matched consumer for an agent entity, if any. */
export function usageForEntity(
  entity: Entity,
  snapshot: UsageSnapshot,
): ConsumerUsage | undefined {
  const id = agentUsageId(entity);
  if (!id) return undefined;
  return snapshot.consumers.find(c => c.alias === id);
}

/**
 * The gateway summary Resource (ADR 0008): team rollups + the unattributed
 * consumers list. `seenAgentIds` are the `<ns>/<name>` handles of every
 * agent the entity providers currently see — a consumer is:
 *   - per-agent (excluded here) if its alias matches a seen agent,
 *   - a team rollup row if it resolves to a team,
 *   - unattributed otherwise: the shadow signal.
 */
export function gatewayResourceEntity(
  snapshot: UsageSnapshot,
  seenAgentIds: Set<string>,
  opts: TransformOptions,
  includeCost: boolean,
): Entity {
  const teams = new Map<
    string,
    { requests: number; totalTokens: number; spend: number }
  >();
  const unattributed: Array<{
    alias: string;
    requests: number;
    totalTokens: number;
    lastActive?: string;
  }> = [];
  let matchedConsumers = 0;

  for (const c of snapshot.consumers) {
    const matched = !!c.alias && seenAgentIds.has(c.alias);
    if (matched) matchedConsumers++;
    const teamKey = c.teamAlias ?? c.teamId;
    if (teamKey) {
      const t = teams.get(teamKey) ?? { requests: 0, totalTokens: 0, spend: 0 };
      t.requests += c.requests;
      t.totalTokens += c.totalTokens;
      t.spend += c.spend;
      teams.set(teamKey, t);
    } else if (!matched) {
      unattributed.push({
        alias: c.alias ?? '(no alias)',
        requests: c.requests,
        totalTokens: bucketTokens(c.totalTokens),
        lastActive: c.lastActive,
      });
    }
  }

  const name = sanitizeName(`${snapshot.source}-gateway`);
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name,
      title: `${snapshot.source} gateway`,
      description:
        'LLM gateway ledger summary: team usage rollups and unattributed consumers (ADR 0008).',
      annotations: {
        ...locationOf('usage', 'gateway', 'Ledger', snapshot.source, 'usage'),
        [`${ANNOTATION_PREFIX}/usage-source`]: snapshot.stale
          ? `${snapshot.source} (stale)`
          : snapshot.source,
        [`${ANNOTATION_PREFIX}/usage-window`]: `${snapshot.windowDays}d`,
        [`${ANNOTATION_PREFIX}/consumers-total`]: String(snapshot.consumers.length),
        [`${ANNOTATION_PREFIX}/consumers-matched`]: String(matchedConsumers),
        [`${ANNOTATION_PREFIX}/consumers-unattributed`]: String(unattributed.length),
      },
      tags: ['llm-gateway', 'usage'],
    },
    spec: {
      type: 'llm-gateway',
      owner: opts.defaultOwner,
      gateway: {
        source: snapshot.source,
        windowDays: snapshot.windowDays,
        teams: [...teams.entries()].map(([team, t]) => ({
          team,
          requests: t.requests,
          totalTokens: bucketTokens(t.totalTokens),
          ...(includeCost ? { costUsd: Number(t.spend.toFixed(2)) } : {}),
        })),
        unattributed,
      },
    } as Entity['spec'],
  };
}
