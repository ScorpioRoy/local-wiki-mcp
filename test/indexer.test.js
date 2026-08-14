import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CURRENT_INDEX_VERSION,
  buildIndex,
  buildIndexFromFiles,
  inspectIndexFreshness,
  loadIndex,
  resolveIndexDirectory,
  saveIndex,
  syncIndexFromFiles,
  validateIndex,
  withIndexLock,
} from "../src/indexer.js";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "local-wiki-indexer-"));
  try {
    await mkdir(path.join(dir, "wiki"), { recursive: true });
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("buildIndexFromFiles records source file metadata", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "wiki", "index.md"), "# Local Wiki\nCodex local knowledge.");

    const index = await buildIndexFromFiles(root, ["wiki"]);

    assert.equal(index.version, CURRENT_INDEX_VERSION);
    assert.equal(index.metadata.files.length, 1);
    assert.equal(index.metadata.files[0].path, "wiki/index.md");
    assert.equal(index.metadata.files[0].chunkIds.length, 1);
    assert.match(index.metadata.files[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof index.metadata.files[0].mtimeMs, "number");
    assert.equal(typeof index.metadata.files[0].size, "number");
    assert.equal(typeof index.chunks[0].tokenCount, "number");
    assert.equal(typeof index.chunks[0].vectorNorm, "number");
    assert.equal("tokens" in index.chunks[0], false);
  });
});

test("inspectIndexFreshness reports unchanged indexes", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "wiki", "index.md"), "# Local Wiki\nCodex local knowledge.");
    const index = await buildIndexFromFiles(root, ["wiki"]);

    const report = await inspectIndexFreshness(root, index, ["wiki"]);

    assert.equal(report.stale, false);
    assert.deepEqual(report.added, []);
    assert.deepEqual(report.changed, []);
    assert.deepEqual(report.deleted, []);
    assert.deepEqual(report.unchanged, ["wiki/index.md"]);
  });
});

test("inspectIndexFreshness reports added changed and deleted files", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "wiki", "index.md"), "# Local Wiki\nCodex local knowledge.");
    await writeFile(path.join(root, "wiki", "old.md"), "# Old\nRemove me.");
    const index = await buildIndexFromFiles(root, ["wiki"]);

    await writeFile(path.join(root, "wiki", "index.md"), "# Local Wiki\nCodex local knowledge changed.");
    await writeFile(path.join(root, "wiki", "new.md"), "# New\nAdded document.");
    await unlink(path.join(root, "wiki", "old.md"));

    const report = await inspectIndexFreshness(root, index, ["wiki"]);

    assert.equal(report.stale, true);
    assert.deepEqual(report.added, ["wiki/new.md"]);
    assert.deepEqual(report.changed, ["wiki/index.md"]);
    assert.deepEqual(report.deleted, ["wiki/old.md"]);
    assert.deepEqual(report.unchanged, []);
  });
});

test("syncIndexFromFiles reuses unchanged chunks and refreshes changed files", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "wiki", "stable.md"), "# Stable\nKeep this chunk.");
    await writeFile(path.join(root, "wiki", "changed.md"), "# Changed\nOld text.");
    await writeFile(path.join(root, "wiki", "deleted.md"), "# Deleted\nRemove me.");
    const previous = await buildIndexFromFiles(root, ["wiki"]);
    const stableChunk = previous.chunks.find((chunk) => chunk.path === "wiki/stable.md");

    await writeFile(path.join(root, "wiki", "changed.md"), "# Changed\nNew text.");
    await writeFile(path.join(root, "wiki", "added.md"), "# Added\nNew page.");
    await unlink(path.join(root, "wiki", "deleted.md"));

    const synced = await syncIndexFromFiles(root, previous, ["wiki"]);

    assert.equal(synced.version, CURRENT_INDEX_VERSION);
    assert.equal(synced.chunkCount, 3);
    assert.equal(synced.chunks.find((chunk) => chunk.path === "wiki/stable.md"), stableChunk);
    assert.match(synced.chunks.find((chunk) => chunk.path === "wiki/changed.md").text, /New text/);
    assert.equal(synced.chunks.some((chunk) => chunk.path === "wiki/added.md"), true);
    assert.equal(synced.chunks.some((chunk) => chunk.path === "wiki/deleted.md"), false);
  });
});

