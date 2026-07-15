import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package metadata is ready for product distribution", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.private, false);
  assert.equal(pkg.version, "0.4.0");
  assert.equal(pkg.license, "MIT");
  assert.match(pkg.description, /local/i);
  assert.deepEqual(Object.keys(pkg.bin).sort(), ["local-wiki", "local-wiki-mcp"]);
  assert(pkg.files.includes("src/"));
  assert(pkg.files.includes("README.md"));
  assert(pkg.files.includes("README.zh-CN.md"));
  assert(pkg.files.includes("MIGRATION_FROM_QMD.md"));
  assert(pkg.files.includes("RELEASING.md"));
  assert.equal(pkg.scripts["pack:check"], "npm pack --dry-run");
  assert.equal(pkg.scripts["test:pack"], "node scripts/verify-package.js");
  assert.equal(pkg.scripts["test:eval"], "node scripts/product-eval.js");
  assert.equal(pkg.scripts["soak:watch"], "node scripts/watch-soak.js");
  assert.equal(pkg.scripts["release:check"], "node scripts/check-release.js --local");
  assert.equal(pkg.scripts.smoke, "node src/cli.js smoke");
  assert.equal(pkg.publishConfig.provenance, true);
});
