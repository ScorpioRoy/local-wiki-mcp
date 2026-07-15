import test from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../src/indexer.js";
import { explainSearch, searchIndex } from "../src/search.js";

const chunks = [
  {
    id: "wiki/cursor/mcp.md#1",
    path: "wiki/cursor/mcp.md",
    heading: "MCP 配置",
    text: "Codex 使用 config.toml 配置 MCP server，本地知识库通过 search_wiki 暴露。",
  },
  {
    id: "wiki/qdrant/read-only.md#1",
    path: "wiki/qdrant/read-only.md",
    heading: "Qdrant 只读模式",
    text: "设置 QDRANT_READ_ONLY=true 可以让向量库检索服务只读运行。",
  },
  {
    id: "wiki/process/daily.md#1",
    path: "wiki/process/daily.md",
    heading: "Daily 记录",
    text: "daily 记录近期工作流水，wiki 保存长期稳定知识。",
  },
];

test("searchIndex ranks exact identifier BM25 hits first", () => {
  const index = buildIndex(chunks);
  const results = searchIndex(index, "QDRANT_READ_ONLY", { topK: 3 });

  assert.equal(results[0].path, "wiki/qdrant/read-only.md");
  assert.equal(results[0].heading, "Qdrant 只读模式");
  assert(results[0].scores.bm25 > 0);
  assert.match(results[0].snippet, /QDRANT_READ_ONLY/);
});

test("searchIndex uses n-gram vector similarity for Chinese phrase queries", () => {
  const index = buildIndex(chunks);
  const results = searchIndex(index, "本地知识检索", { topK: 3 });

  assert.equal(results[0].path, "wiki/cursor/mcp.md");
  assert(results[0].scores.vector > 0);
});

test("searchIndex limits results and includes stable ids and score details", () => {
  const index = buildIndex(chunks);
  const results = searchIndex(index, "wiki 知识", { topK: 2 });

  assert.equal(results.length, 2);
  assert(results[0].id);
  assert.equal(typeof results[0].score, "number");
  assert.equal(typeof results[0].scores.bm25, "number");
  assert.equal(typeof results[0].scores.vector, "number");
});

test("searchIndex boosts exact phrases, headings, and paths", () => {
  const index = buildIndex([
    {
      id: "wiki/general/setup.md#1",
      path: "wiki/general/setup.md",
      heading: "Setup Notes",
      text: "This page mentions local wiki sync stale checks once.",
    },
    {
      id: "wiki/local-wiki/advanced-stable.md#1",
      path: "wiki/local-wiki/advanced-stable.md",
      heading: "local-wiki Advanced Stable",
      text: "Advanced indexing, status reporting, and refresh workflow.",
    },
    {
      id: "wiki/noise/local.md#1",
      path: "wiki/noise/local.md",
      heading: "Loose Terms",
      text: "local advanced stable wiki words are far apart.",
    },
  ]);

  const results = searchIndex(index, "local-wiki Advanced Stable", { topK: 3 });

  assert.equal(results[0].path, "wiki/local-wiki/advanced-stable.md");
  assert(results[0].scores.exact > 0);
  assert(results[0].scores.title > 0);
  assert(results[0].scores.path > 0);
});

test("searchIndex applies configurable boost weights", () => {
  const index = buildIndex([
    {
      id: "wiki/title-choice.md#1",
      path: "wiki/title-choice.md",
      heading: "Needle",
      text: "Only the heading carries the query.",
    },
    {
      id: "wiki/plain-choice.md#1",
      path: "wiki/plain-choice.md",
      heading: "Plain",
      text: "Needle appears in body text.",
    },
  ]);

  const weightedResults = searchIndex(index, "Needle", {
    topK: 2,
    weights: { exact: 0, title: 20, path: 0 },
  });

  assert.equal(weightedResults[0].path, "wiki/title-choice.md");
  assert.equal(weightedResults[0].scores.title, 20);
});

test("searchIndex returns diverse paths by default", () => {
  const index = buildIndex([
    {
      id: "wiki/repeated.md#1",
      path: "wiki/repeated.md",
      heading: "First",
      text: "local wiki cache search",
    },
    {
      id: "wiki/repeated.md#2",
      path: "wiki/repeated.md",
      heading: "Second",
      text: "local wiki cache search again",
    },
    {
      id: "wiki/other.md#1",
      path: "wiki/other.md",
      heading: "Other",
      text: "local wiki cache reference",
    },
  ]);

  const results = searchIndex(index, "local wiki cache", { topK: 3 });

  assert.deepEqual(results.map((result) => result.path), ["wiki/repeated.md", "wiki/other.md"]);
});

test("searchIndex can return multiple chunks per path when diversity is disabled", () => {
  const index = buildIndex([
    {
      id: "wiki/repeated.md#1",
      path: "wiki/repeated.md",
      heading: "First",
      text: "local wiki cache search",
    },
    {
      id: "wiki/repeated.md#2",
      path: "wiki/repeated.md",
      heading: "Second",
      text: "local wiki cache search again",
    },
  ]);

  const results = searchIndex(index, "local wiki cache", { topK: 2, diversity: false });

  assert.equal(results.length, 2);
  assert.equal(results[0].path, results[1].path);
});

test("explainSearch exposes query analysis and score evidence", () => {
  const index = buildIndex(chunks);
  const report = explainSearch(index, "Codex config.toml", { topK: 1 });

  assert.equal(report.strategy.dense_embeddings, false);
  assert.deepEqual(report.query_analysis.tokens, ["codex", "config.toml"]);
  assert.equal(report.returned_count, 1);
  assert.equal(report.results[0].path, "wiki/cursor/mcp.md");
  assert(report.results[0].explanation.matched_tokens.some((entry) => entry.term === "codex"));
  assert.equal(typeof report.results[0].scores.bm25, "number");
});
