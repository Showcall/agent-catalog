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

/**
 * Cards are a few KB at most. Anything larger is not a card and only invites a
 * costly parse plus an oversized catalog entity, so we skip it. (The kube
 * client buffers the proxied body before we see it, so this caps the parse and
 * the stored payload, not the initial read — the apiserver proxy and the fetch
 * timeout bound that. A true byte-cap would need a streamed proxy call.)
 * Approximated by string length; a UTF-16 unit is close enough for a guard.
 */
export const MAX_CARD_BYTES = 1024 * 1024; // 1 MiB

/**
 * Validate a proxy path before it becomes part of a privileged apiserver call.
 * The path may come from a Service annotation (`agentcatalog.io/a2a-path`) —
 * i.e. from anyone who can label a discoverable Service — so it is untrusted.
 * A strict allowlist (unreserved URL path chars + `/`) rejects schemes (`:`),
 * queries (`?`), fragments (`#`), percent-encoding (`%`), whitespace, and
 * control characters in one shot; `..` segments are then forbidden so a path
 * cannot traverse out of the service-proxy scope. Returns a normalized,
 * leading-slash-stripped path, or null if unsafe.
 */
export function sanitizeCardPath(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 256) return null;
  const stripped = trimmed.replace(/^\/+/, '');
  if (!stripped) return null;
  if (!/^[A-Za-z0-9._~/-]+$/.test(stripped)) return null;
  if (stripped.split('/').some(seg => seg === '..')) return null;
  return stripped;
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
      const path = sanitizeCardPath(rawPath);
      if (!path) continue; // unsafe or malformed path — never reaches the API
      try {
        const res: unknown = await withTimeout(
          this.api.connectGetNamespacedServiceProxyWithPath({ namespace, name, path }),
          this.opts.timeoutMs,
        );
        // client-node returns the proxied body as a string; be defensive.
        const text = proxyResponseText(res);
        if (text.length > MAX_CARD_BYTES) continue; // oversized: not a card
        const card = JSON.parse(text);
        if (isValidCard(card)) return card;
      } catch {
        // fall through to the next path
      }
    }
    return null;
  }
}
