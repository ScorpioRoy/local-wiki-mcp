import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_INDEX_VERSION, buildIndex } from "../src/indexer.js";
import { createMcpServer, createToolHandlers, handleMcpLine, listTools } from "../src/mcp.js";
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
  const searchSchema = listTools().find((tool) => tool.name === "search_wiki").inputSchema.properties;

  assert.deepEqual(toolNames, ["search_wiki", "grep_wiki", "read_wiki", "status_wiki"]);
  assert.deepEqual(searchSchema.scope.enum, ["global", "project"]);
  assert.equal(searchSchema.project.type, "string");
  assert.equal(searchSchema.projects.type, "array");
  assert.equal(searchSchema.include_common.type, "boolean");
});

test("MCP initialize reports the product version", async () => {
  const server = createMcpServer({ indexStore: {} });
  const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize" });

  assert.equal(response.result.serverInfo.version, PRODUCT_VERSION);
});

test("stdio line handling reports malformed JSON without throwing", async () => {
  const server = createMcpServer({ loadIndex: async () => index });
  const malformed = JSON.parse(await handleMcpLine(server, "not-json"));
  const valid = JSON.parse(await handleMcpLine(server, JSON.stringify({
    jsonrpc: "2.0",
    id: 9,
    method: "initialize",
  })));

  assert.equal(malformed.error.code, -32700);
  assert.equal(valid.result.serverInfo.version, PRODUCT_VERSION);
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
  assert.equal(parsed.confidence.level, parsed.results[0].confidence.level);
  assert.equal(parsed.output_budget_tokens, 2000);
});

test("search_wiki and grep_wiki enforce explicit project scope", async () => {
  const scopedIndex = buildIndex([
    { id: "wiki/legacy-app/questionnaire.md#1", path: "wiki/legacy-app/questionnaire.md", heading: "Legacy App", text: "QUESTIONNAIRE_SHARED 问卷需求" },
    { id: "wiki/support-service/questionnaire.md#1", path: "wiki/support-service/questionnaire.md", heading: "Project B", text: "QUESTIONNAIRE_SHARED 问卷需求" },
    { id: "wiki/common/source.md#1", path: "wiki/common/source.md", heading: "事实源", text: "QUESTIONNAIRE_SHARED 问卷需求先确认项目。" },
  ]);
  const handlers = createToolHandlers({ loadIndex: async () => scopedIndex });

  const searchResponse = await handlers.search_wiki({ query: "问卷需求", project: "Legacy App", top_k: 10 });
  const search = JSON.parse(searchResponse.content[0].text);
  const grepResponse = await handlers.grep_wiki({ pattern: "QUESTIONNAIRE_SHARED", project: "legacy-app" });
  const grep = JSON.parse(grepResponse.content[0].text);

  assert.deepEqual(search.scope, { mode: "project", projects: ["legacy-app"], include_common: true });
  assert(search.results.some((result) => result.path === "wiki/legacy-app/questionnaire.md"));
  assert(search.results.some((result) => result.path === "wiki/common/source.md"));
  assert(!search.results.some((result) => result.path.startsWith("wiki/support-service/")));
  assert.deepEqual(grep.results.map((result) => result.path), [
    "wiki/legacy-app/questionnaire.md",
    "wiki/common/source.md",
  ]);
});

test("search_wiki canonicalizes repository ids through configured project groups", async () => {
  const groupedIndex = buildIndex([
    { id: "wiki/support-suite/questionnaire.md#1", path: "wiki/support-suite/questionnaire.md", heading: "support-suite", text: "SUPPORT_SUITE_GROUP_SCOPE" },
    { id: "wiki/legacy-app/questionnaire.md#1", path: "wiki/legacy-app/questionnaire.md", heading: "Legacy App", text: "SUPPORT_SUITE_GROUP_SCOPE" },
    { id: "daily/2026-08/2026-08-07.md#1", path: "daily/2026-08/2026-08-07.md", heading: "历史前端", text: "- 项目·模块: support-web · 问卷\nSUPPORT_SUITE_GROUP_SCOPE" },
  ]);
  const handlers = createToolHandlers({
    loadIndex: async () => groupedIndex,
    projectGroups: {
      "support-suite": ["support-web", "support-service", "data-sync", "admin-service"],
    },
  });

  const response = await handlers.search_wiki({ query: "SUPPORT_SUITE_GROUP_SCOPE", project: "support-web", top_k: 10 });
  const parsed = JSON.parse(response.content[0].text);

  assert.deepEqual(parsed.scope, { mode: "project", projects: ["support-suite"], include_common: true });
  assert(parsed.results.some((result) => result.path === "wiki/support-suite/questionnaire.md"));
  assert(parsed.results.some((result) => result.heading === "历史前端"));
  assert(!parsed.results.some((result) => result.path.startsWith("wiki/legacy-app/")));
});

