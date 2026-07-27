import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadConfig,
  mergeCliOptions,
  validateConfigFile,
  validateConfigValue,
} from "../src/config.js";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "local-wiki-config-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadConfig returns defaults when config file is missing", async () => {
  await withTempDir(async (root) => {
    const config = await loadConfig(root);

    assert.deepEqual(config.includes, ["wiki", "MEMORY.md"]);
    assert.equal(config.indexDir, ".local-wiki-index");
    assert.equal(config.maxChunkChars, 2400);
    assert.equal(config.searchWeights.exact, 3);
    assert.equal(config.mcpCache.reloadCheckTtlMs, 1000);
    assert.equal(config.mcpCache.freshnessTtlMs, 5000);
    assert.equal(config.mcpCache.idleUnloadMs, 300000);
    assert.equal(config.reranker.provider, "none");
    assert.equal(config.reranker.baseUrl, "http://127.0.0.1:11434");
    assert.equal(config.reranker.semanticWeight, 0.35);
    assert.equal(config.watch.intervalMs, 2000);
    assert.equal(config.watch.strictEvery, 30);
  });
});

test("loadConfig reads .local-wiki.json and normalizes arrays", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, ".local-wiki.json"), JSON.stringify({
      includes: ["docs", "NOTES.md"],
      indexDir: ".cache/wiki",
      exclude: ["secret"],
      maxChunkChars: 1200,
      searchWeights: { exact: 4, title: 2, path: 1.25 },
      mcpCache: { reloadCheckTtlMs: 250, freshnessTtlMs: 1500, idleUnloadMs: 60000 },
      reranker: {
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        model: "bge-m3",
        timeoutMs: 2500,
        candidateLimit: 12,
        semanticWeight: 0.5,
      },
      watch: { intervalMs: 750, strictEvery: 10 },
    }));

    const config = await loadConfig(root);

    assert.deepEqual(config.includes, ["docs", "NOTES.md"]);
    assert.equal(config.indexDir, ".cache/wiki");
    assert.deepEqual(config.exclude, ["secret"]);
    assert.equal(config.maxChunkChars, 1200);
    assert.equal(config.searchWeights.exact, 4);
    assert.equal(config.searchWeights.title, 2);
    assert.equal(config.searchWeights.path, 1.25);
    assert.equal(config.mcpCache.reloadCheckTtlMs, 250);
    assert.equal(config.mcpCache.freshnessTtlMs, 1500);
    assert.equal(config.mcpCache.idleUnloadMs, 60000);
    assert.equal(config.reranker.provider, "ollama");
    assert.equal(config.reranker.model, "bge-m3");
    assert.equal(config.reranker.candidateLimit, 12);
    assert.equal(config.watch.intervalMs, 750);
    assert.equal(config.watch.strictEvery, 10);
  });
});

test("mergeCliOptions lets command-line values override config", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki"), { recursive: true });
    const config = await loadConfig(root);

    const merged = mergeCliOptions(config, {
      include: ["custom"],
      exclude: ["custom/private"],
      indexDir: ".idx",
      maxChars: 999,
    });

    assert.deepEqual(merged.includes, ["custom"]);
    assert.deepEqual(merged.exclude, ["custom/private"]);
    assert.equal(merged.indexDir, ".idx");
    assert.equal(merged.maxChunkChars, 999);
  });
});

test("validateConfigValue reports invalid values and unknown fields", () => {
  const report = validateConfigValue({
    includes: ["wiki", ""],
    indexDir: "../outside",
    maxChunkChars: 12.5,
    searchWeights: { exact: -1, title: 2, path: 1, typo: true },
    unknown: true,
  }, { root: path.resolve("knowledge") });

  assert.equal(report.ok, false);
  assert(report.errors.some((entry) => entry.path === "$.includes[1]"));
  assert(report.errors.some((entry) => entry.path === "$.indexDir"));
  assert(report.errors.some((entry) => entry.path === "$.maxChunkChars"));
  assert(report.errors.some((entry) => entry.path === "$.searchWeights.exact"));
  assert(report.warnings.some((entry) => entry.path === "$.unknown"));
  assert(report.warnings.some((entry) => entry.path === "$.searchWeights.typo"));
});

test("validateConfigValue rejects remote or malformed reranker settings", () => {
  const report = validateConfigValue({
    reranker: {
      provider: "ollama",
      baseUrl: "https://example.com",
      model: "",
      timeoutMs: 0,
      candidateLimit: 1.5,
      semanticWeight: 2,
    },
  });

  assert.equal(report.ok, false);
  assert(report.errors.some((entry) => entry.path === "$.reranker.baseUrl"));
  assert(report.errors.some((entry) => entry.path === "$.reranker.model"));
  assert(report.errors.some((entry) => entry.path === "$.reranker.timeoutMs"));
  assert(report.errors.some((entry) => entry.path === "$.reranker.candidateLimit"));
  assert(report.errors.some((entry) => entry.path === "$.reranker.semanticWeight"));
});

test("validateConfigValue validates shared runtime settings", () => {
  const invalid = validateConfigValue({
    runtime: { mode: "remote", timeoutMs: 0, requestLimitBytes: 10 },
  });
  const valid = validateConfigValue({
    runtime: { mode: "auto", timeoutMs: 1000, requestLimitBytes: 1048576 },
  });

  assert.equal(invalid.ok, false);
  assert(invalid.errors.some((entry) => entry.path === "$.runtime.mode"));
  assert.equal(valid.ok, true);
  assert.equal(valid.config.runtime.mode, "auto");
});

test("validateConfigValue validates query alias dictionaries", () => {
  const invalid = validateConfigValue({ queryAliases: { legacy: "qmd" } });
  const valid = validateConfigValue({ queryAliases: { legacy: ["qmd", "local-wiki"] } });

  assert.equal(invalid.ok, false);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.config.queryAliases.legacy, ["qmd", "local-wiki"]);
});

test("validateConfigFile handles defaults, missing includes, and malformed JSON", async () => {
  await withTempDir(async (root) => {
    const defaults = await validateConfigFile(root);
    assert.equal(defaults.ok, true);
    assert.equal(defaults.status, "defaults");
    assert.equal(defaults.exists, false);

    await writeFile(path.join(root, ".local-wiki.json"), JSON.stringify({ includes: ["missing"] }));
    const missing = await validateConfigFile(root);
    assert.equal(missing.ok, true);
    assert.equal(missing.status, "warning");
    assert.match(missing.warnings[0].message, /does not exist/i);

    await writeFile(path.join(root, ".local-wiki.json"), "{broken");
    const malformed = await validateConfigFile(root);
    assert.equal(malformed.ok, false);
    assert.equal(malformed.status, "error");
    assert.match(malformed.errors[0].message, /valid JSON/i);
  });
});
