#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.resolve(process.cwd(), requiredOption(process.argv.slice(2), "--output"));
const pkg = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const baseName = `${pkg.name.replace(/^@/, "").replaceAll("/", "-")}-${pkg.version}`;
const names = {
  artifact: `${baseName}.tgz`,
  checksum: `${baseName}.sha256`,
  manifest: `${baseName}.manifest.json`,
};

await mkdir(outputDirectory, { recursive: true });
for (const name of Object.values(names)) {
  if (await exists(path.join(outputDirectory, name))) {
    throw new Error(`Refusing to overwrite existing release file: ${path.join(outputDirectory, name)}`);
  }
}

const temporaryDirectory = await mkdtemp(path.join(outputDirectory, ".local-wiki-release-"));
try {
  const npmCache = path.join(temporaryDirectory, "npm-cache");
  const packed = JSON.parse(runNpm([
    "pack", "--json", "--ignore-scripts", "--pack-destination", temporaryDirectory,
  ], packageRoot, npmCache))[0];
  if (packed.filename !== names.artifact) {
    throw new Error(`Unexpected npm artifact name: ${packed.filename}`);
  }

  const temporaryArtifact = path.join(temporaryDirectory, names.artifact);
  const artifactBytes = await readFile(temporaryArtifact);
  const sha256 = createHash("sha256").update(artifactBytes).digest("hex");
  const manifest = {
    package: pkg.name,
    version: pkg.version,
    artifact: names.artifact,
    sha256,
    bytes: artifactBytes.length,
    npm_integrity: packed.integrity,
    npm_shasum: packed.shasum,
    entry_count: packed.entryCount,
    files: [...(packed.files ?? [])]
      .map(({ path: file, size, mode }) => ({ path: file, size, mode }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };

  const temporaryChecksum = path.join(temporaryDirectory, names.checksum);
  const temporaryManifest = path.join(temporaryDirectory, names.manifest);
  await writeFile(temporaryChecksum, `${sha256}  ${names.artifact}\n`, "utf8");
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await rename(temporaryArtifact, path.join(outputDirectory, names.artifact));
  await rename(temporaryChecksum, path.join(outputDirectory, names.checksum));
  await rename(temporaryManifest, path.join(outputDirectory, names.manifest));

  console.log(JSON.stringify({
    ok: true,
    output_directory: outputDirectory,
    ...manifest,
    checksum_file: names.checksum,
    manifest_file: names.manifest,
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function requiredOption(argv, name) {
  const matches = argv.reduce((values, value, index) => (
    value === name ? [...values, argv[index + 1]] : values
  ), []);
  if (matches.length !== 1 || !matches[0] || matches[0].startsWith("--")) {
    throw new Error(`${name} requires exactly one directory.`);
  }
  const known = new Set([name, matches[0]]);
  const unknown = argv.filter((value) => !known.has(value));
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
  return matches[0];
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function runNpm(args, cwd, cache) {
  const env = {
    ...process.env,
    NO_UPDATE_NOTIFIER: "1",
    npm_config_audit: "false",
    npm_config_cache: cache,
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  const command = process.env.npm_execpath
    ? [process.execPath, [process.env.npm_execpath, ...args]]
    : [process.platform === "win32" ? "npm.cmd" : "npm", args];
  const result = spawnSync(command[0], command[1], {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32" && !process.env.npm_execpath,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n").trim());
  }
  return result.stdout.trim();
}
