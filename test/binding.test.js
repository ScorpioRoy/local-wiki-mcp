import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  bindKnowledgeBase,
  mergeCodexConfig,
  mergeCursorConfig,
} from "../src/binding.js";

async function withTempDir(run) {
  const root = await mkdtemp(path.join(tmpdir(), "local-wiki-binding-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Codex binding preserves unrelated TOML and owns one managed block", () => {
  const snippet = "[mcp_servers.local_wiki]\ncommand = 'node'\n";
  const first = mergeCodexConfig("model = 'gpt'\n", snippet);
  const second = mergeCodexConfig(first, snippet);

  assert.match(first, /model = 'gpt'/);
  assert.match(first, /local-wiki-mcp managed/);
  assert.equal(second, first);
  assert.throws(
    () => mergeCodexConfig("[mcp_servers.local_wiki]\ncommand = 'custom'\n", snippet),
    /unmanaged/i,
  );
  assert.throws(() => mergeCodexConfig("# >>> local-wiki-mcp managed: local_wiki\n", snippet), /incomplete/i);
  assert.throws(() => mergeCodexConfig(`${first}\n[mcp_servers.local_wiki]\ncommand = 'other'\n`, snippet), /another unmanaged/i);
  assert.throws(() => mergeCodexConfig(`${first}\n${first}`, snippet), /duplicated/i);
});

test("Cursor binding preserves other servers and refuses a conflicting entry", () => {
  const snippet = JSON.stringify({
    mcpServers: { "local-wiki": { command: "node", args: ["cli.js", "serve"] } },
  });
  const merged = JSON.parse(mergeCursorConfig(JSON.stringify({
    mcpServers: { existing: { command: "existing" } },
  }), snippet));

  assert.equal(merged.mcpServers.existing.command, "existing");
  assert.equal(merged.mcpServers["local-wiki"].command, "node");
  assert.doesNotThrow(() => mergeCursorConfig(JSON.stringify({
    mcpServers: { "local-wiki": { args: ["cli.js", "serve"], command: "node" } },
  }), snippet));
  assert.throws(() => mergeCursorConfig(JSON.stringify({
    mcpServers: { "local-wiki": { command: "custom" } },
  }), snippet), /different local-wiki/i);
  assert.throws(() => mergeCursorConfig("{broken", snippet), /valid JSON/i);
});

test("bind preview does not initialize or write client configuration", async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "knowledge");
    const codexConfig = path.join(base, "home", ".codex", "config.toml");
    const report = await bindKnowledgeBase(root, {
      clients: ["codex"],
      initialize: true,
      refresh: true,
      daemon: true,
      codexConfig,
    });

    assert.equal(report.mode, "preview");
    assert.equal(report.validation.pending_initialization, true);
    assert.equal(report.actions.apply_client_config, true);
    assert.equal(report.actions.writes_in_preview, false);
    assert.equal(report.bindings[0].ok, true);
    assert.equal(report.bindings[0].changed, true);
    assert.equal(report.bindings[0].file, codexConfig);
    await assert.rejects(access(path.join(root, ".local-wiki.json")), /ENOENT/);
    await assert.rejects(access(codexConfig), /ENOENT/);
  });
});

test("bind preview reports client conflicts without writing", async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "knowledge");
    const cursorConfig = path.join(base, "home", ".cursor", "mcp.json");
    await mkdir(path.dirname(cursorConfig), { recursive: true });
    await writeFile(cursorConfig, JSON.stringify({
      mcpServers: { "local-wiki": { command: "custom" } },
    }));

    const report = await bindKnowledgeBase(root, {
      clients: ["cursor"],
      initialize: true,
      cursorConfig,
    });

    assert.equal(report.ok, false);
    assert.equal(report.bindings[0].ok, false);
    assert.match(report.bindings[0].error, /different local-wiki/i);
    assert.equal(JSON.parse(await readFile(cursorConfig, "utf8")).mcpServers["local-wiki"].command, "custom");
    await assert.rejects(access(path.join(root, ".local-wiki.json")), /ENOENT/);
  });
});

