import test from "node:test";
import assert from "node:assert/strict";
import { assertLoopbackUrl, rerankSearchResults } from "../src/reranker.js";

const index = {
  chunks: [
    { id: "a#1", path: "a.md", heading: "A", text: "lexical candidate" },
    { id: "b#1", path: "b.md", heading: "B", text: "semantic candidate" },
  ],
};

const lexical = [
  { id: "a#1", path: "a.md", heading: "A", snippet: "A", score: 10, scores: { bm25: 10 } },
  { id: "b#1", path: "b.md", heading: "B", snippet: "B", score: 7, scores: { bm25: 7 } },
];

test("assertLoopbackUrl accepts local endpoints and rejects remote hosts", () => {
  assert.equal(assertLoopbackUrl("http://127.0.0.1:11434").hostname, "127.0.0.1");
  assert.equal(assertLoopbackUrl("http://localhost:11434/").pathname, "/");
  assert.throws(() => assertLoopbackUrl("https://example.com"), /loopback/i);
});

test("rerankSearchResults uses one Ollama batch and can promote a semantic candidate", async () => {
  let request;
  const report = await rerankSearchResults(index, "semantic query", lexical, {
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "test-model",
    timeoutMs: 1000,
    candidateLimit: 2,
    semanticWeight: 0.8,
  }, {
    topK: 2,
    fetch: async (url, options) => {
      request = { url: String(url), redirect: options.redirect, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({ embeddings: [[1, 0], [0, 1], [1, 0]] }),
      };
    },
  });

  assert.equal(report.applied, true);
  assert.equal(report.results[0].path, "b.md");
  assert.equal(request.url, "http://127.0.0.1:11434/api/embed");
  assert.equal(request.redirect, "error");
  assert.equal(request.body.input.length, 3);
});

test("rerankSearchResults falls back to lexical order on local provider failure", async () => {
  const report = await rerankSearchResults(index, "query", lexical, {
    provider: "ollama",
    baseUrl: "http://localhost:11434",
  }, {
    topK: 1,
    fetch: async () => { throw new Error("offline"); },
  });

  assert.equal(report.applied, false);
  assert.equal(report.results[0].path, "a.md");
  assert.match(report.warning, /lexical results were returned/i);
});
