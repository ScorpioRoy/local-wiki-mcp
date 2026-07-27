import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadIndex } from "../src/indexer.js";
import { refreshKnowledgeBaseIfNeeded } from "../src/operations.js";
import { acquireWatchLock, startWatchLoop } from "../src/watcher.js";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "local-wiki-watcher-"));
  try {
    await mkdir(path.join(dir, "wiki"), { recursive: true });
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("refreshKnowledgeBaseIfNeeded builds missing indexes and skips fresh indexes", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "wiki", "index.md"), "# Index\nInitial content.");
    const config = { includes: ["wiki"], exclude: [], indexDir: ".local-wiki-index", maxChunkChars: 2400 };

    const first = await refreshKnowledgeBaseIfNeeded(root, config);
    const second = await refreshKnowledgeBaseIfNeeded(root, config);
    await writeFile(path.join(root, "wiki", "index.md"), "# Index\nChanged content with another size.");
    const third = await refreshKnowledgeBaseIfNeeded(root, config);

    assert.equal(first.updated, true);
    assert.equal(first.mode, "full");
    assert.equal(second.updated, false);
    assert.equal(third.updated, true);
    assert.equal(third.mode, "incremental");
    assert.equal((await loadIndex(root)).version, 3);
  });
});

test("startWatchLoop exposes runNow and stops cleanly", async () => {
  let runs = 0;
  const watcher = startWatchLoop({
    intervalMs: 60_000,
    refresh: async () => {
      runs += 1;
      return { updated: false };
    },
  });

  await watcher.runNow();
  watcher.close();

  assert.equal(runs, 1);
  assert.equal(watcher.closed, true);
});

test("acquireWatchLock prevents duplicate live watchers and releases", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "local-wiki-watch-lock-"));
  try {
    const first = await acquireWatchLock(root, ".index", {
      pid: 1234,
      isProcessAlive: (pid) => pid === 1234,
    });
    await assert.rejects(
      acquireWatchLock(root, ".index", {
        pid: 5678,
        isProcessAlive: (pid) => pid === 1234,
      }),
      (error) => error.code === "WATCH_ALREADY_RUNNING" && error.owner.pid === 1234,
    );
    await first.release();
    const second = await acquireWatchLock(root, ".index", {
      pid: 5678,
      isProcessAlive: () => false,
    });
    await second.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("acquireWatchLock replaces an invalid stale lock", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "local-wiki-watch-stale-"));
  try {
    const directory = path.join(root, ".index");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "watch.lock"), "not json");
    const lock = await acquireWatchLock(root, ".index", { pid: 42, isProcessAlive: () => false });
    assert.equal(lock.pid, 42);
    await lock.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
