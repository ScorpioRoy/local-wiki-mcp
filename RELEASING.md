# Releasing local-wiki-mcp

This repository is the source of truth for the `local-wiki-mcp` package. Knowledge-base templates and agent-memory installations should consume a tagged package or a packed `.tgz`; they should not maintain a second copy of the source.

## Local Readiness

Run on Node.js 20, 22, or 24:

```powershell
npm ci --ignore-scripts
npm run ci
npm run test:soak
npm run release:check
```

`test:pack` creates a real tarball, installs it in a clean temporary project, initializes a knowledge base, builds an index, and runs `smoke`. The short soak mutates a temporary wiki and verifies strict freshness. `npm run soak:watch` defaults to 12 hours for a release-candidate machine.

## Remote Prerequisites

Before public publication:

1. Create the remote repository and set `origin`.
2. Add real `repository`, `homepage`, and `bugs` URLs to `package.json`.
3. Add a project security contact to `SECURITY.md`.
4. Confirm the npm package name and ownership.
5. Configure the `npm` GitHub environment and either trusted publishing or `NPM_TOKEN`.

The strict command fails while any of these release boundaries are unresolved:

```powershell
npm run release:check:publish
```

## Version And Publish

1. Update `package.json`, `package-lock.json`, `src/version.js`, and `CHANGELOG.md` to the same version.
2. Run the local readiness commands.
3. Commit the release, create an annotated `vX.Y.Z` tag, and push the commit and tag.
4. The release workflow tests Windows, macOS, and Linux on Node.js 20, 22, and 24 before publishing with npm provenance.

The workflow extracts GitHub release notes from the matching Changelog section.

## Rollback

Publication rollback is intentionally not automatic. Generate a reviewed command plan:

```powershell
npm run release:rollback-plan -- --version 0.4.0 --previous 0.3.0
```

The plan deprecates the failed version and moves the selected dist-tag back to a known-good version. It does not execute network commands or unpublish package history.
