import { makeNgrams, normalizeText, rewriteQuery, summarize, tokenize, unique } from "./text.js";
import { matchesProjectScope, resolveProjectScope } from "./project-scope.js";

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const IDENTIFIER_EXPANSION_WEIGHT = 0.25;
const QUERY_ALIAS_WEIGHT = 1.25;
const INDEX_SEARCH_CACHE = new WeakMap();
const SOURCE_CALIBRATION = {
  wiki: 1,
  product_doc: 1,
  rule: 1,
  memory: 0.9,
  workstate: 0.85,
  daily: 0.85,
  docs: 0.8,
  wiki_index: 0.45,
  template: 0.45,
  document: 0.5,
};

export function searchIndex(index, query, options = {}) {
  return rankSearch(index, query, options).results;
}

export function explainSearch(index, query, options = {}) {
  const ranked = rankSearch(index, query, options, true);
  return {
    query: String(query ?? ""),
    strategy: {
      lexical: "field-aware BM25-like token scoring",
      fuzzy: "character trigram cosine similarity",
      fusion: "reciprocal rank fusion",
      boosts: ["exact phrase", "heading coverage", "path coverage", "identifier coverage", "source lifecycle", "heterogeneous source calibration"],
      dense_embeddings: false,
    },
    query_analysis: {
      normalized: ranked.queryText,
      tokens: ranked.queryTokens,
      terms: ranked.queryTerms,
      identifier_terms: ranked.identifierQueryTokens,
      alias_terms: ranked.aliasQueryTokens,
      rewrites: ranked.queryPlan,
      ngram_occurrences: ranked.queryNgrams.length,
      unique_ngrams: Object.keys(ranked.queryVector).length,
    },
    options: {
      top_k: ranked.topK,
      diversity: ranked.diversity,
      max_chunks_per_path: ranked.maxChunksPerPath,
      weights: ranked.weights,
      context_chars: ranked.contextChars,
      max_output_tokens: ranked.maxOutputTokens,
    },
    candidate_count: ranked.scored.length,
    diversity_eligible_count: ranked.eligible.length,
    returned_count: ranked.results.length,
    results: ranked.results,
  };
}

