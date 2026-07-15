# Security

`local-wiki-mcp` is designed to run locally and read a user-selected Markdown knowledge base.

## Data Boundary

- No external API key is required.
- No external service is contacted by the tool.
- The MCP tools are read-only for normal client calls.
- Index files are written only by explicit CLI commands such as `index`, `sync`, and `repair`.
- `serve --watch` is an explicit opt-in that permits automatic index writes; plain `serve` remains read-only.
- Symbolic links are skipped so includes cannot escape the selected knowledge-base root through a link.
- Index reads and writes reject `indexDir` paths outside the selected root and reject symbolic-link components below that root.

## Sensitive Content

Do not put secrets, credentials, private customer data, or regulated data in a shared knowledge base unless your team has approved that storage. The local index contains excerpts and searchable tokens derived from source files, so deleting only the original Markdown is not enough; run `local-wiki sync` or remove the index directory too.

## Reporting Issues

If you package this for others, publish a project-specific security contact in this file before distribution. Until then, handle reports through the repository or distribution channel you control.
