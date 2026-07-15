import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const CONFIG_FILE_NAME = ".local-wiki.json";

export const DEFAULT_CONFIG = {
  includes: ["wiki", "MEMORY.md"],
  indexDir: ".local-wiki-index",
  exclude: [],
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
    "indexDir",
    "exclude",
    "maxChunkChars",
    "searchWeights",
    "mcpCache",
    "watch",
  ]), "$", warnings);
  checkStringArray(value, "includes", errors);
  checkStringArray(value, "exclude", errors);
  checkNonEmptyString(value, "indexDir", errors);
  checkNumber(value, "maxChunkChars", errors, { integer: true, minimum: 1 });
  checkNumberObject(value, "searchWeights", ["exact", "title", "path"], errors, warnings, {
    minimum: 0,
  });
  checkNumberObject(
    value,
    "mcpCache",
    ["reloadCheckTtlMs", "freshnessTtlMs"],
    errors,
    warnings,
    { integer: true, minimum: 0 },
  );
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
    indexDir: typeof value.indexDir === "string" && value.indexDir ? value.indexDir : DEFAULT_CONFIG.indexDir,
    exclude: normalizeStringArray(value.exclude, DEFAULT_CONFIG.exclude),
    maxChunkChars: positiveNumber(value.maxChunkChars, DEFAULT_CONFIG.maxChunkChars),
    searchWeights: {
      exact: nonNegativeNumber(value.searchWeights?.exact, DEFAULT_CONFIG.searchWeights.exact),
      title: nonNegativeNumber(value.searchWeights?.title, DEFAULT_CONFIG.searchWeights.title),
      path: nonNegativeNumber(value.searchWeights?.path, DEFAULT_CONFIG.searchWeights.path),
    },
    mcpCache: {
      reloadCheckTtlMs: nonNegativeNumber(
        value.mcpCache?.reloadCheckTtlMs,
        DEFAULT_CONFIG.mcpCache.reloadCheckTtlMs,
      ),
      freshnessTtlMs: nonNegativeNumber(
        value.mcpCache?.freshnessTtlMs,
        DEFAULT_CONFIG.mcpCache.freshnessTtlMs,
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

function checkNonEmptyString(value, key, errors) {
  if (!(key in value)) return;
  if (typeof value[key] !== "string" || !value[key].trim()) {
    errors.push(issue(`$.${key}`, "Expected a non-empty string."));
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
