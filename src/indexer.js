import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { chunkDocument, discoverFiles } from "./documents.js";
import { makeNgrams, tokenize } from "./text.js";

export const CURRENT_INDEX_VERSION = 3;
export const DEFAULT_INDEX_DIR = ".local-wiki-index";
export const DEFAULT_INDEX_FILE = "index.json";

export function resolveIndexDirectory(root, indexDir = DEFAULT_INDEX_DIR) {
  const rootPath = path.resolve(root);
  const directory = path.resolve(rootPath, indexDir);
  const relative = path.relative(rootPath, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Index directory must resolve inside the knowledge-base root.");
  }
  return directory;
}

export function buildIndex(chunks, metadata = {}) {
  const indexedChunks = chunks.map((chunk) => (
    isCurrentIndexedChunk(chunk) ? chunk : indexChunk(chunk)
  ));
  const documentFrequency = {};
  let totalTokens = 0;

  for (const chunk of indexedChunks) {
    totalTokens += chunk.tokenCount;
    for (const term of Object.keys(chunk.termCounts)) {
      documentFrequency[term] = (documentFrequency[term] ?? 0) + 1;
    }
  }

  return {
    version: CURRENT_INDEX_VERSION,
    createdAt: new Date().toISOString(),
    metadata,
    chunkCount: indexedChunks.length,
    averageLength: indexedChunks.length ? totalTokens / indexedChunks.length : 0,
    documentFrequency,
    chunks: indexedChunks,
  };
}

export async function buildIndexFromFiles(root, includes, options = {}) {
  const rootPath = path.resolve(root);
  const files = await discoverFiles(rootPath, includes, { exclude: options.exclude });
  const chunks = [];
  const fileMetadata = [];

  for (const relativePath of files) {
    const absolutePath = path.join(rootPath, relativePath);
    const content = await readFile(absolutePath, "utf8");
    const info = await stat(absolutePath);
    const documentChunks = chunkDocument({ path: relativePath, content }, options).map(indexChunk);
    chunks.push(...documentChunks);
    fileMetadata.push({
      path: relativePath,
      mtimeMs: info.mtimeMs,
      size: info.size,
      sha256: sha256(content),
      chunkIds: documentChunks.map((chunk) => chunk.id),
    });
  }

  return buildIndex(chunks, {
    root: rootPath,
    includes,
    exclude: options.exclude ?? [],
    files: fileMetadata,
  });
}

export async function syncIndexFromFiles(root, previousIndex, includes, options = {}) {
  const rootPath = path.resolve(root);
  const currentFiles = await collectFileStats(rootPath, includes, { exclude: options.exclude });
  const previousFiles = new Map((previousIndex.metadata?.files ?? []).map((file) => [file.path, file]));
  const previousChunks = new Map((previousIndex.chunks ?? []).map((chunk) => [chunk.id, chunk]));
  const canReuseCurrentFeatures = previousIndex.version === CURRENT_INDEX_VERSION;
  const chunks = [];
  const fileMetadata = [];

  for (const file of currentFiles) {
    const previous = previousFiles.get(file.path);
    const reusable = canReuseCurrentFeatures ? referencedChunks(previous, previousChunks) : null;
    const sameStats = previous && previous.mtimeMs === file.mtimeMs && previous.size === file.size;

    if (sameStats && reusable) {
      chunks.push(...reusable);
      fileMetadata.push({ ...file, sha256: previous.sha256, chunkIds: reusable.map((chunk) => chunk.id) });
      continue;
    }

    const content = await readFile(path.join(rootPath, file.path), "utf8");
    const contentHash = sha256(content);
    if (previous?.sha256 === contentHash && reusable) {
      chunks.push(...reusable);
      fileMetadata.push({ ...file, sha256: contentHash, chunkIds: reusable.map((chunk) => chunk.id) });
      continue;
    }

    const rebuilt = chunkDocument({ path: file.path, content }, options).map(indexChunk);
    chunks.push(...rebuilt);
    fileMetadata.push({ ...file, sha256: contentHash, chunkIds: rebuilt.map((chunk) => chunk.id) });
  }

  return buildIndex(chunks, {
    root: rootPath,
    includes,
    exclude: options.exclude ?? [],
    files: fileMetadata,
  });
}

