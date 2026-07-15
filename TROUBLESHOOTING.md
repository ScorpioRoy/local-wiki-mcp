# Troubleshooting

## Codex Fails To Start After Editing `config.toml`

Use single quotes or forward slashes in Windows paths:

```toml
[mcp_servers.local_wiki]
command = 'node'
args = ['D:/path/to/agent-memory/tools/local-wiki-mcp/src/cli.js', 'serve', '--root', 'D:/path/to/agent-memory']
```

Generate a fresh snippet instead of hand-editing:

```powershell
local-wiki config codex --root D:\path\to\agent-memory
```

Validate the knowledge-base config independently, even when malformed JSON prevents other commands from loading:

```powershell
local-wiki config validate --root D:\path\to\agent-memory
```

## Search Results Are Missing New Wiki Content

Run:

```powershell
local-wiki status --root D:\path\to\agent-memory
local-wiki sync --root D:\path\to\agent-memory
```

If `search_wiki` returns a stale warning, `sync` is the normal fix.

For automatic refresh, run `local-wiki watch --root <ROOT>` or explicitly use `serve --watch`.

## The Index Is Missing Or Corrupt

Run:

```powershell
local-wiki repair --root D:\path\to\agent-memory
local-wiki doctor --root D:\path\to\agent-memory
```

Use `--force` when you want a full rebuild.

Index v2 is still readable. Running `local-wiki sync` upgrades it to compact index v3.

## Another Index Operation Is Running

`index`, `sync`, `repair`, and watch updates use `.local-wiki-index/index.lock`. Wait for the active operation to finish. Locks older than ten minutes are treated as stale and recovered automatically.

## Chinese Text Looks Wrong In PowerShell

First verify whether the file itself is broken or only the terminal rendering is wrong:

```powershell
local-wiki audit --root D:\path\to\agent-memory
```

If the audit reports mojibake, fix the Markdown source and run `local-wiki sync`.

## Evaluation Quality Is Too Low

Create a small fixture:

```json
[
  { "query": "Codex MCP local wiki", "expected": ["wiki/cursor/memory-wiki-system.md"], "top_k": 3 }
]
```

Then run:

```powershell
local-wiki eval --root D:\path\to\agent-memory --fixture eval.json
```

Add release gates when the fixture is representative:

```powershell
local-wiki eval --root D:\path\to\agent-memory --fixture eval.json --min-top1 0.8 --min-top5 0.95 --max-duplicate-rate 0.1
```

Tune `.local-wiki.json` `searchWeights`, improve headings, and keep important concepts in stable wiki pages rather than only in daily notes.

Inspect one ranking decision without changing data:

```powershell
local-wiki explain "your query" --root D:\path\to\agent-memory --top-k 5
```

Use `--variant-set semantic --summary` with the repository fixture to quantify paraphrase recall separately from the normal lexical product gate.
