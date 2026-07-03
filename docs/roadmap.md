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
| — | Drift scorecard: declared `a2aConfig` skills vs skills in the served card | ⬜ |

## Rung 3: the runtime landscape (verified July 2026)

A2A reached v1.0 under the Linux Foundation with 150+ production
organizations and native support in all three major clouds. **The agent
card is the universal join point** — which is exactly the bet
[ADR 0001](adr/0001-agent-metadata-sources.md) made. Discovery strategy
follows from that, in three tiers:

### Tier A — runtime-agnostic A2A discovery on Kubernetes (highest leverage)

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

## Deliberately not on the roadmap

- Anything that gates deploys on the catalog (violates the
  [architecture invariant](architecture.md)).
- Competing with any runtime's own build/run/operate UI. We read; we don't run.
