# local-wiki-mcp

[![CI](https://github.com/ScorpioRoy/local-wiki-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ScorpioRoy/local-wiki-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/local-wiki-mcp.svg)](https://www.npmjs.com/package/local-wiki-mcp)
[![license](https://img.shields.io/npm/l/local-wiki-mcp.svg)](LICENSE)

`local-wiki-mcp` is a local-first search server for Markdown knowledge bases. It exposes read-only MCP tools for Codex, Cursor, and other AI coding tools, without API keys, hosted services, or native dependencies.

中文主文档：[README.md](README.md)

It is designed for `agent-memory` style LLM wiki systems:

- Fast local indexing into `.local-wiki-index/index.json`.
- Hybrid retrieval with BM25-like tokens, character n-grams, exact phrase boosts, title boosts, and path boosts.
- Good coverage for Chinese notes, English identifiers, file paths, API names, and configuration snippets.
- Stable MCP tools: `search_wiki`, `grep_wiki`, `read_wiki`, `status_wiki`.
- Incremental `sync` for day-to-day wiki edits.
- Compact index v3 with cached MCP loading and fast query-side n-gram scoring.
- Path-diverse results by default, with configurable per-file chunk limits.
- Config validation, verbose diagnostics, index metrics, and score explanations for product operation.
- Clean package-install verification, release gates, and watch soak tooling for team distribution.
- Compact `context` startup output, a single-instance watcher, and idle MCP index unloading.
- Deterministic field-aware ranking, identifier rewriting, heterogeneous source calibration, daily recency, confidence, and token budgets.
- A single authenticated loopback daemon with lightweight MCP bridges and direct-search fallback.
- Optional loopback-only Ollama embedding reranking with lexical fallback.

## Requirements

- Node.js 20 or newer.
- A local Markdown knowledge base.
- No external model, vector database, or API key.

## Quick Start

Install the public release:

```powershell
npm install -g local-wiki-mcp@0.7.0
```

For offline or controlled environments, install the `.tgz` attached to the GitHub Release after verifying its SHA-256 and manifest:

```powershell
npm install -g .\local-wiki-mcp-0.7.0.tgz
```

An audited source checkout can also be linked globally:

```powershell
npm install -g .
```

```powershell
local-wiki version
local-wiki init --root . --template agent-memory
local-wiki config validate --root .
local-wiki index --root .
local-wiki smoke --root .
local-wiki search "Codex MCP local wiki" --root .
```

After wiki edits, run:

```powershell
node tools/local-wiki-mcp/src/cli.js sync --root .
```

If the index is missing, corrupt, or stale:

```powershell
node tools/local-wiki-mcp/src/cli.js repair --root .
node tools/local-wiki-mcp/src/cli.js doctor --root .
```

See [INSTALLATION.md](INSTALLATION.md) for tarball, source, npm publication, upgrade, and uninstall boundaries.

## One-command Codex And Cursor Binding

`bind` is preview-only by default. It does not initialize files, refresh the index, or edit client configuration until `--apply` is present:

```powershell
local-wiki bind --root D:\path\to\agent-memory --client codex --client cursor --initialize --refresh --daemon --install-runtime
```

After reviewing the root, config paths, and requested actions:

```powershell
local-wiki bind --root D:\path\to\agent-memory --client codex --client cursor --initialize --refresh --daemon --install-runtime --apply
```

Preview performs a read-only preflight of the knowledge base and both client configurations. Conflicts return `ok: false` with no writes. Initialization defaults to a lightweight `agent-memory` skeleton; it does not deploy a full team wiki, project mappings, Rules, Skills, or Hooks, and existing knowledge bases normally omit it. Existing client configuration is backed up before an atomic write. An unmanaged Codex section, a different Cursor `local-wiki` entry, or malformed configuration stops the operation. Managed client configuration uses the current absolute Node.js executable path so GUI applications do not depend on the terminal PATH.

Packaged Windows and macOS wrappers call the same CLI implementation:

```powershell
$packageRoot = npm root -g
powershell -File "$packageRoot\local-wiki-mcp\scripts\Bind-LocalWikiKnowledgeBase.ps1" -Root D:\path\to\agent-memory -Initialize -Refresh -Daemon
```

```bash
PACKAGE_ROOT=$(npm root -g)
sh "$PACKAGE_ROOT/local-wiki-mcp/scripts/bind-knowledge-base-macos.sh" --root "$HOME/agent-memory" --client codex --client cursor --initialize --refresh --daemon
```

Add `-Apply` on Windows or `--apply` on macOS only after reviewing the preview.

## Configuration

Create `.local-wiki.json` in the knowledge-base root:

```json
{
  "includes": ["wiki", "MEMORY.md"],
  "scopeRoots": ["."],
  "exclude": ["raw/private", "*.draft.md"],
  "indexDir": ".local-wiki-index",
  "maxChunkChars": 2400,
  "searchWeights": {
    "exact": 3,
    "title": 1.5,
    "path": 1,
    "identifier": 1.25,
    "source": 0.75
  },
  "queryAliases": {
    "legacy knowledge base": ["qmd", "local-wiki", "migration"]
  },
  "projectGroups": {
    "support-suite": ["case-service", "data-sync", "support-web", "support-service", "admin-service", "workorder-service", "workorder-web"]
  },
  "mcpCache": {
    "reloadCheckTtlMs": 1000,
    "freshnessTtlMs": 5000,
    "idleUnloadMs": 300000
  },
  "runtime": {
    "mode": "off",
    "timeoutMs": 1500,
    "requestLimitBytes": 1048576
  },
  "reranker": {
    "provider": "none",
    "baseUrl": "http://127.0.0.1:11434",
    "model": "nomic-embed-text",
    "timeoutMs": 5000,
    "candidateLimit": 20,
    "semanticWeight": 0.35
  },
  "watch": {
    "intervalMs": 2000,
    "strictEvery": 30
  }
}
```

Archived or superseded pages remain strongly downranked for current-state queries. A historical page regains its normal final multiplier only when the query expresses historical intent, contains an explicit version, and that version matches the page title or path; it is then preferred over pages that merely cross-reference that version in their body. Project-level `index.md`, `log.md`, and `project-map.md` files are calibrated as navigation pages, while explicit map, index, and changelog queries can still rank them normally.

Command-line flags override the config file:

```powershell
node tools/local-wiki-mcp/src/cli.js index --root . --include wiki --index-dir .custom-index --max-chars 1800
```

Default includes are `wiki` and `MEMORY.md`. Built-in skipped directories include `.git`, `.state`, `.local-wiki-index`, and `node_modules`.

Use `scopeRoots` to declare relative knowledge roots for project and common path recognition. The default `["."]` keeps recognizing `wiki/<project>/` at the knowledge-base root. When a shared Git Wiki contains a private `agent-memory/` tree, use `[".", "agent-memory"]` to recognize both `wiki/<project>/` and `agent-memory/wiki/<project>/`. `scopeRoots` affects scope filtering only; `includes` still controls what is indexed. Entries must be non-empty relative paths that stay inside the knowledge-base root.

Use `queryAliases` for stable, knowledge-base-specific synonyms. An alias expands only when the query contains its key, contributes independent BM25 and path evidence, and never calls a model. Keep aliases narrow and verify them with eval fixtures.

Use `projectGroups` when one business project spans multiple repositories. Supplying the business project id or any member repository id canonicalizes the response to the business project and matches its Wiki, legacy member paths, and historical daily metadata. A member may belong to only one group. Keep optional dependencies out of the group and add them explicitly through `projects` when needed.

Validate values and source paths before starting MCP:

```powershell
local-wiki config validate --root .
local-wiki doctor --root . --verbose
local-wiki status --root . --strict --metrics
```

Validation reports malformed JSON, invalid numeric values, unknown fields, missing includes, and paths that escape the knowledge-base root. Existing configs remain normalized for backward compatibility.

## Commands

```text
version [--json]                         Show product and runtime versions
init    [--root DIR] [--template NAME]   Create an agent-memory or minimal skeleton
bind    [--root DIR] --client NAME        Preview or apply Codex/Cursor bindings
index   [--root DIR] [--include PATH]    Full rebuild of the local JSON index
sync    [--root DIR] [--include PATH]    Incrementally refresh the local JSON index
context [--root DIR] [--days N]          Print compact startup context
search  <query> [--root DIR] [--rerank]  Hybrid search with optional local reranking
        [--project NAME ...] [--no-common] [--global]
explain <query> [--root DIR]             Explain query parsing and score evidence
grep    <pattern> [--root DIR]           Exact substring search
        [--project NAME ...] [--no-common] [--global]
read    <path-or-id> [--root DIR]        Read indexed chunks
status  [--root DIR] [--strict]          Show index metadata and stale state
        [--metrics]                      Include index size and density metrics
doctor  [--root DIR] [--verbose]         Diagnose runtime, config, index, and MCP health
repair  [--root DIR] [--force]           Rebuild a missing, corrupt, or stale index
bench   [--root DIR] [--query TEXT]      Measure load and search latency
eval    [--root DIR] --fixture FILE      Score search against query fixtures
smoke   [--root DIR]                     Verify index and MCP search readiness
watch   [--root DIR] [--interval-ms N]   Auto-sync changed knowledge files
daemon  [--root DIR] [--watch]           Start the shared loopback runtime
runtime install|uninstall [--root DIR]   Manage Windows Startup or macOS LaunchAgent
config  codex|cursor [--root DIR]        Print MCP configuration snippets
config  validate [--root DIR]            Validate config values and source paths
audit   [--root DIR]                     Check mojibake and legacy qmd rules
serve   [--root DIR] [--watch]           Start the MCP stdio server
```

Use `explain` when a result ranks unexpectedly. It reports normalized query tokens, query rewrites, aliases, trigram counts, active weights, BM25/vector/boost components, heterogeneous source calibration, matched terms, and diversity filtering without changing the index.

## MCP Tools

### `search_wiki`

Use for concepts, decisions, setup notes, and workflow knowledge.

```json
{
  "query": "Codex MCP local wiki",
  "project": "legacy-app",
  "top_k": 8,
  "max_chunks_per_path": 1,
  "diversity": true
}
```

If the index is stale, the response includes:

```json
{
  "warning": {
    "stale": true,
    "message": "The local-wiki index is stale. Run `local-wiki sync` to refresh it.",
    "added": [],
    "changed": [],
    "deleted": []
  }
}
```

### `grep_wiki`

Use for exact text, config keys, error messages, paths, class names, and function names.

```json
{
  "pattern": "config.toml",
  "project": "legacy-app",
  "top_k": 20,
  "max_chunks_per_path": 3
}
```

`grep_wiki` returns at most three matching chunks per file by default so one long document cannot consume the result budget. Override it with `max_chunks_per_path`; the CLI equivalent is `--max-chunks-per-path`.

### Multi-project isolation

For project work, pass `project` to `search_wiki` and `grep_wiki`; for intentional cross-project work, pass an explicit `projects` allowlist. Project scope is a hard result filter. It retains `wiki/<project>/` below every configured `scopeRoots` entry, chunks whose `项目·模块:` / `project:` / `projects:` metadata matches, and common knowledge by default. Chunks and adjacent context belonging to other projects are excluded even when they share the same daily file.

```json
{
  "query": "questionnaire requirements",
  "projects": ["support-web", "support-service"],
  "include_common": true
}
```

Omitting `project` and `projects` preserves backward-compatible global search; `"scope": "global"` makes that intent explicit. Set `"include_common": false` only when shared rules, templates, and product documentation are not wanted. Responses echo the effective `scope` for verification.

With `projectGroups`, a repository id is canonicalized to its business project. For example, `project: "support-web"` can resolve and echo as `project: "support-suite"`. Keep optional systems such as Legacy App outside the fixed group and use `projects: ["support-suite", "legacy-app"]` for intentional integration work.

Equivalent CLI examples:

```powershell
local-wiki search "questionnaire requirements" --root . --project legacy-app
local-wiki grep "QUESTIONNAIRE_API" --root . --project legacy-app --no-common
local-wiki search "integration issue" --root . --project support-web --project support-service
local-wiki search "global question" --root . --global
```

### `read_wiki`

Read indexed chunks by path, path suffix, or chunk id.

```json
{
  "target": "wiki/common/memory-wiki-system.md",
  "max_chars": 12000
}
```

### `status_wiki`

Returns index version, creation time, chunk count, indexed includes, and stale-state details.

Set `strict: true` to hash all source files. Normal searches use a short freshness cache to avoid rescanning the knowledge base on every MCP call.

## Compact Startup Context

```powershell
local-wiki context --root . --days 3 --max-tasks 12 --max-chars 8000
```

`context` mechanically combines `MEMORY.md` with recent daily task headings, project fields, and pending work. It does not call a model or rewrite source Markdown. Read full daily or wiki pages only when the task needs them.

## Automatic Refresh

Run a separate watcher:

```powershell
local-wiki watch --root . --interval-ms 5000
```

Or opt in while serving MCP:

```powershell
local-wiki serve --root . --watch
```

For production, run `local-wiki daemon --root . --watch` once and configure Codex/Cursor with `serve --daemon`. The daemon binds only to loopback, authenticates with a random local state token, and enforces a 1MB request limit. If no daemon is available, an explicitly daemon-enabled bridge automatically becomes a temporary runtime owner; another bridge takes over on its next call after the owner exits, so restarting Codex or Cursor does not require a manual daemon start. Bridges fall back to direct local index access only when automatic ownership also fails. Plain `serve` remains read-only and does not start a runtime. On Windows after a global install, add the packaged runtime to the current-user Startup folder:

```powershell
$packageRoot = npm root -g
powershell -File "$packageRoot\local-wiki-mcp\scripts\install-windows-watch.ps1" -Root D:\path\to\agent-memory
```

On macOS, install the current-user LaunchAgent:

```bash
local-wiki runtime install --root "$HOME/agent-memory"
```

`runtime uninstall` removes the current-user Startup shortcut or LaunchAgent without deleting Markdown or the index. Runtime logs stay under `.state/local-wiki-runtime.log`; Windows rotates them at 5MB.

## Optional Local Semantic Reranking

Set `reranker.provider` to `ollama` to rerank lexical candidates through one local `/api/embed` batch. Only loopback hosts are accepted, and HTTP redirects are rejected. Timeouts, missing models, and invalid responses return a warning and preserve lexical results. Ollama and models are never installed automatically.

## Codex Configuration

Generate a safe TOML snippet:

```powershell
node tools/local-wiki-mcp/src/cli.js config codex --root D:\path\to\agent-memory
```

Example:

```toml
[mcp_servers.local_wiki]
command = 'node'
args = ['D:/path/to/agent-memory/tools/local-wiki-mcp/src/cli.js', 'serve', '--root', 'D:/path/to/agent-memory']
startup_timeout_sec = 10
tool_timeout_sec = 30
enabled = true
enabled_tools = ['search_wiki', 'grep_wiki', 'read_wiki', 'status_wiki']
```

Use forward slashes or TOML single quotes for Windows paths.

## Cursor Configuration

Generate a Cursor MCP snippet:

```powershell
node tools/local-wiki-mcp/src/cli.js config cursor --root D:\path\to\agent-memory
```

Example:

```json
{
  "mcpServers": {
    "local-wiki": {
      "command": "node",
      "args": [
        "D:/path/to/agent-memory/tools/local-wiki-mcp/src/cli.js",
        "serve",
        "--root",
        "D:/path/to/agent-memory"
      ]
    }
  }
}
```

The `config` commands only print snippets. Use preview-first `local-wiki bind` when safe merging into Codex or Cursor configuration is desired.

## Bench And Eval

Latency check:

```powershell
local-wiki bench --root . --query "local-wiki Product v1.4" --iterations 20
```

Evaluation fixture:

```json
[
  {
    "query": "Codex MCP local wiki",
    "expected": ["wiki/common/memory-wiki-system.md"],
    "top_k": 3
  }
]
```

Run:

```powershell
local-wiki eval --root . --fixture eval.json --summary --min-top1 0.85 --min-top5 0.97 --max-duplicate-rate 0.1
```

`eval` reports top1/top3/top5/topK rates, per-category metrics, duplicate-path rate, empty results, average latency, and p50/p95 latency. It exits with code 3 when a configured threshold fails.

The repository includes a sanitized, self-contained product corpus with two named query sets:

```powershell
# Product gate: 150 base and intent-noise queries.
npm run test:eval

# Semantic challenge: 150 queries including paraphrases with different vocabulary.
npm run eval:semantic
```

The semantic set remains diagnostic. Version 0.5.0 can optionally rerank lexical candidates through a loopback Ollama embedding model. Private agent-memory integration fixtures live outside the standalone product repository.

## Distribution And Release Checks

```powershell
npm run ci
npm run test:soak
npm run soak:watch
npm run bench:scale
```

`test:pack` creates a real `.tgz`, SHA-256 file, and manifest through the release-package builder, verifies them, installs the tarball in an isolated consumer project, then runs init, config validation, indexing, and smoke checks. `release:package` writes the same refusal-to-overwrite bundle to `dist/` for controlled internal sharing. `test:soak` is the short CI mutation test; `soak:watch` defaults to 12 hours. See [RELEASING.md](RELEASING.md) for remote metadata, npm provenance, tagging, and rollback gates.

## Migration From qmd

See [MIGRATION_FROM_QMD.md](MIGRATION_FROM_QMD.md). The short version:

- Use `local-wiki index` instead of embedding generation.
- Use `local-wiki sync` after wiki edits.
- Use `.local-wiki.json` instead of qmd collections.
- Keep prompts and rules on `search_wiki`, `grep_wiki`, `read_wiki`, and `status_wiki`.

## Troubleshooting And Security

- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- Security notes: [SECURITY.md](SECURITY.md)

Run an audit after changing rules or docs:

```powershell
node tools/local-wiki-mcp/src/cli.js audit --root .
```
