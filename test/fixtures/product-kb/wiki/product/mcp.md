# MCP Tool Contract

## search_wiki

`search_wiki` accepts `query`, `top_k`, `max_chunks_per_path`, `diversity`, `topic_diversity`, `context_chars`, and `max_output_tokens`. It returns path-diverse ranked snippets, confidence, a bounded token response, optional adjacent context, and an index-stale warning when source files changed.

## grep_wiki

`grep_wiki` accepts an exact `pattern` and optional `top_k`. It is best for error text, configuration names, paths, class names, and function identifiers.

## read_wiki

`read_wiki` accepts a path, path suffix, or chunk id in `target`, plus optional `max_chars`. It returns indexed text without writing the source document.

## status_wiki

`status_wiki` reports index version, creation time, chunk count, includes, and added, changed, or deleted files. `strict: true` hashes every current source file.

## Read-Only Serve Mode

Plain `local-wiki serve` exposes four read-only tools and never refreshes the index. Automatic writes require explicit `serve --watch`; MCP tool names remain stable across versions.

## Shared Runtime Bridge

`local-wiki daemon --watch` starts one authenticated loopback runtime that shares IndexStore and the watcher. `local-wiki serve --daemon` is a lightweight stdio bridge. A random token in the private runtime state file protects tool calls; remote hosts and redirects are rejected. If the daemon is missing or unhealthy, auto mode falls back to direct local index access.
