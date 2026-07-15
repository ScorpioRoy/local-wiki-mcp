# Contributing

`local-wiki-mcp` keeps its default runtime dependency-free and local-first. Changes must preserve the four MCP tool names and must not introduce required API keys, hosted services, or automatic writes in plain `serve` mode.

## Development

Use Node.js 20, 22, or 24:

```powershell
npm ci --ignore-scripts
npm test
npm run test:pack
npm run test:soak
```

For retrieval changes, run both modes against the sanitized product corpus:

```powershell
npm run test:eval
npm run eval:semantic
```

Add focused tests for behavior changes. Keep source files UTF-8, use atomic index writes, validate user-controlled paths and numeric options, and avoid unrelated refactors.

## Pull Requests

- Explain the user-facing behavior and compatibility impact.
- Include test, package-install, and relevant benchmark/eval results.
- Call out index format or MCP protocol changes explicitly.
- Update `CHANGELOG.md` and product documentation for release-visible changes.

See [RELEASING.md](RELEASING.md) for release gates. Public security reporting details must be completed when the remote repository is established.
