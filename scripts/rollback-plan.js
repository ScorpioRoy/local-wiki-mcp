#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const failedVersion = option("--version") ?? pkg.version;
const previousVersion = option("--previous");
const tag = option("--tag") ?? "latest";
validateVersion(failedVersion, "--version");
validateVersion(previousVersion, "--previous");
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(tag)) throw new Error("--tag is invalid.");

console.log(JSON.stringify({
  package: pkg.name,
  failed_version: failedVersion,
  previous_version: previousVersion,
  dist_tag: tag,
  executes_commands: false,
  commands: [
    `npm deprecate \"${pkg.name}@${failedVersion}\" \"Withdrawn: use ${previousVersion}\"`,
    `npm dist-tag add \"${pkg.name}@${previousVersion}\" \"${tag}\"`,
    `npm view \"${pkg.name}\" dist-tags --json`,
  ],
}, null, 2));

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function validateVersion(value, name) {
  if (!value || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${name} requires a semantic version.`);
  }
}
