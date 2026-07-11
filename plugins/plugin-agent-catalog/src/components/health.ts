/**
 * Pure "needs attention" derivation for the fleet health summary.
 *
 * Turns the raw catalog entities into a prioritized list of actionable
 * findings — the answer to "it's 10 PM, what actually needs me?". Kept
 * separate from the view so the triage logic is unit-testable without
 * rendering, same split as `toRow`/FleetPage.
 *
 * Every finding is derived from signals already stamped by the collectors
 * (ownership, reachability, source availability, interface drift, gateway
 * usage); the summary invents no new state, it just ranks what's there.
 */

import type { Entity } from '@backstage/catalog-model';

export const A = 'agentcatalog.io';

export type HealthSeverity = 'critical' | 'warning' | 'info';

export interface HealthFinding {
  /** Stable key, usable as a React key and a test handle. */
  id: string;
  severity: HealthSeverity;
  /** Short imperative-ish label, e.g. "Unowned agents". */
  title: string;
  /** One line on why it matters / what to do. */
  detail: string;
  /** Affected agent entities, for linking from the view. */
  entities: Entity[];
  /**
   * Non-entity subjects (e.g. gateway key aliases with no catalog identity).
   * Rendered as plain text when there is no entity to link to.
   */
  subjects: string[];
  /** entities.length + subjects.length — what the badge shows. */
  count: number;
}

function ann(entity: Entity, key: string): string | undefined {
  return entity.metadata.annotations?.[`${A}/${key}`];
}

function specType(entity: Entity): string | undefined {
  const t = (entity.spec as { type?: unknown } | undefined)?.type;
  return typeof t === 'string' ? t : undefined;
}

/** An agent whose owner is unset or points at the catch-all default group. */
function isUnowned(entity: Entity): boolean {
  const owner = (entity.spec as { owner?: unknown } | undefined)?.owner;
  if (typeof owner !== 'string' || !owner.trim()) return true;
  // The backend stamps a configured defaultOwner when nothing better is known;
  // that is exactly the "nobody has claimed this" case we want to surface.
  return /(^|\/)(unknown|unowned)$/i.test(owner);
}

interface FindingSpec {
  id: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
  /** Include this agent entity in the finding? */
  match: (e: Entity) => boolean;
}

// Ordered most- to least-urgent. The view renders them in this order and the
// first non-empty finding is what an operator should look at first.
const AGENT_FINDINGS: FindingSpec[] = [
  {
    id: 'unreachable',
    severity: 'critical',
    title: 'Unreachable agents',
    detail:
      'Discovered, but their A2A card could not be fetched on the last observation — the endpoint may be down or misconfigured.',
    match: e => ann(e, 'reachable') === 'false',
  },
  {
    id: 'source-unavailable',
    severity: 'warning',
    title: 'Stale — source unavailable',
    detail:
      'Shown from the last good snapshot; the source cluster or gateway is currently unobservable, so this is not a deletion.',
    match: e => ann(e, 'source-status') === 'unavailable',
  },
  {
    id: 'interface-drift',
    severity: 'warning',
    title: 'Interface drift',
    detail:
      'The skills served by the live A2A card differ from what the agent declares — the contract and the deployment disagree.',
    match: e => ann(e, 'interface-status') === 'drift',
  },
  {
    id: 'unowned',
    severity: 'warning',
    title: 'Unowned agents',
    detail:
      'No owning team resolved — nobody to route an incident, cost question, or deprecation to.',
    match: isUnowned,
  },
  {
    id: 'unverified-workload',
    severity: 'info',
    title: 'Unverified LLM workloads',
    detail:
      'Found by heuristics (provider-key env names / framework images), not a declared agent. Label the Service agentcatalog.io/a2a="true" to catalog it, or "false" to dismiss.',
    match: e => specType(e) === 'llm-workload' && ann(e, 'discovery') === 'heuristic',
  },
  {
    id: 'no-traction',
    severity: 'info',
    title: 'Deployed, no traction',
    detail:
      'Attributed to a gateway key but has handled zero requests in the usage window — live but unused.',
    match: e => {
      if (specType(e) === 'llm-workload') return false;
      const requests = ann(e, 'usage-requests');
      return requests !== undefined && Number(requests) === 0;
    },
  },
];

/**
 * Compute the prioritized attention list.
 *
 * @param agents   Component entities from the fleet query (ai-agent /
 *                 ai-agent-team / llm-workload).
 * @param gateways llm-gateway Resource entities (their `spec.gateway.unattributed`
 *                 carries consumers that match no catalog identity).
 */
export function computeHealth(
  agents: Entity[],
  gateways: Entity[] = [],
): HealthFinding[] {
  const findings: HealthFinding[] = [];

  for (const spec of AGENT_FINDINGS) {
    const entities = agents.filter(spec.match);
    if (entities.length) {
      findings.push({
        id: spec.id,
        severity: spec.severity,
        title: spec.title,
        detail: spec.detail,
        entities,
        subjects: [],
        count: entities.length,
      });
    }
  }

  // Gateway consumers with no catalog identity — the "unknown agents" signal.
  // These are key aliases seen spending at the gateway that match nothing we
  // discovered, so there is no entity to link; surface the aliases as text.
  const aliases = new Set<string>();
  for (const gw of gateways) {
    const list = (gw.spec as { gateway?: { unattributed?: unknown } } | undefined)
      ?.gateway?.unattributed;
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      const alias = (c as { alias?: unknown }).alias;
      if (typeof alias === 'string' && alias.trim()) aliases.add(alias.trim());
    }
  }
  if (aliases.size) {
    const subjects = [...aliases].sort();
    findings.push({
      id: 'unattributed-usage',
      severity: 'warning',
      title: 'Unattributed gateway usage',
      detail:
        'Gateway keys are spending under aliases that match no catalog entity — likely uncatalogued or off-cluster agents.',
      entities: [],
      subjects,
      count: subjects.length,
    });
  }

  // Stable severity-major ordering so criticals always lead.
  const rank: Record<HealthSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
