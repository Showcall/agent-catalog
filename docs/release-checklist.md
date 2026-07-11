# Release Readiness

This is the short checklist for each public package release. The detailed
publishing setup and trusted-publisher instructions live in
[releasing.md](releasing.md).

## Before The Release PR

- [ ] All intended feature and fix PRs are merged into main.
- [ ] The root CHANGELOG.md has clear entries under Unreleased.
- [ ] Each published-package change has an explicit Changeset.
- [ ] yarn changeset status reports the intended bump for both packages.

## In The Release PR

- [ ] Both public package versions remain in lockstep.
- [ ] The generated version matches the release intent: a 0.x minor for a new
  capability, or a patch for a compatible fix.
- [ ] The changelog entry accurately describes user-visible behavior and any
  operational or configuration considerations.
- [ ] CI passes: typecheck, lint, tests, and package build.
- [ ] Demo and documentation steps still match the released behavior.

## Publishing

- [ ] Merge the release PR.
- [ ] Confirm the package version and tag match exactly.
- [ ] Push vX.Y.Z and watch the Release workflow publish both packages.
- [ ] Confirm the GitHub Release and npm package pages after the workflow
  completes.

## Current Boundaries

- The audit sweep is opt-in and off by default because it probes declared
  Service ports (ADR 0007).
- Dapr Agents and hosted registry sources remain future work.
- The frontend requires Backstage's new frontend system; the backend module
  remains usable without the frontend package.
