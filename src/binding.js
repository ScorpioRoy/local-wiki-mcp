import { access, chmod, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { DEFAULT_CONFIG, mergeCliOptions, validateConfigFile } from "./config.js";
import { syncKnowledgeBase } from "./operations.js";
import { generateConfig, initKnowledgeBase, runSmoke } from "./product.js";
import { runRuntimeInstaller } from "./runtime.js";

const CODEX_BLOCK_START = "# >>> local-wiki-mcp managed: local_wiki";
const CODEX_BLOCK_END = "# <<< local-wiki-mcp managed: local_wiki";

export async function bindKnowledgeBase(root, options = {}) {
  const rootPath = path.resolve(root);
  const clients = normalizeClients(options.clients);
  if (options.installRuntime && !options.daemon) {
    throw new Error("--install-runtime requires --daemon.");
  }

  const targets = clients.map((client) => ({
    client,
    file: resolveClientConfigPath(client, options),
    snippet: generateConfig(client, {
      root: rootPath,
      daemon: options.daemon,
      command: options.command ?? process.execPath,
    }).text,
  }));
  const validation = await previewValidation(rootPath, options.initialize);
  if (!options.apply) {
    const bindings = await Promise.all(targets.map(previewBinding));
    return {
      ok: validation.ok && bindings.every((binding) => binding.ok),
      mode: "preview",
      root: rootPath,
      actions: requestedActions(options, clients),
      validation,
      bindings,
    };
  }
  if (!validation.ok) {
    throw new Error(`Knowledge-base configuration is invalid: ${formatIssues(validation.errors)}`);
  }

  const prepared = [];
  for (const target of targets) prepared.push(await prepareBinding(target));

  const initialized = options.initialize
    ? await initKnowledgeBase(rootPath, { template: options.template })
    : null;
  const configReport = await validateConfigFile(rootPath);
  if (!configReport.ok) {
    throw new Error(`Knowledge-base configuration is invalid: ${formatIssues(configReport.errors)}`);
  }
  const config = mergeCliOptions(configReport.config ?? DEFAULT_CONFIG, {});
  let refreshed = null;
  let smoke = null;
  if (options.refresh) {
    refreshed = await syncKnowledgeBase(rootPath, config);
    smoke = await runSmoke(rootPath, {
      includes: config.includes,
      indexDir: config.indexDir,
      exclude: config.exclude,
    });
    if (!smoke.ok) throw new Error("Knowledge-base smoke verification failed after refresh.");
  }

  const bindings = [];
  for (const item of prepared) {
    if (!item.changed) {
      bindings.push({ client: item.client, file: item.file, changed: false, backup: null });
      continue;
    }
    const result = await writeConfigAtomically(item.file, item.content, options);
    bindings.push({ client: item.client, file: item.file, changed: true, backup: result.backup });
  }

  const runtime = options.installRuntime
    ? runRuntimeInstaller(rootPath, { noStart: options.noStart, platform: options.platform })
    : null;
  return {
    ok: true,
    mode: "applied",
    root: rootPath,
    initialized,
    refreshed,
    smoke: smoke ? { ok: smoke.ok, chunk_count: smoke.checks.index.chunk_count } : null,
    bindings,
    runtime,
  };
}

export function mergeCodexConfig(current, snippet) {
  const source = String(current ?? "");
  const startCount = countOccurrences(source, CODEX_BLOCK_START);
  const endCount = countOccurrences(source, CODEX_BLOCK_END);
  if (startCount !== endCount || startCount > 1) {
    throw new Error("Codex local-wiki managed block markers are incomplete or duplicated.");
  }
  const block = `${CODEX_BLOCK_START}\n${snippet.trim()}\n${CODEX_BLOCK_END}`;
  if (startCount === 1) {
    const start = source.indexOf(CODEX_BLOCK_START);
    const endMarker = source.indexOf(CODEX_BLOCK_END, start);
    if (endMarker < start) throw new Error("Codex local-wiki managed block markers are out of order.");
    const end = endMarker + CODEX_BLOCK_END.length;
    const outside = `${source.slice(0, start)}${source.slice(end)}`;
    if (/^\s*\[mcp_servers\.local_wiki\]\s*$/m.test(outside)) {
      throw new Error("Codex contains another unmanaged mcp_servers.local_wiki section.");
    }
    return `${source.slice(0, start)}${block}${source.slice(end)}`;
  }
  if (/^\s*\[mcp_servers\.local_wiki\]\s*$/m.test(source)) {
    throw new Error("Codex already contains an unmanaged mcp_servers.local_wiki section.");
  }
  const prefix = source.trimEnd();
  return `${prefix}${prefix ? "\n\n" : ""}${block}\n`;
}

export function mergeCursorConfig(current, snippet) {
  const source = String(current ?? "").trim();
  let config;
  try {
    config = source ? JSON.parse(source) : {};
  } catch {
    throw new Error("Cursor MCP configuration is not valid JSON.");
  }
  if (!isPlainObject(config)) throw new Error("Cursor MCP configuration must be a JSON object.");
  if (config.mcpServers !== undefined && !isPlainObject(config.mcpServers)) {
    throw new Error("Cursor mcpServers must be a JSON object.");
  }
  const generated = JSON.parse(snippet).mcpServers["local-wiki"];
  const existing = config.mcpServers?.["local-wiki"];
  if (existing !== undefined && !isDeepStrictEqual(existing, generated)) {
    throw new Error("Cursor already contains a different local-wiki MCP entry.");
  }
  return `${JSON.stringify({
    ...config,
    mcpServers: {
      ...(config.mcpServers ?? {}),
      "local-wiki": generated,
    },
  }, null, 2)}\n`;
}

async function previewValidation(root, initialize) {
  if (initialize && !await exists(path.join(root, ".local-wiki.json"))) {
    return { ok: true, pending_initialization: true, errors: [] };
  }
  const report = await validateConfigFile(root);
  if (report.ok) return { ok: true, errors: [] };
  return { ok: false, errors: report.errors ?? [] };
}

async function previewBinding(target) {
  try {
    const prepared = await prepareBinding(target);
    return {
      client: target.client,
      file: target.file,
      snippet: target.snippet,
      ok: true,
      changed: prepared.changed,
      error: null,
    };
  } catch (error) {
    return {
      client: target.client,
      file: target.file,
      snippet: target.snippet,
      ok: false,
      changed: null,
      error: error.message,
    };
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function prepareBinding(target) {
  const current = await readOptional(target.file);
  const content = target.client === "codex"
    ? mergeCodexConfig(current, target.snippet)
    : mergeCursorConfig(current, target.snippet);
  return {
    client: target.client,
    file: target.file,
    content,
    changed: current !== content,
  };
}

async function writeConfigAtomically(file, content, options = {}) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  const current = await readOptional(file);
  const suffix = timestamp(options.now ?? new Date());
  const backup = current === null ? null : `${file}.bak-${suffix}-${process.pid}`;
  if (backup) await copyFile(file, backup);
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
    await chmod(file, 0o600).catch(() => {});
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return { backup };
}

function resolveClientConfigPath(client, options) {
  if (client === "codex" && options.codexConfig) return path.resolve(options.codexConfig);
  if (client === "cursor" && options.cursorConfig) return path.resolve(options.cursorConfig);
  const home = path.resolve(options.home ?? homedir());
  return client === "codex"
    ? path.join(home, ".codex", "config.toml")
    : path.join(home, ".cursor", "mcp.json");
}

function normalizeClients(values) {
  const clients = [...new Set((values ?? []).map((value) => String(value).toLowerCase()))];
  if (clients.length === 0) throw new Error("bind requires at least one --client codex|cursor.");
  for (const client of clients) {
    if (!new Set(["codex", "cursor"]).has(client)) throw new Error(`Unknown bind client: ${client}`);
  }
  return clients;
}

function requestedActions(options, clients) {
  return {
    initialize: options.initialize === true,
    refresh: options.refresh === true,
    apply_client_config: clients.length > 0,
    daemon: options.daemon === true,
    install_runtime: options.installRuntime === true,
    writes_in_preview: false,
  };
}

function formatIssues(issues = []) {
  return issues.map((issue) => issue.message ?? String(issue)).join("; ");
}

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function timestamp(value) {
  return new Date(value).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}