test("bind preview does not treat an invalid existing config as pending initialization", async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "knowledge");
    const codexConfig = path.join(base, "home", ".codex", "config.toml");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, ".local-wiki.json"), "{broken");

    const report = await bindKnowledgeBase(root, {
      clients: ["codex"],
      initialize: true,
      codexConfig,
    });

    assert.equal(report.ok, false);
    assert.notEqual(report.validation.pending_initialization, true);
    assert(report.validation.errors.length > 0);
    await assert.rejects(access(codexConfig), /ENOENT/);
  });
});

test("bind apply initializes, refreshes, backs up, and keeps repeated apply idempotent", async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "knowledge");
    const codexConfig = path.join(base, "home", ".codex", "config.toml");
    const cursorConfig = path.join(base, "home", ".cursor", "mcp.json");
    await mkdir(path.dirname(codexConfig), { recursive: true });
    await mkdir(path.dirname(cursorConfig), { recursive: true });
    await writeFile(codexConfig, "model = 'gpt'\n");
    await writeFile(cursorConfig, JSON.stringify({ mcpServers: { existing: { command: "existing" } } }));

    const first = await bindKnowledgeBase(root, {
      clients: ["codex", "cursor"],
      initialize: true,
      refresh: true,
      daemon: true,
      apply: true,
      codexConfig,
      cursorConfig,
      now: new Date("2026-08-14T00:00:00Z"),
    });
    assert.equal(first.ok, true);
    assert.equal(first.smoke.ok, true);
    assert(first.smoke.chunk_count > 0);
    assert(first.bindings.every((binding) => binding.backup !== null));
    assert.match(await readFile(codexConfig, "utf8"), new RegExp(escapeRegExp(process.execPath)));
    assert.equal(JSON.parse(await readFile(cursorConfig, "utf8")).mcpServers["local-wiki"].command, process.execPath);

    const second = await bindKnowledgeBase(root, {
      clients: ["codex", "cursor"],
      daemon: true,
      apply: true,
      codexConfig,
      cursorConfig,
    });
    assert(second.bindings.every((binding) => binding.changed === false));
    assert(second.bindings.every((binding) => binding.backup === null));
  });
});

test("bind apply preflights every client before writing any configuration", async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "knowledge");
    const codexConfig = path.join(base, "home", ".codex", "config.toml");
    const cursorConfig = path.join(base, "home", ".cursor", "mcp.json");
    await bindKnowledgeBase(root, { clients: ["codex"], initialize: true, apply: true, codexConfig });
    await rm(codexConfig);
    await mkdir(path.dirname(cursorConfig), { recursive: true });
    await writeFile(cursorConfig, JSON.stringify({
      mcpServers: { "local-wiki": { command: "custom" } },
    }));

    await assert.rejects(() => bindKnowledgeBase(root, {
      clients: ["codex", "cursor"],
      apply: true,
      codexConfig,
      cursorConfig,
    }), /different local-wiki/i);
    await assert.rejects(access(codexConfig), /ENOENT/);
  });
});

test("bind apply preflights client conflicts before initializing the knowledge base", async () => {
  await withTempDir(async (base) => {
    const root = path.join(base, "knowledge");
    const codexConfig = path.join(base, "home", ".codex", "config.toml");
    const cursorConfig = path.join(base, "home", ".cursor", "mcp.json");
    await mkdir(path.dirname(cursorConfig), { recursive: true });
    await writeFile(cursorConfig, JSON.stringify({
      mcpServers: { "local-wiki": { command: "custom" } },
    }));

    await assert.rejects(() => bindKnowledgeBase(root, {
      clients: ["codex", "cursor"],
      initialize: true,
      apply: true,
      codexConfig,
      cursorConfig,
    }), /different local-wiki/i);
    await assert.rejects(access(path.join(root, ".local-wiki.json")), /ENOENT/);
    await assert.rejects(access(codexConfig), /ENOENT/);
  });
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
