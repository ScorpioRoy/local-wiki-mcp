#!/usr/bin/env node
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { inspectIndexFreshness, loadIndex } from "../src/indexer.js";
import { buildKnowledgeBase } from "../src/operations.js";
import { initKnowledgeBase } from "../src/product.js";
import { searchIndex } from "../src/search.js";
import { watchKnowledgeBase } from "../src/watcher.js";

const durationMs = positiveOption("--duration-ms", 12 * 60 * 60 * 1000);
const mutationIntervalMs = positiveOption("--mutation-interval-ms", 5000);
const watchIntervalMs = positiveOption("--watch-interval-ms", 500);
const strictEvery = positiveOption("--strict-every", 20);
const root = await mkdtemp(path.join(tmpdir(), "local-wiki-soak-"));
let watcher;
let stopRequested = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { stopRequested = true; });
}

try {
  await initKnowledgeBase(root, { template: "minimal" });
  const config = await loadConfig(root);
  await buildKnowledgeBase(root, config);
  const errors = [];
  const updates = [];
  watcher = watchKnowledgeBase(root, config, {
    intervalMs: watchIntervalMs,
    strictEvery,
    runImmediately: true,
    onResult: (report) => {
      if (report.updated) updates.push({ mode: report.mode, chunk_count: report.chunk_count });
    },
    onError: (error) => errors.push(error.message),
  });

  const startedAt = Date.now();
  let mutations = 0;
  while (!stopRequested && Date.now() - startedAt < durationMs) {
    await sleep(Math.min(mutationIntervalMs, Math.max(1, durationMs - (Date.now() - startedAt))));
    if (stopRequested) break;
    mutations += 1;
    const slot = mutations % 16;
    const file = path.join(root, "wiki", `soak-${slot}.md`);
    if (mutations % 11 === 0) {
      await unlink(file).catch(() => {});
    } else {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `# Soak ${slot}\n\nMutation ${mutations} at ${new Date().toISOString()}.\n`, "utf8");
    }
  }

  const finalMarker = `SOAK_FINAL_${Date.now()}`;
  await writeFile(path.join(root, "wiki", "soak-final.md"), `# Final marker\n\n${finalMarker}\n`, "utf8");
  await watcher.runNow();
  await sleep(watchIntervalMs + 25);
  await watcher.runNow();
  watcher.close();

  const index = await loadIndex(root, config.indexDir);
  const freshness = await inspectIndexFreshness(root, index, config.includes, {
    exclude: config.exclude,
    strict: true,
  });
  const results = searchIndex(index, finalMarker, { topK: 3, diversity: false });
  const markerFound = results.some((result) => result.path === "wiki/soak-final.md");
  const report = {
    ok: errors.length === 0 && !freshness.stale && markerFound && updates.length > 0,
    requested_duration_ms: durationMs,
    elapsed_ms: Date.now() - startedAt,
    mutations,
    index_updates: updates.length,
    final_chunk_count: index.chunkCount,
    strict_fresh: !freshness.stale,
    final_marker_found: markerFound,
    errors,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
} finally {
  watcher?.close();
  await rm(root, { recursive: true, force: true });
}

function positiveOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} requires a positive integer.`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