function rankSearch(index, query, options = {}, explain = false) {
  const topK = positiveInteger(options.topK, 8);
  const queryPlan = rewriteQuery(query, options.queryAliases);
  const originalQueryTokens = tokenize(query);
  const aliasQueryTokens = unique(queryPlan.aliases.flatMap(({ values }) => (
    values.flatMap((value) => [...tokenize(value), ...rewriteQuery(value).terms])
  )));
  const identifierQueryTokens = queryPlan.terms.filter((term) => (
    !originalQueryTokens.includes(term) && !aliasQueryTokens.includes(term)
  ));
  const queryTokens = unique([...originalQueryTokens, ...identifierQueryTokens, ...aliasQueryTokens]);
  const queryNgrams = makeNgrams(query, 3);
  const queryVector = vectorFromNgrams(queryNgrams);
  const queryVectorNorm = vectorMagnitude(queryVector);
  const queryText = normalizeText(query).trim();
  const queryTerms = queryWords(query);
  const historicalQuery = analyzeHistoricalQuery(query);
  const navigationQuery = isNavigationQuery(query);
  const weights = {
    exact: positiveNumber(options.weights?.exact, 3),
    title: positiveNumber(options.weights?.title, 1.5),
    path: positiveNumber(options.weights?.path, 1),
    identifier: positiveNumber(options.weights?.identifier, 1.25),
    source: positiveNumber(options.weights?.source, 0.75),
  };
  const projectScope = resolveProjectScope(options);
  const indexCache = getIndexSearchCache(index, projectScope.scopeRoots);
  const scopedChunks = index.chunks.filter((chunk) => matchesProjectScope(chunk, projectScope));

  const candidates = scopedChunks
    .map((chunk) => {
      const fields = indexCache.fields.get(chunk.id);
      const bm25Original = scoreBm25(index, chunk, originalQueryTokens);
      const bm25Expanded = scoreBm25(index, chunk, identifierQueryTokens);
      const bm25Alias = scoreBm25(index, chunk, aliasQueryTokens);
      const bm25 = bm25Original
        + (IDENTIFIER_EXPANSION_WEIGHT * bm25Expanded)
        + (QUERY_ALIAS_WEIGHT * bm25Alias);
      const vector = cosineSimilarity(queryVector, chunk.vector, queryVectorNorm, chunk.vectorNorm);
      const boost = scoreBoosts(chunk, queryText, queryTerms, queryPlan, weights, fields);
      const lifecycle = scoreLifecycle(fields, options.now, historicalQuery);
      const versionSpecificity = scoreVersionSpecificity(fields, historicalQuery);
      const linear = bm25 + vector + boost.exact + boost.title + boost.path + boost.identifier;
      const result = toResult(chunk, linear, {
        bm25,
        bm25_original: bm25Original,
        bm25_expanded: bm25Expanded,
        bm25_alias: bm25Alias,
        vector,
        ...boost,
        source: lifecycle.score * weights.source,
        recency: lifecycle.recency,
        lifecycle: lifecycle.lifecycle,
        lifecycle_multiplier: lifecycle.multiplier,
        version_specificity: versionSpecificity,
        linear,
      });
      result.source_type = lifecycle.type;
      result.topic_key = lifecycle.topicKey;
      if (explain) {
        result.explanation = {
          ...explainChunk(index, chunk, queryTokens, queryTerms, queryVector, queryText),
          identifier_terms: boost.identifierTerms,
          alias_terms: aliasQueryTokens.filter((term) => (chunk.termCounts?.[term] ?? 0) > 0),
          alias_path_matches: boost.aliasPathMatches,
          source_type: lifecycle.type,
          source_score: lifecycle.score,
          lifecycle_status: lifecycle.status,
        };
      }
      return result;
    })
    .filter((result) => result.score > 0)
    .map((result) => {
      delete result.scores.identifierTerms;
      delete result.scores.aliasPathMatches;
      return result;
    });

  applyReciprocalRankFusion(candidates);
  applyHeterogeneousSourceCalibration(candidates, navigationQuery);
  const scored = candidates.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.path.localeCompare(right.path);
    });

  const diversity = options.diversity !== false;
  const maxChunksPerPath = positiveInteger(options.maxChunksPerPath, 1);
  const topicDiversity = options.topicDiversity !== false;
  const eligible = diversity
    ? selectDiverseResults(scored, explain ? scored.length : topK, maxChunksPerPath, topicDiversity)
    : scored;
  const contextChars = nonNegativeInteger(options.contextChars, 0);
  const maxOutputTokens = positiveInteger(options.maxOutputTokens, undefined);
  const selected = explain || !diversity ? eligible.slice(0, topK) : eligible;
  decorateConfidence(selected, queryTokens);
  if (contextChars > 0) attachAdjacentContext(index, selected, contextChars, projectScope);
  const results = applyResultBudget(selected, maxOutputTokens);

  return {
    topK,
    diversity,
    maxChunksPerPath,
    weights,
    queryPlan,
    queryTokens,
    identifierQueryTokens,
    aliasQueryTokens,
    queryNgrams,
    queryVector,
    queryText,
    queryTerms,
    contextChars,
    maxOutputTokens,
    scored,
    eligible,
    results,
  };
}

function scoreBoosts(chunk, queryText, queryTerms, queryPlan, weights, fields) {
  const heading = fields.heading;
  const path = fields.path;
  const identifierTerms = fields.identifierTerms;
  const pathIdentifierMatches = queryPlan.identifiers
    .map(({ original }) => normalizeText(original))
    .filter((term) => term && path.includes(term));
  const aliasPathMatches = unique(queryPlan.aliases.flatMap(({ values }) => values))
    .map((value) => normalizeText(value))
    .filter((term) => term && path.includes(term));
  const pathIdentifier = pathIdentifierMatches.length ? 0.75 * weights.path : 0;
  const pathAlias = aliasPathMatches.length ? 0.75 * weights.path : 0;

  return {
    exact: queryText && (
      path.includes(queryText) || heading.includes(queryText) || String(chunk.text).includes(queryText)
    ) ? weights.exact : 0,
    title: coverageScore(heading, queryTerms) * weights.title,
    path: (coverageScore(path, queryTerms) * weights.path) + Math.max(pathIdentifier, pathAlias),
    path_identifier: pathIdentifier,
    path_alias: pathAlias,
    identifier: overlapScore(identifierTerms, queryPlan.terms) * weights.identifier,
    identifierTerms: queryPlan.terms.filter((term) => identifierTerms.includes(term)),
    aliasPathMatches,
    term_coverage: tokenCoverage(chunk, path, heading, unique([...queryTerms, ...queryPlan.terms])),
  };
}

function tokenCoverage(chunk, path, heading, terms) {
  if (!terms.length) return 0;
  const hits = terms.filter((term) => (
    (chunk.termCounts?.[term] ?? 0) > 0 || path.includes(term) || heading.includes(term)
  )).length;
  return hits / terms.length;
}

