#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(packageRoot, ".package-test-"));
const npmCache = path.join(temporaryRoot, "npm-cache");

try {
  const artifacts = path.join(temporaryRoot, "artifacts");
  const consumer = path.join(temporaryRoot, "consumer");
  const knowledgeBase = path.join(temporaryRoot, "knowledge");
  await mkdir(artifacts, { recursive: true });
  await mkdir(consumer, { recursive: true });
  await writeFile(path.join(consumer, "package.json"), `${JSON.stringify({ private: true }, null, 2)}\n`);

  const packed = JSON.parse(runNpm(["pack", "--json", "--pack-destination", artifacts], packageRoot));
  const artifact = path.join(artifacts, packed[0].filename);
  await access(artifact);
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", artifact], consumer);

  const installedRoot = path.join(consumer, "node_modules", "local-wiki-mcp");
  const cli = path.join(installedRoot, "src", "cli.js");
  const installedPackage = JSON.parse(await readFile(path.join(installedRoot, "package.json"), "utf8"));
  await access(path.join(installedRoot, "README.md"));
  await access(path.join(installedRoot, "README.zh-CN.md"));
  await access(path.join(installedRoot, "scripts", "install-windows-watch.ps1"));
  await access(path.join(installedRoot, "scripts", "local-wiki-watch.ps1"));
  await access(path.join(installedRoot, "scripts", "scale-bench.js"));

  const version = JSON.parse(runNode([cli, "version", "--json"], consumer));
  JSON.parse(runNode([cli, "init", "--root", knowledgeBase, "--template", "minimal"], consumer));
  JSON.parse(runNode([cli, "config", "validate", "--root", knowledgeBase], consumer));
  runNode([cli, "index", "--root", knowledgeBase], consumer);
  const smoke = JSON.parse(runNode([cli, "smoke", "--root", knowledgeBase], consumer));
  if (!smoke.ok) throw new Error("Installed package smoke test failed.");
  if (version.version !== installedPackage.version) {
    throw new Error(`Installed CLI version ${version.version} does not match package ${installedPackage.version}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    package: installedPackage.name,
    version: installedPackage.version,
    artifact: packed[0].filename,
    packed_files: packed[0].entryCount,
    packed_bytes: packed[0].size,
    smoke_chunk_count: smoke.checks.index.chunk_count,
  }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function runNode(args, cwd) {
  return run(process.execPath, args, cwd);
}

function runNpm(args, cwd) {
  const options = {
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: "1",
      npm_config_audit: "false",
      npm_config_cache: npmCache,
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    },
  };
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], cwd, options);
  }
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, cwd, {
    ...options,
    shell: process.platform === "win32",
  });
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with exit code ${result.status}.`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result.stdout.trim();
}
