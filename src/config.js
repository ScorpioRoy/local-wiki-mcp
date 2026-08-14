import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeProjectGroups, normalizeScopeRoots } from "./project-scope.js";

export const CONFIG_FILE_NAME = ".local-wiki.json";

export const DEFAULT_CONFIG = {
  includes: ["wiki", "MEMORY.md"],
  scopeRoots: ["."],
  indexDir: ".local-wiki-index",
  exclude: [],
  maxChunkChars: 2400,
  searchWeights: {
    exact: 3,
    title: 1.5,
    path: 1,
    identifier: 1.25,
    source: 0.75,
  },
  queryAliases: {},
  projectGroups: {},
  mcpCache: {
    reloadCheckTtlMs: 1000,
    freshnessTtlMs: 5000,
    idleUnloadMs: 300000,
  },
  reranker: {
    provider: "none",
    baseUrl: "http://127.0.0.1:11434",
    model: "nomic-embed-text",
    timeoutMs: 5000,
    candidateLimit: 20,
    semanticWeight: 0.35,
  },
  runtime: {
    mode: "off",
    timeoutMs: 1500,
    requestLimitBytes: 1048576,
  },
  watch: {
    intervalMs: 2000,
    strictEvery: 30,
  },
};

export async function loadConfig(root, options = {}) {
  const file = path.resolve(root, options.configFile ?? CONFIG_FILE_NAME);
  let parsed = {};
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return normalizeConfig(parsed);
}

export async function validateConfigFile(root, options = {}) {
  const rootPath = path.resolve(root);
  const file = path.resolve(rootPath, options.configFile ?? CONFIG_FILE_NAME);
  let parsed;

  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        ok: true,
        status: "defaults",
        exists: false,
        file,
        errors: [],
        warnings: [issue("$", `Config file not found; defaults will be used (${CONFIG_FILE_NAME}).`)],
        config: normalizeConfig(),
      };
    }
    return {
      ok: false,
      status: "error",
      exists: true,
      file,
      errors: [issue("$", `Config file is not valid JSON: ${error.message}`)],
      warnings: [],
      config: null,
    };
  }

  const report = validateConfigValue(parsed, { root: rootPath });
  await checkIncludePaths(rootPath, report.config.includes, report.errors, report.warnings);
  return {
    ...report,
    ok: report.errors.length === 0,
    status: report.errors.length ? "error" : report.warnings.length ? "warning" : "ok",
    exists: true,
    file,
  };
}

export function validateConfigValue(value, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(value)) {
    return {
      ok: false,
      errors: [issue("$", "Config must be a JSON object.")],
      warnings,
      config: normalizeConfig(),
    };
  }

  checkUnknownKeys(value, new Set([
    "includes",
    "scopeRoots",
    "indexDir",
    "exclude",
    "maxChunkChars",
    "searchWeights",
    "queryAliases",
    "projectGroups",
    "mcpCache",
    "reranker",
    "runtime",
    "watch",
  ]), "$", warnings);
  checkStringArray(value, "includes", errors);
  checkScopeRoots(value.scopeRoots, errors, options.root);
  checkStringArray(value, "exclude", errors);
  checkNonEmptyString(value, "indexDir", errors);
  checkNumber(value, "maxChunkChars", errors, { integer: true, minimum: 1 });
  checkNumberObject(value, "searchWeights", ["exact", "title", "path", "identifier", "source"], errors, warnings, {
    minimum: 0,
  });
  checkQueryAliases(value.queryAliases, errors);
  checkProjectGroups(value.projectGroups, errors);
  checkNumberObject(
    value,
    "mcpCache",
    ["reloadCheckTtlMs", "freshnessTtlMs", "idleUnloadMs"],
    errors,
    warnings,
    { integer: true, minimum: 0 },
  );
  checkReranker(value.reranker, errors, warnings);
  checkRuntime(value.runtime, errors, warnings);
  checkNumberObject(value, "watch", ["intervalMs", "strictEvery"], errors, warnings, {
    integer: true,
    minimum: 1,
  });

  const config = normalizeConfig(value);
  if (Array.isArray(value.includes) && value.includes.length === 0) {
    warnings.push(issue("$.includes", "No source paths are configured; the index will be empty."));
  }
  if (options.root && !isInsideRoot(path.resolve(options.root), path.resolve(options.root, config.indexDir))) {
    errors.push(issue("$.indexDir", "indexDir must resolve inside the knowledge-base root."));
  }

  return { ok: errors.length === 0, errors, warnings, config };
}

