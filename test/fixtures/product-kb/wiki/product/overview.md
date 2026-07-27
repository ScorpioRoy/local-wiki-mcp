# local-wiki Product Overview

## Local-First Data Boundary

local-wiki runs on the user's machine. Runtime search requires no API key, hosted model, external service, Python process, native database, or network connection. Markdown remains local unless the user shares it separately.

## Hybrid Retrieval

Search combines BM25-like lexical scoring, character trigram cosine similarity, exact phrase boosts, heading coverage, and path coverage. These n-gram vectors are deterministic lexical features, not dense semantic embeddings.

Version 0.6 adds deterministic camelCase, snake_case, dotted path, and error-code query rewriting. Field-aware evidence and reciprocal-rank fusion preserve exact lexical ranking while improving structured matches. Stable wiki pages are preferred over old daily history; daily entries use time decay, repeated task topics collapse, and `supersededBy` or archived status lowers obsolete material.

## Supported Knowledge

The index reads Markdown, plain text, HTML, and HTM files. It handles Chinese phrases, English identifiers, configuration keys, error messages, API names, and file paths.

## Runtime Compatibility

The supported runtime is Node.js 20 or newer. Product CI covers Node.js 20, 22, and 24 on Windows, macOS, and Linux without runtime dependencies.

## Source Of Truth

Markdown files are the knowledge source of truth. `.local-wiki-index/index.json` is derived data that can be deleted and rebuilt; generated index content must not replace the original documents.
