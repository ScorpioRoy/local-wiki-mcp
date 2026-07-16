# 从 qmd 迁移

`local-wiki-mcp` 为需要在 Codex、Cursor 或其他 MCP 客户端中稳定检索本地 Markdown 的团队提供本地优先替代路径。

## 主要变化

- qmd 命令改为 `local-wiki` 命令。
- collection 改为知识库根目录和 `.local-wiki.json`。
- 不需要外部 API key。
- 不需要原生 SQLite、Python、GGUF 模型或外部向量数据库。

## 命令对应

| qmd 工作流 | local-wiki 工作流 |
| --- | --- |
| 构建 embeddings | `local-wiki index --root <MEMORY_ROOT>` |
| 编辑后刷新 | `local-wiki sync --root <MEMORY_ROOT>` |
| 检索 collection | `local-wiki search "<query>" --root <MEMORY_ROOT>` |
| 精确检索 | `local-wiki grep "<text>" --root <MEMORY_ROOT>` |
| 查看状态 | `local-wiki status --root <MEMORY_ROOT>` |
| 诊断配置 | `local-wiki doctor --root <MEMORY_ROOT> --verbose` |

## 推荐配置

在知识库根目录创建 `.local-wiki.json`：

```json
{
  "includes": ["wiki", "MEMORY.md"],
  "exclude": ["raw/private", "*.draft.md"],
  "indexDir": ".local-wiki-index",
  "maxChunkChars": 2400,
  "searchWeights": {
    "exact": 3,
    "title": 1.5,
    "path": 1
  }
}
```

## MCP 工具名

Prompt 和规则继续使用以下稳定工具名：

- `search_wiki`
- `grep_wiki`
- `read_wiki`
- `status_wiki`

## 准确性说明

qmd 可以使用 dense embedding 和 reranking。当前 `local-wiki-mcp` 使用确定性的 BM25 风格词项、字符 n-gram、精确短语、标题和路径加权，适合本地 Markdown、配置名、路径、中文短语和项目笔记。

v0.4 评测将意图噪声检索和语义改写分开统计，避免把 n-gram 误称为语义向量。后续可以在不改变 MCP 工具名、不强制 API key 和外部服务的前提下增加可选本地 embedding provider。
