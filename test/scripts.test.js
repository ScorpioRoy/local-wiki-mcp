import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withTempDir(run) {
  const root = await mkdtemp(path.join(tmpdir(), "local-wiki-scripts-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("macOS binding wrapper delegates to preview-only CLI", { skip: process.platform === "win32" }, async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "knowledge");
    const codexConfig = path.join(base, "home", ".codex", "config.toml");
    const script = path.join(packageRoot, "scripts", "bind-knowledge-base-macos.sh");
    const result = await execFileAsync("/bin/sh", [
      script, "--root", root, "--client", "codex", "--codex-config", codexConfig,
      "--initialize", "--refresh", "--daemon",
    ]);
    const report = JSON.parse(result.stdout);

    assert.equal(report.mode, "preview");
    assert.equal(report.validation.pending_initialization, true);
    await assert.rejects(access(path.join(root, ".local-wiki.json")), /ENOENT/);
  });
});

test("macOS runtime script creates and removes one current-user LaunchAgent", { skip: process.platform === "win32" }, async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "knowledge");
    const home = path.join(base, "home");
    await mkdir(root, { recursive: true });
    const script = path.join(packageRoot, "scripts", "install-macos-runtime.sh");
    const env = { ...process.env, HOME: home };

    await execFileAsync("/bin/sh", [script, "--root", root, "--no-start"], { env });
    const plist = path.join(home, "Library", "LaunchAgents", "com.local-wiki-mcp.runtime.plist");
    const content = await readFile(plist, "utf8");
    assert.match(content, /com\.local-wiki-mcp\.runtime/);
    assert.match(content, /<string>--watch<\/string>/);
    assert.match(content, /local-wiki-runtime\.log/);

    await execFileAsync("/bin/sh", [script, "--root", root, "--uninstall"], { env });
    await assert.rejects(access(plist), /ENOENT/);
  });
});

test("Windows binding wrapper delegates to preview-only CLI", { skip: process.platform !== "win32" }, async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "knowledge");
    const codexConfig = path.join(base, "home", ".codex", "config.toml");
    const script = path.join(packageRoot, "scripts", "Bind-LocalWikiKnowledgeBase.ps1");
    const result = await execFileAsync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
      "-Root", root, "-Client", "codex", "-CodexConfig", codexConfig,
      "-Initialize", "-Refresh", "-Daemon",
    ]);
    const report = JSON.parse(result.stdout);

    assert.equal(report.mode, "preview");
    assert.equal(report.validation.pending_initialization, true);
    await assert.rejects(access(path.join(root, ".local-wiki.json")), /ENOENT/);
  });
});

test("CI and release workflows require live macOS LaunchAgent verification", async () => {
  const verifier = await readFile(path.join(packageRoot, ".github", "scripts", "verify-macos-runtime.sh"), "utf8");
  const ci = await readFile(path.join(packageRoot, ".github", "workflows", "ci.yml"), "utf8");
  const release = await readFile(path.join(packageRoot, ".github", "workflows", "release.yml"), "utf8");

  assert.match(verifier, /runtime install --root/);
  assert.match(verifier, /report\.active/);
  assert.match(verifier, /report\.reachable/);
  assert.match(verifier, /launchctl print/);
  assert.match(verifier, /runtime uninstall --root/);
  assert.doesNotMatch(verifier, /runtime install[^\r\n]*--no-start/);
  assert.match(ci, /sh \.github\/scripts\/verify-macos-runtime\.sh/);
  assert.match(release, /sh \.github\/scripts\/verify-macos-runtime\.sh/);
});

test("release workflow publishes and attaches the same verified bundle with least privilege", async () => {
  const release = await readFile(path.join(packageRoot, ".github", "workflows", "release.yml"), "utf8");

  assert.match(release, /permissions:\r?\n  contents: read/);
  assert.match(release, /publish:[\s\S]*?permissions:\r?\n      contents: write\r?\n      id-token: write/);
  assert.match(release, /gh api "repos\/\$\{\{ github\.repository \}\}" --jq \.visibility/);
  assert.match(release, /npm run release:package/);
  assert.match(release, /npm publish "dist\/local-wiki-mcp-\$\{\{ steps\.package\.outputs\.version \}\}\.tgz"/);
  assert.match(release, /dist\/local-wiki-mcp-\$\{\{ steps\.package\.outputs\.version \}\}\.sha256/);
  assert.match(release, /dist\/local-wiki-mcp-\$\{\{ steps\.package\.outputs\.version \}\}\.manifest\.json/);
  assert.match(release, /gh release create/);
});
