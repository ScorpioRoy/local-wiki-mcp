import { makeNgrams, normalizeText, summarize, tokenize, unique } from "./text.js";

const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function searchIndex(index, query, options = {}) {
  return rankSearch(index, query, options).results;
}

export function explainSearch(index, query, options = {}) {
  const ranked = rankSearch(index, query, options, true);
  return {
    query: String(query ?? ""),
    strategy: {
      lexical: "BM25-like token scoring",
      fuzzy: "character trigram cosine similarity",
      boosts: ["exact phrase", "heading coverage", "path coverage"],
      dense_embeddings: false,
    },
    query_analysis: {
      normalized: ranked.queryText,
      tokens: ranked.queryTokens,
      terms: ranked.queryTerms,
      ngram_occurrences: ranked.queryNgrams.length,
      unique_ngrams: Object.keys(ranked.queryVector).length,
    },
    options: {
      top_k: ranked.topK,
      diversity: ranked.diversity,
      max_chunks_per_path: ranked.maxChunksPerPath,
      weights: ranked.weights,
    },
    candidate_count: ranked.scored.length,
    diversity_eligible_count: ranked.eligible.length,
    returned_count: ranked.results.length,
    results: ranked.results,
  };
}

function rankSearch(index, query, options = {}, explain = false) {
  const topK = positiveInteger(options.topK, 8);
  const queryTokens = tokenize(query);
  const queryNgrams = makeNgrams(query, 3);
  const queryVector = vectorFromNgrams(queryNgrams);
  const queryVectorNorm = vectorMagnitude(queryVector);
  const queryText = normalizeText(query).trim();
  const queryTerms = queryWords(query);
  const weights = {
    exact: positiveNumber(options.weights?.exact, 3),
    title: positiveNumber(options.weights?.title, 1.5),
    path: positiveNumber(options.weights?.path, 1),
  };

  const scored = index.chunks
    .map((chunk) => {
      const bm25 = scoreBm25(index, chunk, queryTokens);
      const vector = cosineSimilarity(queryVector, chunk.vector, queryVectorNorm, chunk.vectorNorm);
      const boost = scoreBoosts(chunk, queryText, queryTerms, weights);
      const score = bm25 + vector + boost.exact + boost.title + boost.path;
      const result = toResult(chunk, score, { bm25, vector, ...boost });
      if (explain) {
        result.explanation = explainChunk(index, chunk, queryTokens, queryTerms, queryVector, queryText);
      }
      return result;
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.path.localeCompare(right.path);
    });

  const diversity = options.diversity !== false;
  const maxChunksPerPath = positiveInteger(options.maxChunksPerPath, 1);
  const eligible = diversity
    ? selectDiverseResults(scored, explain ? scored.length : topK, maxChunksPerPath)
    : scored;

  return {
    topK,
    diversity,
    maxChunksPerPath,
    weights,
    queryTokens,
    queryNgrams,
    queryVector,
    queryText,
    queryTerms,
    scored,
    eligible,
    results: explain || !diversity ? eligible.slice(0, topK) : eligible,
  };
}

function scoreBoosts(chunk, queryText, queryTerms, weights) {
  const heading = normalizeText(chunk.heading);
  const path = normalizeText(chunk.path);
  const searchable = normalizeText(`${chunk.path}\n${chunk.heading}\n${chunk.text}`);

  return {
    exact: queryText && searchable.includes(queryText) ? weights.exact : 0,
    title: coverageScore(heading, queryTerms) * weights.title,
    path: coverageScore(path, queryTerms) * weights.path,
  };
}

function coverageScore(text, terms) {
  if (!terms.length) return 0;
  const hits = terms.filter((term) => text.includes(term)).length;
  return hits / terms.length;
}

