# Roadmap

Where this is going, and why in this order. Positioning holds at every rung:
we are a *consumer* of agent runtimes, never a competitor to any of them —
each new runtime below is a catalog **source**, not a rival.

## The ladder

| Rung | Scope | Status |
|---|---|---|
| 1 | BYO agents projected from the kagent CRD (image/env-name provenance) | ✅ done |
| 2 | Live A2A-card enrichment for all agents (kube-proxy fetch, fail-soft) | ✅ done |
| 3 | Non-kagent discovery — below | ⬜ next |
| — | **Audit sweep**: probe unlabeled Services for cards (shadow-agent hunt; the high-value follow-on to Tier A — see [ADR 0006](adr/0006-a2a-label-discovery.md)) | ⬜ |
| — | Drift scorecard: declared `a2aConfig` skills vs skills in the served card | ⬜ |
| — | Usage scorecard: cumulative tokens/requests per agent — below | ⬜ |

## Rung 3: the runtime landscape (verified July 2026)

A2A reached v1.0 under the Linux Foundation with 150+ production
organizations and native support in all three major clouds. **The agent
card is the universal join point** — which is exactly the bet
[ADR 0001](adr/0001-agent-metadata-sources.md) made. Discovery strategy
follows from that, in three tiers:

### Tier A — runtime-agnostic A2A discovery on Kubernetes (highest leverage)

> Design: [ADR 0006](adr/0006-a2a-label-discovery.md) (proposed).

One feature that covers every framework at once: discover Services/
Deployments labeled as agent-card servers (e.g. `agentcatalog.io/a2a: "true"`
+ optional port/path annotations) and run them through the *existing*
enrichment path. Immediately catalogs self-hosted agents built on ADK,
LangGraph, CrewAI, LlamaIndex, Semantic Kernel, AutoGen, Strands, the
OpenAI Agents SDK, or the Claude Agent SDK — no per-framework code.

Prerequisite fix: newer A2A spec versions serve the card at
`/.well-known/agent-card.json`; kagent serves `/.well-known/agent.json`
(verified: kagent answers on both). The card fetcher should try both paths
before declaring an agent unreachable.

### Tier B — additional CRD-based runtimes (same pattern as kagent)

| Runtime | Notes |
|---|---|
| [ARK](https://mckinsey.github.io/agents-at-scale-ark/) (McKinsey) | `Agent`, `Team`, `Query`, `Model` CRDs — very kagent-shaped. Its `Team` kind (multi-agent grouping) has no catalog equivalent yet; likely maps to `System`. |
| [Dapr Agents](https://dapr.io) (CNCF) | Agents ride the Dapr runtime; discovery via Dapr app annotations/components rather than a dedicated Agent CRD. |
| [Agent Sandbox](https://kubernetes.io/blog/2026/03/20/running-agents-on-kubernetes-with-agent-sandbox/) (kubernetes-sigs) | `Sandbox` CRD — isolation primitive more than identity source; watch, don't integrate yet. |

Each becomes its own provider (per [ADR 0003](adr/0003-full-mutation-per-refresh.md),
per-source providers with distinct locationKeys is the scaling shape anyway).

### Tier C — hosted runtime providers (API-based, not kubeconfig)

| Platform | Notes |
|---|---|
| Amazon Bedrock AgentCore Runtime | Speaks A2A natively incl. agent card — Tier A's enrichment logic reuses cleanly. |
| Azure AI Foundry / Copilot Studio | Copilot Studio A2A GA'd April 2026. |
| Google Vertex AI Agent Engine / ADK | ADK agents serve cards wherever deployed. |

These matter for real enterprises (fleets are hybrid), but each needs cloud
auth + list APIs — bigger lift, after Tiers A/B prove the multi-source model.

## Usage scorecard: cumulative tokens/requests per agent

The ask: surface "this agent has been live 5 days but only handled X
requests / Y tokens" alongside the existing entities — a cumulative counter
read at poll time, not a stored call history (keeps the catalog a stateless
mirror, same shape as the existing card-fetch enrichment; see
[architecture.md](architecture.md)).

This splits cleanly in two, because kagent's ownership of the model call
differs by agent kind (verified July 2026):

- **Declarative agents — low lift.** kagent's own controller constructs and
  wraps the model call (model/prompt/tools all live in the CRD), so it
  already has the hook to emit per-call token accounting. Surfacing it is
  close to free: query kagent's existing usage metrics per agent since
  `creationTimestamp`, stamp it onto the entity, fail-soft like the card
  fetch.
- **BYO agents — genuine gap, not yet closeable for free.** The CRD is just
  a container spec (`spec.byo.deployment`); kagent never sees inside the
  process, so there's no equivalent hook. Closing this requires one of:
  1. A self-instrumentation contract — BYO images expose usage via their
     own metrics endpoint or extend their A2A response with usage fields.
     Cleanest long-term, but opt-in per image author, unenforceable.
  2. An egress sidecar/proxy deriving token counts from intercepted
     request/response bodies — works without image cooperation, but breaks
     if the image does its own TLS to the provider, and is real
     per-agent infra to build and run.
  3. Scraping a Prometheus endpoint if the image happens to expose one —
     free when present, but not guaranteed, so can't be the baseline.

Given the split, don't ship one "usage scorecard" feature that quietly only
works for declarative agents — track it as two rows, and treat the BYO gap
as open until one of the three options above is chosen.

## Deliberately not on the roadmap

- Anything that gates deploys on the catalog (violates the
  [architecture invariant](architecture.md)).
- Competing with any runtime's own build/run/operate UI. We read; we don't run.
