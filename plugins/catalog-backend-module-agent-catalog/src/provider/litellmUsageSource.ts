/**
 * LiteLLM ledger client (ADR 0008). Reads windowed per-consumer aggregates
 * from `/user/daily/activity` — chosen deliberately: it is an OSS endpoint
 * (the `/global/spend/report` family is not available in every deployment)
 * and its `breakdown.api_keys` entries carry `key_alias` + `team_id`, which
 * is the
 * entire matching ladder in one call. Verified against a live proxy;
 * shapes vary by version, so everything here is defensive.
 */

import type { ConsumerUsage, UsageSnapshot } from './usage';

export interface UsageSource {
  /** One windowed snapshot, or null if the ledger is unreachable. Never throws. */
  fetch(): Promise<UsageSnapshot | null>;
}

interface DailyActivityKeyEntry {
  metrics?: {
    api_requests?: number;
    successful_requests?: number;
    total_tokens?: number;
    spend?: number;
  };
  metadata?: { key_alias?: string | null; team_id?: string | null };
}

interface DailyActivityResponse {
  results?: Array<{
    date?: string;
    breakdown?: { api_keys?: Record<string, DailyActivityKeyEntry> };
  }>;
  metadata?: { has_more?: boolean; page?: number };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Windowed usage responses are modest JSON; cap to bound a hostile/broken ledger. */
export const MAX_USAGE_BYTES = 8 * 1024 * 1024; // 8 MiB

/**
 * True when the gateway base URL would put the API key on the wire in
 * plaintext. https is always fine; http is tolerated only for loopback (local
 * dev and the demo ledger on 127.0.0.1), never across a network. Unparseable
 * or non-http(s) URLs are treated as unsafe.
 */
export function isInsecureGatewayUrl(baseUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return true;
  }
  if (u.protocol === 'https:') return false;
  if (u.protocol !== 'http:') return true;
  const host = u.hostname;
  return !(
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' || // WHATWG URL keeps the brackets on IPv6 hostnames
    host === '127.0.0.1' ||
    host.startsWith('127.')
  );
}

export class LiteLLMUsageSource implements UsageSource {
  constructor(
    private readonly opts: {
      baseUrl: string;
      apiKey: string;
      windowDays: number;
      timeoutMs?: number;
    },
  ) {}

  private async get(path: string): Promise<unknown> {
    // Fail closed: never send the spend key over a plaintext, non-loopback URL.
    // (Error text carries no key material; the caller turns a throw into a
    // null snapshot, so usage simply reports unreachable.)
    if (isInsecureGatewayUrl(this.opts.baseUrl)) {
      throw new Error(
        'refusing to send the gateway API key over a non-https, non-loopback baseUrl',
      );
    }
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`LiteLLM ${path}: HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? NaN);
    if (Number.isFinite(len) && len > MAX_USAGE_BYTES) {
      throw new Error(`LiteLLM ${path}: response too large (${len} bytes)`);
    }
    return res.json();
  }

  async fetch(): Promise<UsageSnapshot | null> {
    try {
      const end = new Date();
      end.setDate(end.getDate() + 1); // inclusive of today
      const start = new Date();
      start.setDate(start.getDate() - this.opts.windowDays);

      // Aggregate per key hash across dates and pages.
      const byKey = new Map<string, ConsumerUsage>();
      for (let page = 1; page <= 20; page++) {
        const d = (await this.get(
          `/user/daily/activity?start_date=${isoDate(start)}&end_date=${isoDate(
            end,
          )}&page=${page}`,
        )) as DailyActivityResponse;

        for (const day of d.results ?? []) {
          for (const [hash, entry] of Object.entries(
            day.breakdown?.api_keys ?? {},
          )) {
            const m = entry.metrics ?? {};
            const requests = m.api_requests ?? m.successful_requests ?? 0;
            const cur = byKey.get(hash) ?? {
              alias: entry.metadata?.key_alias ?? undefined,
              teamId: entry.metadata?.team_id ?? undefined,
              requests: 0,
              totalTokens: 0,
              spend: 0,
              lastActive: undefined as string | undefined,
            };
            cur.requests += requests;
            cur.totalTokens += m.total_tokens ?? 0;
            cur.spend += m.spend ?? 0;
            if (requests > 0 && day.date) {
              cur.lastActive =
                !cur.lastActive || day.date > cur.lastActive
                  ? day.date
                  : cur.lastActive;
            }
            byKey.set(hash, cur);
          }
        }
        if (!d.metadata?.has_more) break;
      }

      // Resolve team ids -> aliases (best effort; ids remain usable).
      try {
        const teams = (await this.get('/team/list')) as Array<{
          team_id?: string;
          team_alias?: string;
        }>;
        const aliasById = new Map(
          (teams ?? [])
            .filter(t => t.team_id)
            .map(t => [t.team_id as string, t.team_alias]),
        );
        for (const c of byKey.values()) {
          if (c.teamId) c.teamAlias = aliasById.get(c.teamId) ?? undefined;
        }
      } catch {
        // team aliases are cosmetic — ids still group correctly
      }

      return {
        source: 'litellm',
        windowDays: this.opts.windowDays,
        fetchedAt: Date.now(),
        stale: false,
        consumers: [...byKey.values()],
      };
    } catch {
      return null;
    }
  }
}
