import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_INDEX_VERSION, buildIndex } from "../src/indexer.js";
import { createMcpServer, createToolHandlers, listTools } from "../src/mcp.js";
import { PRODUCT_VERSION } from "../src/version.js";

const index = buildIndex([
  {
    id: "wiki/cursor/mcp.md#1",
    path: "wiki/cursor/mcp.md",
    heading: "MCP 配置",
    text: "Codex config.toml can launch local-wiki-mcp. Use search_wiki for 本地知识库检索。",
  },
  {
    id: "wiki/cursor/qmd.md#1",
    path: "wiki/cursor/qmd.md",
    heading: "qmd 替代",
    text: "qmd 不可用时，使用 BM25 和 n-gram vector 混合检索。",
  },
]);

test("listTools exposes read-only knowledge tools", () => {
  const toolNames = listTools().map((tool) => tool.name);

  assert.deepEqual(toolNames, ["search_wiki", "grep_wiki", "read_wiki", "status_wiki"]);
});

test("MCP initialize reports the product version", async () => {
  const server = createMcpServer({ indexStore: {} });
  const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize" });

  assert.equal(response.result.serverInfo.version, PRODUCT_VERSION);
});

test("MCP calls reject invalid required arguments", async () => {
  const server = createMcpServer({
    loadIndex: async () => index,
    inspectFreshness: async () => ({ stale: false, added: [], changed: [], deleted: [], unchanged: [] }),
  });
  const response = await server.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "search_wiki", arguments: { top_k: -1 } },
  });

  assert.equal(response.error.code, -32000);
  assert.match(response.error.message, /query/i);
});

test("search_wiki returns MCP text content with JSON results", async () => {
  const handlers = createToolHandlers({ loadIndex: async () => index });
  const response = await handlers.search_wiki({ query: "Codex MCP", top_k: 1 });
  const parsed = JSON.parse(response.content[0].text);

  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.results[0].path, "wiki/cursor/mcp.md");
});

test("search_wiki includes a warning when the index is stale", async () => {
  const handlers = createToolHandlers({
    loadIndex: async () => index,
    inspectFreshness: async () => ({
      stale: true,
      added: ["wiki/new.md"],
      changed: ["wiki/cursor/mcp.md"],
      deleted: [],
      unchanged: ["wiki/cursor/qmd.md"],
    }),
  });
  const response = await handlers.search_wiki({ query: "Codex MCP", top_k: 1 });
  const parsed = JSON.parse(response.content[0].text);

  assert.equal(parsed.warning.stale, true);
  assert.deepEqual(parsed.warning.added, ["wiki/new.md"]);
  assert.deepEqual(parsed.warning.changed, ["wiki/cursor/mcp.md"]);
  assert.equal(parsed.results.length, 1);
});

test("search_wiki omits warning when the index is fresh", async () => {
  const handlers = createToolHandlers({
    loadIndex: async () => index,
    inspectFreshness: async () => ({
      stale: false,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
    }),
  });
  const response = await handlers.search_wiki({ query: "Codex MCP", top_k: 1 });
  const parsed = JSON.parse(response.content[0].text);

  assert.equal(parsed.warning, undefined);
});

test("tool handlers use the shared index store for load and freshness", async () => {
  let loadCalls = 0;
  let freshnessCalls = 0;
  const handlers = createToolHandlers({
    indexStore: {
      getIndex: async () => {
        loadCalls += 1;
        return index;
      },
      getFreshness: async (_index, options) => {
        freshnessCalls += 1;
        return { stale: false, forced: options?.force === true, added: [], changed: [], deleted: [], unchanged: [] };
      },
    },
  });

  await handlers.search_wiki({ query: "Codex MCP" });
  await handlers.status_wiki({});

  assert.equal(loadCalls, 2);
  assert.equal(freshnessCalls, 2);
});

test("read_wiki returns matching chunk text", async () => {
  const handlers = createToolHandlers({ loadIndex: async () => index });
  const response = await handlers.read_wiki({ target: "wiki/cursor/qmd.md" });
  const parsed = JSON.parse(response.content[0].text);

  assert.equal(parsed.results[0].heading, "qmd 替代");
  assert.match(parsed.results[0].text, /BM25/);
});

test("status_wiki reports index metadata", async () => {
  const handlers = createToolHandlers({
    loadIndex: async () => index,
    inspectFreshness: async () => ({
      stale: false,
      added: [],
      changed: [],
      deleted: [],
      unchanged: [],
    }),
  });
  const response = await handlers.status_wiki({});
  const parsed = JSON.parse(response.content[0].text);

  assert.equal(parsed.chunk_count, 2);
  assert.equal(parsed.version, CURRENT_INDEX_VERSION);
  assert.equal(parsed.stale, false);
  assert.deepEqual(parsed.added, []);
  assert.deepEqual(parsed.changed, []);
  assert.deepEqual(parsed.deleted, []);
});
