import {
  CURRENT_INDEX_VERSION,
  buildIndexFromFiles,
  inspectIndexFreshness,
  loadIndex,
  saveIndex,
  syncIndexFromFiles,
  withIndexLock,
} from "./indexer.js";

export async function buildKnowledgeBase(root, config) {
  return withIndexLock(root, config.indexDir, async () => {
    const index = await buildIndexFromFiles(root, config.includes, indexOptions(config));
    const file = await saveIndex(root, index, config.indexDir);
    return result(true, "full", index, file);
  });
}

export async function syncKnowledgeBase(root, config, options = {}) {
  return withIndexLock(root, config.indexDir, async () => {
    const previous = options.previousIndex ?? await tryLoadIndex(root, config.indexDir);
    const useIncremental = previous?.version === CURRENT_INDEX_VERSION;
    const index = useIncremental
      ? await syncIndexFromFiles(root, previous, config.includes, indexOptions(config))
      : await buildIndexFromFiles(root, config.includes, indexOptions(config));
    const file = await saveIndex(root, index, config.indexDir);
    return result(true, previous ? (useIncremental ? "incremental" : "upgrade") : "full", index, file);
  });
}

export async function refreshKnowledgeBaseIfNeeded(root, config, options = {}) {
  const index = options.index ?? await tryLoadIndex(root, config.indexDir);
  if (!index || index.version !== CURRENT_INDEX_VERSION) {
    return syncKnowledgeBase(root, config, { previousIndex: index });
  }
  const freshness = await inspectIndexFreshness(root, index, config.includes, {
    exclude: config.exclude,
    strict: options.strict === true,
  });
  if (!freshness.stale) {
    return { ...result(false, "fresh", index), freshness };
  }
  return { ...await syncKnowledgeBase(root, config, { previousIndex: index }), freshness };
}

async function tryLoadIndex(root, indexDir) {
  try {
    return await loadIndex(root, indexDir);
  } catch (error) {
    if (isRecoverableIndexError(error)) return null;
    throw error;
  }
}

function isRecoverableIndexError(error) {
  return error?.code === "ENOENT" || error instanceof SyntaxError || /index|version|chunk/i.test(error?.message ?? "");
}

function indexOptions(config) {
  return { exclude: config.exclude, maxChars: config.maxChunkChars };
}

function result(updated, mode, index, file) {
  return {
    updated,
    mode,
    file,
    version: index.version,
    chunk_count: index.chunkCount,
  };
}
