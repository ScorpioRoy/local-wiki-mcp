# Troubleshooting Guide

## Codex TOML Path Failure

On Windows, backslashes inside TOML double-quoted strings can become illegal escapes. Generate the Codex snippet or use forward slashes and TOML single quotes for `config.toml` paths.

## Stale Search Results

When new Markdown is absent from results, run `local-wiki status` and then `local-wiki sync`. The `search_wiki` stale warning lists added, changed, and deleted files.

## Corrupt Or Missing Index

Run `local-wiki repair` when index JSON is missing or unreadable. Add `--force` for a full rebuild, then run `doctor` and `smoke` to verify readiness.

## Mojibake And UTF-8

Run `local-wiki audit` when Chinese text displays as replacement characters or common mojibake sequences. Verify the UTF-8 source before changing content because terminal rendering alone may be wrong.

## Restricted npm Cache

An `EPERM` error creating the user npm cache can occur in restricted Windows environments. Clean package verification uses an isolated temporary npm cache inside its controlled workspace.
