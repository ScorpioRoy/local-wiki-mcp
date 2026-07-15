# Changelog

## 0.4.0 - 2026-07-15

- Added `version`, `config validate`, `doctor --verbose`, `status --metrics`, and `explain` product commands.
- Added strict config diagnostics for malformed JSON, invalid values, unknown fields, missing includes, and root-boundary violations.
- Added clean `.tgz` installation verification with an isolated npm cache and an installed-package smoke test.
- Added release readiness checks, Changelog-based release notes, reviewed rollback plans, and npm provenance workflow scaffolding.
- Expanded CI to Windows, macOS, and Linux on Node.js 20, 22, and 24.
- Added short CI and 12-hour local watch soak modes with mutation, strict-freshness, and retrieval checks.
- Added UTF-8/editor policies, placeholder-safe MCP examples, release documentation, and a Chinese README.
- Expanded the product evaluation suite to 150 query variants with category-level metrics.
- Separated private integration fixtures from a sanitized self-contained product corpus and enforced root-bound index directories.

## 0.3.0 - 2026-07-15

- Added compact index v3 with `tokenCount`, precomputed vector norms, logical validation, and v2 rebuild migration.
- Reduced search work by iterating query n-grams and added an MCP in-memory index/freshness cache.
- Added default path-diverse results and configurable `max_chunks_per_path`/`diversity` options.
- Added fast mtime/size incremental sync with reuse of unchanged search features.
- Added index-operation locking, symlink skipping, overlapping-include deduplication, and strict freshness checks.
- Added `watch`, opt-in `serve --watch`, `smoke`, and `init --template minimal|agent-memory`.
- Expanded eval reporting and added 50-query quality thresholds.
- Added Windows, macOS, and Linux CI coverage.

## 0.2.0 - 2026-07-07

- Added `.local-wiki.json` configuration for includes, excludes, index directory, chunk size, and search boost weights.
- Added true incremental `sync` that reuses unchanged chunks and refreshes only added or changed files.
- Added `bench` and `eval` commands for latency checks and retrieval quality fixtures.
- Added stale-index warnings to `search_wiki` MCP responses.
- Added product release metadata, troubleshooting, migration, and security documentation.

## 0.1.0 - 2026-07-06

- Added local JSON indexing for Markdown, text, and HTML files.
- Added hybrid BM25-like, n-gram, exact, title, and path search.
- Added read-only MCP tools: `search_wiki`, `grep_wiki`, `read_wiki`, and `status_wiki`.
- Added `init`, `doctor`, `repair`, `config`, and `audit` product commands.
