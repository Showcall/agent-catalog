# Architecture Decision Records

One significant decision per file: context, decision, alternatives,
consequences. If you're about to ask "why did they do it this way" — the
answer is supposed to be here. If it isn't, that's a bug; write the missing
ADR.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-agent-metadata-sources.md) | Agent metadata comes from two sources: CRD (governance plane) + live A2A card (interface plane) | accepted |
| [0002](0002-component-not-custom-kind.md) | Agents are `Component` with `spec.type: ai-agent`, not a custom kind | accepted |
| [0003](0003-full-mutation-per-refresh.md) | Full catalog mutation per refresh, not deltas | accepted (MVP tradeoff) |
| [0004](0004-owner-annotation-not-label.md) | Ownership rides in an annotation, not a label | accepted |
| [0005](0005-entity-naming.md) | Entity names include the k8s namespace (collision fix, catalog + git layer) | accepted |
| [0006](0006-a2a-label-discovery.md) | Runtime-agnostic agent discovery via labeled Services (rung 3, Tier A) | accepted |
| [0007](0007-audit-sweep.md) | Audit sweep: probe unlabeled Services for agent cards (entities directly, trigger-first) | accepted (impl. pending) |
