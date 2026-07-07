# Releasing

Releases publish both packages to npm:

- `@showcall/backstage-plugin-catalog-backend-module-agent-catalog`
- `@showcall/backstage-plugin-agent-catalog`

Publishing uses **npm Trusted Publishing (OIDC)** from
[`.github/workflows/release.yml`](../.github/workflows/release.yml): no
long-lived `NPM_TOKEN`, and provenance attestations are generated
automatically. Requirements (Node ≥ 22.14, npm ≥ 11.5.1) are handled by the
workflow.

## One-time bootstrap (per package)

npm **cannot** configure a trusted publisher for a package that does not exist
yet, so each package's *first* publish is manual. You only do this once.

1. Create the npm org **`showcall`** (npmjs.com), if it doesn't exist.
2. From a clean checkout:
   ```bash
   nvm use 22
   corepack enable
   yarn install
   yarn tsc && yarn build
   npm login          # interactive; complete 2FA
   ```
3. Publish each package once, from its directory:
   ```bash
   ( cd plugins/catalog-backend-module-agent-catalog && npm publish --access public )
   ( cd plugins/plugin-agent-catalog && npm publish --access public )
   ```
   (Provenance isn't produced for a manual local publish — that's expected;
   CI releases will have it.)

## One-time trusted-publisher setup (per package)

Once each package exists on npm, configure it to trust this repo's workflow:

npmjs.com → **Packages** → the package → **Settings** → **Trusted Publishing**
→ add a GitHub Actions publisher:

| Field | Value |
|---|---|
| Organization or user | `Showcall` |
| Repository | `agent-catalog` |
| Workflow filename | `release.yml` |
| Environment | *(leave blank)* |
| Allowed actions | `npm publish` |

Repeat for both packages. No `NPM_TOKEN` secret is needed.

## Cutting a release (every time, no token)

1. Bump `version` in **both** plugin `package.json` files (keep them in
   lockstep), then `yarn install` to update `yarn.lock`.
2. Move the `CHANGELOG.md` `Unreleased` entries under the new version.
3. Commit, then tag and push — the tag must equal the package version:
   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```
4. The **Release** workflow builds and publishes both packages via OIDC, with
   provenance. Watch it under the repo's **Actions** tab.

Notes:

- `npm publish` fails if that exact version already exists — bump the version,
  don't re-tag.
- To migrate away from trusted publishing later (or bootstrap in CI instead of
  locally), a granular/automation `NPM_TOKEN` secret + `npm publish` with
  `NODE_AUTH_TOKEN` is the fallback path.
