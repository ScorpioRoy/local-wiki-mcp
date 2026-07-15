import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

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
  /\bqmd\s*(?:[:：]|\bMCP\b)/i,
  /\bqmd\s+(?:collection|context|doctor|embed|get|mcp|query|search|status|update|vsearch)\b/i,
  /<QMD_COLLECTION_(?:WIKI|DAILY)>/i,
  /\bmemory-(?:wiki|daily)\b.*\bcollection\b/i,
  /\bcollection\b.*\bmemory-(?:wiki|daily)\b/i,
];

export async function auditWorkspace(root) {
  const rootPath = path.resolve(root);
  const files = await collectFiles(rootPath, rootPath);
  const issues = [];

  for (const file of files) {
    const content = await readFile(path.join(rootPath, file), "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (MOJIBAKE_PATTERN.test(line)) {
        issues.push(makeIssue("mojibake", file, index + 1, line));
      }
      if (isLegacyQmdRule(file, line)) {
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

function isLegacyQmdRule(file, line) {
  if (isHistoricalFile(file)) return false;
  if (HISTORY_PATTERN.test(line)) return false;
  return LEGACY_QMD_PATTERNS.some((pattern) => pattern.test(line));
}

function isHistoricalFile(file) {
  return file === "wiki/log.md" ||
    file === "tools/qmd-setup-windows.md" ||
    file.endsWith("/tools/qmd-setup-windows.md") ||
    file.startsWith("eval/");
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
