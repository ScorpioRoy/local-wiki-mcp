import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectIndexMetrics,
  generateConfig,
  getVersionInfo,
  initKnowledgeBase,
  repairIndex,
  runDoctor,
  runSmoke,
} from "../src/product.js";
import { CURRENT_INDEX_VERSION, loadIndex, saveIndex } from "../src/indexer.js";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "local-wiki-product-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("initKnowledgeBase creates a minimal skeleton without overwriting files", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "MEMORY.md"), "# Existing\nKeep me.");

    const result = await initKnowledgeBase(root);

    assert.equal(result.created.includes("wiki/index.md"), true);
    assert.equal(result.skipped.includes("MEMORY.md"), true);
    assert.match(await readFile(path.join(root, "MEMORY.md"), "utf8"), /Keep me/);
    assert.match(await readFile(path.join(root, "wiki", "index.md"), "utf8"), /Wiki 内容索引/);
    assert.match(await readFile(path.join(root, "daily", "README.md"), "utf8"), /Daily 工作记录/);
    const config = JSON.parse(await readFile(path.join(root, ".local-wiki.json"), "utf8"));
    assert.deepEqual(config.includes, ["wiki", "MEMORY.md"]);
    assert.deepEqual(config.scopeRoots, ["."]);
    assert.equal(config.indexDir, ".local-wiki-index");
    assert.equal(config.mcpCache.idleUnloadMs, 300000);
    assert.equal(config.reranker.provider, "none");
    assert.equal(config.runtime.mode, "off");
  });
});

test("generateConfig returns safe Codex and Cursor snippets", async () => {
  await withTempDir(async (root) => {
    const codex = generateConfig("codex", { root, command: "node", cliPath: "D:/tools/local-wiki/src/cli.js" });
    assert.match(codex.text, /\[mcp_servers\.local_wiki\]/);
    assert.match(codex.text, /'D:\/tools\/local-wiki\/src\/cli\.js'/);
    assert.doesNotMatch(codex.text, /D:\\/);

    const cursor = generateConfig("cursor", { root, command: "node", cliPath: "D:/tools/local-wiki/src/cli.js" });
    const parsed = JSON.parse(cursor.text);
    assert.equal(parsed.mcpServers["local-wiki"].command, "node");
    assert.equal(parsed.mcpServers["local-wiki"].args[0], "D:/tools/local-wiki/src/cli.js");

    const watched = generateConfig("codex", {
      root,
      command: "node",
      cliPath: "D:/tools/local-wiki/src/cli.js",
      watch: true,
    });
    assert.match(watched.text, /'--watch'/);

    const daemon = generateConfig("cursor", {
      root,
      command: "node",
      cliPath: "D:/tools/local-wiki/src/cli.js",
      daemon: true,
    });
    assert(JSON.parse(daemon.text).mcpServers["local-wiki"].args.includes("--daemon"));

    const quoted = generateConfig("codex", {
      root: path.join(root, "team's wiki"),
      command: "node",
      cliPath: "D:/team's tools/cli.js",
    });
    assert.match(quoted.text, /"D:\/team's tools\/cli\.js"/);
  });
});

test("initKnowledgeBase supports a minimal product template", async () => {
  await withTempDir(async (root) => {
    const result = await initKnowledgeBase(root, { template: "minimal" });

    assert.equal(result.template, "minimal");
    assert.equal(result.created.includes("MEMORY.md"), true);
    assert.equal(result.created.includes("wiki/index.md"), true);
    await assert.rejects(readFile(path.join(root, "daily", "README.md"), "utf8"), /ENOENT/);
    await assert.rejects(() => initKnowledgeBase(root, { template: "unknown" }), /template/i);
  });
});

test("runDoctor reports missing and fresh index states", async () => {
  await withTempDir(async (root) => {
    await initKnowledgeBase(root);

    const missing = await runDoctor(root);
    assert.equal(missing.ok, false);
    assert.equal(missing.checks.index.status, "error");

    await repairIndex(root);
    const fresh = await runDoctor(root);
    assert.equal(fresh.ok, true);
    assert.equal(fresh.checks.index.status, "ok");
    assert.equal(fresh.checks.index.stale, false);
    assert.equal(fresh.checks.mcp_tools.status, "ok");
  });
});

test("repairIndex rebuilds corrupt indexes", async () => {
  await withTempDir(async (root) => {
    await initKnowledgeBase(root);
    await mkdir(path.join(root, ".local-wiki-index"), { recursive: true });
    await writeFile(path.join(root, ".local-wiki-index", "index.json"), "{bad json");

    const result = await repairIndex(root);
    const index = await loadIndex(root);

    assert.equal(result.repaired, true);
    assert.equal(index.version, CURRENT_INDEX_VERSION);
    assert(index.chunkCount > 0);
  });
});

test("saveIndex writes atomically without leaving temp files", async () => {
  await withTempDir(async (root) => {
    await initKnowledgeBase(root);
    await repairIndex(root);

    const index = await loadIndex(root);
    await saveIndex(root, index);

    const files = await readdir(path.join(root, ".local-wiki-index"));
    assert.equal(files.includes("index.json"), true);
    assert.equal(files.some((file) => file.includes(".tmp-")), false);
    assert.equal((await loadIndex(root)).version, CURRENT_INDEX_VERSION);
  });
});

test("runSmoke verifies a usable local index and MCP tool surface", async () => {
  await withTempDir(async (root) => {
    await initKnowledgeBase(root);
    await repairIndex(root);

    const report = await runSmoke(root);

    assert.equal(report.ok, true);
    assert.equal(report.checks.index.status, "ok");
    assert.deepEqual(report.checks.mcp_tools.tools, ["search_wiki", "grep_wiki", "read_wiki", "status_wiki"]);
    assert.equal(report.checks.search.status, "ok");
  });
});

test("version, verbose doctor, and index metrics expose product diagnostics", async () => {
  await withTempDir(async (root) => {
    await initKnowledgeBase(root);
    await repairIndex(root);

    const index = await loadIndex(root);
    const metrics = await collectIndexMetrics(root, index);
    const doctor = await runDoctor(root, { verbose: true });
    const version = getVersionInfo();

    assert.equal(version.name, "local-wiki-mcp");
    assert.match(version.version, /^\d+\.\d+\.\d+$/);
    assert.equal(metrics.chunk_count, index.chunkCount);
    assert(metrics.index_bytes > 0);
    assert.equal(doctor.ok, true);
    assert.equal(doctor.checks.config.status, "ok");
    assert.equal(doctor.checks.index.freshness_mode, "strict");
    assert.equal(doctor.diagnostics.index_metrics.chunk_count, index.chunkCount);
    assert.equal(doctor.diagnostics.watch_lock.active, false);
  });
});
