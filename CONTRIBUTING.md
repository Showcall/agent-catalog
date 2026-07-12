# Contributing to Agent Catalog

Thanks for helping improve Showcall Agent Catalog. The project is an open
source technical preview, so clear bug reports, runtime integrations, tests,
and documentation are all valuable contributions.

Please do not use public issues to report security vulnerabilities. See
[SECURITY.md](SECURITY.md) for the private reporting path.

## Before You Start

- Check the [roadmap](docs/roadmap.md), existing issues, and open pull requests.
- For a new feature, describe the problem and the users affected before
  settling on an implementation.
- Keep changes focused. A small pull request is easier to review and release.
- Do not include credentials, private cluster names, internal URLs, or
  customer data in commits, fixtures, screenshots, issues, or pull requests.

## Development Setup

Agent Catalog is a standalone Yarn workspace over `plugins/*`. You do not
need a sibling Backstage application to build or test the published packages.

Requirements:

- Node.js 20 or 22
- Corepack and Yarn 4.13.0
- Git

```bash
git clone https://github.com/Showcall/agent-catalog.git
cd agent-catalog
corepack enable
yarn install --immutable
```

If you change dependencies, commit the updated `yarn.lock`.

Run the same checks used by CI:

```bash
yarn tsc
yarn lint
CI=true yarn test
yarn build
```

The frontend and backend package tests can also be run from their workspace
directories with `yarn test`.

## Local Demo

The full demo installs kagent by default and can optionally install ARK to
show multi-runtime discovery. It requires a local Kubernetes cluster plus
`kubectl`, `helm`, Node.js, `npx`, and Yarn.

```bash
minikube start --cpus=4 --memory=8192
./demo/check.sh
./demo/up.sh
./demo/backstage.sh
```

The disposable Backstage app opens at `http://localhost:3001/agents`. To add
ARK to the same cluster:

```bash
DEMO_RUNTIMES="kagent ark" ./demo/up.sh
```

See [demo/README.md](demo/README.md) for runtime packs, cluster configuration,
troubleshooting, and cleanup.

## Architecture Decisions

Significant design choices live as ADRs under [docs/adr/](docs/adr/) — one
decision per file covering context, decision, alternatives, and consequences.
If a non-trivial change would contradict a documented decision, update the
relevant ADR or add a new one.

## Project Areas

| Area                                | Location                                                     |
| ----------------------------------- | ------------------------------------------------------------ |
| Backend discovery and transforms    | `plugins/plugin-agent-catalog-backend/src/provider/` |
| Frontend fleet page and entity card | `plugins/plugin-agent-catalog/src/components/`               |
| Demo manifests and runtime packs    | `demo/`                                                      |
| Kubernetes read-only permissions    | `deploy/rbac.yaml`                                           |
| Architecture decisions              | `docs/adr/`                                                  |
| Product direction                   | `docs/roadmap.md`                                            |

## Pull Requests

Create a branch from `main`, using a short descriptive name such as
`agent/add-runtime-provider` or `fix/card-timeout`:

```bash
git switch -c agent/short-description
```

A useful pull request includes:

- the problem and the user impact
- the approach and any compatibility implications
- tests or checks run, including the result
- documentation updates for changed configuration or workflows
- a changelog entry under `Unreleased` for user-visible behavior, breaking
  changes, or security fixes

For behavior changes, add focused tests next to the implementation. For
provider changes, cover discovery, transformation, full mutation, and
fail-soft behavior where applicable. Documentation-only changes do not need
new tests, but should pass `git diff --check` and targeted formatting checks.

Please keep commits reviewable and avoid unrelated formatting or dependency
churn. Maintainers handle version bumps, tags, and npm publication through the
[release workflow](docs/releasing.md).

## License

By contributing, you agree that your contribution is submitted under the
project's [Apache-2.0 license](LICENSE).
