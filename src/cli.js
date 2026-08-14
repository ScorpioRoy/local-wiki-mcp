#!/usr/bin/env node
import process from "node:process";
import { readFile } from "node:fs/promises";
import { auditWorkspace } from "./audit.js";
import { buildStartupContext } from "./context.js";
import { CURRENT_INDEX_VERSION, inspectIndexFreshness, loadIndex } from "./indexer.js";
import { explainSearch, grepIndex, readFromIndex, searchIndex } from "./search.js";
import { rerankSearchResults } from "./reranker.js";
import { startStdioServer } from "./mcp.js";
import {
  collectIndexMetrics,
  generateConfig,
  getVersionInfo,
  initKnowledgeBase,
  repairIndex,
  runDoctor,
  runSmoke,
} from "./product.js";
import { DEFAULT_CONFIG, loadConfig, mergeCliOptions, validateConfigFile } from "./config.js";
import { runBench, runEval } from "./eval.js";
import { buildKnowledgeBase, syncKnowledgeBase } from "./operations.js";
import { startExclusiveWatcher } from "./watcher.js";
import { publicProjectScope, resolveProjectScope } from "./project-scope.js";
import { bindKnowledgeBase } from "./binding.js";
import {
  createRuntimeBridgeHandlers,
  inspectRuntime,
  startRuntimeServer,
  stopRuntime,
  runRuntimeInstaller,
} from "./runtime.js";

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] ?? "help";
  const args = parseArgs(argv.slice(1));

  if (command === "help" || args.help) {
    printHelp();
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    const info = getVersionInfo();
    if (args.json) printJson(info);
    else console.log(`${info.name} ${info.version}`);
    return;
  }

  const root = args.root ?? process.cwd();

  if (command === "config" && args.positionals[0] === "validate") {
    const report = await validateConfigFile(root);
    printJson(report);
    if (!report.ok) process.exitCode = 2;
    return;
  }

  if (command === "doctor") {
    const configReport = await validateConfigFile(root);
    const config = mergeCliOptions(configReport.config ?? DEFAULT_CONFIG, args);
    let report = await runDoctor(root, {
      includes: config.includes,
      indexDir: config.indexDir,
      exclude: config.exclude,
      configReport,
      verbose: args.verbose === true,
      strict: args.strict === true,
    });
    if (args.fix && configReport.ok && report.checks.root.status === "ok" && report.checks.index.status !== "ok") {
      const repair = await repairIndex(root, {
        indexDir: config.indexDir,
        force: true,
        includes: config.includes,
        exclude: config.exclude,
        maxChunkChars: config.maxChunkChars,
      });
      report = await runDoctor(root, {
        includes: config.includes,
        indexDir: config.indexDir,
        exclude: config.exclude,
        configReport,
        verbose: args.verbose === true,
        strict: args.strict === true,
      });
      report.fixes = [{ action: "repair_index", result: repair }];
    } else if (args.fix) {
      report.fixes = [];
    }
    printJson(report);
    if (!report.ok) process.exitCode = 2;
    return;
  }

  if (command === "bind") {
    const report = await bindKnowledgeBase(root, {
      clients: args.clients,
      initialize: args.initialize,
      refresh: args.refresh,
      template: args.template,
      daemon: args.daemon,
      installRuntime: args.installRuntime,
      noStart: args.noStart,
      apply: args.apply,
      codexConfig: args.codexConfig,
      cursorConfig: args.cursorConfig,
    });
    printJson(report);
    if (!report.ok) process.exitCode = 2;
    return;
  }

  const config = mergeCliOptions(await loadConfig(root), args);
  const indexDir = config.indexDir;

  if (command === "runtime") {
    const action = args.positionals[0] ?? "status";
    if (action === "status") {
      printJson(await inspectRuntime(root, indexDir, { timeoutMs: config.runtime.timeoutMs }));
      return;
    }
    if (action === "stop") {
      printJson(await stopRuntime(root, indexDir));
      return;
    }
    if (action === "install") {
      printJson(runRuntimeInstaller(root, { noStart: args.noStart }));
      return;
    }
    if (action === "uninstall") {
      printJson(runRuntimeInstaller(root, { uninstall: true }));
      return;
    }
    throw new Error(`Unknown runtime action: ${action}`);
  }

  if (command === "init") {
    printJson(await initKnowledgeBase(root, { template: args.template }));
    return;
  }

  if (command === "repair") {
    printJson(await repairIndex(root, {
      indexDir,
      force: args.force,
      includes: config.includes,
      exclude: config.exclude,
      maxChunkChars: config.maxChunkChars,
    }));
    return;
  }

  if (command === "config") {
    const kind = args.positionals[0];
    requireValue(kind, "config requires a target: codex, cursor, or validate");
    process.stdout.write(generateConfig(kind, { root, watch: args.watch, daemon: args.daemon }).text);
    return;
  }

  if (command === "index") {
    const report = await buildKnowledgeBase(root, config);
    console.log(`Indexed ${report.chunk_count} chunks into ${report.file}`);
    return;
  }

  if (command === "sync") {
    const report = await syncKnowledgeBase(root, config);
    console.log(`Synced ${report.chunk_count} chunks into ${report.file} (${report.mode})`);
    return;
  }

  if (command === "context") {
    const report = await buildStartupContext(root, {
      days: args.days,
      maxTasks: args.maxTasks,
      maxChars: args.maxChars,
    });
    if (args.json) printJson(report);
    else process.stdout.write(report.text);
    return;
  }

  if (command === "search") {
    const query = args.positionals.join(" ").trim();
    requireValue(query, "search requires a query");
    const index = await loadIndex(root, indexDir);
    const topK = args.topK ?? 8;
    const rerankRequested = args.rerank ?? config.reranker.provider !== "none";
    const projectScope = cliProjectScope(args, config.projectGroups, config.scopeRoots);
    const lexicalResults = searchIndex(index, query, {
      topK: rerankRequested ? Math.max(topK, config.reranker.candidateLimit) : topK,
      maxChunksPerPath: args.maxChunksPerPath,
      diversity: args.diversity,
      topicDiversity: args.topicDiversity,
      contextChars: args.contextChars,
      maxOutputTokens: args.maxOutputTokens,
      weights: config.searchWeights,
      queryAliases: config.queryAliases,
      projectScope,
    });
    if (!rerankRequested) {
      printJson({ query, scope: publicProjectScope(projectScope), results: lexicalResults });
      return;
    }
    const reranked = await rerankSearchResults(index, query, lexicalResults, config.reranker, { topK });
    const { results, ...reranker } = reranked;
    printJson({ query, scope: publicProjectScope(projectScope), reranker, results });
    return;
  }

  if (command === "explain") {
    const query = args.positionals.join(" ").trim();
    requireValue(query, "explain requires a query");
    const index = await loadIndex(root, indexDir);
    const projectScope = cliProjectScope(args, config.projectGroups, config.scopeRoots);
    printJson(explainSearch(index, query, {
      topK: args.topK ?? 8,
      maxChunksPerPath: args.maxChunksPerPath,
      diversity: args.diversity,
      weights: config.searchWeights,
      queryAliases: config.queryAliases,
      projectScope,
    }));
    return;
  }

  if (command === "grep") {
    const pattern = args.positionals.join(" ").trim();
    requireValue(pattern, "grep requires a pattern");
    const index = await loadIndex(root, indexDir);
    const projectScope = cliProjectScope(args, config.projectGroups, config.scopeRoots);
    const results = grepIndex(index, pattern, { topK: args.topK ?? 20, projectScope });
    printJson({ pattern, scope: publicProjectScope(projectScope), results });
    return;
  }

  if (command === "read") {
    const target = args.positionals.join(" ").trim();
    requireValue(target, "read requires a path or chunk id");
    const index = await loadIndex(root, indexDir);
    const results = readFromIndex(index, target, { maxChars: args.maxChars ?? 12000 });
    printJson({ target, results });
    return;
  }

  if (command === "status") {
    const index = await loadIndex(root, indexDir);
    const freshness = await inspectIndexFreshness(root, index, config.includes, {
      exclude: config.exclude,
      strict: args.strict === true,
    });
    const report = {
      version: index.version,
      current_version: CURRENT_INDEX_VERSION,
      created_at: index.createdAt,
      chunk_count: index.chunkCount,
      root: index.metadata?.root,
      includes: index.metadata?.includes ?? [],
      stale: freshness.stale,
      added: freshness.added,
      changed: freshness.changed,
      deleted: freshness.deleted,
      unchanged_count: freshness.unchanged.length,
    };
    if (args.metrics) {
      report.metrics = await collectIndexMetrics(root, index, indexDir);
    }
    printJson(report);
    return;
  }

  if (command === "audit") {
    const report = await auditWorkspace(root, {
      includes: config.includes,
      exclude: config.exclude,
      scopeRoots: config.scopeRoots,
    });
    printJson(report);
    if (!report.ok) {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "bench") {
    const query = args.query ?? args.positionals.join(" ").trim() ?? "local-wiki";
    const report = await runBench({
      query: query || "local-wiki",
      topK: args.topK ?? 8,
      iterations: args.iterations ?? 5,
      weights: config.searchWeights,
      queryAliases: config.queryAliases,
      loadIndex: () => loadIndex(root, indexDir),
    });
    printJson(report);
    return;
  }

  if (command === "eval") {
    requireValue(args.fixture, "eval requires --fixture PATH");
    const index = await loadIndex(root, indexDir);
    const fixtures = JSON.parse(await readFile(args.fixture, "utf8"));
    const report = runEval(index, fixtures, {
      topK: args.topK,
      weights: config.searchWeights,
      maxChunksPerPath: args.maxChunksPerPath,
      diversity: args.diversity,
      minTop1: args.minTop1,
      minTop3: args.minTop3,
      minTop5: args.minTop5,
      maxDuplicateRate: args.maxDuplicateRate,
      variantSet: args.variantSet,
      queryAliases: config.queryAliases,
    });
    if (args.summary) delete report.cases;
    printJson(report);
    if (!report.passed) process.exitCode = 3;
    return;
  }

  if (command === "smoke") {
    const report = await runSmoke(root, {
      includes: config.includes,
      indexDir,
      exclude: config.exclude,
      query: args.query,
    });
    printJson(report);
    if (!report.ok) process.exitCode = 2;
    return;
  }

  if (command === "watch") {
    const watcher = await startConfiguredWatcher(root, config, args, console.log);
    console.log(`Watching ${root} every ${args.intervalMs ?? config.watch.intervalMs}ms. Press Ctrl+C to stop.`);
    installWatchShutdown(watcher);
    return;
  }

  if (command === "daemon") {
    const runtime = await startRuntimeServer({
      ...directServerOptions(root, config),
      config,
      mcpCache: config.mcpCache,
      watch: args.watch,
      port: args.port,
      requestLimitBytes: config.runtime.requestLimitBytes,
      watchOptions: {
        intervalMs: args.intervalMs ?? config.watch.intervalMs,
        strictEvery: config.watch.strictEvery,
        runImmediately: true,
        onResult: (report) => {
          if (report.updated) console.log(`local-wiki runtime watch: ${report.mode}, ${report.chunk_count} chunks`);
        },
        onError: (error) => console.error(`local-wiki runtime watch: ${error.message}`),
      },
    });
    printJson(runtime.state);
    installRuntimeShutdown(runtime);
    return;
  }

  if (command === "serve") {
    if (args.watch) {
      try {
        const watcher = await startConfiguredWatcher(root, config, args, console.error);
        installWatchShutdown(watcher);
      } catch (error) {
        if (error.code !== "WATCH_ALREADY_RUNNING") throw error;
        console.error(`local-wiki watch: reusing existing watcher pid ${error.owner?.pid}`);
      }
    }
    const serverOptions = directServerOptions(root, config);
    const runtimeMode = args.daemon
      ? (args.noFallback ? "required" : "auto")
      : config.runtime.mode;
    const handlers = runtimeMode === "off" ? undefined : createRuntimeBridgeHandlers({
      ...serverOptions,
      mode: runtimeMode,
      timeoutMs: config.runtime.timeoutMs,
    });
    startStdioServer({ ...serverOptions, handlers });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(argv) {
  const args = {
    clients: [],
    include: [],
    exclude: [],
    projects: [],
    positionals: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root") {
      args.root = argv[++index];
    } else if (value === "--client") {
      args.clients.push(argv[++index]);
    } else if (value === "--codex-config") {
      args.codexConfig = argv[++index];
    } else if (value === "--cursor-config") {
      args.cursorConfig = argv[++index];
    } else if (value === "--include") {
      args.include.push(argv[++index]);
    } else if (value === "--exclude") {
      args.exclude.push(argv[++index]);
    } else if (value === "--index-dir") {
      args.indexDir = argv[++index];
    } else if (value === "--top-k") {
      args.topK = positiveInteger(argv[++index], "--top-k");
    } else if (value === "--project") {
      args.projects.push(argv[++index]);
    } else if (value === "--global") {
      args.scope = "global";
    } else if (value === "--no-common") {
      args.includeCommon = false;
    } else if (value === "--max-chars") {
      args.maxChars = positiveInteger(argv[++index], "--max-chars");
    } else if (value === "--context-chars") {
      args.contextChars = nonNegativeInteger(argv[++index], "--context-chars");
    } else if (value === "--max-output-tokens") {
      args.maxOutputTokens = positiveInteger(argv[++index], "--max-output-tokens");
    } else if (value === "--days") {
      args.days = positiveInteger(argv[++index], "--days");
    } else if (value === "--max-tasks") {
      args.maxTasks = positiveInteger(argv[++index], "--max-tasks");
    } else if (value === "--max-chunks-per-path") {
      args.maxChunksPerPath = positiveInteger(argv[++index], "--max-chunks-per-path");
    } else if (value === "--query") {
      args.query = argv[++index];
    } else if (value === "--fixture") {
      args.fixture = argv[++index];
    } else if (value === "--iterations") {
      args.iterations = positiveInteger(argv[++index], "--iterations");
    } else if (value === "--interval-ms") {
      args.intervalMs = positiveInteger(argv[++index], "--interval-ms");
    } else if (value === "--port") {
      args.port = nonNegativeInteger(argv[++index], "--port");
    } else if (value === "--min-top1") {
      args.minTop1 = rateValue(argv[++index], "--min-top1");
    } else if (value === "--min-top3") {
      args.minTop3 = rateValue(argv[++index], "--min-top3");
    } else if (value === "--min-top5") {
      args.minTop5 = rateValue(argv[++index], "--min-top5");
    } else if (value === "--max-duplicate-rate") {
      args.maxDuplicateRate = rateValue(argv[++index], "--max-duplicate-rate");
    } else if (value === "--template") {
      args.template = argv[++index];
    } else if (value === "--variant-set") {
      args.variantSet = argv[++index];
    } else if (value === "--no-diversity") {
      args.diversity = false;
    } else if (value === "--diversity") {
      args.diversity = true;
    } else if (value === "--no-topic-diversity") {
      args.topicDiversity = false;
    } else if (value === "--topic-diversity") {
      args.topicDiversity = true;
    } else if (value === "--rerank") {
      args.rerank = true;
    } else if (value === "--no-rerank") {
      args.rerank = false;
    } else if (value === "--strict") {
      args.strict = true;
    } else if (value === "--verbose") {
      args.verbose = true;
    } else if (value === "--metrics") {
      args.metrics = true;
    } else if (value === "--json") {
      args.json = true;
    } else if (value === "--summary") {
      args.summary = true;
    } else if (value === "--watch") {
      args.watch = true;
    } else if (value === "--daemon") {
      args.daemon = true;
    } else if (value === "--no-fallback") {
      args.noFallback = true;
    } else if (value === "--no-start") {
      args.noStart = true;
    } else if (value === "--initialize") {
      args.initialize = true;
    } else if (value === "--refresh") {
      args.refresh = true;
    } else if (value === "--install-runtime") {
      args.installRuntime = true;
    } else if (value === "--apply") {
      args.apply = true;
    } else if (value === "--help" || value === "-h") {
      args.help = true;
    } else if (value === "--force") {
      args.force = true;
    } else if (value === "--fix") {
      args.fix = true;
    } else if (value.startsWith("-")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      args.positionals.push(value);
    }
  }

  return args;
}

function requireValue(value, message) {
  if (!value) throw new Error(message);
}

function cliProjectScope(args, projectGroups, scopeRoots) {
  return resolveProjectScope({
    scope: args.scope,
    projects: args.projects,
    includeCommon: args.includeCommon,
    projectGroups,
    scopeRoots,
  });
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} requires a positive integer.`);
  }
  return number;
}

function rateValue(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${name} requires a number between 0 and 1.`);
  }
  return number;
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function startConfiguredWatcher(root, config, args, log) {
  return startExclusiveWatcher(root, config, {
    intervalMs: args.intervalMs ?? config.watch.intervalMs,
    strictEvery: config.watch.strictEvery,
    runImmediately: true,
    onResult: (report) => {
      if (report.updated) log(`local-wiki watch: ${report.mode}, ${report.chunk_count} chunks`);
    },
    onError: (error) => console.error(`local-wiki watch: ${error.message}`),
  });
}

