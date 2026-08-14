# Release Operations

## Clean Tarball Installation

`npm run test:pack` creates a real `.tgz`, SHA-256 file, and manifest, verifies refusal to overwrite, installs the tarball into a clean consumer project, checks packaged files, initializes a knowledge base, builds an index, and runs smoke tests. `npm run release:package` writes the same controlled-sharing bundle to `dist/`.

## Cross-Platform Matrix

The CI matrix runs Windows, macOS, and Linux with Node.js 20, 22, and 24. Every job uses `npm ci`, unit tests, release checks, and clean-package installation. The macOS Node.js 24 job also installs a real current-user LaunchAgent, waits for daemon reachability, runs smoke, and uninstalls it.

## Watch Soak

`npm run test:soak` performs a short mutation test. `npm run soak:watch` defaults to twelve hours and verifies repeated updates, strict freshness, and final-marker retrieval.

## Provenance Release

A tagged release requires a publicly visible GitHub repository and runs strict metadata and Git checks before publishing the generated tarball with npm provenance. The same `.tgz`, SHA-256 file, and manifest are attached to the GitHub Release. Repository, homepage, bugs, security contact, package ownership, and credentials must be real.

## Reviewed Rollback

Rollback automation only prints a plan. The reviewed commands deprecate the failed version and move a dist-tag to a known-good version; they do not unpublish history automatically.
