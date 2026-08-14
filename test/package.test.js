import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package metadata is ready for product distribution", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.private, false);
  assert.equal(pkg.version, "0.7.0");
  assert.equal(pkg.scripts["bench:scale"], "node --expose-gc scripts/scale-bench.js");
  assert.equal(pkg.license, "MIT");
  assert.match(pkg.description, /local/i);
  assert.deepEqual(Object.keys(pkg.bin).sort(), ["local-wiki", "local-wiki-mcp"]);
  assert(pkg.files.includes("src/"));
  assert(pkg.files.includes("scripts/Bind-LocalWikiKnowledgeBase.ps1"));
  assert(pkg.files.includes("scripts/build-release-package.js"));
  assert(pkg.files.includes("scripts/bind-knowledge-base-macos.sh"));
  assert(pkg.files.includes("scripts/install-macos-runtime.sh"));
  assert(pkg.files.includes("scripts/install-windows-watch.ps1"));
  assert(pkg.files.includes("scripts/local-wiki-watch.ps1"));
  assert(pkg.files.includes("scripts/scale-bench.js"));
  assert(pkg.files.includes("README.md"));
  assert(pkg.files.includes("README.en.md"));
  assert(pkg.files.includes("README.zh-CN.md"));
  assert(pkg.files.includes("INSTALLATION.md"));
  assert(pkg.files.includes("MIGRATION_FROM_QMD.md"));
  assert(pkg.files.includes("RELEASING.md"));
  assert.equal(pkg.scripts["pack:check"], "npm pack --dry-run");
  assert.equal(pkg.scripts["release:package"], "node scripts/build-release-package.js --output dist");
  assert.equal(pkg.scripts["test:pack"], "node scripts/verify-package.js");
  assert.equal(pkg.scripts["test:eval"], "node scripts/product-eval.js");
  assert.equal(pkg.scripts["soak:watch"], "node scripts/watch-soak.js");
  assert.equal(pkg.scripts["release:check"], "node scripts/check-release.js --local");
  assert.equal(pkg.scripts.smoke, "node src/cli.js smoke");
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.publishConfig.provenance, true);
  assert.equal(pkg.repository.url, "https://github.com/ScorpioRoy/local-wiki-mcp.git");

  const installation = await readFile(new URL("../INSTALLATION.md", import.meta.url), "utf8");
  assert.doesNotMatch(installation, /<LOCAL_WIKI_REPOSITORY>/);
});
