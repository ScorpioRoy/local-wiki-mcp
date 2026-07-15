import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../src/cli.js");

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "local-wiki-cli-"));
  try {
    await mkdir(path.join(dir, "wiki"), { recursive: true });
    await writeFile(path.join(dir, "wiki", "index.md"), "# Local Wiki\nCodex MCP 本地知识库检索");
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("cli indexes and searches a local wiki", async () => {
  await withTempDir(async (root) => {
    const index = await execFileAsync("node", [cliPath, "index", "--root", root, "--include", "wiki"]);
    assert.match(index.stdout, /indexed 1 chunks/i);

    const search = await execFileAsync("node", [cliPath, "search", "Codex MCP", "--root", root, "--top-k", "1"]);
    const parsed = JSON.parse(search.stdout);
    assert.equal(parsed.results[0].path, "wiki/index.md");

    const status = await execFileAsync("node", [cliPath, "status", "--root", root]);
    assert.match(status.stdout, /chunk_count/i);
  });
});

test("cli status reports stale files and sync refreshes the index", async () => {
  await withTempDir(async (root) => {
    await execFileAsync("node", [cliPath, "index", "--root", root, "--include", "wiki"]);

    const freshStatus = await execFileAsync("node", [cliPath, "status", "--root", root]);
    assert.equal(JSON.parse(freshStatus.stdout).stale, false);

    await writeFile(path.join(root, "wiki", "index.md"), "# Local Wiki\nCodex MCP advanced sync.");
    await writeFile(path.join(root, "wiki", "advanced.md"), "# Advanced\nStale detection.");

    const staleStatus = await execFileAsync("node", [cliPath, "status", "--root", root]);
    const stale = JSON.parse(staleStatus.stdout);
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.changed, ["wiki/index.md"]);
    assert.deepEqual(stale.added, ["wiki/advanced.md"]);

    const sync = await execFileAsync("node", [cliPath, "sync", "--root", root, "--include", "wiki"]);
    assert.match(sync.stdout, /synced 2 chunks/i);

    const syncedStatus = await execFileAsync("node", [cliPath, "status", "--root", root]);
    assert.equal(JSON.parse(syncedStatus.stdout).stale, false);
  });
});

test("cli exposes product init config doctor and repair commands", async () => {
  await withTempDir(async (root) => {
    const init = await execFileAsync("node", [cliPath, "init", "--root", root]);
    assert.equal(JSON.parse(init.stdout).skipped.includes("wiki/index.md"), true);

    const codex = await execFileAsync("node", [cliPath, "config", "codex", "--root", root]);
    assert.match(codex.stdout, /\[mcp_servers\.local_wiki\]/);
    assert.doesNotMatch(codex.stdout, /\\/);

    const repair = await execFileAsync("node", [cliPath, "repair", "--root", root, "--force"]);
    assert.equal(JSON.parse(repair.stdout).repaired, true);

    const doctor = await execFileAsync("node", [cliPath, "doctor", "--root", root]);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.checks.index.status, "ok");
  });
});

test("cli honors .local-wiki.json includes exclude and indexDir", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "docs", "private"), { recursive: true });
    await writeFile(path.join(root, "docs", "guide.md"), "# Docs\nConfigured include.");
    await writeFile(path.join(root, "docs", "private", "secret.md"), "# Secret\nExcluded.");
    await writeFile(path.join(root, ".local-wiki.json"), JSON.stringify({
      includes: ["docs"],
      exclude: ["docs/private"],
      indexDir: ".custom-index",
    }));

    const index = await execFileAsync("node", [cliPath, "index", "--root", root]);
    assert.match(index.stdout, /\.custom-index/);

    const search = await execFileAsync("node", [cliPath, "search", "Configured", "--root", root]);
    const parsed = JSON.parse(search.stdout);
    assert.deepEqual(parsed.results.map((result) => result.path), ["docs/guide.md"]);
  });
});

