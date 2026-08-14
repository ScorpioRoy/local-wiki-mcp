import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { discoverFiles } from "./documents.js";
import { normalizeScopeRoots } from "./project-scope.js";

const SCANNED_EXTENSIONS = new Set([".md", ".mdc", ".json", ".toml", ".ps1"]);
const SKIPPED_DIRS = new Set([
  ".git",
  ".local-wiki-index",
  ".state",
  "daily",
  "node_modules",
  "workstates",
]);

const MOJIBAKE_PATTERN = /�|锛|銆|鈥|鏂|浠|涓|绋|閫|瀹|璁|鐢|鍙|寰|鐩|妯|鍦/;
const HISTORY_PATTERN = /历史|historical|history|来源|source/i;
const LEGACY_QMD_PATTERNS = [
  /user-qmd/i,
  /\bqmd\s*[:：]\s*(?:collection|context|doctor|embed|get|mcp|query|search|status|update|vsearch)\b/i,
  /\bqmd\s+(?:collection|context|doctor|embed|get|mcp|query|search|status|update|vsearch)\b/i,
  /npm\s+install\s+(?:--global|-g)\s+@tobilu\/qmd\b/i,
  /(?:\$HOME|~|%USERPROFILE%)\s*[\\/]\s*\.?(?:config[\\/])?qmd\b/i,
  /<QMD_COLLECTION_(?:WIKI|DAILY)>/i,
  /\bmemory-(?:wiki|daily)\b.*\bcollection\b/i,
  /\bcollection\b.*\bmemory-(?:wiki|daily)\b/i,
];

export async function auditWorkspace(root, options = {}) {
  const rootPath = path.resolve(root);
  const scopeRoots = normalizeScopeRoots(options.scopeRoots);
  const files = Array.isArray(options.includes)
    ? await discoverFiles(rootPath, options.includes, {
      exclude: options.exclude,
      extensions: SCANNED_EXTENSIONS,
    })
    : await collectFiles(rootPath, rootPath);
  const issues = [];

  for (const file of files) {
    const content = await readFile(path.join(rootPath, file), "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (MOJIBAKE_PATTERN.test(line)) {
        issues.push(makeIssue("mojibake", file, index + 1, line));
      }
      if (isLegacyQmdRule(file, line, scopeRoots)) {
        issues.push(makeIssue("legacy-qmd-rule", file, index + 1, line));
      }
    });
  }

  return {
    ok: issues.length === 0,
    scanned_files: files.length,
    issues,
  };
}

function isLegacyQmdRule(file, line, scopeRoots) {
  if (isHistoricalFile(file, scopeRoots)) return false;
  if (HISTORY_PATTERN.test(line)) return false;
  return LEGACY_QMD_PATTERNS.some((pattern) => pattern.test(line));
}

function isHistoricalFile(file, scopeRoots) {
  return scopeRelativePaths(file, scopeRoots).some((relativePath) =>
    relativePath === "wiki/log.md" ||
    relativePath === "tools/qmd-setup-windows.md" ||
    relativePath.startsWith("daily/") ||
    relativePath.startsWith("eval/") ||
    relativePath.startsWith("archive/") ||
    relativePath.startsWith("workstates/archive/"));
}

function scopeRelativePaths(file, scopeRoots) {
  const normalizedFile = toPosix(file).toLowerCase();
  return scopeRoots.flatMap((scopeRoot) => {
    const normalizedRoot = toPosix(scopeRoot).replace(/^\.\//, "").replace(/\/$/, "").toLowerCase();
    if (!normalizedRoot || normalizedRoot === ".") return [normalizedFile];
    if (normalizedFile === normalizedRoot) return [""];
    return normalizedFile.startsWith(`${normalizedRoot}/`)
      ? [normalizedFile.slice(normalizedRoot.length + 1)]
      : [];
  });
}

async function collectFiles(rootPath, dir) {
  let info;
  try {
    info = await stat(dir);
  } catch {
    return [];
  }

  if (info.isFile()) {
    return shouldScan(dir) ? [toPosix(path.relative(rootPath, dir))] : [];
  }

  if (!info.isDirectory()) return [];
  if (SKIPPED_DIRS.has(path.basename(dir))) return [];

  const result = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;
    result.push(...await collectFiles(rootPath, child));
  }

  return result.sort();
}

function shouldScan(file) {
  return SCANNED_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function makeIssue(kind, file, lineNumber, line) {
  return {
    kind,
    path: file,
    line: lineNumber,
    text: line.trim().slice(0, 240),
  };
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}
