/**
 * Pure entity -> fleet-table-row projection. Kept separate from FleetPage so
 * the annotation-reading logic is unit-testable without rendering.
 */

import type { Entity } from '@backstage/catalog-model';

export const A = 'agentcatalog.io';

export interface AgentRow {
  entity: Entity;
  name: string;
  owner: string;
  runtime: string;
  discovery: string;
  lifecycle: string;
  reachable: string;
  lastActive: string;
  requests: number | undefined;
  window: string;
}

export function toRow(entity: Entity): AgentRow {
  const ann = entity.metadata.annotations ?? {};
  const requests = ann[`${A}/usage-requests`];
  return {
    entity,
    name: entity.metadata.title ?? entity.metadata.name,
    owner: String(entity.spec?.owner ?? '—'),
    runtime: ann[`${A}/runtime`] ?? 'unknown',
    discovery: ann[`${A}/discovery`] ?? '—',
    lifecycle: String(entity.spec?.lifecycle ?? '—'),
    reachable: ann[`${A}/reachable`] ?? '—',
    lastActive: ann[`${A}/last-active`] ?? '—',
    requests: requests !== undefined ? Number(requests) : undefined,
    window: ann[`${A}/usage-window`] ?? '',
  };
}
