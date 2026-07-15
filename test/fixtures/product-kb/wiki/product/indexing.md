# Indexing Internals

## Compact Index Version 3

Index v3 stores `tokenCount` and precomputed `vectorNorm`, omits legacy token arrays, writes compact JSON, and validates chunk search features when loading.

## Incremental Fast Path

Incremental sync compares file mtime and size first. Unchanged files reuse their existing chunk ids, term counts, trigram vectors, and SHA-256 metadata without rereading content.

## Strict Hash Verification

Strict freshness reads every configured source and compares SHA-256 content hashes. It detects edits whose timestamp and byte size were preserved.

## Atomic Writes And Locking

Index saves use a temporary file followed by atomic rename. `index.lock` prevents concurrent writers and permits recovery of locks older than ten minutes.

## MCP Memory Cache

The MCP index store caches parsed JSON and reloads only when index-file metadata changes. A separate freshness TTL avoids rescanning all source paths on every search call.
