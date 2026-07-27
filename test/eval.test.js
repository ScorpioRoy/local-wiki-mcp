import test from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../src/indexer.js";
import { runBench, runEval } from "../src/eval.js";

const index = buildIndex([
  {
    id: "wiki/local-wiki/product.md#1",
    path: "wiki/local-wiki/product.md",
    heading: "Product v1.1",
    text: "local-wiki supports bench eval and incremental sync.",
  },
  {
    id: "wiki/other.md#1",
    path: "wiki/other.md",
    heading: "Other",
    text: "Unrelated note.",
  },
]);

test("runEval counts top1 and topK path hits", () => {
  const report = runEval(index, [
    { query: "incremental sync", expected: ["wiki/local-wiki/product.md"], top_k: 1 },
    { query: "unrelated", expected: ["wiki/local-wiki/product.md"], top_k: 2 },
  ]);

  assert.equal(report.total, 2);
  assert.equal(report.top1_hits, 1);
  assert.equal(report.top3_hits, 1);
  assert.equal(report.top5_hits, 1);
  assert.equal(report.topk_hits, 1);
  assert.equal(report.duplicate_path_rate, 0);
  assert.equal(typeof report.topic_duplicate_rate, "number");
  assert.equal(typeof report.mrr, "number");
  assert.equal(typeof report.ndcg, "number");
  assert.equal(typeof report.average_result_tokens, "number");
  assert.equal(typeof report.low_confidence_rate, "number");
  assert.equal(report.empty_results, 0);
  assert.equal(typeof report.search_ms.average, "number");
  assert.equal(typeof report.search_ms.p50, "number");
  assert.equal(typeof report.search_ms.p95, "number");
  assert.equal(report.cases.length, 2);
  assert.equal(report.cases[0].hit_top1, true);
  assert.equal(report.cases[0].reciprocal_rank, 1);
  assert.equal(report.cases[0].ndcg, 1);
});

test("runEval expands query variants and reports category metrics", () => {
  const report = runEval(index, [{
    query: "incremental sync",
    variants: ["refresh changed wiki", "local-wiki product"],
    expected: ["wiki/local-wiki/product.md"],
    category: "product",
    top_k: 3,
  }]);

  assert.equal(report.fixture_groups, 1);
  assert.equal(report.total, 3);
  assert.equal(report.categories.product.total, 3);
  assert.equal(report.categories.product.rates.top5, 1);
  assert.equal(report.cases[1].variant_of, "incremental sync");
  assert.throws(() => runEval(index, [
    { query: "same", variants: ["same"], expected: ["wiki/local-wiki/product.md"] },
  ]), /duplicate eval query/i);
});

test("runEval supports named intent and semantic variant sets", () => {
  const document = {
    default_variant_set: "intent",
    variant_sets: { intent: ["find {query}", "help with {query}"] },
    fixtures: [{
      query: "incremental sync",
      variants: ["refresh changed wiki"],
      expected: ["wiki/local-wiki/product.md"],
      category: "product",
    }],
  };

  const intent = runEval(index, document);
  const semantic = runEval(index, document, { variantSet: "semantic" });

  assert.equal(intent.variant_set, "intent");
  assert.equal(intent.total, 3);
  assert.equal(semantic.variant_set, "semantic");
  assert.equal(semantic.total, 2);
  assert.throws(() => runEval(index, document, { variantSet: "missing" }), /variant set/i);
});

test("runEval reports threshold failures", () => {
  const report = runEval(index, [
    { query: "unrelated", expected: ["wiki/local-wiki/product.md"], top_k: 1 },
  ], {
    minTop1: 1,
    minTop5: 1,
    maxDuplicateRate: 0,
  });

  assert.equal(report.passed, false);
  assert.match(report.failures.join(" "), /top1/i);
});

test("runBench reports load and search timings", async () => {
  const report = await runBench({
    query: "local-wiki",
    loadIndex: async () => index,
    iterations: 3,
  });

  assert.equal(report.query, "local-wiki");
  assert.equal(report.chunk_count, 2);
  assert.equal(report.iterations, 3);
  assert.equal(typeof report.load_ms, "number");
  assert.equal(typeof report.search_ms, "number");
  assert.equal(typeof report.search_p50_ms, "number");
  assert.equal(typeof report.search_p95_ms, "number");
});