function installWatchShutdown(watcher) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      Promise.resolve(watcher.close()).finally(() => process.exit(0));
    });
  }
}

function installRuntimeShutdown(runtime) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      Promise.resolve(runtime.close()).finally(() => process.exit(0));
    });
  }
}

function directServerOptions(root, config) {
  return {
    root,
    indexDir: config.indexDir,
    includes: config.includes,
    exclude: config.exclude,
    weights: config.searchWeights,
    queryAliases: config.queryAliases,
    projectGroups: config.projectGroups,
    scopeRoots: config.scopeRoots,
    reranker: config.reranker,
    reloadCheckTtlMs: config.mcpCache.reloadCheckTtlMs,
    freshnessTtlMs: config.mcpCache.freshnessTtlMs,
    idleUnloadMs: config.mcpCache.idleUnloadMs,
  };
}

function printHelp() {
  console.log(`local-wiki-mcp

Commands:
  version [--json]                         Show product and runtime versions
  init   [--root DIR] [--template NAME]   Create an agent-memory or minimal skeleton
  bind   [--root DIR] --client NAME        Preview or apply Codex/Cursor bindings
         [--initialize] [--refresh] [--daemon] [--install-runtime] [--apply]
  index  [--root DIR] [--include PATH]    Build the local JSON index
  search <query> [--root DIR] [--rerank]  Deterministic field-aware hybrid search
         [--context-chars N] [--max-output-tokens N]
         [--project NAME ...] [--no-common] [--global]
  explain <query> [--root DIR]            Explain query analysis and result scores
  grep   <pattern> [--root DIR]           Exact substring search
         [--project NAME ...] [--no-common] [--global]
  read   <path-or-id> [--root DIR]        Read indexed chunks
  status [--root DIR] [--strict]          Show index metadata and freshness
         [--metrics]                      Include index size and density metrics
  sync   [--root DIR] [--include PATH]    Refresh the local JSON index
  context [--root DIR] [--days N]         Print compact startup memory context
          [--max-tasks N] [--max-chars N]
  doctor [--root DIR] [--verbose] [--fix] Diagnose and repair derived index state
  repair [--root DIR] [--force]           Rebuild a missing, corrupt, or stale index
  config codex|cursor [--root DIR]        Print MCP configuration snippets
  config validate [--root DIR]            Validate .local-wiki.json and source paths
  audit  [--root DIR]                     Check mojibake and legacy qmd rules
  bench  [--root DIR] [--query TEXT]      Measure local index load/search latency
  eval   [--root DIR] --fixture FILE      Score search results against fixtures
         [--variant-set NAME] [--summary] Select fixture variants and omit case details
  smoke  [--root DIR]                     Verify index and MCP search readiness
  watch  [--root DIR] [--interval-ms N]   Auto-sync changed knowledge files
  daemon [--root DIR] [--watch]           Start shared loopback search runtime
  runtime status|stop [--root DIR]        Inspect or stop the shared runtime
  runtime install|uninstall [--root DIR]  Manage Windows Startup or macOS LaunchAgent
  serve  [--root DIR] [--daemon]          Start MCP stdio server with optional bridge

Defaults:
  --include wiki --include MEMORY.md
  --index-dir .local-wiki-index
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
