#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
const heading = new RegExp(`^## ${escapeRegExp(pkg.version)}(?:\\s.*)?$`, "m");
const match = heading.exec(changelog);
if (!match) throw new Error(`CHANGELOG.md has no section for ${pkg.version}.`);
const remainder = changelog.slice(match.index + match[0].length).replace(/^\r?\n/, "");
const nextHeading = remainder.search(/^## /m);
const notes = (nextHeading === -1 ? remainder : remainder.slice(0, nextHeading)).trim();
const outputIndex = process.argv.indexOf("--output");

if (outputIndex >= 0) {
  const output = process.argv[outputIndex + 1];
  if (!output) throw new Error("--output requires a path.");
  await writeFile(path.resolve(process.cwd(), output), `${notes}\n`, "utf8");
} else {
  console.log(notes);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
