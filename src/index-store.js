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

  async function getIndex(getOptions = {}) {
    const currentTime = now();
    if (cachedIndex && !getOptions.force && currentTime - lastReloadCheck < reloadCheckTtlMs) {
      return cachedIndex;
    }

    const info = await statIndex();
    const signature = `${info.mtimeMs}:${info.size}`;
    lastReloadCheck = currentTime;
    if (cachedIndex && !getOptions.force && signature === cachedSignature) {
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
    return loading;
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

  function invalidate() {
    cachedIndex = undefined;
    cachedSignature = undefined;
    freshnessCache = undefined;
    lastReloadCheck = Number.NEGATIVE_INFINITY;
  }

  return { getIndex, getFreshness, invalidate };
}

function nonNegative(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
