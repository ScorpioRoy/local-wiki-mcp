import { performance } from "node:perf_hooks";

export async function rerankSearchResults(index, query, lexicalResults, config = {}, options = {}) {
  const topK = positiveInteger(options.topK, 8);
  const provider = config.provider ?? "none";
  const fallback = lexicalResults.slice(0, topK);

  if (provider === "none") {
    return {
      applied: false,
      provider,
      results: fallback,
      warning: "Local semantic reranking is not configured; lexical results were returned.",
    };
  }
  if (provider !== "ollama") {
    return {
      applied: false,
      provider,
      results: fallback,
      warning: `Unsupported reranker provider: ${provider}`,
    };
  }

  try {
    const baseUrl = assertLoopbackUrl(config.baseUrl);
    const candidates = lexicalResults.slice(0, positiveInteger(config.candidateLimit, 20));
    if (!candidates.length) return { applied: true, provider, results: [] };
    const chunks = new Map(index.chunks.map((chunk) => [chunk.id, chunk]));
    const input = [
      String(query),
      ...candidates.map((result) => candidateText(chunks.get(result.id), result)),
    ];
    const started = performance.now();
    const embeddings = await embedWithOllama(baseUrl, config, input, options.fetch);
    const queryEmbedding = embeddings[0];
    const maxLexical = Math.max(...candidates.map((result) => result.score), 1e-9);
    const semanticWeight = boundedNumber(config.semanticWeight, 0.35, 0, 1);
    const results = candidates.map((result, index) => {
      const semantic = cosine(queryEmbedding, embeddings[index + 1]);
      const lexicalNormalized = result.score / maxLexical;
      const rerankScore = ((1 - semanticWeight) * lexicalNormalized) + (semanticWeight * semantic);
      return {
        ...result,
        lexical_score: result.score,
        score: rerankScore,
        scores: {
          ...result.scores,
          lexical_normalized: lexicalNormalized,
          semantic,
        },
      };
    }).sort((left, right) => (
      right.score - left.score || right.lexical_score - left.lexical_score || left.path.localeCompare(right.path)
    )).slice(0, topK);

    return {
      applied: true,
      provider,
      model: config.model,
      candidate_count: candidates.length,
      semantic_weight: semanticWeight,
      duration_ms: round(performance.now() - started),
      results,
    };
  } catch (error) {
    return {
      applied: false,
      provider,
      results: fallback,
      warning: `Local semantic reranking failed; lexical results were returned: ${error.message}`,
    };
  }
}

export function assertLoopbackUrl(value) {
  let url;
  try {
    url = new URL(value ?? "http://127.0.0.1:11434");
  } catch {
    throw new Error("reranker.baseUrl must be a valid URL");
  }
  const host = url.hostname.toLowerCase();
  if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(host)) {
    throw new Error("reranker.baseUrl must use a loopback host");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("reranker.baseUrl must use http or https");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

async function embedWithOllama(baseUrl, config, input, fetchOverride) {
  const fetchImpl = fetchOverride ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this Node.js runtime");
  const timeoutMs = positiveInteger(config.timeoutMs, 5000);
  const response = await fetchImpl(new URL("api/embed", baseUrl), {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model ?? "nomic-embed-text",
      input,
      truncate: true,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Ollama embed returned HTTP ${response.status}`);
  const payload = await response.json();
  const embeddings = payload.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== input.length) {
    throw new Error("Ollama embed returned an invalid embeddings array");
  }
  const dimension = embeddings[0]?.length;
  if (!Number.isInteger(dimension) || dimension <= 0 || embeddings.some((embedding) => (
    !Array.isArray(embedding) || embedding.length !== dimension || embedding.some((value) => !Number.isFinite(value))
  ))) {
    throw new Error("Ollama embed returned invalid vector dimensions");
  }
  return embeddings;
}

function candidateText(chunk, result) {
  if (!chunk) return `${result.path}\n${result.heading}\n${result.snippet}`;
  return `${chunk.path}\n${chunk.heading}\n${chunk.text}`.slice(0, 6000);
}

function cosine(left, right) {
  let dot = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftSquared += left[index] ** 2;
    rightSquared += right[index] ** 2;
  }
  if (!leftSquared || !rightSquared) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftSquared * rightSquared)));
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