export function normalizeConfig(value = {}) {
  return {
    includes: normalizeStringArray(value.includes, DEFAULT_CONFIG.includes),
    scopeRoots: normalizeScopeRoots(value.scopeRoots),
    indexDir: typeof value.indexDir === "string" && value.indexDir ? value.indexDir : DEFAULT_CONFIG.indexDir,
    exclude: normalizeStringArray(value.exclude, DEFAULT_CONFIG.exclude),
    maxChunkChars: positiveNumber(value.maxChunkChars, DEFAULT_CONFIG.maxChunkChars),
    searchWeights: {
      exact: nonNegativeNumber(value.searchWeights?.exact, DEFAULT_CONFIG.searchWeights.exact),
      title: nonNegativeNumber(value.searchWeights?.title, DEFAULT_CONFIG.searchWeights.title),
      path: nonNegativeNumber(value.searchWeights?.path, DEFAULT_CONFIG.searchWeights.path),
      identifier: nonNegativeNumber(value.searchWeights?.identifier, DEFAULT_CONFIG.searchWeights.identifier),
      source: nonNegativeNumber(value.searchWeights?.source, DEFAULT_CONFIG.searchWeights.source),
    },
    queryAliases: normalizeQueryAliases(value.queryAliases),
    projectGroups: safeNormalizeProjectGroups(value.projectGroups),
    mcpCache: {
      reloadCheckTtlMs: nonNegativeNumber(
        value.mcpCache?.reloadCheckTtlMs,
        DEFAULT_CONFIG.mcpCache.reloadCheckTtlMs,
      ),
      freshnessTtlMs: nonNegativeNumber(
        value.mcpCache?.freshnessTtlMs,
        DEFAULT_CONFIG.mcpCache.freshnessTtlMs,
      ),
      idleUnloadMs: nonNegativeNumber(
        value.mcpCache?.idleUnloadMs,
        DEFAULT_CONFIG.mcpCache.idleUnloadMs,
      ),
    },
    reranker: {
      provider: new Set(["none", "ollama"]).has(value.reranker?.provider)
        ? value.reranker.provider
        : DEFAULT_CONFIG.reranker.provider,
      baseUrl: nonEmptyString(value.reranker?.baseUrl, DEFAULT_CONFIG.reranker.baseUrl),
      model: nonEmptyString(value.reranker?.model, DEFAULT_CONFIG.reranker.model),
      timeoutMs: positiveInteger(value.reranker?.timeoutMs, DEFAULT_CONFIG.reranker.timeoutMs),
      candidateLimit: positiveInteger(value.reranker?.candidateLimit, DEFAULT_CONFIG.reranker.candidateLimit),
      semanticWeight: boundedNumber(
        value.reranker?.semanticWeight,
        DEFAULT_CONFIG.reranker.semanticWeight,
        0,
        1,
      ),
    },
    runtime: {
      mode: new Set(["off", "auto", "required"]).has(value.runtime?.mode)
        ? value.runtime.mode
        : DEFAULT_CONFIG.runtime.mode,
      timeoutMs: positiveInteger(value.runtime?.timeoutMs, DEFAULT_CONFIG.runtime.timeoutMs),
      requestLimitBytes: positiveInteger(
        value.runtime?.requestLimitBytes,
        DEFAULT_CONFIG.runtime.requestLimitBytes,
      ),
    },
    watch: {
      intervalMs: positiveNumber(value.watch?.intervalMs, DEFAULT_CONFIG.watch.intervalMs),
      strictEvery: positiveInteger(value.watch?.strictEvery, DEFAULT_CONFIG.watch.strictEvery),
    },
  };
}

