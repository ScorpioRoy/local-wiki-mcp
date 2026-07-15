# Migrating From qmd

`local-wiki-mcp` is a local-first replacement path for teams that need stable Markdown knowledge retrieval in Codex, Cursor, or other MCP clients.

## What Changes

- qmd commands are replaced with `local-wiki` commands.
- Collections are replaced by a root directory plus `.local-wiki.json`.
- External API keys are not required.
- Native SQLite, Python, GGUF models, and external vector databases are not required.

## Command Mapping

| qmd workflow | local-wiki workflow |
| --- | --- |
| Build embeddings | `local-wiki index --root <MEMORY_ROOT>` |
| Refresh after edits | `local-wiki sync --root <MEMORY_ROOT>` |
| Search collection | `local-wiki search "<query>" --root <MEMORY_ROOT>` |
| Exact search | `local-wiki grep "<text>" --root <MEMORY_ROOT>` |
| Inspect status | `local-wiki status --root <MEMORY_ROOT>` |
| Diagnose setup | `local-wiki doctor --root <MEMORY_ROOT>` |

## Recommended Config

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
  }
}
```

## MCP Tool Names

Keep these tool names stable in prompts and rules:

- `search_wiki`
- `grep_wiki`
- `read_wiki`
- `status_wiki`

## Accuracy Notes

qmd can use dense embeddings and reranking. `local-wiki-mcp` currently uses a deterministic hybrid of BM25-like tokens, character n-grams, exact phrase boosts, title boosts, and path boosts. It is very fast and stable for local Markdown, configuration names, file paths, Chinese phrases, and project notes.

The v0.4 evaluation fixture separates intent-noise retrieval from semantic paraphrases. This makes the embedding gap measurable instead of assuming that n-grams are semantic vectors. A future optional local embedding provider can be added behind the same MCP tool names without forcing API keys or external services on the default installation.
