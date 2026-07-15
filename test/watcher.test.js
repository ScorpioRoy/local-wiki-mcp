import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadIndex } from "../src/indexer.js";
import { refreshKnowledgeBaseIfNeeded } from "../src/operations.js";
import { startWatchLoop } from "../src/watcher.js";

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
