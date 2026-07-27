import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveIndexDirectory } from "./indexer.js";
import { createToolHandlers } from "./mcp.js";
import { startExclusiveWatcher } from "./watcher.js";
import { PRODUCT_VERSION } from "./version.js";

const RUNTIME_STATE_FILE = "runtime.json";
const RUNTIME_LOCK_FILE = "runtime.lock";
const DEFAULT_REQUEST_LIMIT = 1024 * 1024;

export async function startRuntimeServer(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const directory = resolveIndexDirectory(root, options.indexDir);
  const lock = await acquireRuntimeLock(root, options.indexDir, options.lockOptions);
  const token = randomBytes(32).toString("hex");
  const handlers = options.handlers ?? createToolHandlers(options);
  const requestLimitBytes = positiveInteger(options.requestLimitBytes, DEFAULT_REQUEST_LIMIT);
  let watcher;
  let watchMode = "off";
  let closed = false;

  if (options.watch) {
    try {
      watcher = await startExclusiveWatcher(root, {
        ...options.config,
        indexDir: options.indexDir,
        includes: options.includes,
        exclude: options.exclude,
        mcpCache: options.mcpCache,
      }, options.watchOptions);
      watchMode = "owned";
    } catch (error) {
      if (error.code !== "WATCH_ALREADY_RUNNING") {
        await lock.release();
        throw error;
      }
      watchMode = "external";
    }
  }

  const server = createServer((request, response) => {
    handleRuntimeRequest(request, response, { handlers, token, requestLimitBytes }).catch((error) => {
      sendJson(response, 500, { error: error.message });
    });
  });

  try {
    await listen(server, options.port ?? 0);
  } catch (error) {
    await watcher?.close?.();
    await lock.release();
    throw error;
  }

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  const stateFile = path.join(directory, RUNTIME_STATE_FILE);
  const state = {
    pid: process.pid,
    url,
    token,
    root,
    version: PRODUCT_VERSION,
    createdAt: new Date().toISOString(),
    watchMode,
  };
  try {
    await writeRuntimeState(stateFile, state);
  } catch (error) {
    await closeServer(server);
    await watcher?.close?.();
    await lock.release();
    throw error;
  }

  return {
    state: publicRuntimeState(state),
    stateFile,
    async close() {
      if (closed) return;
      closed = true;
      await closeServer(server);
      await watcher?.close?.();
      const owner = await readJsonOptional(stateFile);
      if (owner?.pid === process.pid && owner?.token === token) await unlink(stateFile).catch(() => {});
      await lock.release();
    },
  };
}

export function createRuntimeBridgeHandlers(options = {}) {
  const fallback = options.fallbackHandlers ?? createToolHandlers(options);
  const mode = options.mode ?? "auto";
  const handlers = {};
  for (const name of ["search_wiki", "grep_wiki", "read_wiki", "status_wiki"]) {
    handlers[name] = async (args = {}) => {
      try {
        const result = await callRuntimeTool(options.root, options.indexDir, name, args, options);
        return annotateRuntime(result, { mode: "daemon" });
      } catch (error) {
        if (mode === "required") throw error;
        const result = await fallback[name](args);
        return annotateRuntime(result, {
          mode: "fallback",
          warning: `Shared runtime unavailable; direct local search was used: ${error.message}`,
        });
      }
    };
  }
  return handlers;
}

