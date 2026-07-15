import test from "node:test";
import assert from "node:assert/strict";
import { makeNgrams, tokenize } from "../src/text.js";

test("tokenize keeps English identifiers, paths, and Chinese terms searchable", () => {
  const tokens = tokenize("Codex config.toml QDRANT_READ_ONLY 本地知识库");

  assert(tokens.includes("codex"));
  assert(tokens.includes("config.toml"));
  assert(tokens.includes("qdrant_read_only"));
  assert(tokens.includes("本地"));
  assert(tokens.includes("知识库"));
});

test("tokenize de-duplicates terms without losing order", () => {
  assert.deepEqual(tokenize("Codex codex CODEX"), ["codex"]);
});

test("makeNgrams creates stable overlapping grams", () => {
  assert.deepEqual(makeNgrams("abcdef", 3), ["abc", "bcd", "cde", "def"]);
});

test("makeNgrams returns the whole text when shorter than requested gram size", () => {
  assert.deepEqual(makeNgrams("知识", 3), ["知识"]);
});
