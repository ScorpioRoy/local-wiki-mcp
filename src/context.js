import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const DAILY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const TASK_HEADING = /^## 任务(\d+):\s*(.+)$/gm;

export async function buildStartupContext(root, options = {}) {
  const rootPath = path.resolve(root);
  const days = positiveInteger(options.days, 3);
  const maxTasks = positiveInteger(options.maxTasks, 12);
  const maxChars = positiveInteger(options.maxChars, 8000);
  const now = options.now instanceof Date ? options.now : new Date();
  const memoryPath = path.join(rootPath, "MEMORY.md");
  const memory = await readOptional(memoryPath);
  const dailyFiles = await findRecentDailyFiles(rootPath, now, days);
  const tasks = [];

  for (const file of dailyFiles) {
    const content = await readFile(file.absolutePath, "utf8");
    const fileTasks = extractTasks(content, file.date).filter(isCurrentTask).reverse();
    tasks.push(...fileTasks);
    if (tasks.length >= maxTasks) break;
  }

  const selected = tasks.slice(0, maxTasks);
  const sections = [
    "# 紧凑启动上下文",
    "",
    `> 自动提取：最近 ${days} 天、最多 ${maxTasks} 个任务。事实以 Markdown 原文为准。`,
    "",
    "## 热启动摘要",
    "",
    memory.trim() || "（MEMORY.md 为空或不存在）",
    "",
    "## 最近任务索引",
    "",
    ...(selected.length ? selected.map(formatTask) : ["- 最近时间窗口内没有 daily 任务。"]),
    "",
    "## 按需读取",
    "",
    "- 概念、方案和历史决策使用 `search_wiki`。",
    "- 配置、报错、API、路径和标识符使用 `grep_wiki`。",
    "- 命中后使用 `read_wiki`，仅在需要连续上下文时读取 daily 原文。",
    "",
  ];
  const text = limitText(sections.join("\n"), maxChars);

  return {
    text,
    days,
    max_tasks: maxTasks,
    task_count: selected.length,
    chars: text.length,
    approximate_tokens: approximateTokens(text),
    sources: [
      ...(memory ? [toPosix(path.relative(rootPath, memoryPath))] : []),
      ...dailyFiles.map((file) => file.relativePath),
    ],
  };
}

export function extractTasks(content, date) {
  const matches = [...String(content ?? "").matchAll(TASK_HEADING)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    const body = content.slice(start, end);
    return {
      date,
      number: Number(match[1]),
      title: match[2].trim(),
      status: field(body, "状态").toLowerCase() || "active",
      project: field(body, "项目·模块"),
      pending: field(body, "遗留/待办"),
    };
  });
}

function isCurrentTask(task) {
  return !/^(superseded|archived|deprecated|obsolete|closed)$/.test(task.status);
}

async function findRecentDailyFiles(rootPath, now, days) {
  const dailyRoot = path.join(rootPath, "daily");
  const threshold = dayNumber(now) - (days - 1);
  const entries = await readdir(dailyRoot, { withFileTypes: true }).catch(() => []);
  const candidates = [];

  for (const entry of entries) {
    if (entry.isFile()) addCandidate(entry.name, dailyRoot);
    if (!entry.isDirectory()) continue;
    const directory = path.join(dailyRoot, entry.name);
    const children = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (child.isFile()) addCandidate(child.name, directory);
    }
  }

  return candidates
    .filter((file) => file.day >= threshold && file.day <= dayNumber(now))
    .sort((left, right) => right.day - left.day);

  function addCandidate(name, directory) {
    const match = name.match(DAILY_FILE);
    if (!match) return;
    const parsed = parseDate(match[1]);
    if (!parsed) return;
    const absolutePath = path.join(directory, name);
    candidates.push({
      absolutePath,
      relativePath: toPosix(path.relative(rootPath, absolutePath)),
      date: match[1],
      day: parsed,
    });
  }
}

function formatTask(task) {
  const details = [
    task.project ? `项目：${compact(task.project, 100)}` : null,
    task.pending ? `待办：${compact(task.pending, 180)}` : null,
  ].filter(Boolean);
  return `- ${task.date} · 任务${task.number} · ${compact(task.title, 120)}${details.length ? ` | ${details.join(" | ")}` : ""}`;
}

function field(body, name) {
  const match = String(body ?? "").match(new RegExp(`^- ${escapeRegExp(name)}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function compact(value, maxChars) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function limitText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 20)).trimEnd()}\n\n（已按字符上限截断）\n`;
}

function approximateTokens(text) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  return Math.round(cjk + (text.length - cjk) / 4);
}

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function parseDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 86400000);
}

function dayNumber(value) {
  return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000);
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}
