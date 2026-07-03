/**
 * Fetch an agent's live A2A card (`/.well-known/agent.json`) by proxying
 * through the Kubernetes API server:
 *   GET /api/v1/namespaces/{ns}/services/http:{svc}:{port}/proxy/{path}
 *
 * This reuses the kubeconfig the provider already loads, so it works whether
 * Backstage runs locally (host -> apiserver -> service) or in-cluster, with no
 * port-forward or direct pod networking. See docs/adr/0001.
 */

import { KubeConfig, CoreV1Api } from '@kubernetes/client-node';
import type { A2ACard } from './transforms';

export interface CardFetcher {
  /** Returns the parsed card, or null if unreachable / not JSON. Never throws. */
  fetch(namespace: string, service: string): Promise<A2ACard | null>;
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
    private readonly opts: { port: number; path: string; timeoutMs: number },
  ) {
    this.api = kc.makeApiClient(CoreV1Api);
  }

  async fetch(namespace: string, service: string): Promise<A2ACard | null> {
    // Service subresource name encodes scheme + port: `http:<svc>:<port>`.
    const name = `http:${service}:${this.opts.port}`;
    const path = this.opts.path.replace(/^\//, '');
    try {
      const res: unknown = await withTimeout(
        this.api.connectGetNamespacedServiceProxyWithPath({ namespace, name, path }),
        this.opts.timeoutMs,
      );
      // client-node returns the proxied body as a string; be defensive.
      const text =
        typeof res === 'string'
          ? res
          : typeof (res as { body?: unknown })?.body === 'string'
          ? (res as { body: string }).body
          : JSON.stringify(res);
      const card = JSON.parse(text);
      return card && typeof card === 'object' ? (card as A2ACard) : null;
    } catch {
      return null;
    }
  }
}
