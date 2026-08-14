import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("cli search and grep can isolate one project while retaining common wiki", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki", "legacy-app"), { recursive: true });
    await mkdir(path.join(root, "wiki", "support-service"), { recursive: true });
    await mkdir(path.join(root, "wiki", "common"), { recursive: true });
    await writeFile(path.join(root, "wiki", "legacy-app", "questionnaire.md"), "# Legacy App\nQUESTIONNAIRE_SHARED 问卷需求");
    await writeFile(path.join(root, "wiki", "support-service", "questionnaire.md"), "# Project B\nQUESTIONNAIRE_SHARED 问卷需求");
    await writeFile(path.join(root, "wiki", "common", "source.md"), "# Common\nQUESTIONNAIRE_SHARED 问卷需求先确认项目事实源");
    await execFileAsync("node", [cliPath, "index", "--root", root, "--include", "wiki"]);

    const search = await execFileAsync("node", [cliPath, "search", "问卷需求", "--root", root, "--project", "legacy-app", "--top-k", "10"]);
    const parsedSearch = JSON.parse(search.stdout);
    const grep = await execFileAsync("node", [cliPath, "grep", "QUESTIONNAIRE_SHARED", "--root", root, "--project", "legacy-app"]);
    const parsedGrep = JSON.parse(grep.stdout);

    assert(parsedSearch.results.some((result) => result.path === "wiki/legacy-app/questionnaire.md"));
    assert(parsedSearch.results.some((result) => result.path === "wiki/common/source.md"));
    assert(!parsedSearch.results.some((result) => result.path.startsWith("wiki/support-service/")));
    assert.deepEqual(parsedGrep.results.map((result) => result.path).sort(), [
      "wiki/common/source.md",
      "wiki/legacy-app/questionnaire.md",
    ]);
  });
});

test("cli applies configured project groups and canonicalizes repository ids", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki", "support-suite"), { recursive: true });
    await mkdir(path.join(root, "wiki", "legacy-app"), { recursive: true });
    await writeFile(path.join(root, ".local-wiki.json"), JSON.stringify({
      includes: ["wiki"],
      projectGroups: {
        "support-suite": ["support-web", "support-service", "data-sync", "admin-service"],
      },
    }));
    await writeFile(path.join(root, "wiki", "support-suite", "scope.md"), "# support-suite\nSUPPORT_SUITE_CLI_GROUP_SCOPE");
    await writeFile(path.join(root, "wiki", "legacy-app", "scope.md"), "# Legacy App\nSUPPORT_SUITE_CLI_GROUP_SCOPE");
    await execFileAsync("node", [cliPath, "index", "--root", root]);

    const grouped = JSON.parse((await execFileAsync("node", [
      cliPath, "search", "SUPPORT_SUITE_CLI_GROUP_SCOPE", "--root", root, "--project", "support-web", "--top-k", "10",
    ])).stdout);
    const crossProject = JSON.parse((await execFileAsync("node", [
      cliPath, "grep", "SUPPORT_SUITE_CLI_GROUP_SCOPE", "--root", root,
      "--project", "support-suite", "--project", "legacy-app",
    ])).stdout);

    assert.deepEqual(grouped.scope, { mode: "project", projects: ["support-suite"], include_common: true });
    assert(grouped.results.some((result) => result.path === "wiki/support-suite/scope.md"));
    assert(!grouped.results.some((result) => result.path.startsWith("wiki/legacy-app/")));
    assert(crossProject.results.some((result) => result.path.startsWith("wiki/support-suite/")));
    assert(crossProject.results.some((result) => result.path.startsWith("wiki/legacy-app/")));
  });
});

