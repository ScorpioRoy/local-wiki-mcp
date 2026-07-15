# local-wiki-mcp

`local-wiki-mcp` 是面向 Codex、Cursor 和其他 MCP 客户端的本地 Markdown 知识库检索工具。它只依赖 Node.js 20+，不需要外接大模型 API key、向量数据库、Python 或原生依赖。

## 核心能力

- BM25 风格词项评分、字符 n-gram 余弦相似度、精确短语、标题和路径加权的混合检索。
- 对中文知识、英文标识符、配置项、报错、文件路径和 API 名称都有稳定覆盖。
- 紧凑 index v3、真正增量 `sync`、MCP 进程内缓存和默认路径去重。
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

## 配置与诊断

配置文件位于知识库根目录的 `.local-wiki.json`。接入 AI 工具前建议运行：

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
