import { refreshKnowledgeBaseIfNeeded } from "./operations.js";

export function watchKnowledgeBase(root, config, options = {}) {
  const strictEvery = positiveInteger(options.strictEvery, 30);
  let cycle = 0;
  return startWatchLoop({
    intervalMs: options.intervalMs,
    refresh: () => {
      cycle += 1;
      return refreshKnowledgeBaseIfNeeded(root, config, { strict: cycle % strictEvery === 0 });
    },
    onResult: options.onResult,
    onError: options.onError,
    runImmediately: options.runImmediately,
  });
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
