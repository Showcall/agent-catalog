# 11. Findings and scan provenance belong in the backend

- Status: proposed
- Date: 2026-07-11

## Context

The fleet's most valuable output — the "needs attention" findings (what is
shadow / unowned / unreachable / drifting) — is currently derived **in the
browser** (`plugins/plugin-agent-catalog/src/components/health.ts`). It ranks
annotations the collectors already stamped; it invents no data. But because it
runs client-side:

- The findings **only exist while a tab is open.** They can't be queried,
  alerted on, or scraped. "It's 10 PM, do you know where your agents are?" is a
  promise the current architecture can't keep — nobody watches a UI at 10 PM.
- The derivation and severity model live in the view layer, untestable as a
  service and un-reusable by anything but the page.

Separately, **discovery can't explain itself.** The sweep silently skips
labeled / claimed / suppressed / cardless Services and emits what it found. A
skeptical platform lead's first question — *"how do I know this inventory is
complete, and what did you skip?"* — has no answer surfaced anywhere. That
undercuts trust in the count, which is the entire value proposition.

The blocker to fixing either server-side: the backend package
(`@showcall/backstage-plugin-agent-catalog-backend`) is today a Backstage
catalog **module** (`role: backend-plugin-module`, `pluginId: catalog`). Its
whole surface is pushing entities into the catalog via the processing extension
point; it owns no HTTP route and cannot serve `/api/...` or `/metrics`.

## Decision

1. **Export a `createBackendPlugin` from the existing backend package — no new
   npm package.** The package already ships Node code; it gains a second
   backend feature alongside the module. Its `backstage.role` becomes
   `backend-plugin`. The app registers both:

   ```ts
   backend.add(catalogModuleAgentCatalog); // ingests → catalog (unchanged)
   backend.add(agentCatalogPlugin);        // owns /api/agent-catalog/*
   ```

   The two-package floor (one browser, one Node) is preserved; the frontend/
   backend split is the only line Backstage genuinely enforces.

2. **Move the finding derivation + severity model server-side.** `computeHealth`
   relocates into the plugin (shared, unit-tested against fixtures). The
   frontend fetches findings instead of computing them, with a graceful
   empty/loading state when the endpoint isn't deployed.

3. **Serve current state, not saved state.**
   - `GET /api/agent-catalog/findings` — the ranked findings, computed on read
     from agent entities (cheap; they're already in the catalog).
   - `GET /api/agent-catalog/scan-report` — provenance (see 4).
   - Prometheus gauges (`agent_catalog_shadow_total`, `_unowned_total`,
     `_unreachable_total`, …). This is the **OSS wedge**: it lets operators
     build their own alerting, while polished drift/history/notifications stay
     on the enterprise side of the line (see [governance.md](../governance.md)).

4. **Persist scan provenance as a catalog entity** (a `Resource`,
   `spec.type: agent-scan-report`, one per cluster). Providers already run a
   full scan each cycle; they additionally publish a per-run summary —
   `examined`, `matched`, `skipped` (with reason: labeled `a2a=false`, claimed
   by a runtime CR, cardless), `unreachable`. Emitting it as an entity keeps it
   coherent with "the catalog is the source of truth" (ADR 0003), makes it
   queryable like everything else, and avoids a side channel between the module
   and the plugin. Findings stay computed-on-read; only provenance is persisted.

## Alternatives considered

- **A shared store (DB table / in-memory) the module writes and the plugin
  reads.** More "correct" as data modeling, but reintroduces exactly the
  cross-plugin coupling Backstage's extension-point design steers away from,
  and needs its own migrations/lifecycle. Rejected in favor of the catalog
  entity — the catalog *is* our shared store.
- **A third, dedicated backend plugin package.** Conventional separation
  (module ingests, plugin serves) but grows the package count with no user
  benefit — you still need all of them for one thing to work. Folded into the
  existing package instead.
- **Leave findings in the frontend.** The status quo. Fails the core promise:
  no integration surface, no alerting, no server-side tests.

## Consequences

- Findings become integratable; the metrics endpoint turns the catalog from "a
  page" into "a data source in our stack" — the actual adoption threshold.
- Provenance makes the shadow-agent "aha" believable instead of magic, and is
  itself current-state read-only, so it stays OSS.
- The derivation model gets real backend tests, and the frontend gets thinner
  (view-only, as it should be — business logic does not belong in the browser).
- **Known portability caveat (flagged for future revisit):** representing scan
  provenance as a *catalog* entity binds it to Backstage's catalog model. In a
  fully non-Backstage deployment (a standalone inventory service), that won't
  fly — provenance would need promoting to a first-class store, and findings to
  a runtime the catalog doesn't provide. Accepted now because the product *is*
  a Backstage plugin and the catalog is the right substrate here; revisit if a
  non-Backstage runtime becomes a goal. This ADR is likely the first place that
  seam shows.