function explainChunk(index, chunk, queryTokens, queryTerms, queryVector, queryText) {
  const heading = normalizeText(chunk.heading);
  const path = normalizeText(chunk.path);
  const searchable = normalizeText(`${chunk.path}\n${chunk.heading}\n${chunk.text}`);
  const matchedTokens = queryTokens.filter((term) => (chunk.termCounts[term] ?? 0) > 0);
  const matchedNgrams = Object.keys(queryVector).filter((gram) => (chunk.vector?.[gram] ?? 0) > 0);
  return {
    matched_tokens: matchedTokens.map((term) => ({
      term,
      term_frequency: chunk.termCounts[term],
      document_frequency: index.documentFrequency[term] ?? 0,
    })),
    missing_tokens: queryTokens.filter((term) => !matchedTokens.includes(term)),
    matched_unique_ngrams: matchedNgrams.length,
    query_unique_ngrams: Object.keys(queryVector).length,
    exact_phrase_match: Boolean(queryText && searchable.includes(queryText)),
    heading_terms: queryTerms.filter((term) => heading.includes(term)),
    path_terms: queryTerms.filter((term) => path.includes(term)),
  };
}

function queryWords(query) {
  const words = normalizeText(query)
    .split(/[^a-z0-9\p{Script=Han}]+/u)
    .filter((word) => word.length >= 2);
  return unique(words);
}

export function grepIndex(index, pattern, options = {}) {
  const topK = positiveInteger(options.topK, 20);
  const needle = String(pattern ?? "").toLowerCase();
  if (!needle) return [];

  return index.chunks
    .filter((chunk) => `${chunk.path}\n${chunk.heading}\n${chunk.text}`.toLowerCase().includes(needle))
    .slice(0, topK)
    .map((chunk) => toResult(chunk, 1, { bm25: 1, vector: 0 }));
}

export function readFromIndex(index, target, options = {}) {
  const maxChars = positiveInteger(options.maxChars, 12000);
  const query = String(target ?? "");
  const chunks = index.chunks.filter((chunk) => (
    chunk.path === query ||
    chunk.id === query ||
    chunk.path.endsWith(query)
  ));

  return chunks.map((chunk) => ({
    id: chunk.id,
    path: chunk.path,
    heading: chunk.heading,
    text: chunk.text.slice(0, maxChars),
  }));
}

function scoreBm25(index, chunk, queryTokens) {
  let score = 0;
  const totalDocs = Math.max(1, index.chunkCount);
  const length = Math.max(1, chunk.tokenCount ?? chunk.tokens?.length ?? sumValues(chunk.termCounts));
  const averageLength = Math.max(1, index.averageLength);

  for (const term of queryTokens) {
    const termFrequency = chunk.termCounts[term] ?? 0;
    if (!termFrequency) continue;

    const docsWithTerm = index.documentFrequency[term] ?? 0;
    const idf = Math.log(1 + (totalDocs - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
    const numerator = termFrequency * (BM25_K1 + 1);
    const denominator = termFrequency + BM25_K1 * (1 - BM25_B + BM25_B * (length / averageLength));
    score += idf * (numerator / denominator);
  }

  return score;
}

function vectorFromNgrams(ngrams) {
  const vector = {};
  for (const gram of ngrams) {
    vector[gram] = (vector[gram] ?? 0) + 1;
  }
  return vector;
}

function cosineSimilarity(left, right, leftNorm = vectorMagnitude(left), rightNorm = vectorMagnitude(right)) {
  let dot = 0;
  for (const [key, value] of Object.entries(left ?? {})) {
    if (right?.[key]) dot += value * right[key];
  }

  if (!leftNorm || !rightNorm) return 0;
  return dot / (leftNorm * rightNorm);
}

function vectorMagnitude(vector) {
  let squared = 0;
  for (const value of Object.values(vector ?? {})) squared += value * value;
  return Math.sqrt(squared);
}

function sumValues(values) {
  let total = 0;
  for (const value of Object.values(values ?? {})) total += value;
  return total;
}

function selectDiverseResults(results, topK, maxChunksPerPath) {
  const limit = Number.isInteger(maxChunksPerPath) && maxChunksPerPath > 0 ? maxChunksPerPath : 1;
  const counts = new Map();
  const selected = [];
  for (const result of results) {
    const count = counts.get(result.path) ?? 0;
    if (count >= limit) continue;
    counts.set(result.path, count + 1);
    selected.push(result);
    if (selected.length >= topK) break;
  }
  return selected;
}

function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function toResult(chunk, score, scores) {
  return {
    id: chunk.id,
    path: chunk.path,
    heading: chunk.heading,
    snippet: summarize(chunk.text),
    score,
    scores,
  };
}
