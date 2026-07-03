# 1. Agent metadata comes from two sources: the CRD and the live A2A card

- Status: accepted
- Date: 2026-07-03

## Context

An agent entity in the catalog draws metadata from two places, and they are
authoritative for different things:

- **The kagent CRD (cluster / desired + deployed state).** Knows ownership,
  lifecycle (from the Ready condition), the `ModelConfig` it depends on, the
  tool/MCP servers it may call, and — for BYO agents — the container image and
  env. This is the **governance plane**. Critically, the CRD is the *only*
  place this data exists: an agent's `/.well-known/agent.json` says nothing
  about which model or which tools it uses.

- **The live A2A card (`/.well-known/agent.json`).** Knows the agent's *real*
  advertised skills, capabilities, transport, and protocol version — what it
  actually serves to other agents right now. This is the **interface plane**.
  For a declarative agent the CRD carries a *declared* `a2aConfig`, but that's
  intent; the card is ground truth. For a **BYO** agent the CRD carries no
  interface data at all, so the card is the *only* source.

Two agent types exist (`spec.type`): `Declarative` (model/tools/prompt in
`spec.declarative`) and `BYO` (`spec.byo.deployment` — an opaque container).

## Decision

1. **Fetch the live card for _every_ agent, not just BYO.** One uniform,
   runtime-agnostic path. It closes the "synthesized, not fetched" gap for
   declarative agents and enables drift detection (declared vs served skills).

2. **The CRD owns the governance plane; the live card owns the interface
   plane.** They are merged into one entity, never one overriding the other:
   - Ownership, lifecycle, `dependsOn` (model + tools), BYO image/env → CRD.
   - Real skills, capabilities, transport → live card (the `API` entity's
     `spec.definition`).

3. **Reachability: proxy through the Kubernetes API server**, not port-forward
   or direct pod networking:
   `GET /api/v1/namespaces/{ns}/services/http:{svc}:{port}/proxy/{path}`.
   Reuses the kubeconfig the provider already has; works identically for a
   Backstage running locally or in-cluster. (kagent names the Service after the
   agent, so service name = agent name, port 8080.)

4. **Keep the CRD transform pure and offline; enrichment is a separate pass.**
   `transforms.ts` (CRD → entities) makes no network calls and stays
   fixture-testable. `enrichAgentEntities()` overlays a fetched card. The
   provider owns fetching (timeout, cache), so the enrichment fn stays pure.

5. **Fail soft.** Per-agent timeout; cache last-known card in memory.
   - card fetched → `card-source: live`, `reachable: true`.
   - fetch fails but cache hit → `card-source: stale`, `reachable: false`.
   - fetch fails, declarative → fall back to the synthesized card
     (`card-source: synthesized`).
   - fetch fails, BYO → no `API` entity; Component flagged `reachable: false`.

## Alternatives considered

- **Enrich only BYO agents.** Rejected: leaves declarative cards synthesized
  (a known gap) and loses drift detection; two code paths instead of one.
- **A fully separate EntityProvider for cards.** Reasonable, but two providers
  mutating related entities is more moving parts than the demo needs. Chose a
  single provider with an enrichment pass; can split later.
- **Port-forward / direct pod IP.** Doesn't generalise beyond local dev.

## Consequences

- The provider now makes N network calls per refresh (bounded by timeout +
  cache). An unreachable agent degrades to a flagged entity, never a crash or a
  dropped entity.
- `reachable`/`card-source` become first-class governance signals — "declared
  but not answering" is now visible, which is itself an anti-sprawl lever.
- Adding a non-kagent runtime later is mostly a new discovery source; the card
  fetch + enrichment is already runtime-agnostic.
- Future: bounded fetch concurrency, persistent card cache, and drift
  detection (declared skills vs served skills) as a scorecard.
