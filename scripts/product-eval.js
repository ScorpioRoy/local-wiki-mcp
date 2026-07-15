#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEval } from "../src/eval.js";
import { buildIndexFromFiles } from "../src/indexer.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(packageRoot, "test", "fixtures", "product-kb");
const fixtureFile = path.join(packageRoot, "test", "fixtures", "eval.json");
const variantSet = option("--variant-set");
const fixture = JSON.parse(await readFile(fixtureFile, "utf8"));
const index = await buildIndexFromFiles(fixtureRoot, ["wiki"]);
const thresholds = variantSet === "semantic" ? {} : {
  minTop1: 0.85,
  minTop5: 0.97,
  maxDuplicateRate: 0.1,
};
const report = runEval(index, fixture, { variantSet, ...thresholds });
delete report.cases;
console.log(JSON.stringify({
  corpus: "sanitized-product-kb",
  corpus_files: index.metadata.files.length,
  corpus_chunks: index.chunkCount,
  ...report,
}, null, 2));
if (!report.passed) process.exitCode = 3;

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
