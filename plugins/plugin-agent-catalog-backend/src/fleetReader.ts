/**
 * Reads the catalog and projects it into neutral core values — the server-side
 * half of Fork B (ADR 0011). The frontend no longer maps entities; it fetches
 * these snapshots and findings over HTTP. This module owns the catalog filters
 * and the mapping; the core owns the derivation.
 */

import type { BackstageCredentials } from '@backstage/backend-plugin-api';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import { computeHealth, type AgentSnapshot, type Finding } from './core';
import { entityToSnapshot, gatewayToSnapshot } from './provider/snapshotFromEntity';

const AGENT_FILTER = {
  kind: 'Component',
  'spec.type': ['ai-agent', 'ai-agent-team', 'llm-workload'],
};
const GATEWAY_FILTER = { kind: 'Resource', 'spec.type': 'llm-gateway' };

export async function readAgents(
  catalog: CatalogService,
  credentials: BackstageCredentials,
): Promise<AgentSnapshot[]> {
  const { items } = await catalog.getEntities({ filter: AGENT_FILTER }, { credentials });
  return items.map(entityToSnapshot);
}

export async function readFindings(
  catalog: CatalogService,
  credentials: BackstageCredentials,
): Promise<Finding[]> {
  const [agents, gateways] = await Promise.all([
    catalog.getEntities({ filter: AGENT_FILTER }, { credentials }),
    catalog.getEntities({ filter: GATEWAY_FILTER }, { credentials }),
  ]);
  return computeHealth(
    agents.items.map(entityToSnapshot),
    gateways.items.map(gatewayToSnapshot),
  );
}
