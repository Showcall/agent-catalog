---
"@showcall/backstage-plugin-agent-catalog": minor
"@showcall/backstage-plugin-catalog-backend-module-agent-catalog": minor
---

Add operator-focused fleet triage and optional audit discovery for agents.

The `/agents` fleet view now opens with current-state summary tiles and a
prioritized Needs attention panel. Operators can click findings to filter the
fleet, identify shadow agents at a glance, and choose which lower-signal
columns are visible without losing the wider operational context.

The backend adds an opt-in audit sweep that probes unlabeled Kubernetes
Services for valid A2A cards, while skipping labeled, runtime-claimed,
suppressed, and system-namespace Services. Findings are emitted as
`discovery: probe` catalog entities with bounded declared-port probing and a
separate provider location. The demo includes a shadow-agent playbook that
shows the discovery flow end to end.
