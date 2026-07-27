import { performance } from "node:perf_hooks";
import { searchIndex } from "./search.js";

export async function runBench(options = {}) {
  const query = options.query ?? "local-wiki";
  const topK = options.topK ?? 8;
  const iterations = options.iterations ?? 5;
  const loadIndex = options.loadIndex;
  if (typeof loadIndex !== "function") {
    throw new Error("runBench requires loadIndex");
  }

  const loadStart = performance.now();
  const index = await loadIndex();
  const loadMs = performance.now() - loadStart;

  let totalSearchMs = 0;
  const searchTimes = [];
  let lastResults = [];
  for (let count = 0; count < iterations; count += 1) {
    const searchStart = performance.now();
    lastResults = searchIndex(index, query, { topK, weights: options.weights, queryAliases: options.queryAliases });
    const elapsed = performance.now() - searchStart;
    searchTimes.push(elapsed);
    totalSearchMs += elapsed;
  }

  return {
    query,
    iterations,
    chunk_count: index.chunkCount,
    load_ms: round(loadMs),
    search_ms: round(totalSearchMs / iterations),
    search_p50_ms: round(percentile(searchTimes, 0.5)),
    search_p95_ms: round(percentile(searchTimes, 0.95)),
    result_count: lastResults.length,
  };
}

export function runEval(index, fixtures, options = {}) {
  const searchTimes = [];
  const fixtureDocument = normalizeFixtureDocument(fixtures, options.variantSet);
  const normalizedFixtures = normalizeFixtures(fixtureDocument.fixtures, fixtureDocument.variantTemplates);
  const cases = normalizedFixtures.map((fixture) => {
    const topK = fixture.top_k ?? fixture.topK ?? options.topK ?? 8;
    const retrievalK = Math.max(5, topK);
    const searchStart = performance.now();
    const results = searchIndex(index, fixture.query, {
      topK: retrievalK,
      weights: options.weights,
      diversity: options.diversity,
      maxChunksPerPath: options.maxChunksPerPath,
      queryAliases: options.queryAliases,
    });
    searchTimes.push(performance.now() - searchStart);
    const paths = results.map((result) => result.path);
    const expected = fixture.expected ?? [];
    const hitTop1 = paths.length > 0 && expected.includes(paths[0]);
    const hitTop3 = paths.slice(0, 3).some((path) => expected.includes(path));
    const hitTop5 = paths.slice(0, 5).some((path) => expected.includes(path));
    const hitTopK = paths.slice(0, topK).some((path) => expected.includes(path));
    const firstRelevantIndex = paths.findIndex((path) => expected.includes(path));
    const reciprocalRank = firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1);
    const ndcg = normalizedDcg(paths.slice(0, topK), expected);
    const resultTokens = approximateTokens(JSON.stringify(results.slice(0, topK)));
    const topicDuplicates = countTopicDuplicates(results.slice(0, topK));
    const lowConfidence = results[0]?.confidence?.level === "low";

    return {
      query: fixture.query,
      category: fixture.category,
      variant_of: fixture.variant_of,
      expected,
      top_k: topK,
      top1: paths[0] ?? null,
      results: paths,
      hit_top1: hitTop1,
      hit_top3: hitTop3,
      hit_top5: hitTop5,
      hit_topk: hitTopK,
      reciprocal_rank: round(reciprocalRank),
      ndcg: round(ndcg),
      result_tokens: resultTokens,
      topic_duplicates: topicDuplicates,
      low_confidence: lowConfidence,
    };
  });

  const total = cases.length;
  const top1Hits = cases.filter((entry) => entry.hit_top1).length;
  const top3Hits = cases.filter((entry) => entry.hit_top3).length;
  const top5Hits = cases.filter((entry) => entry.hit_top5).length;
  const topKHits = cases.filter((entry) => entry.hit_topk).length;
  const resultPaths = cases.flatMap((entry) => entry.results);
  const duplicateCount = cases.reduce((totalDuplicates, entry) => (
    totalDuplicates + entry.results.length - new Set(entry.results).size
  ), 0);
  const duplicatePathRate = resultPaths.length ? duplicateCount / resultPaths.length : 0;
  const totalReturned = cases.reduce((sum, entry) => sum + entry.results.length, 0);
  const topicDuplicateCount = cases.reduce((sum, entry) => sum + entry.topic_duplicates, 0);
  const rates = {
    top1: ratio(top1Hits, total),
    top3: ratio(top3Hits, total),
    top5: ratio(top5Hits, total),
    topk: ratio(topKHits, total),
  };
  const failures = thresholdFailures(rates, duplicatePathRate, options);
  const categories = categoryMetrics(cases);

  return {
    fixture_groups: fixtureDocument.fixtures.length,
    variant_set: fixtureDocument.variantSet,
    total,
    top1_hits: top1Hits,
    top3_hits: top3Hits,
    top5_hits: top5Hits,
    topk_hits: topKHits,
    rates,
    duplicate_path_rate: round(duplicatePathRate),
    topic_duplicate_rate: round(totalReturned ? topicDuplicateCount / totalReturned : 0),
    mrr: round(cases.reduce((sum, entry) => sum + entry.reciprocal_rank, 0) / Math.max(1, total)),
    ndcg: round(cases.reduce((sum, entry) => sum + entry.ndcg, 0) / Math.max(1, total)),
    average_result_tokens: round(cases.reduce((sum, entry) => sum + entry.result_tokens, 0) / Math.max(1, total)),
    low_confidence_rate: round(ratio(cases.filter((entry) => entry.low_confidence).length, total)),
    empty_results: cases.filter((entry) => entry.results.length === 0).length,
    search_ms: {
      average: round(searchTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, searchTimes.length)),
      p50: round(percentile(searchTimes, 0.5)),
      p95: round(percentile(searchTimes, 0.95)),
    },
    categories,
    passed: failures.length === 0,
    failures,
    cases,
  };
}

