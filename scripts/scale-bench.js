#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { buildIndex } from "../src/indexer.js";
import { searchIndex } from "../src/search.js";

const args = parseArgs(process.argv.slice(2));
const chunkCount = positiveInteger(args.chunks, 5000);
const iterations = positiveInteger(args.iterations, 100);
const concurrency = positiveInteger(args.concurrency, 8);
const before = process.memoryUsage();
const chunks = Array.from({ length: chunkCount }, (_, index) => ({
  id: `wiki/generated/topic-${index % 200}.md#${index + 1}`,
  path: `wiki/generated/topic-${index % 200}.md`,
  heading: `Generated Topic ${index % 200}`,
  text: `Deterministic benchmark passage ${index} runtime cache config error CODE_${index % 500}.`,
}));

const buildStarted = performance.now();
const index = buildIndex(chunks);
const buildMs = performance.now() - buildStarted;
const afterBuild = process.memoryUsage();
const timings = [];
let resultCount = 0;

for (let offset = 0; offset < iterations; offset += concurrency) {
  const batchSize = Math.min(concurrency, iterations - offset);
  for (let item = 0; item < batchSize; item += 1) {
    const sequence = offset + item;
    const started = performance.now();
    const results = searchIndex(index, `Generated Topic ${sequence % 200} CODE_${sequence % 500}`, { topK: 8 });
    timings.push(performance.now() - started);
    resultCount = results.length;
  }
}

globalThis.gc?.();
const afterSearch = process.memoryUsage();
console.log(JSON.stringify({
  ok: true,
  chunks: chunkCount,
  iterations,
  concurrency,
  gc_available: typeof globalThis.gc === "function",
  build_ms: round(buildMs),
  search_ms: {
    average: round(timings.reduce((sum, value) => sum + value, 0) / timings.length),
    p50: round(percentile(timings, 0.5)),
    p95: round(percentile(timings, 0.95)),
  },
  memory_mb: {
    before_rss: mb(before.rss),
    after_build_rss: mb(afterBuild.rss),
    after_search_rss: mb(afterSearch.rss),
    heap_used: mb(afterSearch.heapUsed),
  },
  result_count: resultCount,
}, null, 2));

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name === "--chunks") result.chunks = Number(values[++index]);
    else if (name === "--iterations") result.iterations = Number(values[++index]);
    else if (name === "--concurrency") result.concurrency = Number(values[++index]);
    else throw new Error(`Unknown option: ${name}`);
  }
  return result;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function mb(value) {
  return Math.round((value / 1024 / 1024) * 1000) / 1000;
}
