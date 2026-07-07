# Contributing

Thanks for your interest in agent-catalog. This is a **technical preview**
(v0.1.x) — interfaces and config keys may still change. Issues and PRs are
welcome.

## Development setup

This repo is a standalone [yarn](https://yarnpkg.com) workspace over
`plugins/*`. You do **not** need a sibling Backstage app to build or test it.

Requirements: Node 20 or 22, and Corepack (bundled with Node) to provision
the pinned yarn version.

```bash
corepack enable
git clone https://github.com/Showcall/agent-catalog
cd agent-catalog
yarn install
```

## The test loop

```bash
yarn tsc      # type check the whole workspace
yarn lint     # lint changed packages
yarn test     # run unit tests
yarn build    # build both packages
```

CI runs exactly these on Node 20 and 22 for every PR. Run them locally before
pushing. If you change dependencies, commit the updated `yarn.lock`.

## Trying changes in a real Backstage app

The `demo/` directory spins up a local Kubernetes agent estate and a
disposable Backstage app wired to these plugins:

```bash
./demo/check.sh   # preflight
./demo/up.sh      # cluster + runtimes (kagent by default)
./demo/backstage.sh
```

See [demo/README.md](demo/README.md) for details, including how to point an
existing Backstage app at the demo cluster.

## Architecture decisions

Significant design choices live as ADRs under [docs/adr/](docs/adr/) — one
decision per file (context, decision, alternatives, consequences). If you're
about to ask "why is it done this way," the answer should be there; if it
isn't, that's a gap worth an ADR. Non-trivial PRs that change a documented
decision should update or add the relevant ADR.

## Pull requests

- Keep PRs focused; one concern per PR.
- Match the surrounding code's style, naming, and comment density.
- Add or update tests for behavior changes.
- Update `CHANGELOG.md` under the `Unreleased` heading.

## Reporting security issues

Please do not open public issues for vulnerabilities. See
[SECURITY.md](SECURITY.md).
