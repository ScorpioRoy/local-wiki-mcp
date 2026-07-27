import { stat } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_INDEX_DIR,
  DEFAULT_INDEX_FILE,
  inspectIndexFreshness,
  loadIndex,
  resolveIndexDirectory,
} from "./indexer.js";

export function createIndexStore(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const indexDir = options.indexDir ?? DEFAULT_INDEX_DIR;
  const now = options.now ?? Date.now;
  const reloadCheckTtlMs = nonNegative(options.reloadCheckTtlMs, 1000);
  const freshnessTtlMs = nonNegative(options.freshnessTtlMs, 5000);
  const idleUnloadMs = nonNegative(options.idleUnloadMs, 300000);
  const setTimer = options.setTimeout ?? setTimeout;
  const clearTimer = options.clearTimeout ?? clearTimeout;
  const statIndex = options.statIndex ?? (() => stat(path.join(
    resolveIndexDirectory(root, indexDir),
    DEFAULT_INDEX_FILE,
  )));
  const readIndex = options.loadIndex ?? (() => loadIndex(root, indexDir));
  const inspect = options.inspectFreshness ?? ((index, inspectOptions = {}) => inspectIndexFreshness(
    root,
    index,
    options.includes,
    { exclude: options.exclude, strict: inspectOptions.strict },
  ));

  let cachedIndex;
  let cachedSignature;
  let lastReloadCheck = Number.NEGATIVE_INFINITY;
  let loading;
  let freshnessCache;
  let idleTimer;
  let lastAccessAt;
  let unloadCount = 0;

  async function getIndex(getOptions = {}) {
    const currentTime = now();
    if (cachedIndex && !getOptions.force && currentTime - lastReloadCheck < reloadCheckTtlMs) {
      touch(currentTime);
      return cachedIndex;
    }

    const info = await statIndex();
    const signature = `${info.mtimeMs}:${info.size}`;
    lastReloadCheck = currentTime;
    if (cachedIndex && !getOptions.force && signature === cachedSignature) {
      touch(currentTime);
      return cachedIndex;
    }

    if (!loading) {
      loading = Promise.resolve(readIndex()).then((index) => {
        cachedIndex = index;
        cachedSignature = signature;
        freshnessCache = undefined;
        return index;
      }).finally(() => {
        loading = undefined;
      });
    }
    const index = await loading;
    touch(now());
    return index;
  }

  async function getFreshness(index, inspectOptions = {}) {
    const currentTime = now();
    const key = `${index?.createdAt ?? "unknown"}:${inspectOptions.strict === true}`;
    if (
      freshnessCache &&
      !inspectOptions.force &&
      freshnessCache.key === key &&
      currentTime - freshnessCache.checkedAt < freshnessTtlMs
    ) {
      return freshnessCache.report;
    }

    const report = await inspect(index, inspectOptions);
    freshnessCache = { key, checkedAt: currentTime, report };
    return report;
  }

  function invalidate(reason = "manual") {
    if (idleTimer) clearTimer(idleTimer);
    idleTimer = undefined;
    cachedIndex = undefined;
    cachedSignature = undefined;
    freshnessCache = undefined;
    lastReloadCheck = Number.NEGATIVE_INFINITY;
    if (reason === "idle") unloadCount += 1;
  }

  function touch(currentTime) {
    lastAccessAt = currentTime;
    if (idleTimer) clearTimer(idleTimer);
    idleTimer = undefined;
    if (!idleUnloadMs) return;
    idleTimer = setTimer(() => {
      if (cachedIndex && now() - lastAccessAt >= idleUnloadMs) invalidate("idle");
    }, idleUnloadMs);
    idleTimer?.unref?.();
  }

  function getStats() {
    return {
      loaded: Boolean(cachedIndex),
      loading: Boolean(loading),
      idle_unload_ms: idleUnloadMs,
      last_access_at: Number.isFinite(lastAccessAt) ? lastAccessAt : null,
      unload_count: unloadCount,
    };
  }

  return { getIndex, getFreshness, invalidate, getStats };
}

function nonNegative(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