export async function saveIndex(root, index, indexDir = DEFAULT_INDEX_DIR) {
  validateIndex(index, { allowLegacy: false });
  const dir = await safeIndexDirectory(root, indexDir);
  await mkdir(dir, { recursive: true });
  await assertNoLinkedIndexPath(path.resolve(root), dir);
  const file = path.join(dir, DEFAULT_INDEX_FILE);
  const temporary = path.join(dir, `${DEFAULT_INDEX_FILE}.tmp-${process.pid}-${Date.now()}`);
  await writeFile(temporary, `${JSON.stringify(index)}\n`, "utf8");
  try {
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return file;
}

export async function loadIndex(root, indexDir = DEFAULT_INDEX_DIR) {
  const file = path.join(await safeIndexDirectory(root, indexDir), DEFAULT_INDEX_FILE);
  const raw = await readFile(file, "utf8");
  return validateIndex(JSON.parse(raw));
}

export async function withIndexLock(root, indexDir = DEFAULT_INDEX_DIR, action, options = {}) {
  const dir = await safeIndexDirectory(root, indexDir);
  const lockFile = path.join(dir, "index.lock");
  const staleLockMs = options.staleLockMs ?? 10 * 60 * 1000;
  await mkdir(dir, { recursive: true });
  await assertNoLinkedIndexPath(path.resolve(root), dir);
  let handle;

  try {
    handle = await open(lockFile, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const lockInfo = await stat(lockFile).catch(() => null);
    if (!lockInfo || Date.now() - lockInfo.mtimeMs <= staleLockMs) {
      throw new Error(`Another local-wiki index operation is already running: ${lockFile}`);
    }
    await unlink(lockFile).catch(() => {});
    try {
      handle = await open(lockFile, "wx");
    } catch (retryError) {
      if (retryError.code === "EEXIST") {
        throw new Error(`Another local-wiki index operation is already running: ${lockFile}`);
      }
      throw retryError;
    }
  }

  await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, "utf8");
  try {
    return await action();
  } finally {
    await handle.close().catch(() => {});
    await unlink(lockFile).catch(() => {});
  }
}

export function validateIndex(index, options = {}) {
  if (!index || typeof index !== "object" || Array.isArray(index)) {
    throw new Error("Index must be a JSON object.");
  }
  const supported = options.allowLegacy === false ? [CURRENT_INDEX_VERSION] : [2, CURRENT_INDEX_VERSION];
  if (!supported.includes(index.version)) {
    throw new Error(`Unsupported index version: ${index.version}.`);
  }
  if (!Array.isArray(index.chunks)) {
    throw new Error("Index chunks must be an array.");
  }
  if (index.chunkCount !== index.chunks.length) {
    throw new Error(`Index chunkCount ${index.chunkCount} does not match chunks length ${index.chunks.length}.`);
  }
  if (!index.documentFrequency || typeof index.documentFrequency !== "object") {
    throw new Error("Index documentFrequency is missing.");
  }

  for (const [position, chunk] of index.chunks.entries()) {
    if (!chunk || typeof chunk.id !== "string" || typeof chunk.path !== "string" || typeof chunk.text !== "string") {
      throw new Error(`Invalid chunk at index ${position}.`);
    }
    if (!chunk.termCounts || typeof chunk.termCounts !== "object" || !chunk.vector || typeof chunk.vector !== "object") {
      throw new Error(`Chunk ${chunk.id} is missing search features.`);
    }
    if (index.version === CURRENT_INDEX_VERSION && (
      !Number.isFinite(chunk.tokenCount) || chunk.tokenCount < 0 ||
      !Number.isFinite(chunk.vectorNorm) || chunk.vectorNorm < 0
    )) {
      throw new Error(`Chunk ${chunk.id} has invalid v3 search features.`);
    }
  }
  return index;
}

export async function inspectIndexFreshness(
  root,
  index,
  includes = index.metadata?.includes ?? ["wiki", "MEMORY.md"],
  options = {},
) {
  const rootPath = path.resolve(root);
  const indexedFiles = new Map((index.metadata?.files ?? []).map((file) => [file.path, file]));
  const exclude = options.exclude ?? index.metadata?.exclude ?? [];
  const currentFiles = options.strict
    ? await collectFileMetadata(rootPath, includes, { exclude })
    : await collectFileStats(rootPath, includes, { exclude });
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
  const added = [];
  const changed = [];
  const deleted = [];
  const unchanged = [];

  for (const file of currentFiles) {
    const previous = indexedFiles.get(file.path);
    if (!previous) {
      added.push(file.path);
    } else if (options.strict
      ? previous.sha256 !== file.sha256
      : previous.mtimeMs !== file.mtimeMs || previous.size !== file.size) {
      changed.push(file.path);
    } else {
      unchanged.push(file.path);
    }
  }

  for (const file of indexedFiles.values()) {
    if (!currentByPath.has(file.path)) {
      deleted.push(file.path);
    }
  }

  return {
    stale: added.length > 0 || changed.length > 0 || deleted.length > 0,
    mode: options.strict ? "strict" : "fast",
    added: added.sort(),
    changed: changed.sort(),
    deleted: deleted.sort(),
    unchanged: unchanged.sort(),
  };
}

async function collectFileStats(rootPath, includes, options = {}) {
  const files = await discoverFiles(rootPath, includes, { exclude: options.exclude });
  const metadata = [];
  for (const relativePath of files) {
    const info = await stat(path.join(rootPath, relativePath));
    metadata.push({ path: relativePath, mtimeMs: info.mtimeMs, size: info.size });
  }
  return metadata;
}

async function collectFileMetadata(rootPath, includes, options = {}) {
  const metadata = await collectFileStats(rootPath, includes, options);
  for (const file of metadata) {
    const content = await readFile(path.join(rootPath, file.path), "utf8");
    file.sha256 = sha256(content);
  }
  return metadata;
}

function referencedChunks(file, chunksById) {
  if (!file || !Array.isArray(file.chunkIds) || file.chunkIds.length === 0) return null;
  const chunks = file.chunkIds.map((id) => chunksById.get(id));
  return chunks.every(isCurrentIndexedChunk) ? chunks : null;
}

function isCurrentIndexedChunk(chunk) {
  return Boolean(
    chunk &&
    Number.isFinite(chunk.tokenCount) &&
    Number.isFinite(chunk.vectorNorm) &&
    chunk.termCounts &&
    chunk.vector,
  );
}

function indexChunk(chunk) {
  const searchable = `${chunk.path}\n${chunk.heading}\n${chunk.text}`;
  const tokens = tokenize(searchable);
  const vector = countValues(makeNgrams(searchable, 3));
  const { tokens: legacyTokens, tokenCount, vectorNorm, ...base } = chunk;
  void legacyTokens;
  void tokenCount;
  void vectorNorm;
  return {
    ...base,
    tokenCount: tokens.length,
    termCounts: countValues(tokens),
    vector,
    vectorNorm: magnitude(vector),
  };
}

function magnitude(vector) {
  let squared = 0;
  for (const value of Object.values(vector)) squared += value * value;
  return Math.sqrt(squared);
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function safeIndexDirectory(root, indexDir) {
  const rootPath = path.resolve(root);
  const directory = resolveIndexDirectory(rootPath, indexDir);
  await assertNoLinkedIndexPath(rootPath, directory);
  return directory;
}

async function assertNoLinkedIndexPath(rootPath, directory) {
  const relative = path.relative(rootPath, directory);
  let current = rootPath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error(`Index directory must not pass through a symbolic link: ${current}`);
    }
  }
}
