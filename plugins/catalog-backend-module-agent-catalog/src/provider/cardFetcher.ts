/**
 * Fetch an agent's live A2A card by proxying through the Kubernetes API
 * server:
 *   GET /api/v1/namespaces/{ns}/services/http:{svc}:{port}/proxy/{path}
 *
 * Paths are tried in order — A2A v1.0 serves the card at
 * `/.well-known/agent-card.json`; kagent (and older spec versions) at
 * `/.well-known/agent.json` (ADR 0006). The proxy reuses the kubeconfig the
 * provider already loads, so it works whether Backstage runs locally or
 * in-cluster, with no port-forward or direct pod networking (ADR 0001).
 */

import { KubeConfig, CoreV1Api } from '@kubernetes/client-node';
import type { A2ACard } from './transforms';

/**
 * Minimal shape gate: keeps HTML 200s and lookalike JSON endpoints out of
 * the catalog. A card must be an object with a `name` and at least one
 * card-ish field.
 */
export function isValidCard(v: unknown): v is A2ACard {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name) return false;
  return (
    Array.isArray(o.skills) ||
    typeof o.capabilities === 'object' ||
    typeof o.protocolVersion === 'string'
  );
}

/** Normalize a client-node proxy response into the raw body text. */
function proxyResponseText(res: unknown): string {
  if (typeof res === 'string') return res;
  const body = (res as { body?: unknown })?.body;
  if (typeof body === 'string') return body;
  return JSON.stringify(res);
}

export interface CardFetchOverrides {
  /** Per-service port override (e.g. from a Service annotation). */
  port?: number;
  /** Per-service path override; replaces the default fallback chain. */
  paths?: string[];
}

export interface CardFetcher {
  /** Returns the first valid card across paths, or null. Never throws. */
  fetch(
    namespace: string,
    service: string,
    overrides?: CardFetchOverrides,
  ): Promise<A2ACard | null>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`card fetch timed out after ${ms}ms`)), ms);
    p.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      e => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class KubeProxyCardFetcher implements CardFetcher {
  private readonly api: CoreV1Api;

  constructor(
    kc: KubeConfig,
    private readonly opts: { port: number; paths: string[]; timeoutMs: number },
  ) {
    this.api = kc.makeApiClient(CoreV1Api);
  }

  async fetch(
    namespace: string,
    service: string,
    overrides?: CardFetchOverrides,
  ): Promise<A2ACard | null> {
    const port = overrides?.port ?? this.opts.port;
    const paths = overrides?.paths ?? this.opts.paths;
    // Service subresource name encodes scheme + port: `http:<svc>:<port>`.
    const name = `http:${service}:${port}`;

    for (const rawPath of paths) {
      const path = rawPath.replace(/^\//, '');
      try {
        const res: unknown = await withTimeout(
          this.api.connectGetNamespacedServiceProxyWithPath({ namespace, name, path }),
          this.opts.timeoutMs,
        );
        // client-node returns the proxied body as a string; be defensive.
        const card = JSON.parse(proxyResponseText(res));
        if (isValidCard(card)) return card;
      } catch {
        // fall through to the next path
      }
    }
    return null;
  }
}
