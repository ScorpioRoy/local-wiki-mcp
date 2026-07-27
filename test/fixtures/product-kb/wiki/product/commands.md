# CLI Command Guide

## Setup Commands

Use `local-wiki version`, `init`, `config validate`, `index`, and `smoke` to initialize and verify a new knowledge base.

## Retrieval Commands

Use `search` for hybrid concept retrieval, `grep` for exact substrings, `read` for indexed chunks, and `explain` for query tokens and score evidence.

## Refresh Commands

Use `sync` after normal edits, `watch` for automatic polling, and `repair --force` for a missing, corrupt, legacy, or deliberately rebuilt index.

## Inspection Commands

Use `status --strict --metrics` for freshness and index density. Use `doctor --verbose` for runtime, config, lock, index, and MCP tool diagnostics.

Use `doctor --fix` for reversible derived-index repair. Use `runtime status`, `runtime stop`, `runtime install`, and `runtime uninstall` to inspect or manage the shared Windows current-user runtime. Runtime logs rotate at five megabytes.

## Quality Commands

Use `bench` for load and latency timing, `eval` for top1/top3/top5 quality, `audit` for mojibake and legacy rules, and `serve` for MCP stdio.
