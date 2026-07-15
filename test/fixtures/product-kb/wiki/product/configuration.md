# Configuration Reference

## Source Includes

The `.local-wiki.json` `includes` array selects files and directories under the knowledge-base root. The `exclude` array removes private directories, drafts, or matching paths from discovery.

## Index And Chunk Size

`indexDir` chooses the generated index directory. `maxChunkChars` controls the maximum text size of each indexed chunk and defaults to 2400 characters.

## Search Weights

`searchWeights.exact`, `searchWeights.title`, and `searchWeights.path` tune exact phrase, heading, and path boosts. Every weight must be a finite non-negative number.

## MCP Cache Settings

`mcpCache.reloadCheckTtlMs` limits index-file stat checks. `mcpCache.freshnessTtlMs` limits repeated source freshness scans inside the long-running MCP process.

## Watch Settings

`watch.intervalMs` controls polling frequency and `watch.strictEvery` controls periodic SHA-256 verification. `local-wiki config validate` reports malformed JSON, bad values, missing includes, and root-boundary violations.
