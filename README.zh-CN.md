# local-wiki-mcp

> 中文主文档已经统一到 [README.md](README.md)。本文件保留为旧链接兼容和简版快速指南。

`local-wiki-mcp` 是面向 Codex、Cursor 和其他 MCP 客户端的本地 Markdown 知识库检索工具。它只依赖 Node.js 20+，不需要外接大模型 API key、向量数据库、Python 或原生依赖。

## 核心能力

- BM25 风格词项评分、字符 n-gram 余弦相似度、精确短语、标题和路径加权的混合检索。
- 对中文知识、英文标识符、配置项、报错、文件路径和 API 名称都有稳定覆盖。
- 紧凑 index v3、真正增量 `sync`、MCP 进程内缓存和默认路径去重。
- `context` 紧凑启动上下文、单实例 watcher 和空闲索引卸载。
- 默认关闭、仅限 loopback 且拒绝重定向的 Ollama 本地语义重排。
- 无模型字段化排序、历史来源治理、置信度和默认 2000 token 结果预算。
- 单实例共享 daemon、随机 token 鉴权和 daemon 故障时的直接检索回退。
- 稳定的只读 MCP 工具：`search_wiki`、`grep_wiki`、`read_wiki`、`status_wiki`。
- `doctor`、`repair`、`watch`、`bench`、`eval`、`smoke`、`audit` 等产品运维命令。

## 快速开始

在源码目录本地安装：

```powershell
npm install -g .
local-wiki version
local-wiki init --root D:\path\to\agent-memory --template agent-memory
local-wiki index --root D:\path\to\agent-memory
local-wiki smoke --root D:\path\to\agent-memory
```

知识库新增或修改后执行增量刷新：

```powershell
local-wiki sync --root D:\path\to\agent-memory
```

需要自动刷新时，单独运行 watcher：

```powershell
local-wiki watch --root D:\path\to\agent-memory
```

默认 `serve` 只读；只有显式 `serve --watch` 才会自动写索引。

推荐运行 `local-wiki daemon --root . --watch`，并让 Codex/Cursor 使用 `serve --daemon`。共享 runtime 不可用时会自动回退直接本地检索。

全局安装后，可安装当前用户 Windows 启动项：

```powershell
$packageRoot = npm root -g
powershell -File "$packageRoot\local-wiki-mcp\scripts\install-windows-watch.ps1" -Root D:\path\to\agent-memory
```

## 配置与诊断

配置文件位于知识库根目录的 `.local-wiki.json`。接入 AI 工具前建议运行：

知识库存在稳定的领域同义词时，可使用确定性的 `queryAliases`，不需要模型或 API key：

```json
{
  "queryAliases": {
    "旧知识库": ["qmd", "local-wiki", "迁移"]
  }
}
```

alias 只在查询包含左侧短语时展开；建议用 eval 验证后再加入，避免配置过宽的通用词。

```powershell
local-wiki config validate --root D:\path\to\agent-memory
local-wiki doctor --root D:\path\to\agent-memory --verbose
local-wiki status --root D:\path\to\agent-memory --strict --metrics
```

检索结果不符合预期时，可以查看每一项分数及命中证据：

```powershell
local-wiki explain "Codex MCP 配置" --root D:\path\to\agent-memory
```

## Codex 与 Cursor

生成配置片段，不会自动修改全局配置：

```powershell
local-wiki config codex --root D:\path\to\agent-memory
local-wiki config cursor --root D:\path\to\agent-memory
```

Windows 的 Codex TOML 路径使用正斜杠或单引号，避免反斜杠被解析成非法转义。完整命令、MCP 参数、评测和安全说明见 [README.md](README.md)、[TROUBLESHOOTING.md](TROUBLESHOOTING.md) 与 [SECURITY.md](SECURITY.md)。
