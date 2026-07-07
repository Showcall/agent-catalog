# v0.1.0 release checklist

Framing: **technical preview** — same honesty we extend to kagent and ARK.
The product surface is further along than the packaging; this list is the
packaging.

## P0 — the repo must stand alone

- [x] **Root yarn workspace** over `plugins/*` — `package.json` (workspaces),
  `.yarnrc.yml`, root `tsconfig.json`, `packageManager: yarn@4.13.0`.
  - [ ] **Commit `yarn.lock`** — needs a one-time `corepack enable && yarn
    install` in an environment with yarn + network (local machine or the
    first CI run). The lockfile is now un-gitignored and must be committed so
    `git clone && yarn install` is reproducible. **This is the only remaining
    P0 blocker.**
- [x] **CI** (GitHub Actions): `.github/workflows/ci.yml` runs tsc, lint,
  test, build on Node 20 & 22 with `yarn install --immutable`. First green run
  doubles as the "clone stands alone" proof.
  - [ ] Add the CI badge to the README once the workflow has run once.
- [x] **Real package names** — `@showcall/backstage-plugin-agent-catalog` and
  `@showcall/backstage-plugin-catalog-backend-module-agent-catalog`, with
  repository/homepage/bugs/keywords and `publishConfig.access: public`.
  - [ ] Decide v0.1 distribution: `npm publish` vs. documented copy-in
    (publish mechanics are staged via `publishConfig` but not yet wired to a
    release workflow).
- [x] **Config schema (`config.d.ts`)** for every `agentCatalog.*` key, wired
  via `configSchema` + `files`.

## P1 — the stranger's first hour

- [ ] **Compatibility statement**, loud and early in the README: the frontend
  plugin requires Backstage's **new frontend system** (legacy-frontend apps
  get no UI — support planned, PRs welcome); Node 20/22; `@kubernetes/client-node`
  1.x; kagent CRD v1alpha2; ARK v1alpha1 (technical preview).
- [ ] **Screenshots in the README** — fleet page and the agent card, static
  PNGs until the screen recording lands.
- [x] **Ship a least-privilege RBAC manifest** — `deploy/rbac.yaml` (read-only
  ClusterRole: services/endpoints list, services/proxy get, deployments list,
  kagent + ARK CR reads).
- [x] **CONTRIBUTING.md** (workspace dev setup, test loop, ADR convention) and
  **SECURITY.md** (private vuln reporting; reads cluster state + spend ledgers).
  - [ ] Minimal GitHub issue templates (`.github/ISSUE_TEMPLATE/`).

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
