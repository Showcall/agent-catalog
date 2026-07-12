# agent-catalog

Domain language for the agent inventory: how agents are discovered across
runtimes, projected into a neutral shape, and triaged. Terms here are the
ubiquitous language — use them in code, tests, and ADRs.

## Language

**Agent**:
An AI workload the catalog tracks — a kagent/ARK custom resource, a labeled
A2A Service, or a heuristically-identified LLM workload.
_Avoid_: bot, service (for the agent itself), app

**Shadow agent**:
An agent found by probing unlabeled Services for a live A2A card — one nobody
registered. Carries `discovery: probe`.
_Avoid_: unknown agent, rogue agent, orphan

**Discovery source**:
How an agent came to be known: `crd` (a runtime custom resource), `label` (an
explicit A2A label), `probe` (the sweep), or `heuristic` (evidence-based).
_Avoid_: origin, method

**AgentSnapshot**:
The neutral, typed projection of one agent's current state — booleans, enums,
dates, nullable domain values, keyed by `entityRef`. The core currency the
findings logic and the views consume. The Backstage catalog entity (with its
`agentcatalog.io/*` annotations) is one *serialization* of a snapshot, not the
snapshot itself.
_Avoid_: row, DTO, model, entity (for the domain value)

**Entity → AgentSnapshot mapper**:
The single adapter that reads catalog entities and their annotations and
produces AgentSnapshots. The only module that reads the annotation wire format.
_Avoid_: transformer, parser, converter

**Finding**:
One prioritized, severity-ranked item that needs an owner's attention (an
unreachable agent, an unowned agent, interface drift, …), derived purely from
AgentSnapshots and referencing affected agents by `entityRef`.
_Avoid_: issue, alert, health check, problem

**Scan report**:
The provenance of a discovery run — what was examined, matched, and skipped
(with reason), per cluster. Produced by the collectors, exposed by the backend.
_Avoid_: audit log, scan result, history
