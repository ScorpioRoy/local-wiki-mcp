import { createIndexStore } from "./index-store.js";
import { grepIndex, readFromIndex, searchIndex } from "./search.js";
import { PRODUCT_VERSION } from "./version.js";

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
  });
  const load = options.loadIndex ?? (() => store.getIndex());
  const inspect = options.inspectFreshness ?? ((index, inspectOptions) => store.getFreshness(index, inspectOptions));
  const weights = options.weights;

  return {
    async search_wiki(args) {
      const query = requiredString(args.query, "query");
      const topK = optionalPositiveInteger(args.top_k ?? args.topK, 8, "top_k");
      const maxChunksPerPath = optionalPositiveInteger(
        args.max_chunks_per_path ?? args.maxChunksPerPath,
        undefined,
        "max_chunks_per_path",
      );
      const index = await load();
      const freshness = await inspect(index, { force: false });
      const results = searchIndex(index, query, {
        topK,
        maxChunksPerPath,
        diversity: args.diversity ?? true,
        weights,
      });
      return jsonContent({
        query,
        ...(freshness.stale ? { warning: staleWarning(freshness) } : {}),
        results,
      });
    },

    async grep_wiki(args) {
      const pattern = requiredString(args.pattern, "pattern");
      const index = await load();
      const results = grepIndex(index, pattern, {
        topK: optionalPositiveInteger(args.top_k ?? args.topK, 20, "top_k"),
      });
      return jsonContent({ pattern, results });
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
  const handlers = createToolHandlers(options);

  return {
    async handle(message) {
      if (message.method === "initialize") {
        return response(message.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "local-wiki-mcp", version: PRODUCT_VERSION },
          instructions: "Use search_wiki first for local knowledge. Use grep_wiki for exact identifiers and read_wiki for full indexed chunks. Treat results as read-only source references.",
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
      const message = JSON.parse(line);
      const result = await server.handle(message);
      if (result) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      }
    }
  });
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
