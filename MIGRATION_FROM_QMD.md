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
| 持续监听新增与修改 | `local-wiki watch --root <MEMORY_ROOT>` |
| 生成紧凑启动上下文 | `local-wiki context --root <MEMORY_ROOT>` |
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
    "path": 1,
    "identifier": 1.25,
    "source": 0.75
  },
  "queryAliases": {
    "旧知识库": ["qmd", "local-wiki", "迁移"]
  }
}
```

`queryAliases` 是可选的确定性领域同义词，不依赖 embedding 或 API key。迁移时只加入经过 eval 验证的稳定叫法，避免把宽泛通用词映射到单一产品文档。

## MCP 工具名

Prompt 和规则继续使用以下稳定工具名：

- `search_wiki`
- `grep_wiki`
- `read_wiki`
- `status_wiki`

## 准确性说明

qmd 可以使用 dense embedding 和 reranking。当前 `local-wiki-mcp` 使用确定性的 BM25 风格词项、字符 n-gram、精确短语、标题和路径加权，适合本地 Markdown、配置名、路径、中文短语和项目笔记。

v0.6.0 使用字段化 BM25、确定性标识符改写、可配置领域 alias、轻量 RRF、来源层级和 daily 时间衰减提高无模型排序。默认检索仍然零 API key、零模型下载；需要加强跨措辞排序时，仍可显式配置仅限 loopback 的 Ollama embedding reranker。reranker 超时、模型缺失或响应异常时会自动回退词法结果，不改变四个 MCP 工具名。

从 qmd 的自动更新流程迁移时，推荐只运行一个 `local-wiki daemon --watch`，Codex/Cursor 使用 `serve --daemon` 共享索引；daemon 不可用时自动回退直接检索。Windows 可使用 `local-wiki runtime install` 或产品包内脚本安装当前用户启动项。
