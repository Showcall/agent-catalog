# v0.1.0 release checklist

Framing: **technical preview** — same honesty we extend to kagent and ARK.
The product surface is further along than the packaging; this list is the
packaging.

## P0 — the repo must stand alone

- [ ] **Root yarn workspace** over `plugins/*` with a committed lockfile —
  `git clone && yarn install && yarn test` must work with no sibling app.
  (Also retires the copy-into-a-dev-app workflow.)
- [ ] **CI** (GitHub Actions): lint, tsc, unit tests, package build on every
  PR; badge in the README.
- [ ] **Real package names** — `@internal/*` is unpublishable by definition.
  Decide the npm scope, follow `backstage-plugin-*` naming conventions, add
  repository/homepage/keywords metadata. Decide v0.1 distribution: npm
  publish vs. documented copy-in.
- [ ] **Config schema (`config.d.ts`)** for every `agentCatalog.*` key so
  Backstage validates app-config instead of silently ignoring typos.

## P1 — the stranger's first hour

- [ ] **Compatibility statement**, loud and early: the frontend plugin
  requires Backstage's **new frontend system** (legacy-frontend apps get no
  UI — support planned, PRs welcome); Node 20/22; `@kubernetes/client-node`
  1.x; kagent CRD v1alpha2; ARK v1alpha1 (technical preview).
- [ ] **Screenshots in the README** — fleet page and the agent card, static
  PNGs until the screen recording lands.
- [ ] **Ship a least-privilege RBAC manifest** (ClusterRole for list
  services/endpoints + get `services/proxy` + CRD reads) instead of
  describing the verbs in prose.
- [ ] **CONTRIBUTING.md** (dev setup, test loop, ADR convention),
  **SECURITY.md** (vuln reporting path — this tool reads cluster state and
  spend ledgers), minimal issue templates.

## P2 — tagging the release

- [ ] CHANGELOG.md seeded from the git history.
- [ ] Tag `v0.1.0`, GitHub release notes with the technical-preview framing.
- [ ] Repo topics (`backstage-plugin`, `a2a`, `ai-agents`, `kagent`) for
  discoverability.

## Known-and-accepted for v0.1 (state in release notes)

- Audit sweep designed, not implemented ([ADR 0007](adr/0007-audit-sweep.md)).
- Dapr Agents / Tier C not started ([roadmap](roadmap.md)).
- Scaffolder output shows a raw `${{ steps.pr.output.remoteUrl }}` link
  (cosmetic; the PR is created correctly).
- Provider wiring has no mocked-client tests yet (pure transforms: 52 tests).
- Legacy-frontend UI variant not available.
