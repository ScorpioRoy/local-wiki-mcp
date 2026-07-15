import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { auditWorkspace } from "../src/audit.js";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "local-wiki-audit-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("auditWorkspace reports stale qmd instructions in active docs", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki", "cursor"), { recursive: true });
    await writeFile(path.join(root, "wiki", "cursor", "guide.md"), "Use user-qmd to query memory-wiki.");

    const report = await auditWorkspace(root);

    assert.equal(report.ok, false);
    assert.equal(report.issues[0].kind, "legacy-qmd-rule");
    assert.equal(report.issues[0].path, "wiki/cursor/guide.md");
  });
});

test("auditWorkspace reports qmd collection workflow instructions", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki", "project"), { recursive: true });
    await writeFile(path.join(root, "wiki", "project", "map.md"), "qmd: search memory-wiki before changing code.");

    const report = await auditWorkspace(root);

    assert.equal(report.ok, false);
    assert.equal(report.issues[0].kind, "legacy-qmd-rule");
    assert.equal(report.issues[0].path, "wiki/project/map.md");
  });
});

test("auditWorkspace does not report memory-wiki filenames or skill names", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki", "cursor"), { recursive: true });
    await mkdir(path.join(root, "skills", "memory-wiki-workflow"), { recursive: true });
    await writeFile(path.join(root, "wiki", "cursor", "links.md"), "- [Cursor memory](memory-wiki-system.md)\n- Use `memory-wiki-workflow`.");
    await writeFile(path.join(root, "skills", "memory-wiki-workflow", "SKILL.md"), "name: memory-wiki-workflow");

    const report = await auditWorkspace(root);

    assert.equal(report.ok, true);
    assert.deepEqual(report.issues, []);
  });
});

test("auditWorkspace ignores historical qmd mentions marked as history", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "wiki", "cursor"), { recursive: true });
    await writeFile(path.join(root, "wiki", "cursor", "history.md"), "两个项目 memory 规则加入 `user-qmd` 检索流程的历史记录。");

    const report = await auditWorkspace(root);

    assert.equal(report.ok, true);
    assert.deepEqual(report.issues, []);
  });
});

test("auditWorkspace ignores archived qmd setup manuals", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "tools"), { recursive: true });
    await writeFile(path.join(root, "tools", "qmd-setup-windows.md"), "qmd search \"LLM Wiki\" -c memory-wiki");

    const report = await auditWorkspace(root);

    assert.equal(report.ok, true);
    assert.deepEqual(report.issues, []);
  });
});

test("auditWorkspace treats evaluation queries as historical evidence", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "eval"), { recursive: true });
    await writeFile(path.join(root, "eval", "queries.json"), JSON.stringify({ query: "qmd embed migration" }));

    const report = await auditWorkspace(root);

    assert.equal(report.ok, true);
    assert.deepEqual(report.issues, []);
  });
});

test("auditWorkspace reports mojibake-looking text", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "README.md"), "鏈湴 MD 璁板繂");

    const report = await auditWorkspace(root);

    assert.equal(report.ok, false);
    assert.equal(report.issues[0].kind, "mojibake");
  });
});