function overlapScore(left, right) {
  if (!right.length) return 0;
  const values = new Set(left);
  return right.filter((term) => values.has(term)).length / right.length;
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

function scoreLifecycle(fields, nowValue, historicalQuery) {
  let score = fields.sourceScore;
  let recency = 1;
  if (fields.type === "daily") {
    if (Number.isFinite(fields.dailyTimestamp)) {
      const now = nowValue instanceof Date ? nowValue.getTime() : Number.isFinite(nowValue) ? nowValue : Date.now();
      const ageDays = Math.max(0, (now - fields.dailyTimestamp) / 86400000);
      recency = 0.35 + (0.65 * Math.exp(-ageDays / 90));
      score *= recency;
    }
  }
  if (fields.superseded) score *= 0.2;
  const historicalVersionMatch = fields.superseded
    && historicalQuery.historical
    && historicalQuery.versions.some((version) => fields.versions.includes(version));
  return {
    type: fields.type,
    score,
    recency,
    lifecycle: fields.superseded ? -1 : 0,
    multiplier: fields.superseded && !historicalVersionMatch ? 0.2 : 1,
    status: fields.status,
    topicKey: fields.topicKey,
  };
}

function applyReciprocalRankFusion(results) {
  const rankMaps = ["bm25", "vector", "structure"].map((channel) => {
    const ranked = [...results]
      .filter((result) => channelValue(result, channel) > 0)
      .sort((left, right) => channelValue(right, channel) - channelValue(left, channel));
    return new Map(ranked.map((result, index) => [result.id, index + 1]));
  });

  for (const result of results) {
    let rrf = 0;
    for (const ranks of rankMaps) {
      const rank = ranks.get(result.id);
      if (rank) rrf += 1 / (60 + rank);
    }
    result.scores.rrf = rrf;
    result.score = result.scores.linear + rrf + result.scores.source + result.scores.lifecycle;
  }
}

function applyHeterogeneousSourceCalibration(results, navigationQuery = false) {
  const heterogeneous = new Set(results.map((result) => result.source_type)).size > 1;
  for (const result of results) {
    const source = heterogeneous
      ? navigationQuery && result.source_type === "wiki_index"
        ? 1
        : (SOURCE_CALIBRATION[result.source_type] ?? 0.7)
      : 1;
    const coverage = heterogeneous ? 0.5 + (0.5 * (result.scores.term_coverage ?? 0)) : 1;
    const calibration = source * coverage;
    result.scores.calibration = calibration;
    if (result.explanation) {
      result.explanation.source_calibration = source;
      result.explanation.coverage_calibration = coverage;
    }
    result.score *= calibration
      * (result.scores.lifecycle_multiplier ?? 1)
      * (result.scores.version_specificity ?? 1);
  }
}

function channelValue(result, channel) {
  if (channel === "structure") {
    return result.scores.exact + result.scores.title + result.scores.path + result.scores.identifier;
  }
  return result.scores[channel] ?? 0;
}

export function grepIndex(index, pattern, options = {}) {
  const topK = positiveInteger(options.topK, 20);
  const maxChunksPerPath = positiveInteger(options.maxChunksPerPath, 3);
  const needle = String(pattern ?? "").toLowerCase();
  if (!needle) return [];
  const projectScope = resolveProjectScope(options);
  const matches = index.chunks
    .filter((chunk) => matchesProjectScope(chunk, projectScope))
    .filter((chunk) => `${chunk.path}\n${chunk.heading}\n${chunk.text}`.toLowerCase().includes(needle));
  const selected = [];
  const pathCounts = new Map();
  for (const chunk of matches) {
    const count = pathCounts.get(chunk.path) ?? 0;
    if (count >= maxChunksPerPath) continue;
    selected.push(chunk);
    pathCounts.set(chunk.path, count + 1);
    if (selected.length >= topK) break;
  }
  return selected.map((chunk) => toResult(chunk, 1, { bm25: 1, vector: 0 }));
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

function selectDiverseResults(results, topK, maxChunksPerPath, topicDiversity = true) {
  const limit = Number.isInteger(maxChunksPerPath) && maxChunksPerPath > 0 ? maxChunksPerPath : 1;
  const counts = new Map();
  const topics = new Set();
  const selected = [];
  for (const result of results) {
    const count = counts.get(result.path) ?? 0;
    if (count >= limit) continue;
    if (topicDiversity && result.topic_key && topics.has(result.topic_key)) continue;
    counts.set(result.path, count + 1);
    if (result.topic_key) topics.add(result.topic_key);
    selected.push(result);
    if (selected.length >= topK) break;
  }
  return selected;
}

function decorateConfidence(results, queryTokens) {
  const top = results[0]?.score ?? 0;
  const second = results[1]?.score ?? 0;
  const gap = top > 0 ? Math.max(0, (top - second) / top) : 0;
  results.forEach((result, index) => {
    const relative = top > 0 ? result.score / top : 0;
    const coverage = result.scores.term_coverage ?? 0;
    const exact = result.scores.exact > 0 ? 0.15 : 0;
    const value = Math.max(0, Math.min(1,
      (0.5 * relative) + (0.3 * coverage) + exact + (index === 0 ? 0.15 * gap : 0),
    ));
    result.confidence = {
      value: Math.round(value * 1000) / 1000,
      level: value >= 0.75 ? "high" : value >= 0.45 ? "medium" : "low",
      matched_terms: Math.round(coverage * queryTokens.length),
      query_terms: queryTokens.length,
    };
    delete result.topic_key;
  });
}

function attachAdjacentContext(index, results, maxChars, projectScope) {
  const positions = getIndexSearchCache(index, projectScope.scopeRoots).positions;
  for (const result of results) {
    const position = positions.get(result.id);
    if (!Number.isInteger(position)) continue;
    const before = index.chunks[position - 1];
    const after = index.chunks[position + 1];
    const budget = Math.max(0, maxChars);
    const half = Math.floor(budget / 2);
    const context = {};
    if (before?.path === result.path && matchesProjectScope(before, projectScope)) {
      context.before = summarize(before.text, half);
    }
    if (after?.path === result.path && matchesProjectScope(after, projectScope)) {
      context.after = summarize(after.text, budget - (context.before?.length ?? 0));
    }
    if (Object.keys(context).length) result.context = context;
  }
}

function getIndexSearchCache(index, scopeRoots = ["."]) {
  const cacheKey = [...scopeRoots].sort().join("\n");
  let caches = INDEX_SEARCH_CACHE.get(index);
  if (caches && caches.has(cacheKey)) return caches.get(cacheKey);
  caches ??= new Map();
  INDEX_SEARCH_CACHE.set(index, caches);
  const fields = new Map();
  const positions = new Map();
  const documentLifecycle = new Map();
  for (const chunk of index.chunks) {
    const lifecycle = parseDocumentLifecycle(chunk.text);
    if (lifecycle) documentLifecycle.set(chunk.path, lifecycle);
  }
  index.chunks.forEach((chunk, position) => {
    const normalizedPath = String(chunk.path ?? "").replaceAll("\\", "/").toLowerCase();
    const sourcePath = pathInsideMostSpecificScopeRoot(normalizedPath, scopeRoots);
    const body = String(chunk.text ?? "");
    let type = "document";
    let sourceScore = 0.55;
    if (sourcePath === "memory.md") [type, sourceScore] = ["memory", 0.95];
    else if (sourcePath.startsWith("tools/local-wiki-mcp/")) [type, sourceScore] = ["product_doc", 0.95];
    else if (isNavigationPath(sourcePath)) [type, sourceScore] = ["wiki_index", 0.7];
    else if (sourcePath.startsWith("wiki/")) [type, sourceScore] = ["wiki", 1];
    else if (sourcePath.startsWith("skills/") || sourcePath.includes("/.cursor/rules/")) [type, sourceScore] = ["rule", 0.9];
    else if (sourcePath.startsWith("workstates/")) [type, sourceScore] = ["workstate", 0.75];
    else if (sourcePath.startsWith("daily/")) [type, sourceScore] = ["daily", 0.55];
    else if (sourcePath.startsWith("docs/")) [type, sourceScore] = ["docs", 0.7];
    else if (sourcePath.startsWith("templates/")) [type, sourceScore] = ["template", 0.3];

    const statusMatch = body.match(/^(?:-\s*)?(?:status|状态):\s*([^\r\n]+)$/im);
    const chunkStatus = statusMatch?.[1]?.trim().toLowerCase() ?? "active";
    const chunkSuperseded = /^(superseded|archived|deprecated|obsolete)$/i.test(chunkStatus)
      || /^supersededBy:\s*\S+/im.test(body);
    const fileLifecycle = documentLifecycle.get(chunk.path);
    const superseded = fileLifecycle?.superseded || chunkSuperseded;
    const status = fileLifecycle?.superseded
      ? fileLifecycle.status
      : chunkSuperseded ? chunkStatus : fileLifecycle?.status ?? chunkStatus;
    const dateMatch = type === "daily" ? sourcePath.match(/(\d{4}-\d{2}-\d{2})\.md$/) : null;
    fields.set(chunk.id, {
      heading: normalizeText(chunk.heading),
      path: normalizeText(chunk.path),
      identifierTerms: rewriteQuery(`${chunk.path} ${chunk.heading}`).terms,
      type,
      sourceScore,
      status,
      superseded,
      versions: extractVersions(`${chunk.path} ${chunk.heading}`),
      dailyTimestamp: dateMatch ? Date.parse(`${dateMatch[1]}T00:00:00Z`) : null,
      topicKey: type === "daily"
        ? normalizeText(chunk.heading).replace(/^任务\d+[:：]?\s*/, "").replace(/\s+/g, " ").trim()
        : null,
    });
    positions.set(chunk.id, position);
  });
  const cache = { fields, positions };
  caches.set(cacheKey, cache);
  return cache;
}

function analyzeHistoricalQuery(query) {
  const text = normalizeText(query);
  return {
    historical: /(?:历史|追溯|旧版|旧版本|归档|曾经|当时|过往|historical|history|archived|previous|old version)/i.test(text),
    versions: extractVersions(query),
  };
}

function scoreVersionSpecificity(fields, historicalQuery) {
  if (!historicalQuery.historical || !historicalQuery.versions.length) return 1;
  return historicalQuery.versions.some((version) => fields.versions.includes(version)) ? 1 : 0.2;
}

function extractVersions(value) {
  return unique([...String(value ?? "").matchAll(/\bv?\d+(?:\.\d+)+\b/gi)]
    .map((match) => match[0].toLowerCase().replace(/^v/, "")));
}

function isNavigationPath(sourcePath) {
  return /^wiki\/(?:.+\/)?(?:index|log|project-map)\.md$/.test(sourcePath);
}

function isNavigationQuery(query) {
  return /(?:项目\s*(?:map|地图)|project[-\s]?map|知识(?:库)?索引|wiki\s*index|变更日志|wiki\s*log)/i.test(String(query ?? ""));
}

function parseDocumentLifecycle(body) {
  const frontmatter = String(body ?? "").match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|$)/)?.[1];
  if (!frontmatter) return null;

  const status = frontmatter.match(/^status\s*:\s*([^\r\n#]+)/im)?.[1]?.trim().toLowerCase() ?? "active";
  const archived = frontmatterHasTag(frontmatter, "archived");
  const supersededBy = /^supersededBy\s*:\s*\S+/im.test(frontmatter);
  const superseded = archived
    || supersededBy
    || /^(superseded|archived|deprecated|obsolete)$/i.test(status);

  return {
    status: archived ? "archived" : supersededBy && status === "active" ? "superseded" : status,
    superseded,
  };
}

function frontmatterHasTag(frontmatter, expectedTag) {
  const lines = String(frontmatter).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^tags\s*:\s*(.*)$/i.exec(lines[index]);
    if (!match) continue;
    if (metadataValueHasToken(match[1], expectedTag)) return true;
    if (match[1].trim()) return false;
    for (index += 1; index < lines.length && /^\s+/.test(lines[index]); index += 1) {
      if (metadataValueHasToken(lines[index], expectedTag)) return true;
    }
    return false;
  }
  return false;
}

function metadataValueHasToken(value, expectedToken) {
  return String(value)
    .toLowerCase()
    .replace(/^\s*-\s*/, "")
    .replace(/[\[\]'\"]/g, " ")
    .split(/[,\s]+/)
    .filter(Boolean)
    .includes(expectedToken);
}

function pathInsideMostSpecificScopeRoot(normalizedPath, scopeRoots) {
  const matches = scopeRoots
    .map((scopeRoot) => String(scopeRoot ?? ".").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "").toLowerCase() || ".")
    .map((scopeRoot) => {
      if (scopeRoot === ".") return { scopeRoot, relativePath: normalizedPath };
      if (normalizedPath === scopeRoot) return { scopeRoot, relativePath: "" };
      if (normalizedPath.startsWith(`${scopeRoot}/`)) {
        return { scopeRoot, relativePath: normalizedPath.slice(scopeRoot.length + 1) };
      }
      return null;
    })
    .filter(Boolean)
    .sort((left, right) => right.scopeRoot.length - left.scopeRoot.length);
  return matches[0]?.relativePath ?? normalizedPath;
}

function applyResultBudget(results, maxOutputTokens) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) return results;
  const selected = [];
  let used = 0;
  for (const result of results) {
    const cost = approximateTokens(JSON.stringify(result));
    if (selected.length && used + cost > maxOutputTokens) break;
    selected.push(result);
    used += cost;
  }
  return selected;
}

function approximateTokens(value) {
  const text = String(value ?? "");
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  return Math.max(1, Math.ceil(cjk + ((text.length - cjk) / 4)));
}

function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
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