test("search_wiki and grep_wiki isolate personal wiki from project facts", async () => {
  const multiRootIndex = buildIndex([
    { id: "wiki/support-suite/shared.md#1", path: "wiki/support-suite/shared.md", heading: "共享", text: "MCP_MULTI_ROOT_SCOPE" },
    { id: "agent-memory/wiki/support-suite/private.md#1", path: "agent-memory/wiki/support-suite/private.md", heading: "个人", text: "MCP_MULTI_ROOT_SCOPE" },
    { id: "agent-memory/wiki/common/common.md#1", path: "agent-memory/wiki/common/common.md", heading: "通用", text: "MCP_MULTI_ROOT_SCOPE" },
    { id: "agent-memory/wiki/legacy-app/private.md#1", path: "agent-memory/wiki/legacy-app/private.md", heading: "Legacy App", text: "MCP_MULTI_ROOT_SCOPE" },
  ]);
  const handlers = createToolHandlers({
    loadIndex: async () => multiRootIndex,
    projectGroups: {
      "support-suite": ["support-web", "support-service", "data-sync", "admin-service"],
    },
    scopeRoots: [".", "agent-memory"],
  });

  const search = JSON.parse((await handlers.search_wiki({
    query: "MCP_MULTI_ROOT_SCOPE",
    project: "data-sync",
    top_k: 10,
  })).content[0].text);
  const grep = JSON.parse((await handlers.grep_wiki({
    pattern: "MCP_MULTI_ROOT_SCOPE",
    project: "support-suite",
    top_k: 10,
  })).content[0].text);

  for (const response of [search, grep]) {
    const paths = response.results.map((result) => result.path);
    assert(paths.includes("wiki/support-suite/shared.md"));
    assert(!paths.includes("agent-memory/wiki/support-suite/private.md"));
    assert(paths.includes("agent-memory/wiki/common/common.md"));
    assert(!paths.includes("agent-memory/wiki/legacy-app/private.md"));
  }
});

test("project scope requires at least one project", async () => {
  const handlers = createToolHandlers({ loadIndex: async () => index });

  await assert.rejects(
    handlers.search_wiki({ query: "Codex", scope: "project" }),
    /requires at least one project/i,
  );
});

test("search_wiki supports adjacent context and token budget controls", async () => {
  const contextualIndex = buildIndex([
    { id: "wiki/context.md#1", path: "wiki/context.md", heading: "Before", text: "前置说明。" },
    { id: "wiki/context.md#2", path: "wiki/context.md", heading: "Target", text: "RUNTIME_BUDGET_TARGET 配置。" },
    { id: "wiki/context.md#3", path: "wiki/context.md", heading: "After", text: "后续验证。" },
  ]);
  const handlers = createToolHandlers({ loadIndex: async () => contextualIndex });
  const response = await handlers.search_wiki({
    query: "RUNTIME_BUDGET_TARGET",
    context_chars: 200,
    max_output_tokens: 500,
    diversity: false,
  });
  const parsed = JSON.parse(response.content[0].text);

  assert.match(parsed.results[0].context.before, /前置说明/);
  assert.match(parsed.results[0].context.after, /后续验证/);
  assert.equal(parsed.output_budget_tokens, 500);
});

test("search_wiki applies configured local reranking when requested", async () => {
  const handlers = createToolHandlers({
    loadIndex: async () => index,
    reranker: {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test-model",
      candidateLimit: 2,
      semanticWeight: 0.8,
    },
    rerankerFetch: async (_url, options) => {
      const { input } = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ embeddings: input.map(() => [1, 0]) }),
      };
    },
  });
  const response = await handlers.search_wiki({ query: "Codex MCP", top_k: 2, rerank: true });
  const parsed = JSON.parse(response.content[0].text);

  assert.equal(parsed.reranker.applied, true);
  assert.equal(parsed.reranker.provider, "ollama");
  assert(parsed.results.length >= 1 && parsed.results.length <= 2);
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
