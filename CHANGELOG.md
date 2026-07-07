# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While
on the `0.x` line (technical preview), minor versions may include breaking
changes.

## [Unreleased]

### Added

- Standalone yarn workspace over `plugins/*` with a committed lockfile —
  `git clone && yarn install && yarn test` works with no sibling app.
- GitHub Actions CI: type check, lint, test, and package build on Node 20/22.
- Config schema (`config.d.ts`) for all `agentCatalog.*` keys.
- Least-privilege RBAC manifest at `deploy/rbac.yaml`.
- `CONTRIBUTING.md` and `SECURITY.md`.
- Runtime-pack demo structure (`demo/runtimes/<name>/`) with kagent as the
  default runtime and ARK optional, selected via `DEMO_RUNTIMES`.

### Changed

- Package names moved from `@internal/*` to the publishable `@showcall/*`
  scope (`@showcall/backstage-plugin-agent-catalog`,
  `@showcall/backstage-plugin-catalog-backend-module-agent-catalog`).

## [0.1.0] - unreleased

Initial technical-preview surface: kagent + ARK ingestion, labeled A2A Service
discovery, heuristic LLM-workload discovery, live A2A-card enrichment,
LLM-gateway (LiteLLM) usage/traction, and the `/agents` fleet view.

[Unreleased]: https://github.com/Showcall/agent-catalog/compare/main...HEAD