test("cli bench and eval report measurable search quality", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "wiki", "index.md"), "# Local Wiki\nProduct v1.1 bench eval.");
    await writeFile(path.join(root, "eval.json"), JSON.stringify([
      { query: "Product v1.1", expected: ["wiki/index.md"], top_k: 1 },
    ]));
    await execFileAsync("node", [cliPath, "index", "--root", root, "--include", "wiki"]);

    const bench = await execFileAsync("node", [cliPath, "bench", "--root", root, "--query", "Product v1.1"]);
    const benchReport = JSON.parse(bench.stdout);
    assert.equal(benchReport.query, "Product v1.1");
    assert.equal(benchReport.chunk_count, 1);
    assert.equal(typeof benchReport.search_ms, "number");

    const evaluation = await execFileAsync("node", [cliPath, "eval", "--root", root, "--fixture", path.join(root, "eval.json")]);
    const evalReport = JSON.parse(evaluation.stdout);
    assert.equal(evalReport.total, 1);
    assert.equal(evalReport.top1_hits, 1);
    assert.equal(evalReport.topk_hits, 1);

    const summary = await execFileAsync("node", [
      cliPath,
      "eval",
      "--root",
      root,
      "--fixture",
      path.join(root, "eval.json"),
      "--summary",
    ]);
    assert.equal(JSON.parse(summary.stdout).cases, undefined);
  });
});

test("cli eval returns exit code 3 when quality thresholds fail", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "eval-fail.json"), JSON.stringify([
      { query: "Codex MCP", expected: ["wiki/missing.md"], top_k: 1 },
    ]));
    await execFileAsync("node", [cliPath, "index", "--root", root, "--include", "wiki"]);

    await assert.rejects(
      execFileAsync("node", [
        cliPath,
        "eval",
        "--root",
        root,
        "--fixture",
        path.join(root, "eval-fail.json"),
        "--min-top1",
        "1",
      ]),
      (error) => {
        assert.equal(error.code, 3);
        assert.equal(JSON.parse(error.stdout).passed, false);
        return true;
      },
    );
  });
});

test("cli supports minimal init smoke and numeric validation", async () => {
  await withTempDir(async (root) => {
    const target = path.join(root, "minimal");
    const init = await execFileAsync("node", [cliPath, "init", "--root", target, "--template", "minimal"]);
    assert.equal(JSON.parse(init.stdout).template, "minimal");
    await execFileAsync("node", [cliPath, "repair", "--root", target]);

    const smoke = await execFileAsync("node", [cliPath, "smoke", "--root", target]);
    assert.equal(JSON.parse(smoke.stdout).ok, true);

    await assert.rejects(
      execFileAsync("node", [cliPath, "bench", "--root", target, "--iterations", "0"]),
      /positive integer/i,
    );
  });
});

test("cli exposes v1.3 version, validation, metrics, verbose doctor, and explain commands", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, ".local-wiki.json"), JSON.stringify({ includes: ["wiki"] }));

    const version = await execFileAsync("node", [cliPath, "version", "--json"]);
    assert.equal(JSON.parse(version.stdout).name, "local-wiki-mcp");

    const validation = await execFileAsync("node", [cliPath, "config", "validate", "--root", root]);
    assert.equal(JSON.parse(validation.stdout).ok, true);

    await execFileAsync("node", [cliPath, "index", "--root", root]);
    const status = await execFileAsync("node", [cliPath, "status", "--root", root, "--metrics"]);
    assert(JSON.parse(status.stdout).metrics.index_bytes > 0);

    const doctor = await execFileAsync("node", [cliPath, "doctor", "--root", root, "--verbose"]);
    assert.equal(JSON.parse(doctor.stdout).diagnostics.product.name, "local-wiki-mcp");

    const explanation = await execFileAsync("node", [cliPath, "explain", "Codex MCP", "--root", root]);
    const explainReport = JSON.parse(explanation.stdout);
    assert.equal(explainReport.query, "Codex MCP");
    assert(explainReport.returned_count > 0);
  });
});

test("config validate returns structured errors for malformed JSON", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, ".local-wiki.json"), "{broken");

    await assert.rejects(
      execFileAsync("node", [cliPath, "config", "validate", "--root", root]),
      (error) => {
        assert.equal(error.code, 2);
        const report = JSON.parse(error.stdout);
        assert.equal(report.ok, false);
        assert.match(report.errors[0].message, /valid JSON/i);
        return true;
      },
    );
  });
});
