export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC");
}

export function makeNgrams(value, size = 3) {
  const text = normalizeText(value).replace(/\s+/g, "");
  if (!text) return [];
  if (text.length <= size) return [text];

  const grams = [];
  for (let index = 0; index <= text.length - size; index += 1) {
    grams.push(text.slice(index, index + size));
  }
  return grams;
}

export function tokenize(value) {
  const text = normalizeText(value);
  const tokens = [];

  for (const match of text.matchAll(/[a-z0-9][a-z0-9._:/\\-]*/g)) {
    tokens.push(match[0]);
  }

  for (const match of text.matchAll(/[\p{Script=Han}]+/gu)) {
    const run = match[0];
    tokens.push(run);
    if (run.length > 1) {
      tokens.push(...makeNgrams(run, 2));
    }
    if (run.length > 2) {
      tokens.push(...makeNgrams(run, 3));
    }
  }

  return unique(tokens.filter(Boolean));
}

export function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

export function summarize(value, maxChars = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}
