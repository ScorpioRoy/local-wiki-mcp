import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chunkDocument, discoverFiles, readDocuments } from "../src/documents.js";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "local-wiki-mcp-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("discoverFiles recursively finds supported files and skips generated directories", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki", "cursor"), { recursive: true });
    await mkdir(path.join(root, ".local-wiki-index"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(root, "wiki", "index.md"), "# Index");
    await writeFile(path.join(root, "wiki", "cursor", "guide.txt"), "Guide");
    await writeFile(path.join(root, ".local-wiki-index", "index.json"), "{}");
    await writeFile(path.join(root, "node_modules", "pkg", "README.md"), "noise");

    const files = await discoverFiles(root, ["wiki"]);

    assert.deepEqual(files.sort(), [
      "wiki/cursor/guide.txt",
      "wiki/index.md",
    ]);
  });
});

test("chunkDocument groups Markdown under headings with stable ids", () => {
  const chunks = chunkDocument({
    path: "wiki/cursor/guide.md",
    content: "# Guide\nIntro\n\n## Setup\nInstall MCP\n\n## Usage\nCall search_wiki",
  });

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].heading, "Guide");
  assert.equal(chunks[1].heading, "Setup");
  assert.equal(chunks[2].id, "wiki/cursor/guide.md#3");
  assert.match(chunks[2].text, /search_wiki/);
});

test("readDocuments returns path and content for included files", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki"), { recursive: true });
    await writeFile(path.join(root, "wiki", "index.md"), "# Wiki\nCodex MCP");

    const docs = await readDocuments(root, ["wiki"]);

    assert.deepEqual(docs, [{ path: "wiki/index.md", content: "# Wiki\nCodex MCP" }]);
  });
});

test("discoverFiles supports product exclude patterns", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki", "public"), { recursive: true });
    await mkdir(path.join(root, "wiki", "private"), { recursive: true });
    await writeFile(path.join(root, "wiki", "public", "guide.md"), "# Public");
    await writeFile(path.join(root, "wiki", "private", "secret.md"), "# Secret");
    await writeFile(path.join(root, "wiki", "draft.skip.md"), "# Draft");

    const files = await discoverFiles(root, ["wiki"], {
      exclude: ["wiki/private", "*.skip.md"],
    });

    assert.deepEqual(files, ["wiki/public/guide.md"]);
  });
});

test("discoverFiles supports caller-specific file extensions", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "rules", "private"), { recursive: true });
    await writeFile(path.join(root, "rules", "memory.mdc"), "Use local-wiki.");
    await writeFile(path.join(root, "rules", "config.json"), "{}");
    await writeFile(path.join(root, "rules", "guide.md"), "# Guide");
    await writeFile(path.join(root, "rules", "private", "secret.json"), "{}");

    const files = await discoverFiles(root, ["rules"], {
      exclude: ["rules/private"],
      extensions: new Set([".mdc", ".json"]),
    });

    assert.deepEqual(files, [
      "rules/config.json",
      "rules/memory.mdc",
    ]);
  });
});

test("discoverFiles ignores include paths outside the root even with shared prefixes", async () => {
  await withTempDir(async (root) => {
    const sibling = `${root}-sibling`;
    try {
      await mkdir(sibling, { recursive: true });
      await writeFile(path.join(sibling, "outside.md"), "# Outside");
      await mkdir(path.join(root, "wiki"), { recursive: true });
      await writeFile(path.join(root, "wiki", "inside.md"), "# Inside");

      const files = await discoverFiles(root, ["wiki", path.relative(root, sibling)]);

      assert.deepEqual(files, ["wiki/inside.md"]);
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });
});

test("discoverFiles de-duplicates overlapping includes", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki"), { recursive: true });
    await writeFile(path.join(root, "wiki", "index.md"), "# Index");

    const files = await discoverFiles(root, ["wiki", "wiki/index.md"]);

    assert.deepEqual(files, ["wiki/index.md"]);
  });
});

test("discoverFiles skips directory links", async (context) => {
  await withTempDir(async (root) => {
    const outside = `${root}-outside`;
    try {
      await mkdir(outside, { recursive: true });
      await writeFile(path.join(outside, "secret.md"), "# Outside");
      await mkdir(path.join(root, "wiki"), { recursive: true });
      try {
        await symlink(outside, path.join(root, "wiki", "linked"), "junction");
      } catch (error) {
        if (error.code === "EPERM") {
          context.skip("Creating directory links is not permitted on this Windows host.");
          return;
        }
        throw error;
      }

      const files = await discoverFiles(root, ["wiki"]);

      assert.deepEqual(files, []);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