test("saveIndex writes compact JSON and loadIndex validates it", async () => {
  await withTempDir(async (root) => {
    const index = buildIndex([{
      id: "wiki/index.md#1",
      path: "wiki/index.md",
      heading: "Index",
      text: "Compact local index.",
    }]);

    await saveIndex(root, index);
    const raw = await readFile(path.join(root, ".local-wiki-index", "index.json"), "utf8");
    const loaded = await loadIndex(root);

    assert.doesNotMatch(raw, /\n  "/);
    assert.equal(loaded.version, CURRENT_INDEX_VERSION);
    assert.equal(validateIndex(loaded), loaded);
  });
});

test("saveIndex retries transient Windows rename failures", async () => {
  await withTempDir(async (root) => {
    const index = buildIndex([{
      id: "wiki/index.md#1",
      path: "wiki/index.md",
      heading: "Index",
      text: "Retry a temporarily locked index file.",
    }]);
    let attempts = 0;

    await saveIndex(root, index, ".local-wiki-index", {
      renameAttempts: 3,
      renameDelayMs: 0,
      rename: async (source, destination) => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("file is temporarily locked");
          error.code = attempts === 1 ? "EPERM" : "EBUSY";
          throw error;
        }
        await rename(source, destination);
      },
    });

    assert.equal(attempts, 3);
    assert.equal((await loadIndex(root)).version, CURRENT_INDEX_VERSION);
  });
});

test("validateIndex accepts legacy v2 indexes and rejects logical corruption", () => {
  const legacy = {
    ...buildIndex([{
      id: "wiki/index.md#1",
      path: "wiki/index.md",
      heading: "Index",
      text: "Legacy index.",
    }]),
    version: 2,
  };
  legacy.chunks = legacy.chunks.map((chunk) => ({
    ...chunk,
    tokens: ["legacy"],
    tokenCount: undefined,
    vectorNorm: undefined,
  }));

  assert.equal(validateIndex(legacy), legacy);
  assert.throws(() => validateIndex({ version: 3, chunkCount: 1, chunks: [] }), /chunkCount/i);
  assert.throws(() => validateIndex({ version: 99, chunkCount: 0, chunks: [] }), /version/i);
});

test("syncIndexFromFiles rebuilds files whose previous chunk references are incomplete", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "wiki", "index.md"), "# Index\nDo not lose this file.");
    const previous = await buildIndexFromFiles(root, ["wiki"]);
    previous.chunks = [];
    previous.chunkCount = 0;

    const synced = await syncIndexFromFiles(root, previous, ["wiki"]);

    assert.equal(synced.chunkCount, 1);
    assert.equal(synced.chunks[0].path, "wiki/index.md");
  });
});

test("withIndexLock prevents concurrent index writers and releases after completion", async () => {
  await withTempDir(async (root) => {
    let release;
    let acquired;
    const acquiredPromise = new Promise((resolve) => { acquired = resolve; });
    const releasePromise = new Promise((resolve) => { release = resolve; });
    const first = withIndexLock(root, ".local-wiki-index", async () => {
      acquired();
      await releasePromise;
      return "first";
    });
    await acquiredPromise;

    await assert.rejects(
      withIndexLock(root, ".local-wiki-index", async () => "second"),
      /already running/i,
    );
    release();
    assert.equal(await first, "first");
    assert.equal(await withIndexLock(root, ".local-wiki-index", async () => "third"), "third");
  });
});

test("index operations reject directories outside the knowledge-base root", async () => {
  await withTempDir(async (root) => {
    const index = buildIndex([]);

    assert.throws(() => resolveIndexDirectory(root, "../escaped-index"), /inside/i);
    await assert.rejects(saveIndex(root, index, "../escaped-index"), /inside/i);
    await assert.rejects(loadIndex(root, "../escaped-index"), /inside/i);
    await assert.rejects(
      withIndexLock(root, "../escaped-index", async () => {}),
      /inside/i,
    );
  });
});

test("index writes reject symbolic-link directories", async (context) => {
  await withTempDir(async (root) => {
    const target = path.join(root, "real-index");
    const linked = path.join(root, "linked-index");
    await mkdir(target, { recursive: true });
    try {
      await symlink(target, linked, "junction");
    } catch (error) {
      if (error.code === "EPERM") {
        context.skip("Creating directory links is not permitted on this Windows host.");
        return;
      }
      throw error;
    }

    await assert.rejects(saveIndex(root, buildIndex([]), "linked-index"), /symbolic link/i);
  });
});
