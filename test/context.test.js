import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildStartupContext, extractTasks } from "../src/context.js";

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "local-wiki-context-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("extractTasks reads task headings and compact fields", () => {
  const tasks = extractTasks(`## 任务1: 第一项
- 项目·模块: demo · 搜索
- 遗留/待办: 等待验证

## 任务2: 第二项
- 项目·模块: demo · 索引
`, "2026-07-16");

  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[0], {
    date: "2026-07-16",
    number: 1,
    title: "第一项",
    status: "active",
    project: "demo · 搜索",
    pending: "等待验证",
  });
});

test("buildStartupContext excludes superseded daily tasks", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "daily", "2026-07"), { recursive: true });
    await writeFile(path.join(root, "daily", "2026-07", "2026-07-16.md"), [
      "## 任务1: 已关闭迁移",
      "- 状态: superseded",
      "- supersededBy: daily/2026-07/2026-07-16.md#任务2",
      "- 遗留/待办: 等待迁移",
      "",
      "## 任务2: 当前整合",
      "- 状态: active",
      "- 遗留/待办: 继续验证",
    ].join("\n"));

    const report = await buildStartupContext(root, {
      now: new Date("2026-07-16T12:00:00+08:00"),
      days: 1,
      maxTasks: 10,
    });
    assert.match(report.text, /当前整合/);
    assert.doesNotMatch(report.text, /已关闭迁移|等待迁移/);
  });
});

test("buildStartupContext limits the date window and newest tasks", async () => {
  await withTempDir(async (root) => {
    await mkdir(path.join(root, "daily", "2026-07"), { recursive: true });
    await writeFile(path.join(root, "MEMORY.md"), "# 热启动\n\n保持简短。\n");
    await writeFile(path.join(root, "daily", "2026-07", "2026-07-14.md"), "## 任务1: 边界日任务\n- 项目·模块: demo\n");
    await writeFile(path.join(root, "daily", "2026-07", "2026-07-15.md"), "## 任务1: 昨日任务\n- 遗留/待办: 继续处理\n");
    await writeFile(path.join(root, "daily", "2026-07", "2026-07-16.md"), [
      "## 任务1: 今日较早任务",
      "- 项目·模块: demo · one",
      "",
      "## 任务2: 今日最新任务",
      "- 项目·模块: demo · two",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "daily", "2026-07", "2026-07-13.md"), "## 任务1: 窗口外任务\n");

    const report = await buildStartupContext(root, {
      now: new Date("2026-07-16T12:00:00+08:00"),
      days: 3,
      maxTasks: 3,
      maxChars: 8000,
    });

    assert.equal(report.task_count, 3);
    assert.match(report.text, /保持简短/);
    assert.match(report.text, /今日最新任务/);
    assert.match(report.text, /今日较早任务/);
    assert.match(report.text, /昨日任务/);
    assert.doesNotMatch(report.text, /边界日任务/);
    assert.doesNotMatch(report.text, /窗口外任务/);
    assert(report.approximate_tokens > 0);
  });
});

test("buildStartupContext enforces the character ceiling", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "MEMORY.md"), "中".repeat(2000));
    const report = await buildStartupContext(root, { maxChars: 500 });
    assert(report.text.length <= 500);
    assert.match(report.text, /已按字符上限截断/);
  });
});
