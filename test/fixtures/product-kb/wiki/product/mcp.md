# MCP Tool Contract

## search_wiki

`search_wiki` accepts `query`, `top_k`, `max_chunks_per_path`, and `diversity`. It returns path-diverse ranked snippets and an index-stale warning when source files changed.

## grep_wiki

`grep_wiki` accepts an exact `pattern` and optional `top_k`. It is best for error text, configuration names, paths, class names, and function identifiers.

## read_wiki

`read_wiki` accepts a path, path suffix, or chunk id in `target`, plus optional `max_chars`. It returns indexed text without writing the source document.

## status_wiki

`status_wiki` reports index version, creation time, chunk count, includes, and added, changed, or deleted files. `strict: true` hashes every current source file.

## Read-Only Serve Mode

Plain `local-wiki serve` exposes four read-only tools and never refreshes the index. Automatic writes require explicit `serve --watch`; MCP tool names remain stable across versions.
