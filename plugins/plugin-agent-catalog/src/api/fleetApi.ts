/**
 * Client for the agent-catalog backend (Fork B, ADR 0011). The frontend no
 * longer maps catalog entities — it fetches neutral snapshots and findings the
 * backend derived. Types come from the backend package via `import type`, so
 * they are erased from the browser bundle (no backend runtime pulled in).
 */

import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import type {
  AgentSnapshot,
  Finding,
  HealthSeverity,
} from '@showcall/backstage-plugin-agent-catalog-backend';

export type { AgentSnapshot, Finding, HealthSeverity };

export interface FleetApi {
  getAgents(): Promise<AgentSnapshot[]>;
  getFindings(): Promise<Finding[]>;
}

export function useFleetApi(): FleetApi {
  const discovery = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  async function get<T>(path: string): Promise<T> {
    const base = await discovery.getBaseUrl('agent-catalog');
    const res = await fetchApi.fetch(`${base}${path}`);
    if (!res.ok) {
      throw new Error(`agent-catalog ${path}: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  return {
    getAgents: () => get<AgentSnapshot[]>('/agents'),
    getFindings: () => get<Finding[]>('/findings'),
  };
}
