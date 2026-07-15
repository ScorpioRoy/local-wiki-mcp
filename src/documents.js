import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".html", ".htm"]);
const SKIPPED_DIRS = new Set([
  ".git",
  ".local-wiki-index",
  ".state",
  "node_modules",
]);

export async function discoverFiles(root, includes = ["wiki", "MEMORY.md"], options = {}) {
  const rootPath = path.resolve(root);
  const files = [];
  const exclude = normalizeExclude(options.exclude ?? []);

  for (const include of includes) {
    const absolute = path.resolve(rootPath, include);
    if (!isInsideRoot(rootPath, absolute)) continue;
    await collectFiles(rootPath, absolute, files, exclude);
  }

  return [...new Set(files)].sort();
}

export async function readDocuments(root, includes = ["wiki", "MEMORY.md"], options = {}) {
  const rootPath = path.resolve(root);
  const files = await discoverFiles(rootPath, includes, options);
  const docs = [];

  for (const relativePath of files) {
    const content = await readFile(path.join(rootPath, relativePath), "utf8");
    docs.push({ path: relativePath, content });
  }

  return docs;
}

export function chunkDocument(document, options = {}) {
  const maxChars = options.maxChars ?? 2400;
  const sections = splitMarkdownSections(document.content);
  const chunks = [];

  for (const section of sections) {
    const parts = splitLongText(section.text, maxChars);
    for (const part of parts) {
      chunks.push({
        id: `${document.path}#${chunks.length + 1}`,
        path: document.path,
        heading: section.heading,
        text: part,
      });
    }
  }

  return chunks;
}

async function collectFiles(rootPath, target, files, exclude) {
  let info;
  try {
    info = await lstat(target);
  } catch {
    return;
  }

  if (info.isSymbolicLink()) return;

  if (info.isFile()) {
    if (SUPPORTED_EXTENSIONS.has(path.extname(target).toLowerCase())) {
      const relativePath = toPosix(path.relative(rootPath, target));
      if (!isExcluded(relativePath, exclude)) {
        files.push(relativePath);
      }
    }
    return;
  }

  if (!info.isDirectory()) return;
  if (SKIPPED_DIRS.has(path.basename(target))) return;
  const relativeDir = toPosix(path.relative(rootPath, target));
  if (relativeDir && isExcluded(relativeDir, exclude)) return;

  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;
    await collectFiles(rootPath, path.join(target, entry.name), files, exclude);
  }
}

function splitMarkdownSections(content) {
  const lines = String(content ?? "").split(/\r?\n/);
  const sections = [];
  let heading = "Document";
  let buffer = [];

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim();
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }

  flush();
  return sections.length ? sections : [{ heading, text: String(content ?? "") }];

  function flush() {
    const text = buffer.join("\n").trim();
    if (text) {
      sections.push({ heading, text });
    }
  }
}

function splitLongText(text, maxChars) {
  if (text.length <= maxChars) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const parts = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) parts.push(current);
    current = paragraph;
  }

  if (current) parts.push(current);
  return parts.flatMap((part) => hardSplit(part, maxChars));
}

function hardSplit(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const parts = [];
  for (let index = 0; index < text.length; index += maxChars) {
    parts.push(text.slice(index, index + maxChars));
  }
  return parts;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function normalizeExclude(values) {
  return values
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => toPosix(value.trim()).replace(/^\/+/, "").replace(/\/+$/, ""));
}

function isExcluded(relativePath, patterns) {
  return patterns.some((pattern) => {
    if (pattern.includes("*")) {
      return globToRegExp(pattern).test(relativePath);
    }
    return relativePath === pattern || relativePath.startsWith(`${pattern}/`);
  });
}

function globToRegExp(pattern) {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

function isInsideRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
