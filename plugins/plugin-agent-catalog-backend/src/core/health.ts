/**
 * Prioritized "needs attention" derivation — pure, over `AgentSnapshot`s.
 *
 * The answer to "it's 10 PM, what actually needs me?". Invents no state: it
 * ranks the typed signals already on the snapshots (reachability, source
 * availability, interface drift, ownership, usage) plus unattributed gateway
 * consumers. Lives in `core/` so it is testable against plain snapshot
 * fixtures with no Backstage entities in sight, and reusable by any adapter
 * (Backstage today, a standalone runtime later — ADR 0011).
 */

import {
  AgentSnapshot,
  GatewaySnapshot,
  isUnowned,
} from './snapshot';

export type HealthSeverity = 'critical' | 'warning' | 'info';

export interface Finding {
  /** Stable key, usable as a React key and a test handle. */
  id: string;
  severity: HealthSeverity;
  /** Short imperative-ish label, e.g. "Unowned agents". */
  title: string;
  /** One line on why it matters / what to do. */
  detail: string;
  /** Affected agents, referenced by `AgentSnapshot.ref` for linking. */
  agentRefs: string[];
  /** Non-agent subjects (e.g. gateway key aliases with no catalog identity),
   * shown as plain text when there is no agent to link to. */
  subjects: string[];
  /** agentRefs.length + subjects.length — what the badge shows. */
  count: number;
}

interface FindingSpec {
  id: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
  match: (a: AgentSnapshot) => boolean;
}

// Ordered most- to least-urgent; the first non-empty finding is what an
// operator should look at first.
const AGENT_FINDINGS: FindingSpec[] = [
  {
    id: 'unreachable',
    severity: 'critical',
    title: 'Unreachable agents',
    detail:
      'Discovered, but their A2A card could not be fetched on the last observation — the endpoint may be down or misconfigured.',
    match: a => a.reachable === false,
  },
  {
    id: 'source-unavailable',
    severity: 'warning',
    title: 'Stale — source unavailable',
    detail:
      'Shown from the last good snapshot; the source cluster or gateway is currently unobservable, so this is not a deletion.',
    match: a => a.sourceStatus === 'unavailable',
  },
  {
    id: 'interface-drift',
    severity: 'warning',
    title: 'Interface drift',
    detail:
      'The skills served by the live A2A card differ from what the agent declares — the contract and the deployment disagree.',
    match: a => a.interfaceStatus === 'drift',
  },
  {
    id: 'unowned',
    severity: 'warning',
    title: 'Unowned agents',
    detail:
      'No owning team resolved — nobody to route an incident, cost question, or deprecation to.',
    match: a => isUnowned(a.owner),
  },
  {
    id: 'unverified-workload',
    severity: 'info',
    title: 'Unverified LLM workloads',
    detail:
      'Found by heuristics (provider-key env names / framework images), not a declared agent. Label the Service agentcatalog.io/a2a="true" to catalog it, or "false" to dismiss.',
    match: a => a.kind === 'workload' && a.discovery === 'heuristic',
  },
  {
    id: 'no-traction',
    severity: 'info',
    title: 'Deployed, no traction',
    detail:
      'Attributed to a gateway key but has handled zero requests in the usage window — live but unused.',
    match: a => a.kind !== 'workload' && a.usage.requests === 0,
  },
];

/**
 * Compute the prioritized attention list.
 *
 * @param agents   the fleet's snapshots.
 * @param gateways gateway snapshots; their `unattributedAliases` are consumers
 *                 spending under names that match no catalog identity.
 */
export function computeHealth(
  agents: AgentSnapshot[],
  gateways: GatewaySnapshot[] = [],
): Finding[] {
  const findings: Finding[] = [];

  for (const spec of AGENT_FINDINGS) {
    const matched = agents.filter(spec.match);
    if (matched.length) {
      findings.push({
        id: spec.id,
        severity: spec.severity,
        title: spec.title,
        detail: spec.detail,
        agentRefs: matched.map(a => a.ref),
        subjects: [],
        count: matched.length,
      });
    }
  }

  // Gateway consumers with no catalog identity — the "unknown agents" signal
  // (ADR 0008). Aliases seen spending that match nothing we discovered; there
  // is no agent to link, so surface the aliases as text.
  const aliases = new Set<string>();
  for (const gw of gateways) {
    for (const alias of gw.unattributedAliases) {
      if (alias.trim()) aliases.add(alias.trim());
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
      agentRefs: [],
      subjects,
      count: subjects.length,
    });
  }

  // Stable severity-major ordering so criticals always lead.
  const rank: Record<HealthSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
