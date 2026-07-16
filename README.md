# local-wiki-mcp

`local-wiki-mcp` 是面向 Codex、Cursor 和其他 MCP 客户端的本地 Markdown 知识库检索工具。它默认只在本机运行，不需要外接大模型 API key、托管服务、Python、原生数据库或向量数据库。

English documentation: [README.en.md](README.en.md)

它适合 `agent-memory`、LLM Wiki 和团队内部技术知识库：

- 将本地 Markdown、文本和 HTML 构建为 `.local-wiki-index/index.json`。
- 使用 BM25 风格词项评分、字符 n-gram 余弦相似度、精确短语、标题和路径加权进行混合检索。
- 稳定覆盖中文知识、英文标识符、配置项、报错、API 名和文件路径。
- 提供稳定的只读 MCP 工具：`search_wiki`、`grep_wiki`、`read_wiki`、`status_wiki`。
- 支持真正增量的 `sync`、MCP 进程内缓存、路径去重和索引过期提示。
- 提供配置校验、详细诊断、索引指标、检索解释、评测、打包验证和 watch 耐久性测试。

## 环境要求

- Node.js 20 或更高版本。
- 一个本地 Markdown 知识库目录。
- 默认运行不需要外部模型、向量数据库或 API key。

## 快速开始

在源码目录进行本地全局安装：

```powershell
npm install -g .
```

初始化并验证知识库：

```powershell
local-wiki version
local-wiki init --root D:\path\to\agent-memory --template agent-memory
local-wiki config validate --root D:\path\to\agent-memory
local-wiki index --root D:\path\to\agent-memory
local-wiki smoke --root D:\path\to\agent-memory
local-wiki search "Codex MCP 本地知识库" --root D:\path\to\agent-memory
```

知识库发生日常修改后执行增量刷新：

```powershell
local-wiki sync --root D:\path\to\agent-memory
```

索引缺失、损坏或需要完整重建时：

```powershell
local-wiki repair --root D:\path\to\agent-memory --force
local-wiki doctor --root D:\path\to\agent-memory --verbose
```

## 配置文件

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
  },
  "mcpCache": {
    "reloadCheckTtlMs": 1000,
    "freshnessTtlMs": 5000
  },
  "watch": {
    "intervalMs": 2000,
    "strictEvery": 30
  }
}
```

命令行参数会覆盖配置文件：

```powershell
local-wiki index --root . --include wiki --index-dir .custom-index --max-chars 1800
```

默认索引 `wiki` 和 `MEMORY.md`。内置跳过目录包括 `.git`、`.state`、`.local-wiki-index` 和 `node_modules`。

启动 MCP 前建议执行：

```powershell
local-wiki config validate --root .
local-wiki doctor --root . --verbose
local-wiki status --root . --strict --metrics
```

`config validate` 会报告 JSON 语法错误、非法数值、未知字段、缺失 include 和逃出知识库根目录的路径。即使用户跳过校验，索引读写仍会拒绝越界的 `indexDir` 和符号链接目录。

## 命令概览

```text
version [--json]                         显示产品、索引和运行时版本
init    [--root DIR] [--template NAME]   创建 agent-memory 或 minimal 骨架
index   [--root DIR] [--include PATH]    完整构建本地 JSON 索引
sync    [--root DIR] [--include PATH]    增量刷新索引
search  <query> [--root DIR]             混合检索并默认按路径去重
explain <query> [--root DIR]             解释查询分析和结果评分
grep    <pattern> [--root DIR]           精确子字符串检索
read    <path-or-id> [--root DIR]        读取索引片段
status  [--root DIR] [--strict]          查看索引元数据和过期状态
        [--metrics]                      输出索引大小和密度指标
doctor  [--root DIR] [--verbose]         诊断运行时、配置、索引和 MCP
repair  [--root DIR] [--force]           重建缺失、损坏或过期索引
bench   [--root DIR] [--query TEXT]      测量加载和检索延迟
eval    [--root DIR] --fixture FILE      运行检索质量评测
        [--variant-set NAME] [--summary] 选择 query 集并省略逐条结果