export async function callRuntimeTool(root, indexDir, name, args = {}, options = {}) {
  const state = await readRuntimeState(root, indexDir);
  const url = assertLoopbackRuntimeUrl(state.url);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this Node.js runtime");
  const response = await fetchImpl(new URL(`/tools/${name}`, url), {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: `Bearer ${state.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(positiveInteger(options.timeoutMs, 1500)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `runtime returned HTTP ${response.status}`);
  return payload;
}

export async function inspectRuntime(root, indexDir, options = {}) {
  let state;
  try {
    state = await readRuntimeState(root, indexDir);
  } catch (error) {
    return { active: false, reachable: false, reason: error.message };
  }
  const active = isProcessAlive(state.pid);
  let reachable = false;
  let healthError = null;
  if (active) {
    try {
      const url = assertLoopbackRuntimeUrl(state.url);
      const response = await (options.fetch ?? globalThis.fetch)(new URL("/health", url), {
        redirect: "error",
        signal: AbortSignal.timeout(positiveInteger(options.timeoutMs, 1000)),
      });
      reachable = response.ok;
      if (!response.ok) healthError = `HTTP ${response.status}`;
    } catch (error) {
      healthError = error.message;
    }
  }
  return {
    active,
    reachable,
    pid: state.pid,
    url: state.url,
    version: state.version,
    created_at: state.createdAt,
    watch_mode: state.watchMode,
    ...(healthError ? { health_error: healthError } : {}),
  };
}

export async function stopRuntime(root, indexDir) {
  const state = await readRuntimeState(root, indexDir);
  const inspected = await inspectRuntime(root, indexDir);
  if (!inspected.active || !inspected.reachable) {
    await cleanupRuntimeFiles(root, indexDir);
    return { stopped: false, stale: true, pid: state.pid, reachable: inspected.reachable };
  }
  process.kill(state.pid, "SIGTERM");
  return { stopped: true, stale: false, pid: state.pid };
}

export function runWindowsRuntimeInstaller(root, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") throw new Error("Runtime Startup installation is only available on Windows.");
  const script = options.script ?? fileURLToPath(new URL("../scripts/install-windows-watch.ps1", import.meta.url));
  const args = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", script,
    "-Root", path.resolve(root),
    ...(options.uninstall ? ["-Uninstall"] : []),
    ...(options.noStart ? ["-NoStart"] : []),
  ];
  const spawn = options.spawnSync ?? spawnSync;
  const result = spawn("powershell.exe", args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `Runtime installer exited with ${result.status}.`);
  return {
    ok: true,
    action: options.uninstall ? "uninstall" : "install",
    root: path.resolve(root),
    output: result.stdout?.trim() ?? "",
  };
}

export async function cleanupRuntimeFiles(root, indexDir) {
  const directory = resolveIndexDirectory(root, indexDir);
  await unlink(path.join(directory, RUNTIME_STATE_FILE)).catch(() => {});
  await unlink(path.join(directory, RUNTIME_LOCK_FILE)).catch(() => {});
}

export async function readRuntimeState(root, indexDir) {
  const directory = resolveIndexDirectory(root, indexDir);
  const state = await readJsonOptional(path.join(directory, RUNTIME_STATE_FILE));
  if (!state || !Number.isInteger(state.pid) || !state.token || !state.url) {
    throw new Error("Shared runtime state is missing or invalid.");
  }
  assertLoopbackRuntimeUrl(state.url);
  return state;
}

export function assertLoopbackRuntimeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Shared runtime URL is invalid.");
  }
  if (url.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname.toLowerCase())) {
    throw new Error("Shared runtime URL must use loopback HTTP.");
  }
  return url;
}

async function handleRuntimeRequest(request, response, options) {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true, pid: process.pid, version: PRODUCT_VERSION });
    return;
  }
  const match = /^\/tools\/(search_wiki|grep_wiki|read_wiki|status_wiki)$/.exec(request.url ?? "");
  if (request.method !== "POST" || !match) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  if (!validBearer(request.headers.authorization, options.token)) {
    sendJson(response, 401, { error: "Unauthorized." });
    return;
  }
  let args;
  try {
    args = JSON.parse(await readRequestBody(request, options.requestLimitBytes) || "{}");
  } catch (error) {
    sendJson(response, error.code === "REQUEST_TOO_LARGE" ? 413 : 400, { error: error.message });
    return;
  }
  try {
    sendJson(response, 200, await options.handlers[match[1]](args));
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

async function readRequestBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error(`Request body exceeds ${limit} bytes.`);
      error.code = "REQUEST_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function acquireRuntimeLock(root, indexDir, options = {}) {
  const directory = resolveIndexDirectory(root, indexDir);
  const file = path.join(directory, RUNTIME_LOCK_FILE);
  const pid = positiveInteger(options.pid, process.pid);
  const alive = options.isProcessAlive ?? isProcessAlive;
  await mkdir(directory, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await open(file, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = await readJsonOptional(file);
      if (owner?.pid && alive(owner.pid)) {
        const lockError = new Error(`Another local-wiki runtime is already running (pid ${owner.pid}).`);
        lockError.code = "RUNTIME_ALREADY_RUNNING";
        lockError.owner = owner;
        throw lockError;
      }
      await unlink(file).catch(() => {});
      continue;
    }
    await handle.writeFile(`${JSON.stringify({ pid, createdAt: new Date().toISOString() })}\n`, "utf8");
    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        await handle.close().catch(() => {});
        const owner = await readJsonOptional(file);
        if (owner?.pid === pid) await unlink(file).catch(() => {});
      },
    };
  }
  throw new Error("Unable to acquire local-wiki runtime lock.");
}

async function writeRuntimeState(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600).catch(() => {});
}

function annotateRuntime(result, runtime) {
  const clone = structuredClone(result);
  const block = clone?.content?.find((entry) => entry.type === "text");
  if (!block) return clone;
  try {
    const payload = JSON.parse(block.text);
    payload.runtime = runtime;
    block.text = JSON.stringify(payload, null, 2);
  } catch {
    // Preserve valid MCP content even when a custom handler returns non-JSON text.
  }
  return clone;
}

function validBearer(header, token) {
  const actual = String(header ?? "").replace(/^Bearer\s+/i, "");
  const left = Buffer.from(actual);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendJson(response, status, value) {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function readJsonOptional(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function publicRuntimeState(state) {
  const { token, ...safe } = state;
  void token;
  return safe;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
