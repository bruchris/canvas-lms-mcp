# Releasing canvas-lms-mcp

## How releases work

Releases are fully automated via [release-please](https://github.com/googleapis/release-please). Push conventional commits to `main`; release-please opens a PR bumping the version and updating CHANGELOG.md. Merging that PR triggers the Release workflow, which:

1. **`release-please`** — creates the GitHub release and tag (e.g. `canvas-lms-mcp-v1.16.0`).
2. **`npm-publish`** — publishes to npm via OIDC Trusted Publisher (no token stored in secrets).
3. **`registry-publish`** — publishes to the MCP Registry at `registry.modelcontextprotocol.io` as `io.github.bruchris/canvas-lms-mcp`.
4. **`enhance-notes`** — enriches the GitHub release body with AI-written highlights.

## MCP Registry publish

### Authentication

The `registry-publish` job uses **GitHub OIDC** (`mcp-publisher login github-oidc`). No token or secret is required — GitHub Actions mints a short-lived OIDC token automatically when the job has `id-token: write` permission. The MCP Registry trusts GitHub's OIDC issuer and maps the `io.github.bruchris/*` namespace to the `bruchris` GitHub account.

**No `MCP_REGISTRY_TOKEN` secret is needed.** OIDC is the recommended approach for CI.

### First-time setup

OIDC publish is gated on the registry recognising the GitHub repository. On first publish from a new repo, the registry may require a one-time GitHub App authorisation. If the first automated publish fails with an authorisation error:

1. Install the [MCP Publisher CLI](https://github.com/modelcontextprotocol/registry/releases/latest) locally.
2. From the repo root, run:
   ```bash
   mcp-publisher login
   mcp-publisher publish
   ```
   This opens a browser to authorise the `bruchris` GitHub account with the registry.
3. Subsequent CI runs will succeed via OIDC without any manual step.

### server.json

`server.json` at the repo root is the manifest read by `mcp-publisher publish`. The `version` field is synced to the release tag by the workflow's "Sync server.json version" step before publishing, so the checked-in file always reflects the latest published version.

### Failure policy

`registry-publish` runs with `continue-on-error: true`. If it fails after `npm-publish` succeeded, the npm package is still live and is the source of truth. Re-run the failed job from the Actions tab; the propagation poll re-checks npm visibility before retrying the registry step.

## Manual publish (dry-run / backfill)

To publish a specific tag to the MCP Registry without going through CI, install `mcp-publisher` locally and run:

```bash
git checkout canvas-lms-mcp-v1.16.0
# edit server.json version to match, then:
mcp-publisher login
mcp-publisher publish
```

## npm publish

npm publish uses OIDC Trusted Publishing configured in the [npm package settings](https://www.npmjs.com/package/canvas-lms-mcp) under "Trusted Publisher". No `NPM_TOKEN` secret is stored; the `npm-publish` job's `id-token: write` permission supplies the OIDC grant.