test("cli applies configured scope roots while isolating personal wiki from project facts", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki", "support-suite"), { recursive: true });
    await mkdir(path.join(root, "agent-memory", "wiki", "support-suite"), { recursive: true });
    await mkdir(path.join(root, "agent-memory", "wiki", "common"), { recursive: true });
    await mkdir(path.join(root, "agent-memory", "wiki", "legacy-app"), { recursive: true });
    await writeFile(path.join(root, ".local-wiki.json"), JSON.stringify({
      includes: ["wiki", "agent-memory/wiki"],
      scopeRoots: [".", "agent-memory"],
      projectGroups: {
        "support-suite": ["support-web", "support-service", "data-sync", "admin-service"],
      },
    }));
    await writeFile(path.join(root, "wiki", "support-suite", "shared.md"), "# Shared\nCLI_MULTI_ROOT_SCOPE");
    await writeFile(path.join(root, "agent-memory", "wiki", "support-suite", "private.md"), "# Private\nCLI_MULTI_ROOT_SCOPE");
    await writeFile(path.join(root, "agent-memory", "wiki", "common", "common.md"), "# Common\nCLI_MULTI_ROOT_SCOPE");
    await writeFile(path.join(root, "agent-memory", "wiki", "legacy-app", "private.md"), "# Legacy App\nCLI_MULTI_ROOT_SCOPE");
    await execFileAsync("node", [cliPath, "index", "--root", root]);

    const parsed = JSON.parse((await execFileAsync("node", [
      cliPath, "search", "CLI_MULTI_ROOT_SCOPE", "--root", root, "--project", "data-sync", "--top-k", "10",
    ])).stdout);
    const paths = parsed.results.map((result) => result.path);

    assert.deepEqual(parsed.scope, { mode: "project", projects: ["support-suite"], include_common: true });
    assert(paths.includes("wiki/support-suite/shared.md"));
    assert(!paths.includes("agent-memory/wiki/support-suite/private.md"));
    assert(paths.includes("agent-memory/wiki/common/common.md"));
    assert(!paths.includes("agent-memory/wiki/legacy-app/private.md"));
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

test("cli bind previews by default and applies only to explicit config paths", async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "bound-knowledge");
    const codexConfig = path.join(base, "home", ".codex", "config.toml");
    const cursorConfig = path.join(base, "home", ".cursor", "mcp.json");
    const common = [
      cliPath, "bind", "--root", root,
      "--client", "codex", "--client", "cursor",
      "--codex-config", codexConfig, "--cursor-config", cursorConfig,
      "--initialize", "--refresh", "--daemon",
    ];
    const preview = JSON.parse((await execFileAsync("node", common)).stdout);
    assert.equal(preview.mode, "preview");
    assert.equal(preview.ok, true);
    assert.equal(preview.actions.apply_client_config, true);
    assert.equal(preview.bindings.length, 2);

    const applied = JSON.parse((await execFileAsync("node", [...common, "--apply"])).stdout);
    assert.equal(applied.mode, "applied");
    assert.equal(applied.smoke.ok, true);
    assert.match(await (await import("node:fs/promises")).readFile(codexConfig, "utf8"), /local-wiki-mcp managed/);
  });
});

test("cli bind returns a failing preview for conflicting client configuration", async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "bound-knowledge");
    const cursorConfig = path.join(base, "home", ".cursor", "mcp.json");
    await mkdir(path.dirname(cursorConfig), { recursive: true });
    await writeFile(cursorConfig, JSON.stringify({
      mcpServers: { "local-wiki": { command: "custom" } },
    }));

    await assert.rejects(
      execFileAsync("node", [
        cliPath, "bind", "--root", root,
        "--client", "cursor", "--cursor-config", cursorConfig,
        "--initialize",
      ]),
      error => {
        const report = JSON.parse(error.stdout);
        assert.equal(report.mode, "preview");
        assert.equal(report.ok, false);
        assert.match(report.bindings[0].error, /different local-wiki/i);
        return true;
      },
    );
    await assert.rejects(access(path.join(root, ".local-wiki.json")), /ENOENT/);
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

test("cli audit honors configured sources and scope roots", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "agent-memory", "wiki"), { recursive: true });
    await writeFile(path.join(root, "AGENTS.md"), "qmd search shared-team-wiki");
    await writeFile(path.join(root, "agent-memory", "wiki", "log.md"), "qmd collection memory-wiki");
    await writeFile(path.join(root, ".local-wiki.json"), JSON.stringify({
      includes: ["wiki", "agent-memory/wiki"],
      scopeRoots: [".", "agent-memory"],
    }));

    const audit = await execFileAsync("node", [cliPath, "audit", "--root", root]);
    const report = JSON.parse(audit.stdout);

    assert.equal(report.ok, true);
    assert.equal(report.scanned_files, 2);
    assert.deepEqual(report.issues, []);
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

test("cli exposes version, validation, metrics, verbose doctor, and explain commands", async () => {
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

test("doctor --fix rebuilds a missing derived index", async () => {
  await withTempDir(async (root) => {
    await execFileAsync("node", [cliPath, "init", "--root", root, "--template", "minimal"]);
    const fixed = await execFileAsync("node", [cliPath, "doctor", "--root", root, "--fix"]);
    const report = JSON.parse(fixed.stdout);

    assert.equal(report.ok, true);
    assert.equal(report.checks.index.status, "ok");
    assert.equal(report.fixes[0].action, "repair_index");
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
