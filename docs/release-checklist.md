# v0.1.0 release checklist

Framing: **technical preview** — same honesty we extend to kagent and ARK.
The product surface is further along than the packaging; this list is the
packaging.

## P0 — the repo must stand alone

- [x] **Root yarn workspace** over `plugins/*` — `package.json` (workspaces),
  `.yarnrc.yml`, root `tsconfig.json`, `packageManager: yarn@4.13.0`.
  - [x] **`yarn.lock` committed** — `git clone && yarn install` is
    reproducible. Full toolchain verified standalone: `yarn tsc`, `yarn lint`,
    `yarn test` (52 passed), `yarn build`.
- [x] **CI** (GitHub Actions): `.github/workflows/ci.yml` runs tsc, lint,
  test, build on Node 20 & 22 with `yarn install --immutable`.
  - [x] CI + license badges in the README.
- [x] **Real package names** — `@showcall/backstage-plugin-agent-catalog` and
  `@showcall/backstage-plugin-catalog-backend-module-agent-catalog`, with
  repository/homepage/bugs/keywords and `publishConfig.access: public`.
  - [x] Release workflow wired: `.github/workflows/release.yml` publishes both
    packages on a `v*` tag via **npm Trusted Publishing (OIDC)** — no token,
    automatic provenance. `publishConfig` verified against real tarballs
    (frontend is ESM-only: `main` → `dist/index.esm.js`). Process documented
    in [releasing.md](releasing.md).
  - [ ] **Owner actions to enable publishing** (see [releasing.md](releasing.md)):
    create npm org `showcall`; bootstrap the first publish of each package
    manually (npm can't configure a trusted publisher for a nonexistent
    package); then add the GitHub trusted publisher in each package's npm
    settings.
- [x] **Config schema (`config.d.ts`)** for every `agentCatalog.*` key, wired
  via `configSchema` + `files`.

## P1 — the stranger's first hour

- [x] **Compatibility statement**, loud and early in the README (new
  frontend system only; Node 20/22; client-node 1.x; kagent v1alpha2; ARK
  v1alpha1 preview; LiteLLM usage).
- [ ] **Screenshots in the README** — fleet page and the agent card, static
  PNGs until the screen recording lands.
- [x] **Ship a least-privilege RBAC manifest** — `deploy/rbac.yaml` (read-only
  ClusterRole: services/endpoints list, services/proxy get, deployments list,
  kagent + ARK CR reads).
- [x] **CONTRIBUTING.md** (workspace dev setup, test loop, ADR convention) and
  **SECURITY.md** (private vuln reporting; reads cluster state + spend ledgers).
  - [x] Minimal GitHub issue templates (`.github/ISSUE_TEMPLATE/` — bug,
    feature, config with security link).

## P2 — tagging the release

- [x] CHANGELOG.md seeded (Keep a Changelog format, `Unreleased` section).
- [ ] Tag `v0.1.0`, GitHub release notes with the technical-preview framing.
- [ ] Repo topics (`backstage-plugin`, `a2a`, `ai-agents`, `kagent`) for
  discoverability.

## Known-and-accepted for v0.1 (state in release notes)

- Audit sweep designed, not implemented ([ADR 0007](adr/0007-audit-sweep.md)).
- Dapr Agents / Tier C not started ([roadmap](roadmap.md)).
- Scaffolder output shows a raw `${{ steps.pr.output.remoteUrl }}` link
  (cosmetic; the PR is created correctly).
- Provider wiring has no mocked-client tests yet (pure transforms: 52 tests).
  Closing this is a **1.0** gate, not a v0.1 one.
- Legacy-frontend UI variant not available.
