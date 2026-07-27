import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createIndexStore } from "./index-store.js";
import { resolveIndexDirectory } from "./indexer.js";
import { refreshKnowledgeBaseIfNeeded } from "./operations.js";

export function watchKnowledgeBase(root, config, options = {}) {
  const strictEvery = positiveInteger(options.strictEvery, 30);
  const store = options.indexStore ?? createIndexStore({
    root,
    indexDir: config.indexDir,
    includes: config.includes,
    exclude: config.exclude,
    reloadCheckTtlMs: config.mcpCache?.reloadCheckTtlMs,
    freshnessTtlMs: config.mcpCache?.freshnessTtlMs,
    idleUnloadMs: 0,
  });
  let cycle = 0;
  return startWatchLoop({
    intervalMs: options.intervalMs,
    refresh: async () => {
      cycle += 1;
      let index;
      try {
        index = await store.getIndex();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const report = await refreshKnowledgeBaseIfNeeded(root, config, {
        strict: cycle % strictEvery === 0,
        index,
      });
      if (report.updated) store.invalidate();
      return report;
    },
    onResult: options.onResult,
    onError: options.onError,
    runImmediately: options.runImmediately,
  });
}

export async function startExclusiveWatcher(root, config, options = {}) {
  const lock = await acquireWatchLock(root, config.indexDir, options.lockOptions);
  const watcher = watchKnowledgeBase(root, config, options);
  let closed = false;
  return {
    ...watcher,
    async close() {
      if (closed) return;
      closed = true;
      watcher.close();
      await lock.release();
    },
    lockFile: lock.file,
  };
}

export async function acquireWatchLock(root, indexDir, options = {}) {
  const directory = resolveIndexDirectory(root, indexDir);
  const file = path.join(directory, "watch.lock");
  const pid = positiveInteger(options.pid, process.pid);
  const isAlive = options.isProcessAlive ?? isProcessAlive;
  await mkdir(directory, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await open(file, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = await readLockOwner(file);
      if (owner?.pid && isAlive(owner.pid)) {
        const lockError = new Error(`Another local-wiki watcher is already running (pid ${owner.pid}): ${file}`);
        lockError.code = "WATCH_ALREADY_RUNNING";
        lockError.owner = owner;
        throw lockError;
      }
      await unlink(file).catch((unlinkError) => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
      continue;
    }

    await handle.writeFile(`${JSON.stringify({ pid, createdAt: new Date().toISOString() })}\n`, "utf8");
    let released = false;
    return {
      file,
      pid,
      async release() {
        if (released) return;
        released = true;
        await handle.close().catch(() => {});
        const owner = await readLockOwner(file);
        if (owner?.pid === pid) await unlink(file).catch(() => {});
      },
    };
  }

  throw new Error(`Unable to acquire local-wiki watch lock: ${file}`);
}

export function startWatchLoop(options = {}) {
  const intervalMs = positiveInteger(options.intervalMs, 2000);
  const refresh = options.refresh;
  if (typeof refresh !== "function") throw new Error("watch requires a refresh function");
  let isClosed = false;
  let running;

  async function runNow() {
    if (isClosed) return { updated: false, mode: "closed" };
    if (running) return running;
    running = Promise.resolve(refresh()).then((report) => {
      options.onResult?.(report);
      return report;
    }).finally(() => {
      running = undefined;
    });
    return running;
  }

  const timer = setInterval(() => {
    runNow().catch((error) => options.onError?.(error));
  }, intervalMs);

  if (options.runImmediately) {
    runNow().catch((error) => options.onError?.(error));
  }

  return {
    runNow,
    close() {
      if (isClosed) return;
      isClosed = true;
      clearInterval(timer);
    },
    get closed() {
      return isClosed;
    },
  };
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function readLockOwner(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
