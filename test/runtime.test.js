import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertLoopbackRuntimeUrl,
  callRuntimeTool,
  createRuntimeOwner,
  createRuntimeBridgeHandlers,
  inspectRuntime,
  readRuntimeState,
  runMacRuntimeInstaller,
  runRuntimeInstaller,
  runWindowsRuntimeInstaller,
  startRuntimeServer,
} from "../src/runtime.js";

async function withTempDir(run) {
  const root = await mkdtemp(path.join(tmpdir(), "local-wiki-runtime-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function jsonContent(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function stubHandlers() {
  return {
    search_wiki: async (args) => jsonContent({ query: args.query, results: [{ path: "wiki/runtime.md" }] }),
    grep_wiki: async (args) => jsonContent({ pattern: args.pattern, results: [] }),
    read_wiki: async (args) => jsonContent({ target: args.target, results: [] }),
    status_wiki: async () => jsonContent({ stale: false }),
  };
}

test("runtime only accepts loopback HTTP URLs", () => {
  assert.equal(assertLoopbackRuntimeUrl("http://127.0.0.1:1234").hostname, "127.0.0.1");
  assert.throws(() => assertLoopbackRuntimeUrl("https://127.0.0.1:1234"), /loopback HTTP/i);
  assert.throws(() => assertLoopbackRuntimeUrl("http://example.com"), /loopback HTTP/i);
});

test("runtime authenticates tool calls and hides token from diagnostics", async () => {
  await withTempDir(async (root) => {
    const runtime = await startRuntimeServer({ root, handlers: stubHandlers() });
    try {
      assert.equal(runtime.state.token, undefined);
      const result = await callRuntimeTool(root, undefined, "search_wiki", { query: "runtime" });
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.results[0].path, "wiki/runtime.md");

      const state = await readRuntimeState(root);
      const unauthorized = await fetch(new URL("/tools/status_wiki", state.url), {
        method: "POST",
        body: "{}",
      });
      assert.equal(unauthorized.status, 401);

      const report = await inspectRuntime(root);
      assert.equal(report.active, true);
      assert.equal(report.reachable, true);
      assert.equal(report.token, undefined);
    } finally {
      await runtime.close();
    }
  });
});

test("runtime rejects duplicate processes and oversized requests", async () => {
  await withTempDir(async (root) => {
    const runtime = await startRuntimeServer({ root, handlers: stubHandlers(), requestLimitBytes: 64 });
    try {
      await assert.rejects(() => startRuntimeServer({ root, handlers: stubHandlers() }), /already running/i);
      const state = await readRuntimeState(root);
      const response = await fetch(new URL("/tools/search_wiki", state.url), {
        method: "POST",
        headers: { authorization: `Bearer ${state.token}` },
        body: JSON.stringify({ query: "x".repeat(100) }),
      });
      assert.equal(response.status, 413);
    } finally {
      await runtime.close();
    }
  });
});

test("runtime bridge falls back to direct handlers when daemon is unavailable", async () => {
  await withTempDir(async (root) => {
    const handlers = createRuntimeBridgeHandlers({
      root,
      fallbackHandlers: stubHandlers(),
      timeoutMs: 50,
    });
    const result = await handlers.search_wiki({ query: "fallback" });
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(parsed.runtime.mode, "fallback");
    assert.match(parsed.runtime.warning, /direct local search/i);
    assert.equal(parsed.results[0].path, "wiki/runtime.md");
  });
});

test("runtime bridge starts an owner on demand instead of requiring manual daemon startup", async () => {
  await withTempDir(async (root) => {
    const owner = createRuntimeOwner({ root, handlers: stubHandlers() });
    const handlers = createRuntimeBridgeHandlers({
      root,
      fallbackHandlers: stubHandlers(),
      ensureRuntime: owner.ensure,
      timeoutMs: 200,
    });
    try {
      const result = await handlers.search_wiki({ query: "automatic owner" });
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.runtime.mode, "daemon");
      assert.equal(owner.owned, true);
      assert.equal((await inspectRuntime(root)).reachable, true);
    } finally {
      await owner.close();
    }
  });
});

test("runtime owners reuse concurrent startup and a standby owner can take over", async () => {
  await withTempDir(async (root) => {
    const first = createRuntimeOwner({ root, handlers: stubHandlers() });
    const second = createRuntimeOwner({ root, handlers: stubHandlers() });
    try {
      const [firstStatus, secondStatus] = await Promise.all([first.ensure(), second.ensure()]);
      assert.equal(firstStatus.reachable, true);
      assert.equal(secondStatus.reachable, true);
      assert.notEqual(first.owned, second.owned);

      const owner = first.owned ? first : second;
      const standby = first.owned ? second : first;
      await owner.close();
      assert.equal((await inspectRuntime(root)).reachable, false);

      const recovered = await standby.ensure();
      assert.equal(recovered.reachable, true);
      assert.equal(standby.owned, true);
    } finally {
      await first.close();
      await second.close();
    }
  });
});

test("Windows runtime installer uses the packaged PowerShell script", () => {
  let invocation;
  const result = runWindowsRuntimeInstaller("D:/knowledge", {
    platform: "win32",
    script: "D:/package/install.ps1",
    noStart: true,
    spawnSync(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, stdout: "installed", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(invocation.command, "powershell.exe");
  assert(invocation.args.includes("-NoStart"));
  assert(invocation.args.includes("D:/package/install.ps1"));
  assert.equal(invocation.options.windowsHide, true);
});

test("Windows Startup script selects one scalar PowerShell executable", async () => {
  const script = await readFile(new URL("../scripts/install-windows-watch.ps1", import.meta.url), "utf8");

  assert.match(script, /\$PowerShell = \$PowerShellCandidates \|/);
  assert.doesNotMatch(script, /\$PowerShell\s*=\s*@\(/);
  assert.match(script, /\$Shortcut\.TargetPath = \$PowerShell/);
});

test("Windows runtime wrapper retries crashes but preserves normal stop", async () => {
  const script = await readFile(new URL("../scripts/local-wiki-watch.ps1", import.meta.url), "utf8");

  assert.match(script, /while\s*\(\$true\)/i);
  assert.match(script, /\$RuntimeExitCode\s*-eq\s*0/);
  assert.match(script, /Restarting runtime in \$RetryDelaySeconds seconds/);
  assert.match(script, /\$MaxRetryDelaySeconds\s*=\s*60/);
});

test("macOS runtime installer uses the packaged LaunchAgent script", () => {
  let invocation;
  const result = runMacRuntimeInstaller("/Users/test/knowledge", {
    platform: "darwin",
    script: "/package/install-macos-runtime.sh",
    noStart: true,
    spawnSync(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, stdout: "installed", stderr: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(invocation.command, "/bin/sh");
  assert(invocation.args.includes("--no-start"));
  assert(invocation.args.includes("/package/install-macos-runtime.sh"));
  assert.equal(invocation.options.encoding, "utf8");
});

test("runtime installer dispatches by platform and rejects unsupported systems", () => {
  const spawnSync = () => ({ status: 0, stdout: "ok", stderr: "" });
  assert.equal(runRuntimeInstaller("D:/knowledge", {
    platform: "win32", script: "D:/install.ps1", spawnSync,
  }).ok, true);
  assert.equal(runRuntimeInstaller("/Users/test/knowledge", {
    platform: "darwin", script: "/install.sh", spawnSync,
  }).ok, true);
  assert.throws(() => runRuntimeInstaller("/tmp/knowledge", { platform: "linux" }), /Windows and macOS/i);
});
