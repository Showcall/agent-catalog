/**
 * Pure helpers for the fleet view's summary tiles and click-to-filter, over
 * the neutral `AgentSnapshot` the backend serves. These are view-interaction
 * concerns (which tiles filter to what); the heavier triage derivation
 * (findings + severity) lives server-side in the core (ADR 0011).
 */

import type { AgentSnapshot } from '@showcall/backstage-plugin-agent-catalog-backend';

/** Owner unresolved: unset, or the catch-all "unknown"/"unowned" placeholder.
 * Mirrors the core's `isUnowned` (kept local to avoid a runtime import from the
 * backend package into the browser bundle). */
export function isUnowned(snap: AgentSnapshot): boolean {
  const owner = snap.owner;
  if (!owner || !owner.trim()) return true;
  return /(^|\/)(unknown|unowned)$/i.test(owner);
}

export interface FleetStats {
  agents: number;
  shadow: number;
  unreachable: number;
  unowned: number;
  runtimes: number;
}

export function computeFleetStats(agents: AgentSnapshot[]): FleetStats {
  return {
    agents: agents.length,
    shadow: agents.filter(a => a.discovery === 'probe').length,
    unreachable: agents.filter(a => a.reachable === false).length,
    unowned: agents.filter(isUnowned).length,
    runtimes: new Set(
      agents
        .map(a => a.runtime)
        .filter((rt): rt is string => !!rt && rt !== 'unknown'),
    ).size,
  };
}

export type FilterTone = 'accent' | 'danger' | 'warning';

/** A named filter over the fleet (a tile, or a health finding). */
export interface FleetFilter {
  id: string;
  label: string;
  match: (agent: AgentSnapshot) => boolean;
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
  filter?: (agent: AgentSnapshot) => boolean;
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
    filter: a => a.discovery === 'probe',
  },
  {
    id: 'unreachable',
    label: 'Unreachable',
    stat: 'unreachable',
    tone: 'danger',
    filter: a => a.reachable === false,
  },
  {
    id: 'unowned',
    label: 'Unowned',
    stat: 'unowned',
    tone: 'warning',
    filter: isUnowned,
  },
  { id: 'runtimes', label: 'Runtimes', stat: 'runtimes' },
];

export function filterRows(
  agents: AgentSnapshot[],
  filter: FleetFilter | undefined,
): AgentSnapshot[] {
  return filter ? agents.filter(filter.match) : agents;
}
