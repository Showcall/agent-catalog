# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While
on the `0.x` line (technical preview), minor versions may include breaking
changes.

## [Unreleased]

### Added

- Mocked-kube-client tests for the four entity providers (kagent, ARK, A2A
  discovery, heuristic): full `refresh()` coverage of the list → transform →
  full-mutation path, namespace exclusion, claimed/labeled yielding, and
  fail-soft error handling (incl. ARK's "404 = no ARK here").
- Frontend tests: extracted the fleet-row projection to a pure `toRow` and
  unit-tested it, plus render tests for `AgentInfoCard`. 52 → 80 tests.

### Security

- **Card-fetch path hardening.** The `agentcatalog.io/a2a-path` Service
  annotation is untrusted (set by whoever can label a discoverable Service)
  and flowed into a privileged kube-apiserver service-proxy request. It is now
  sanitized: paths containing a scheme, query, fragment, percent-encoding, or a
  `..` traversal segment are rejected and fall back to the well-known card
  paths. `agentcatalog.io/a2a-port` is clamped to a valid TCP port (1–65535).
- **Response size caps.** Card bodies over 1 MiB are skipped before parsing,
  and oversized LiteLLM usage responses are rejected — bounding parse cost and
  stored-entity size against a hostile or broken endpoint.
- **Gateway key protection.** The LiteLLM spend key is never sent over a
  non-https, non-loopback `baseUrl` (fail closed); http remains allowed only
  for loopback (local dev / the demo ledger).

## [0.1.1] - 2026-07-08

### Fixed

- The **Agents** sidebar item now appears under Backstage's new frontend
  system. The fleet page registered no `routeRef`, so the app's nav module
  (`AppNav`) filtered it out — the page was reachable at `/agents` but never
  surfaced in the sidebar. It now creates and passes a `routeRef`.
  Classic/custom sidebars using `AgentCatalogSidebarItem` were unaffected.

## [0.1.0] - 2026-07-07

First technical-preview release, published to npm as
`@showcall/backstage-plugin-agent-catalog` and
`@showcall/backstage-plugin-catalog-backend-module-agent-catalog`.

### Added

- Agent discovery across runtimes: kagent (`kagent.dev/v1alpha2`) and ARK
  (`ark.mckinsey.com/v1alpha1`) CRDs, runtime-agnostic labeled A2A Services,
  and heuristic discovery of unlabeled LLM-consuming workloads.
- Live A2A agent-card enrichment through the kube-apiserver service proxy.
- LLM-gateway (LiteLLM) usage/traction: per-agent annotations plus a gateway
  Resource with team rollups and unattributed-consumer surfacing.
- `/agents` fleet view and a per-agent Agent info card (new frontend system).
- Standalone yarn workspace over `plugins/*` with a committed lockfile —
  `git clone && yarn install && yarn test` works with no sibling app.
- GitHub Actions CI (tsc, lint, test, build on Node 20/22) and an OIDC
  trusted-publishing release workflow.
- Config schema (`config.d.ts`) for all `agentCatalog.*` keys.
- Least-privilege RBAC manifest at `deploy/rbac.yaml`.
- `CONTRIBUTING.md`, `SECURITY.md`, and a runtime-pack demo
  (`demo/runtimes/<name>/`, kagent default / ARK optional via `DEMO_RUNTIMES`).

### Known limitations

- Audit sweep designed but not implemented ([ADR 0007](docs/adr/0007-audit-sweep.md)).
- Provider classes have no mocked-client tests yet (transforms: 52 tests).
- Frontend requires Backstage's new frontend system; legacy-frontend apps get
  the backend module but no UI.

[Unreleased]: https://github.com/Showcall/agent-catalog/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Showcall/agent-catalog/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Showcall/agent-catalog/releases/tag/v0.1.0