export function mergeCliOptions(config, args = {}) {
  return {
    ...config,
    includes: args.include?.length ? args.include : config.includes,
    exclude: args.exclude?.length ? args.exclude : config.exclude,
    indexDir: args.indexDir ?? config.indexDir,
    maxChunkChars: args.maxChars ?? config.maxChunkChars,
  };
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
}

async function checkIncludePaths(rootPath, includes, errors, warnings) {
  for (let index = 0; index < includes.length; index += 1) {
    const include = includes[index];
    const target = path.resolve(rootPath, include);
    if (!isInsideRoot(rootPath, target)) {
      errors.push(issue(`$.includes[${index}]`, "Include path must resolve inside the knowledge-base root."));
      continue;
    }
    try {
      await access(target);
    } catch {
      warnings.push(issue(`$.includes[${index}]`, `Configured source path does not exist: ${include}`));
    }
  }
}

function checkUnknownKeys(value, allowed, prefix, warnings) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) warnings.push(issue(`${prefix}.${key}`, "Unknown config field; it will be ignored."));
  }
}

function checkStringArray(value, key, errors) {
  if (!(key in value)) return;
  if (!Array.isArray(value[key])) {
    errors.push(issue(`$.${key}`, "Expected an array of non-empty strings."));
    return;
  }
  value[key].forEach((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      errors.push(issue(`$.${key}[${index}]`, "Expected a non-empty string."));
    }
  });
}

function checkScopeRoots(value, errors, root) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(issue("$.scopeRoots", "Expected a non-empty array of relative paths."));
    return;
  }
  const rootPath = root ? path.resolve(root) : null;
  value.forEach((entry, index) => {
    const issuePath = `$.scopeRoots[${index}]`;
    if (typeof entry !== "string" || !entry.trim()) {
      errors.push(issue(issuePath, "Expected a non-empty relative path."));
      return;
    }
    const candidate = entry.trim();
    const segments = candidate.replaceAll("\\", "/").split("/");
    if (path.isAbsolute(candidate) || path.win32.isAbsolute(candidate)
      || path.posix.isAbsolute(candidate) || segments.includes("..")) {
      errors.push(issue(issuePath, "scopeRoots entries must be relative and stay inside the knowledge-base root."));
      return;
    }
    if (rootPath && !isInsideRoot(rootPath, path.resolve(rootPath, candidate))) {
      errors.push(issue(issuePath, "scopeRoots entries must resolve inside the knowledge-base root."));
    }
  });
}

function checkNonEmptyString(value, key, errors, prefix = "$") {
  if (!(key in value)) return;
  if (typeof value[key] !== "string" || !value[key].trim()) {
    errors.push(issue(`${prefix}.${key}`, "Expected a non-empty string."));
  }
}

function checkNumberObject(value, key, fields, errors, warnings, options) {
  if (!(key in value)) return;
  if (!isPlainObject(value[key])) {
    errors.push(issue(`$.${key}`, "Expected a JSON object."));
    return;
  }
  checkUnknownKeys(value[key], new Set(fields), `$.${key}`, warnings);
  for (const field of fields) {
    checkNumber(value[key], field, errors, options, `$.${key}`);
  }
}

function checkNumber(value, key, errors, options, prefix = "$") {
  if (!(key in value)) return;
  const number = value[key];
  if (typeof number !== "number" || !Number.isFinite(number)) {
    errors.push(issue(`${prefix}.${key}`, "Expected a finite number."));
    return;
  }
  if (options.integer && !Number.isInteger(number)) {
    errors.push(issue(`${prefix}.${key}`, "Expected an integer."));
  }
  if (number < options.minimum) {
    errors.push(issue(`${prefix}.${key}`, `Expected a number greater than or equal to ${options.minimum}.`));
  }
  if (Number.isFinite(options.maximum) && number > options.maximum) {
    errors.push(issue(`${prefix}.${key}`, `Expected a number less than or equal to ${options.maximum}.`));
  }
}

