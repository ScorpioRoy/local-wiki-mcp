import { createIndexStore } from "./index-store.js";
import { grepIndex, readFromIndex, searchIndex } from "./search.js";
import { rerankSearchResults } from "./reranker.js";
import { PRODUCT_VERSION } from "./version.js";
import { publicProjectScope, resolveProjectScope } from "./project-scope.js";

export function listTools() {
  return [
    {
      name: "search_wiki",
      description: "Hybrid search the local agent-memory wiki. Use for concepts, decisions, setup notes, and coding workflow knowledge.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          top_k: { type: "number", description: "Maximum result count. Default 8." },
          max_chunks_per_path: { type: "number", description: "Maximum chunks returned from one file. Default 1." },
          diversity: { type: "boolean", description: "Keep path-diverse results. Default true." },
          topic_diversity: { type: "boolean", description: "Collapse repeated daily topics. Default true." },
          context_chars: { type: "number", description: "Adjacent context characters per result. Default 0." },
          max_output_tokens: { type: "number", description: "Approximate result token budget. Default 2000." },
          rerank: { type: "boolean", description: "Use the configured loopback local reranker. Default follows config." },
          scope: { type: "string", enum: ["global", "project"], description: "Search globally or restrict results to explicit projects. Defaults to project when project/projects is supplied." },
          project: { type: "string", description: "Single project id, for example legacy-app. Project scope also retains common knowledge by default." },
          projects: { type: "array", items: { type: "string" }, description: "Explicit project allowlist for cross-project work." },
          include_common: { type: "boolean", description: "Include common wiki, rules, templates, and product docs in project scope. Default true." },
        },
        required: ["query"],
      },
    },
    {
      name: "grep_wiki",
      description: "Exact substring search for config keys, error text, file names, APIs, and identifiers.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Exact text to find." },
          top_k: { type: "number", description: "Maximum result count. Default 20." },
          max_chunks_per_path: { type: "number", description: "Maximum exact-match chunks returned from one file. Default 3." },
          scope: { type: "string", enum: ["global", "project"], description: "Search globally or restrict exact matches to explicit projects." },
          project: { type: "string", description: "Single project id, for example legacy-app." },
          projects: { type: "array", items: { type: "string" }, description: "Explicit project allowlist for cross-project work." },
          include_common: { type: "boolean", description: "Include common knowledge in project scope. Default true." },
        },
        required: ["pattern"],
      },
    },
    {
      name: "read_wiki",
      description: "Read indexed wiki chunks by path, path suffix, or chunk id after search_wiki/grep_wiki finds a source.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Path, path suffix, or chunk id." },
          max_chars: { type: "number", description: "Maximum characters per chunk. Default 12000." },
        },
        required: ["target"],
      },
    },
    {
      name: "status_wiki",
      description: "Report local wiki index status and metadata.",
      inputSchema: {
        type: "object",
        properties: {
          strict: { type: "boolean", description: "Hash all source files for a strict freshness check." },
        },
      },
    },
  ];
}

