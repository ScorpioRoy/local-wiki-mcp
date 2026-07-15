#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localOnly = process.argv.includes("--local");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const versionSource = await readFile(path.join(root, "src", "version.js"), "utf8");
const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const errors = [];
const warnings = [];

check(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version), "package.json version is not valid semver.");
check(versionSource.includes(`PRODUCT_VERSION = "${pkg.version}"`), "src/version.js does not match package.json.");
check(new RegExp(`^## ${escapeRegExp(pkg.version)}(?:\\s|$)`, "m").test(changelog), "CHANGELOG.md has no section for the package version.");
check(lock.version === pkg.version && lock.packages?.[""]?.version === pkg.version, "package-lock.json version does not match package.json.");
check(pkg.private === false, "package must not be private.");
check(pkg.license === "MIT", "package license must be MIT.");
check(pkg.engines?.node === ">=20.0.0", "Node.js engine support must remain explicit.");

for (const file of pkg.files ?? []) {
  await access(path.join(root, file.replace(/\/$/, ""))).catch(() => {
    errors.push(`Package file entry does not exist: ${file}`);
  });
}

const remoteFields = [
  ["repository.url", pkg.repository?.url],
  ["homepage", pkg.homepage],
  ["bugs.url", pkg.bugs?.url],
];
for (const [name, value] of remoteFields) {
  if (!isReleaseUrl(value)) {
    (localOnly ? warnings : errors).push(`${name} must be a real HTTPS URL before public publication.`);
  }
}

const git = gitState();
if (!git.available) {
  (localOnly ? warnings : errors).push("Package directory is not an initialized Git repository.");
} else {
  if (git.dirty) (localOnly ? warnings : errors).push("Git worktree is not clean.");
  if (!localOnly && git.tag !== `v${pkg.version}`) {
    errors.push(`Release commit must be tagged v${pkg.version}.`);
  }
  if (!localOnly && !git.remote) errors.push("Git repository has no origin remote.");
}

const report = {
  ok: errors.length === 0,
  mode: localOnly ? "local" : "publish",
  package: pkg.name,
  version: pkg.version,
  errors,
  warnings,
  git,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 2;

function check(condition, message) {
  if (!condition) errors.push(message);
}

function gitState() {
  const inside = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || output(inside) !== "true") return { available: false };
  const status = runGit(["status", "--porcelain"]);
  const tag = runGit(["describe", "--tags", "--exact-match"]);
  const remote = runGit(["remote", "get-url", "origin"]);
  return {
    available: true,
    dirty: Boolean(output(status)),
    tag: tag.status === 0 ? output(tag) : null,
    remote: remote.status === 0 ? output(remote) : null,
  };
}

function runGit(args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
}

function output(result) {
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

function isReleaseUrl(value) {
  return typeof value === "string" && /^https:\/\/[^<>\s]+$/i.test(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