function checkReranker(value, errors, warnings) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(issue("$.reranker", "Expected a JSON object."));
    return;
  }
  checkUnknownKeys(value, new Set([
    "provider",
    "baseUrl",
    "model",
    "timeoutMs",
    "candidateLimit",
    "semanticWeight",
  ]), "$.reranker", warnings);
  if ("provider" in value && !new Set(["none", "ollama"]).has(value.provider)) {
    errors.push(issue("$.reranker.provider", "Expected one of: none, ollama."));
  }
  checkNonEmptyString(value, "baseUrl", errors, "$.reranker");
  checkNonEmptyString(value, "model", errors, "$.reranker");
  checkNumber(value, "timeoutMs", errors, { integer: true, minimum: 1 }, "$.reranker");
  checkNumber(value, "candidateLimit", errors, { integer: true, minimum: 1 }, "$.reranker");
  checkNumber(value, "semanticWeight", errors, { minimum: 0, maximum: 1 }, "$.reranker");
  if (typeof value.baseUrl !== "string" || !value.baseUrl) return;
  try {
    const url = new URL(value.baseUrl);
    if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(url.hostname.toLowerCase())) {
      errors.push(issue("$.reranker.baseUrl", "Only loopback hosts are allowed."));
    }
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      errors.push(issue("$.reranker.baseUrl", "Expected an http or https URL."));
    }
  } catch {
    errors.push(issue("$.reranker.baseUrl", "Expected a valid URL."));
  }
}

function checkRuntime(value, errors, warnings) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(issue("$.runtime", "Expected a JSON object."));
    return;
  }
  checkUnknownKeys(value, new Set(["mode", "timeoutMs", "requestLimitBytes"]), "$.runtime", warnings);
  if ("mode" in value && !new Set(["off", "auto", "required"]).has(value.mode)) {
    errors.push(issue("$.runtime.mode", "Expected one of: off, auto, required."));
  }
  checkNumber(value, "timeoutMs", errors, { integer: true, minimum: 1 }, "$.runtime");
  checkNumber(value, "requestLimitBytes", errors, { integer: true, minimum: 1024 }, "$.runtime");
}

function checkQueryAliases(value, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(issue("$.queryAliases", "Expected an object of string arrays."));
    return;
  }
  for (const [key, aliases] of Object.entries(value)) {
    if (!key.trim() || !Array.isArray(aliases) || aliases.some((alias) => typeof alias !== "string" || !alias.trim())) {
      errors.push(issue(`$.queryAliases.${key}`, "Expected a non-empty string array."));
    }
  }
}

function checkProjectGroups(value, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push(issue("$.projectGroups", "Expected an object of project member arrays."));
    return;
  }
  for (const [group, members] of Object.entries(value)) {
    if (!group.trim() || !Array.isArray(members) || members.length === 0
      || members.some((member) => typeof member !== "string" || !member.trim())) {
      errors.push(issue(`$.projectGroups.${group}`, "Expected a non-empty project member array."));
    }
  }
  try {
    normalizeProjectGroups(value);
  } catch (error) {
    errors.push(issue("$.projectGroups", error.message));
  }
}

function normalizeQueryAliases(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, aliases]) => key.trim() && Array.isArray(aliases))
    .map(([key, aliases]) => [key.trim(), aliases.filter((alias) => typeof alias === "string" && alias.trim()).map((alias) => alias.trim())]));
}

function safeNormalizeProjectGroups(value) {
  try {
    return normalizeProjectGroups(value);
  } catch {
    return {};
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isInsideRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function issue(pathName, message) {
  return { path: pathName, message };
}

function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}