export function createToolHandlers(options = {}) {
  const root = options.root ?? process.cwd();
  const indexDir = options.indexDir;
  const store = options.indexStore ?? createIndexStore({
    root,
    indexDir,
    includes: options.includes,
    exclude: options.exclude,
    reloadCheckTtlMs: options.reloadCheckTtlMs,
    freshnessTtlMs: options.freshnessTtlMs,
    idleUnloadMs: options.idleUnloadMs,
  });
  const load = options.loadIndex ?? (() => store.getIndex());
  const inspect = options.inspectFreshness ?? ((index, inspectOptions) => store.getFreshness(index, inspectOptions));
  const weights = options.weights;
  const queryAliases = options.queryAliases;
  const projectGroups = options.projectGroups;
  const scopeRoots = options.scopeRoots;
  const rerankerConfig = options.reranker ?? { provider: "none" };

  return {
    async search_wiki(args) {
      const query = requiredString(args.query, "query");
      const topK = optionalPositiveInteger(args.top_k ?? args.topK, 8, "top_k");
      const maxChunksPerPath = optionalPositiveInteger(
        args.max_chunks_per_path ?? args.maxChunksPerPath,
        undefined,
        "max_chunks_per_path",
      );
      const contextChars = optionalNonNegativeInteger(args.context_chars ?? args.contextChars, 0, "context_chars");
      const maxOutputTokens = optionalPositiveInteger(
        args.max_output_tokens ?? args.maxOutputTokens,
        2000,
        "max_output_tokens",
      );
      const index = await load();
      const freshness = await inspect(index, { force: false });
      const projectScope = resolveProjectScope({ ...args, projectGroups, scopeRoots });
      const rerankRequested = args.rerank ?? rerankerConfig.provider !== "none";
      const lexicalResults = searchIndex(index, query, {
        topK: rerankRequested ? Math.max(topK, rerankerConfig.candidateLimit ?? 20) : topK,
        maxChunksPerPath,
        diversity: args.diversity ?? true,
        topicDiversity: args.topic_diversity ?? args.topicDiversity ?? true,
        contextChars,
        maxOutputTokens: rerankRequested ? undefined : maxOutputTokens,
        weights,
        queryAliases,
        projectScope,
      });
      const reranked = rerankRequested
        ? await rerankSearchResults(index, query, lexicalResults, rerankerConfig, {
          topK,
          fetch: options.rerankerFetch,
        })
        : { results: lexicalResults };
      const { results, ...reranker } = reranked;
      return jsonContent({
        query,
        ...(freshness.stale ? { warning: staleWarning(freshness) } : {}),
        ...(rerankRequested ? { reranker } : {}),
        confidence: results[0]?.confidence ?? null,
        output_budget_tokens: maxOutputTokens,
        scope: publicProjectScope(projectScope),
        results,
      });
    },

    async grep_wiki(args) {
      const pattern = requiredString(args.pattern, "pattern");
      const maxChunksPerPath = optionalPositiveInteger(
        args.max_chunks_per_path ?? args.maxChunksPerPath,
        3,
        "max_chunks_per_path",
      );
      const index = await load();
      const projectScope = resolveProjectScope({ ...args, projectGroups, scopeRoots });
      const results = grepIndex(index, pattern, {
        topK: optionalPositiveInteger(args.top_k ?? args.topK, 20, "top_k"),
        maxChunksPerPath,
        projectScope,
      });
      return jsonContent({ pattern, scope: publicProjectScope(projectScope), results });
    },

    async read_wiki(args) {
      const target = requiredString(args.target, "target");
      const index = await load();
      const results = readFromIndex(index, target, {
        maxChars: optionalPositiveInteger(args.max_chars ?? args.maxChars, 12000, "max_chars"),
      });
      return jsonContent({ target, results });
    },

    async status_wiki(args = {}) {
      const index = await load();
      const freshness = await inspect(index, { force: true, strict: args.strict === true });
      return jsonContent({
        version: index.version,
        created_at: index.createdAt,
        chunk_count: index.chunkCount,
        root: index.metadata?.root,
        includes: index.metadata?.includes ?? [],
        stale: freshness.stale,
        added: freshness.added,
        changed: freshness.changed,
        deleted: freshness.deleted,
        unchanged_count: freshness.unchanged.length,
        ...(typeof store.getStats === "function" ? { cache: store.getStats() } : {}),
      });
    },
  };
}

function staleWarning(freshness) {
  return {
    stale: true,
    message: "The local-wiki index is stale. Run `local-wiki sync` to refresh it.",
    added: freshness.added,
    changed: freshness.changed,
    deleted: freshness.deleted,
  };
}

export function createMcpServer(options = {}) {
  const handlers = options.handlers ?? createToolHandlers(options);

  return {
    async handle(message) {
      if (message.method === "initialize") {
        return response(message.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "local-wiki-mcp", version: PRODUCT_VERSION },
          instructions: "Use search_wiki first for local knowledge. For project work, pass project or projects so search_wiki and grep_wiki enforce project isolation; omit them only for an intentional global search. Use read_wiki for full indexed chunks. Treat results as read-only source references.",
        });
      }

      if (message.method === "tools/list") {
        return response(message.id, { tools: listTools() });
      }

      if (message.method === "tools/call") {
        const name = message.params?.name;
        const args = message.params?.arguments ?? {};
        if (!handlers[name]) {
          return errorResponse(message.id, -32601, `Unknown tool: ${name}`);
        }
        try {
          const result = await handlers[name](args);
          return response(message.id, result);
        } catch (error) {
          return errorResponse(message.id, -32000, error.message);
        }
      }

      if (message.id !== undefined) {
        return errorResponse(message.id, -32601, `Unknown method: ${message.method}`);
      }

      return null;
    },
  };
}

export function startStdioServer(options = {}) {
  const server = createMcpServer(options);
  let buffer = "";

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const output = await handleMcpLine(server, line);
      if (output) process.stdout.write(`${output}\n`);
    }
  });
}

export async function handleMcpLine(server, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return JSON.stringify(errorResponse(null, -32700, "Parse error: expected one JSON-RPC object per line."));
  }
  const result = await server.handle(message);
  return result ? JSON.stringify(result) : null;
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonContent(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalPositiveInteger(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function optionalNonNegativeInteger(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}
