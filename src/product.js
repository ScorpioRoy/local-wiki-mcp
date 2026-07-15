import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfigFile } from "./config.js";
import {
  CURRENT_INDEX_VERSION,
  DEFAULT_INDEX_DIR,
  DEFAULT_INDEX_FILE,
  buildIndexFromFiles,
  inspectIndexFreshness,
  loadIndex,
  resolveIndexDirectory,
  saveIndex,
  withIndexLock,
} from "./indexer.js";
import { listTools } from "./mcp.js";
import { searchIndex } from "./search.js";
import { PRODUCT_VERSION } from "./version.js";

const DEFAULT_INCLUDES = ["wiki", "MEMORY.md"];

export async function initKnowledgeBase(root, options = {}) {
  const rootPath = path.resolve(root);
  const template = options.template ?? "agent-memory";
  if (!new Set(["minimal", "agent-memory"]).has(template)) {
    throw new Error(`Unknown knowledge-base template: ${template}`);
  }
  const baseEntries = [
    [".local-wiki.json", `${JSON.stringify({
      includes: ["wiki", "MEMORY.md"],
      exclude: [],
      indexDir: ".local-wiki-index",
      maxChunkChars: 2400,
      searchWeights: {
        exact: 3,
        title: 1.5,
        path: 1,
      },
      mcpCache: {
        reloadCheckTtlMs: 1000,
        freshnessTtlMs: 5000,
      },
      watch: {
        intervalMs: 2000,
        strictEvery: 30,
      },
    }, null, 2)}\n`],
    ["MEMORY.md", "# Local Wiki Memory\n\nUse this file as the short startup summary for this knowledge base.\n"],
    ["wiki/index.md", "# Wiki Index\n\n| Page | Summary | Updated |\n|------|---------|---------|\n"],
    ["wiki/log.md", "# Wiki Log\n\nRecord durable wiki updates here.\n"],
  ];
  const agentMemoryEntries = [
    ["README.md", "# Local Wiki Knowledge Base\n\nThis directory stores Markdown knowledge for local-wiki-mcp.\n"],
    ["SCHEMA.md", "# Maintenance Schema\n\nKeep durable knowledge in wiki/ and recent work notes in daily/.\n"],
    ["daily/README.md", "# Daily Notes\n\nUse daily notes for recent work context.\n"],
    ["raw/README.md", "# Raw Sources\n\nStore sanitized source material here before turning it into wiki pages.\n"],
  ];
  const entries = template === "minimal" ? baseEntries : [...baseEntries, ...agentMemoryEntries];

  const created = [];
  const skipped = [];

  await mkdir(rootPath, { recursive: true });
  for (const [relativePath, content] of entries) {
    const absolutePath = path.join(rootPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    if (await exists(absolutePath)) {
      skipped.push(toPosix(relativePath));
      continue;
    }
    await writeFile(absolutePath, content, "utf8");
    created.push(toPosix(relativePath));
  }

  return { root: rootPath, template, created, skipped };
}

export function generateConfig(kind, options = {}) {
  const root = toForwardSlashes(path.resolve(options.root ?? process.cwd()));
  const command = options.command ?? "node";
  const cliPath = toForwardSlashes(options.cliPath ?? defaultCliPath());
  const args = [cliPath, "serve", "--root", root, ...(options.watch ? ["--watch"] : [])];

  if (kind === "codex") {
    return {
      kind,
      text: [
        "[mcp_servers.local_wiki]",
        `command = ${tomlString(command)}`,
        `args = [${args.map(tomlString).join(", ")}]`,
        "startup_timeout_sec = 10",
        "tool_timeout_sec = 30",
        "enabled = true",
        "enabled_tools = ['search_wiki', 'grep_wiki', 'read_wiki', 'status_wiki']",
        "",
      ].join("\n"),
    };
  }

  if (kind === "cursor") {
    return {
      kind,
      text: `${JSON.stringify({
        mcpServers: {
          "local-wiki": {
            command,
            args,
          },
        },
      }, null, 2)}\n`,
    };
  }

  throw new Error(`Unknown config kind: ${kind}`);
}

export function getVersionInfo() {
  return {
    name: "local-wiki-mcp",
    version: PRODUCT_VERSION,
    index_version: CURRENT_INDEX_VERSION,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  };
}

export async function runDoctor(root, options = {}) {
  const rootPath = path.resolve(root);
  const configReport = options.configReport ?? await validateConfigFile(rootPath);
  const effectiveConfig = configReport.config ?? {};
  const includes = options.includes ?? effectiveConfig.includes ?? DEFAULT_INCLUDES;
  const indexDir = options.indexDir ?? effectiveConfig.indexDir;
  const exclude = options.exclude ?? effectiveConfig.exclude;
  const checks = {
    node: checkNodeVersion(process.versions.node),
    root: await checkRoot(rootPath),
    config: checkConfig(configReport),
    index: await checkIndex(rootPath, includes, {
      ...options,
      indexDir,
      exclude,
      strict: options.verbose === true || options.strict === true,
    }),
    mcp_tools: checkMcpTools(),
  };

  const report = {
    ok: Object.values(checks).every((check) => check.status !== "error"),
    root: rootPath,
    checks,
  };
  if (options.verbose) {
    report.diagnostics = await collectDoctorDiagnostics(rootPath, indexDir, configReport);
  }
  return report;
}

export async function collectIndexMetrics(root, index, indexDir = DEFAULT_INDEX_DIR) {
  const indexFile = path.join(resolveIndexDirectory(root, indexDir), DEFAULT_INDEX_FILE);
  const info = await stat(indexFile);
  const files = index.metadata?.files ?? [];
  const totalSourceBytes = files.reduce((sum, file) => sum + finiteNumber(file.size), 0);
  const totalChunkChars = index.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const totalTokens = index.chunks.reduce((sum, chunk) => (
    sum + finiteNumber(chunk.tokenCount ?? chunk.tokens?.length)
  ), 0);
  return {
    index_file: indexFile,
    index_bytes: info.size,
    source_file_count: files.length,
    source_bytes: totalSourceBytes,
    chunk_count: index.chunkCount,
    chunks_per_file: roundRatio(index.chunkCount, files.length),
    average_chunk_chars: roundRatio(totalChunkChars, index.chunkCount),
    average_token_count: roundRatio(totalTokens, index.chunkCount),
    vocabulary_terms: Object.keys(index.documentFrequency ?? {}).length,
    bytes_per_chunk: roundRatio(info.size, index.chunkCount),
    modified_at: info.mtime.toISOString(),
  };
}

export async function repairIndex(root, options = {}) {
  const rootPath = path.resolve(root);
  const includes = options.includes ?? DEFAULT_INCLUDES;
  let reason = "requested";

  try {
    const index = await loadIndex(rootPath, options.indexDir);
    const freshness = await inspectIndexFreshness(rootPath, index, includes, { exclude: options.exclude });
    reason = index.version !== CURRENT_INDEX_VERSION ? "legacy" : freshness.stale ? "stale" : "fresh";
    if (index.version === CURRENT_INDEX_VERSION && !freshness.stale && !options.force) {
      return { repaired: false, reason, root: rootPath, chunk_count: index.chunkCount };
    }
  } catch (error) {
    reason = error.name === "SyntaxError" ? "corrupt" : "missing";
  }

  return withIndexLock(rootPath, options.indexDir, async () => {
    const index = await buildIndexFromFiles(rootPath, includes, {
      exclude: options.exclude,
      maxChars: options.maxChunkChars,
    });
    const file = await saveIndex(rootPath, index, options.indexDir);
    return { repaired: true, reason, root: rootPath, file, chunk_count: index.chunkCount };
  });
}

export async function runSmoke(root, options = {}) {
  const doctor = await runDoctor(root, options);
  let search = { status: "error", result_count: 0 };
  try {
    const index = await loadIndex(root, options.indexDir);
    const results = searchIndex(index, options.query ?? "local wiki", { topK: 1 });
    search = {
      status: results.length ? "ok" : "error",
      query: options.query ?? "local wiki",
      result_count: results.length,
      top_path: results[0]?.path,
    };
  } catch (error) {
    search = { status: "error", message: error.message, result_count: 0 };
  }
  return {
    ok: doctor.ok && doctor.checks.index.status === "ok" && search.status === "ok",
    root: path.resolve(root),
    checks: { ...doctor.checks, search },
  };
}

async function checkRoot(rootPath) {
  try {
    await access(rootPath);
    return { status: "ok", path: rootPath };
  } catch {
    return { status: "error", message: "Root path is not accessible.", path: rootPath };
  }
}

async function checkIndex(rootPath, includes, options = {}) {
  try {
    const index = await loadIndex(rootPath, options.indexDir);
    const freshness = await inspectIndexFreshness(rootPath, index, includes, {
      exclude: options.exclude,
      strict: options.strict === true,
    });
    const legacy = index.version !== CURRENT_INDEX_VERSION;
    return {
      status: freshness.stale || legacy ? "warning" : "ok",
      version: index.version,
      current_version: CURRENT_INDEX_VERSION,
      legacy,
      chunk_count: index.chunkCount,
      stale: freshness.stale,
      freshness_mode: freshness.mode,
      added: freshness.added,
      changed: freshness.changed,
      deleted: freshness.deleted,
    };
  } catch (error) {
    return { status: "error", message: `Index is missing or unreadable: ${error.message}` };
  }
}

function checkConfig(report) {
  return {
    status: report.ok ? (report.warnings.length ? "warning" : "ok") : "error",
    file: report.file,
    exists: report.exists,
    errors: report.errors,
    warnings: report.warnings,
  };
}

function checkNodeVersion(version) {
  const major = Number(String(version).split(".")[0]);
  return {
    status: major >= 20 ? "ok" : "error",
    version,
    required: ">=20.0.0",
  };
}

function checkMcpTools() {
  const tools = listTools().map((tool) => tool.name);
  const required = ["search_wiki", "grep_wiki", "read_wiki", "status_wiki"];
  const missing = required.filter((tool) => !tools.includes(tool));
  return {
    status: missing.length ? "error" : "ok",
    tools,
    missing,
  };
}

function defaultCliPath() {
  return fileURLToPath(new URL("./cli.js", import.meta.url));
}

async function collectDoctorDiagnostics(rootPath, indexDir, configReport) {
  const resolvedIndexDir = resolveIndexDirectory(rootPath, indexDir ?? DEFAULT_INDEX_DIR);
  const lockFile = path.join(resolvedIndexDir, "index.lock");
  const lockInfo = await stat(lockFile).catch(() => null);
  let metrics = null;
  let metricsError = null;
  try {
    metrics = await collectIndexMetrics(rootPath, await loadIndex(rootPath, indexDir), indexDir);
  } catch (error) {
    metricsError = error.message;
  }
  return {
    product: getVersionInfo(),
    runtime: {
      executable: process.execPath,
      cwd: process.cwd(),
    },
    config: configReport.config,
    index_dir: resolvedIndexDir,
    index_metrics: metrics,
    index_metrics_error: metricsError,
    lock: lockInfo ? {
      active: true,
      file: lockFile,
      age_ms: Math.max(0, Date.now() - lockInfo.mtimeMs),
    } : {
      active: false,
      file: lockFile,
    },
  };
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function toForwardSlashes(value) {
  return String(value).replace(/\\/g, "/");
}

function tomlString(value) {
  const text = String(value);
  return text.includes("'") ? JSON.stringify(text) : `'${text}'`;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function roundRatio(value, divisor) {
  if (!divisor) return 0;
  return Math.round((value / divisor) * 1000) / 1000;
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}