smoke   [--root DIR]                     验证索引和 MCP 检索是否可用
watch   [--root DIR] [--interval-ms N]   自动同步知识文件变化
config  codex|cursor [--root DIR]        输出 MCP 配置片段
config  validate [--root DIR]            校验配置值和源路径
audit   [--root DIR]                     检查乱码和遗留 qmd 规则
serve   [--root DIR] [--watch]           启动 MCP stdio 服务
```

`explain` 适合排查排名异常。它会输出规范化查询、token、trigram 数量、启用权重、BM25/vector/boost 分项、命中词项和多样性过滤情况，但不会修改索引。

## MCP 工具

### `search_wiki`

用于概念、决策、方案、历史经验和工作流知识：

```json
{
  "query": "Codex MCP 本地知识库",
  "top_k": 8,
  "max_chunks_per_path": 1,
  "diversity": true
}
```

索引过期时响应会带有：

```json
{
  "warning": {
    "stale": true,
    "message": "The local-wiki index is stale. Run `local-wiki sync` to refresh it.",
    "added": [],
    "changed": [],
    "deleted": []
  }
}
```

### `grep_wiki`

用于配置键、报错、路径、类名、函数名和其他精确文本：

```json
{
  "pattern": "config.toml",
  "top_k": 20
}
```

### `read_wiki`

按完整路径、路径后缀或 chunk id 读取索引文本：

```json
{
  "target": "wiki/cursor/memory-wiki-system.md",
  "max_chars": 12000
}
```

### `status_wiki`

返回索引版本、创建时间、chunk 数、include 和 added/changed/deleted 状态。设置 `strict: true` 会对当前源文件执行完整哈希校验。

普通搜索使用短时 freshness cache，避免每次 MCP 调用都扫描整个知识库。

## 自动刷新

单独运行 watcher：

```powershell
local-wiki watch --root . --interval-ms 2000
```

或者显式允许 MCP 服务自动刷新：

```powershell
local-wiki serve --root . --watch
```

默认 `serve` 始终只读。只有显式 `--watch` 才会自动写索引。watch 使用原子写入、索引操作锁、mtime/size 快速检查和周期严格哈希。

## Codex 配置

生成安全的 TOML 片段：

```powershell
local-wiki config codex --root D:\path\to\agent-memory
```

示例：

```toml
[mcp_servers.local_wiki]
command = 'node'
args = ['D:/path/to/local-wiki-mcp/src/cli.js', 'serve', '--root', 'D:/path/to/agent-memory']
startup_timeout_sec = 10
tool_timeout_sec = 30
enabled = true
enabled_tools = ['search_wiki', 'grep_wiki', 'read_wiki', 'status_wiki']
```

Windows 路径使用正斜杠或 TOML 单引号，避免反斜杠触发非法转义。

## Cursor 配置

生成 Cursor MCP 片段：

```powershell
local-wiki config cursor --root D:\path\to\agent-memory
```

示例：

```json
{
  "mcpServers": {
    "local-wiki": {
      "command": "node",
      "args": [
        "D:/path/to/local-wiki-mcp/src/cli.js",
        "serve",
        "--root",
        "D:/path/to/agent-memory"
      ]
    }
  }
}
```

配置生成命令只输出片段，不会自动修改 Codex 或 Cursor 的全局配置。

## Benchmark 与 Eval

延迟测试：

```powershell
local-wiki bench --root . --query "local-wiki Product v1.3" --iterations 20
```

自定义评测 fixture：

```json
[
  {
    "query": "Codex MCP 本地知识库",
    "expected": ["wiki/cursor/memory-wiki-system.md"],
    "top_k": 3
  }
]
```

运行质量门禁：

```powershell
local-wiki eval --root . --fixture eval.json --summary --min-top1 0.85 --min-top5 0.97 --max-duplicate-rate 0.1
```

`eval` 输出 top1/top3/top5/topK、分类指标、重复路径率、空结果、平均延迟和 p50/p95，并在阈值失败时以退出码 3 结束。

仓库包含完全脱敏、自包含的产品语料：

```powershell
# 150 条基础查询和意图噪声查询，作为发布门禁
npm run test:eval

# 150 条包含不同词汇改写的语义挑战集
npm run eval:semantic
```

`semantic` 集合用于量化可选本地 embedding/reranker 能改善的空间，不作为当前词法检索版本的发布门禁。私有 agent-memory 集成 fixture 不进入产品仓库。

## 分发与发布检查

```powershell
npm run ci
npm run test:soak
npm run soak:watch
```

- `test:pack` 会生成真实 `.tgz`，安装到全新临时项目，再执行 init、配置校验、索引和 smoke。
- `test:soak` 是短时 CI 变更测试。
- `soak:watch` 默认运行 12 小时。
- 发布流程、远程元数据、npm provenance、标签和回滚要求见 [RELEASING.md](RELEASING.md)。

## 从 qmd 迁移

详见 [MIGRATION_FROM_QMD.md](MIGRATION_FROM_QMD.md)。简要对应关系：

- embedding 构建改为 `local-wiki index`。
- 日常更新改为 `local-wiki sync`。
- collection 改为知识库根目录和 `.local-wiki.json`。
- Prompt 和规则继续使用 `search_wiki`、`grep_wiki`、`read_wiki`、`status_wiki`。

## 排障与安全

- 排障说明：[TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- 安全说明：[SECURITY.md](SECURITY.md)
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)

修改规则或文档后运行：

```powershell
local-wiki audit --root .
```