function normalizedDcg(paths, expected) {
  const relevant = new Set(expected);
  let dcg = 0;
  for (let index = 0; index < paths.length; index += 1) {
    if (relevant.has(paths[index])) dcg += 1 / Math.log2(index + 2);
  }
  const idealCount = Math.min(paths.length, relevant.size);
  let ideal = 0;
  for (let index = 0; index < idealCount; index += 1) ideal += 1 / Math.log2(index + 2);
  return ideal ? dcg / ideal : 0;
}

function countTopicDuplicates(results) {
  const topics = new Set();
  let duplicates = 0;
  for (const result of results) {
    if (result.source_type !== "daily") continue;
    const topic = String(result.heading ?? "")
      .replace(/^任务\d+[:：]?\s*/, "")
      .trim()
      .toLowerCase();
    if (!topic) continue;
    if (topics.has(topic)) duplicates += 1;
    topics.add(topic);
  }
  return duplicates;
}

function approximateTokens(value) {
  const text = String(value ?? "");
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  return Math.max(1, Math.ceil(cjk + ((text.length - cjk) / 4)));
}

function normalizeFixtureDocument(value, requestedVariantSet) {
  if (Array.isArray(value)) {
    return { fixtures: value, variantTemplates: null, variantSet: "inline" };
  }
  if (!value || typeof value !== "object" || !Array.isArray(value.fixtures)) {
    throw new Error("Eval fixture must be a JSON array or fixture document");
  }
  const variantSet = requestedVariantSet ?? value.default_variant_set ?? "semantic";
  if (variantSet === "semantic") {
    return { fixtures: value.fixtures, variantTemplates: null, variantSet };
  }
  const variantTemplates = value.variant_sets?.[variantSet];
  if (!Array.isArray(variantTemplates) || variantTemplates.some((entry) => (
    typeof entry !== "string" || !entry.includes("{query}")
  ))) {
    throw new Error(`Unknown or invalid eval variant set: ${variantSet}`);
  }
  return { fixtures: value.fixtures, variantTemplates, variantSet };
}

function normalizeFixtures(fixtures, variantTemplates) {
  const seenQueries = new Set();
  return fixtures.flatMap((fixture, index) => {
    if (!fixture || typeof fixture.query !== "string" || !fixture.query.trim() || !Array.isArray(fixture.expected)) {
      throw new Error(`Invalid eval fixture at index ${index}`);
    }
    if (!fixture.expected.length || fixture.expected.some((value) => typeof value !== "string" || !value)) {
      throw new Error(`Invalid expected paths at eval fixture index ${index}`);
    }
    if (fixture.variants !== undefined && (
      !Array.isArray(fixture.variants) ||
      fixture.variants.some((value) => typeof value !== "string" || !value.trim())
    )) {
      throw new Error(`Invalid query variants at eval fixture index ${index}`);
    }
    if (fixture.category !== undefined && (typeof fixture.category !== "string" || !fixture.category.trim())) {
      throw new Error(`Invalid category at eval fixture index ${index}`);
    }

    const baseQuery = fixture.query.trim();
    const variants = variantTemplates
      ? variantTemplates.map((template) => template.replaceAll("{query}", baseQuery))
      : (fixture.variants ?? []).map((query) => query.trim());
    return [baseQuery, ...variants].map((query, variantIndex) => {
      if (seenQueries.has(query)) throw new Error(`Duplicate eval query: ${query}`);
      seenQueries.add(query);
      return {
        ...fixture,
        query,
        category: fixture.category?.trim() ?? "uncategorized",
        variant_of: variantIndex === 0 ? null : baseQuery,
      };
    });
  });
}

function categoryMetrics(cases) {
  const grouped = new Map();
  for (const entry of cases) {
    const group = grouped.get(entry.category) ?? [];
    group.push(entry);
    grouped.set(entry.category, group);
  }
  return Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    ([category, entries]) => [category, {
      total: entries.length,
      rates: {
        top1: ratio(entries.filter((entry) => entry.hit_top1).length, entries.length),
        top3: ratio(entries.filter((entry) => entry.hit_top3).length, entries.length),
        top5: ratio(entries.filter((entry) => entry.hit_top5).length, entries.length),
        topk: ratio(entries.filter((entry) => entry.hit_topk).length, entries.length),
      },
      empty_results: entries.filter((entry) => entry.results.length === 0).length,
    }],
  ));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function ratio(value, total) {
  return total ? value / total : 0;
}

function percentile(values, value) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(value * sorted.length) - 1);
  return sorted[index];
}

function thresholdFailures(rates, duplicatePathRate, options) {
  const failures = [];
  checkMinimum("top1", rates.top1, options.minTop1);
  checkMinimum("top3", rates.top3, options.minTop3);
  checkMinimum("top5", rates.top5, options.minTop5);
  if (Number.isFinite(options.maxDuplicateRate) && duplicatePathRate > options.maxDuplicateRate) {
    failures.push(`duplicate path rate ${round(duplicatePathRate)} exceeds ${options.maxDuplicateRate}`);
  }
  return failures;

  function checkMinimum(name, actual, minimum) {
    if (Number.isFinite(minimum) && actual < minimum) {
      failures.push(`${name} rate ${round(actual)} is below ${minimum}`);
    }
  }
}
