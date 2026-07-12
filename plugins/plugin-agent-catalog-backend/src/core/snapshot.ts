/**
 * The neutral domain model — the core currency of the catalog.
 *
 * An `AgentSnapshot` is one agent's current state as typed domain values:
 * booleans, enums, dates, nullable fields, keyed by a stable `ref`. It is
 * deliberately free of any `@backstage/*` type. A Backstage catalog entity
 * (with its `agentcatalog.io/*` annotations) is one *serialization* of a
 * snapshot, produced by the Entity → AgentSnapshot mapper in the adapter — it
 * is not the snapshot itself. Nothing in `core/` may import `@backstage/*`;
 * that seam is what keeps findings and provenance portable (see ADR 0011).
 */

/** How an agent came to be known (docs/adr: discovery sources). Open-ended. */
export type DiscoverySource = 'crd' | 'label' | 'probe' | 'heuristic';

/** Component classification, from `spec.type`. */
export type AgentKind = 'agent' | 'team' | 'workload';

export type SourceStatus = 'available' | 'unavailable';
export type InterfaceStatus = 'in-sync' | 'drift';

/** Gateway traction for one agent. `null` requests = no key alias (absent), as
 * distinct from `0` = a matched alias that has handled nothing. */
export interface UsageSnapshot {
  requests: number | null;
  tokens: number | null;
  costUsd: number | null;
  /** The usage window label, e.g. `7d`. */
  window: string | null;
}

export interface AgentSnapshot {
  /** Stable entity ref, e.g. `component:default/foo-ns-cluster`. The id the
   * views resolve for linking and findings reference. */
  ref: string;
  /** Display name (entity title, falling back to name). */
  name: string;
  kind: AgentKind;
  /** Owning entity ref, or `null` when unresolved. See `isUnowned`. */
  owner: string | null;
  cluster: string | null;
  /** Kubernetes namespace the agent lives in (for the gateway key-alias
   * convention `<namespace>/<name>`), or `null` when unknown. */
  namespace: string | null;
  /** e.g. `kagent`, `ark`; `null`/unknown when the source doesn't say. */
  runtime: string | null;
  discovery: DiscoverySource;
  agentType: string | null;
  lifecycle: string | null;
  reachable: boolean | null;
  sourceStatus: SourceStatus | null;
  sourceLastSuccessAt: string | null;
  interfaceStatus: InterfaceStatus | null;
  interfaceDrift: string | null;
  lastObservedAt: string | null;
  lastActive: string | null;
  usage: UsageSnapshot;
  model: string | null;
  image: string | null;
  cardSource: string | null;
  /** Why a heuristic workload was flagged (raw evidence text). */
  heuristicSignals: string | null;
}

/**
 * One gateway's consumers that matched no catalog identity — the
 * "unattributed usage" signal (ADR 0008). Neutral projection of the
 * `llm-gateway` Resource entity's `spec.gateway.unattributed`.
 */
export interface GatewaySnapshot {
  unattributedAliases: string[];
}

/**
 * Owner unresolved: unset, or the catch-all `unknown`/`unowned` placeholder
 * the backend stamps when nothing better is known. A domain predicate, not a
 * presentation concern — findings and stats both ask it.
 */
export function isUnowned(owner: string | null): boolean {
  if (!owner || !owner.trim()) return true;
  return /(^|\/)(unknown|unowned)$/i.test(owner);
}
