/**
 * Pure helpers for the fleet view's summary tiles and click-to-filter — kept
 * out of the component so the counting and predicates are unit-testable.
 */

import type { AgentRow } from './rows';

/** Owner unresolved: unset, or the catch-all "unknown"/"unowned" placeholder. */
export function isUnownedRow(row: AgentRow): boolean {
  const owner = row.owner;
  if (!owner || owner === '—') return true;
  return /(^|\/)(unknown|unowned)$/i.test(owner);
}

export interface FleetStats {
  agents: number;
  shadow: number;
  unreachable: number;
  unowned: number;
  runtimes: number;
}

export function computeFleetStats(rows: AgentRow[]): FleetStats {
  return {
    agents: rows.length,
    shadow: rows.filter(r => r.discovery === 'probe').length,
    unreachable: rows.filter(r => r.reachable === 'false').length,
    unowned: rows.filter(isUnownedRow).length,
    runtimes: new Set(
      rows.map(r => r.runtime).filter(rt => rt && rt !== 'unknown' && rt !== '—'),
    ).size,
  };
}

export type FilterTone = 'accent' | 'danger' | 'warning';

/** A named filter over the fleet rows (a tile, or a health finding). */
export interface FleetFilter {
  id: string;
  label: string;
  match: (row: AgentRow) => boolean;
}

/**
 * The clickable summary tiles, in display order. `stat` names the count in
 * `FleetStats`; a tile with no `filter` (Agents, Runtimes) is informational.
 */
export interface TileSpec {
  id: string;
  label: string;
  stat: keyof FleetStats;
  tone?: FilterTone;
  filter?: (row: AgentRow) => boolean;
  /** Show the small ghost mark (shadow tile). */
  ghost?: boolean;
}

export const TILES: TileSpec[] = [
  { id: 'agents', label: 'Agents', stat: 'agents' },
  {
    id: 'shadow',
    label: 'Shadow',
    stat: 'shadow',
    tone: 'accent',
    ghost: true,
    filter: r => r.discovery === 'probe',
  },
  {
    id: 'unreachable',
    label: 'Unreachable',
    stat: 'unreachable',
    tone: 'danger',
    filter: r => r.reachable === 'false',
  },
  {
    id: 'unowned',
    label: 'Unowned',
    stat: 'unowned',
    tone: 'warning',
    filter: isUnownedRow,
  },
  { id: 'runtimes', label: 'Runtimes', stat: 'runtimes' },
];

export function filterRows(
  rows: AgentRow[],
  filter: FleetFilter | undefined,
): AgentRow[] {
  return filter ? rows.filter(filter.match) : rows;
}
