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
  assert.deepEqual(report.query_analysis.tokens, ["codex", "config.toml", "config", "toml"]);
  assert.equal(report.returned_count, 1);
  assert.equal(report.results[0].path, "wiki/cursor/mcp.md");
  assert(report.results[0].explanation.matched_tokens.some((entry) => entry.term === "codex"));
  assert.equal(typeof report.results[0].scores.bm25, "number");
  assert.equal(report.strategy.fusion, "reciprocal rank fusion");
  assert(report.query_analysis.rewrites.terms.includes("toml"));
});

test("searchIndex expands camelCase identifiers and reports field evidence", () => {
  const index = buildIndex([
    { id: "wiki/config.md#1", path: "wiki/runtime/config.md", heading: "Reminder Config Service", text: "运行配置服务。" },
    { id: "daily/noise.md#1", path: "daily/2020-01/2020-01-01.md", heading: "Unrelated", text: "Reminder only." },
  ]);
  const results = searchIndex(index, "ReminderConfigService", { topK: 2 });

  assert.equal(results[0].path, "wiki/runtime/config.md");
  assert(results[0].scores.identifier > 0);
  assert.equal(results[0].source_type, "wiki");
  assert.equal(results[0].confidence.level, "high");
});

test("searchIndex gives configured aliases an independent lexical and path channel", () => {
  const index = buildIndex([
    {
      id: "tools/local-wiki-mcp/migration.md#1",
      path: "tools/local-wiki-mcp/MIGRATION_FROM_QMD.md",
      heading: "迁移指南",
      text: "使用 local-wiki 替代 qmd，并执行增量索引同步。",
    },
    {
      id: "daily/noise.md#1",
      path: "daily/noise.md",
      heading: "旧知识库讨论",
      text: "旧知识库检索命令替换方案仍在评估。",
    },
  ]);
  const report = explainSearch(index, "旧知识库检索命令替换方案", {
    topK: 2,
    queryAliases: { "旧知识库": ["qmd", "local-wiki", "迁移"] },
  });
  const migration = report.results.find((result) => result.path.endsWith("MIGRATION_FROM_QMD.md"));

  assert(migration);
  assert(migration.scores.bm25_alias > 0);
  assert(migration.scores.path_alias > 0);
  assert(report.query_analysis.alias_terms.includes("qmd"));
  assert(migration.explanation.alias_terms.includes("qmd"));
  assert(migration.explanation.alias_path_matches.includes("qmd"));
});

test("searchIndex prefers stable wiki over old daily and de-duplicates daily topics", () => {
  const index = buildIndex([
    { id: "wiki/stable.md#1", path: "wiki/stable.md", heading: "缓存恢复", text: "缓存恢复流程与配置。" },
    { id: "daily/a.md#1", path: "daily/2020-01/2020-01-01.md", heading: "任务1: 缓存恢复", text: "缓存恢复流程与配置。" },
    { id: "daily/b.md#1", path: "daily/2020-01/2020-01-02.md", heading: "任务2: 缓存恢复", text: "缓存恢复流程与配置。" },
  ]);
  const results = searchIndex(index, "缓存恢复配置", { topK: 3, now: new Date("2026-07-16T00:00:00Z") });

  assert.equal(results[0].path, "wiki/stable.md");
  assert.equal(results.filter((result) => result.source_type === "daily").length, 1);
});

test("searchIndex can attach adjacent context and enforce an output token budget", () => {
  const index = buildIndex([
    { id: "wiki/guide.md#1", path: "wiki/guide.md", heading: "Before", text: "前置背景。" },
    { id: "wiki/guide.md#2", path: "wiki/guide.md", heading: "Target", text: "目标配置 LOCAL_WIKI_RUNTIME。" },
    { id: "wiki/guide.md#3", path: "wiki/guide.md", heading: "After", text: "后续验证。" },
  ]);
  const results = searchIndex(index, "LOCAL_WIKI_RUNTIME", {
    topK: 3,
    diversity: false,
    contextChars: 200,
    maxOutputTokens: 500,
  });

  assert(results.length >= 1);
  assert.match(results[0].context.before, /前置背景/);
  assert.match(results[0].context.after, /后续验证/);
});
