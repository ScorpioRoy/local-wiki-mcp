import test from "node:test";
import assert from "node:assert/strict";
import { createIndexStore } from "../src/index-store.js";

test("index store caches parsed indexes and reloads after the index file changes", async () => {
  let now = 1000;
  let signature = { mtimeMs: 10, size: 100 };
  let statCalls = 0;
  let loadCalls = 0;
  const store = createIndexStore({
    now: () => now,
    reloadCheckTtlMs: 100,
    statIndex: async () => {
      statCalls += 1;
      return signature;
    },
    loadIndex: async () => {
      loadCalls += 1;
      return { version: 3, createdAt: `load-${loadCalls}`, chunkCount: 0, chunks: [], documentFrequency: {} };
    },
    inspectFreshness: async () => ({ stale: false }),
  });

  const first = await store.getIndex();
  const cached = await store.getIndex();
  now += 101;
  const checked = await store.getIndex();
  signature = { mtimeMs: 20, size: 110 };
  now += 101;
  const reloaded = await store.getIndex();

  assert.equal(first, cached);
  assert.equal(first, checked);
  assert.notEqual(first, reloaded);
  assert.equal(statCalls, 3);
  assert.equal(loadCalls, 2);
});

test("index store caches freshness reports within the configured TTL", async () => {
  let now = 1000;
  let inspectCalls = 0;
  const index = { version: 3, createdAt: "index-1", chunkCount: 0, chunks: [], documentFrequency: {} };
  const store = createIndexStore({
    now: () => now,
    freshnessTtlMs: 500,
    statIndex: async () => ({ mtimeMs: 10, size: 100 }),
    loadIndex: async () => index,
    inspectFreshness: async () => {
      inspectCalls += 1;
      return { stale: false, inspectCalls };
    },
  });

  const first = await store.getFreshness(index);
  const cached = await store.getFreshness(index);
  now += 501;
  const refreshed = await store.getFreshness(index);
  const forced = await store.getFreshness(index, { force: true });

  assert.equal(first, cached);
  assert.equal(refreshed.inspectCalls, 2);
  assert.equal(forced.inspectCalls, 3);
  assert.equal(inspectCalls, 3);
});
