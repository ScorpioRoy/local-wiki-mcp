# local-wiki-mcp

`local-wiki-mcp` is a local-first search server for Markdown knowledge bases. It exposes read-only MCP tools for Codex, Cursor, and other AI coding tools, without API keys, hosted services, or native dependencies.

Chinese guide: [README.zh-CN.md](README.zh-CN.md)

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

## Requirements

- Node.js 20 or newer.
- A local Markdown knowledge base.
- No external model, vector database, or API key.

## Quick Start

From this package directory, an unpublished local install can be linked globally:

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

## Configuration

Create `.local-wiki.json` in the knowledge-base root:

```json
{
  "includes": ["wiki", "MEMORY.md"],
  "exclude": ["raw/private", "*.draft.md"],
  "indexDir": ".local-wiki-index",
  "maxChunkChars": 2400,
  "searchWeights": {
    "exact": 3,
    "title": 1.5,
    "path": 1
  },
  "mcpCache": {
    "reloadCheckTtlMs": 1000,
    "freshnessTtlMs": 5000
  },
  "watch": {
    "intervalMs": 2000,
    "strictEvery": 30
  }
}
```

Command-line flags override the config file:

```powershell
node tools/local-wiki-mcp/src/cli.js index --root . --include wiki --index-dir .custom-index --max-chars 1800
```

Default includes are `wiki` and `MEMORY.md`. Built-in skipped directories include `.git`, `.state`, `.local-wiki-index`, and `node_modules`.

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
index   [--root DIR] [--include PATH]    Full rebuild of the local JSON index
sync    [--root DIR] [--include PATH]    Incrementally refresh the local JSON index
search  <query> [--root DIR]             Hybrid search with path diversity
explain <query> [--root DIR]             Explain query parsing and score evidence
grep    <pattern> [--root DIR]           Exact substring search
read    <path-or-id> [--root DIR]        Read indexed chunks
status  [--root DIR] [--strict]          Show index metadata and stale state
        [--metrics]                      Include index size and density metrics
doctor  [--root DIR] [--verbose]         Diagnose runtime, config, index, and MCP health
repair  [--root DIR] [--force]           Rebuild a missing, corrupt, or stale index
bench   [--root DIR] [--query TEXT]      Measure load and search latency
eval    [--root DIR] --fixture FILE      Score search against query fixtures
smoke   [--root DIR]                     Verify index and MCP search readiness
watch   [--root DIR] [--interval-ms N]   Auto-sync changed knowledge files
config  codex|cursor [--root DIR]        Print MCP configuration snippets
config  validate [--root DIR]            Validate config values and source paths
audit   [--root DIR]                     Check mojibake and legacy qmd rules
serve   [--root DIR] [--watch]           Start the MCP stdio server
```

Use `explain` when a result ranks unexpectedly. It reports normalized query tokens, trigram counts, active weights, BM25/vector/boost components, matched terms, and diversity filtering without changing the index.

## MCP Tools

### `search_wiki`

Use for concepts, decisions, setup notes, and workflow knowledge.

```json
{
  "query": "Codex MCP local wiki",
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
  "top_k": 20
}
```

### `read_wiki`

Read indexed chunks by path, path suffix, or chunk id.

```json
{
  "target": "wiki/cursor/memory-wiki-system.md",
  "max_chars": 12000
}
```

### `status_wiki`

Returns index version, creation time, chunk count, indexed includes, and stale-state details.

Set `strict: true` to hash all source files. Normal searches use a short freshness cache to avoid rescanning the knowledge base on every MCP call.

## Automatic Refresh

Run a separate watcher:

```powershell
local-wiki watch --root . --interval-ms 2000
```

Or opt in while serving MCP:

```powershell
local-wiki serve --root . --watch
```

The default `serve` command remains read-only. Watch mode uses atomic writes, an index-operation lock, fast mtime/size checks, and a periodic strict hash pass.

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

## Bench And Eval

Latency check:

```powershell
local-wiki bench --root . --query "local-wiki Product v1.2" --iterations 20
```

Evaluation fixture:

```json
[
  {
    "query": "Codex MCP local wiki",
    "expected": ["wiki/cursor/memory-wiki-system.md"],
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

The semantic set is diagnostic rather than a release gate. It measures the gap that an optional local embedding provider may address in a later version. Private agent-memory integration fixtures live outside the standalone product repository.

## Distribution And Release Checks

```powershell
npm run ci
npm run test:soak
npm run soak:watch
```

`test:pack` creates and installs a real `.tgz` in an isolated consumer project, then runs init, config validation, indexing, and smoke checks. `test:soak` is the short CI mutation test; `soak:watch` defaults to 12 hours. See [RELEASING.md](RELEASING.md) for remote metadata, npm provenance, tagging, and rollback gates.

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
