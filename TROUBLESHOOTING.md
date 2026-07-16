# 排障指南

## 修改 `config.toml` 后 Codex 无法启动

Windows 路径使用 TOML 单引号或正斜杠：

```toml
[mcp_servers.local_wiki]
command = 'node'
args = ['D:/path/to/local-wiki-mcp/src/cli.js', 'serve', '--root', 'D:/path/to/agent-memory']
```

优先生成配置片段，不要手工拼接：

```powershell
local-wiki config codex --root D:\path\to\agent-memory
```

即使 JSON 已损坏，也可以单独校验知识库配置：

```powershell
local-wiki config validate --root D:\path\to\agent-memory
```

## 新增知识搜不到

```powershell
local-wiki status --root D:\path\to\agent-memory
local-wiki sync --root D:\path\to\agent-memory
```

`search_wiki` 返回 stale warning 时，正常处理方式是运行 `sync`。

需要自动刷新时，运行 `local-wiki watch --root <ROOT>`，或者显式使用 `serve --watch`。

## 索引缺失或损坏

```powershell
local-wiki repair --root D:\path\to\agent-memory
local-wiki doctor --root D:\path\to\agent-memory --verbose
```

需要完整重建时增加 `--force`。

索引 v2 仍可读取；运行 `local-wiki sync` 会升级为紧凑 index v3。

## 提示已有索引操作运行

`index`、`sync`、`repair` 和 watch 更新使用 `.local-wiki-index/index.lock`。等待当前操作结束。超过十分钟的锁会被视为 stale lock 并自动恢复。

## PowerShell 中文显示异常

先区分文件损坏和终端显示问题：

```powershell
local-wiki audit --root D:\path\to\agent-memory
```

audit 报告 mojibake 时，修复 Markdown 源文件并运行 `local-wiki sync`。audit 无异常时，不要只根据 PowerShell 显示覆盖文件。

## 评测质量偏低

创建小型 fixture：

```json
[
  {
    "query": "Codex MCP 本地知识库",
    "expected": ["wiki/cursor/memory-wiki-system.md"],
    "top_k": 3
  }
]
```

运行：

```powershell
local-wiki eval --root D:\path\to\agent-memory --fixture eval.json --summary
```

代表性足够后增加发布门禁：

```powershell
local-wiki eval --root D:\path\to\agent-memory --fixture eval.json --summary --min-top1 0.8 --min-top5 0.95 --max-duplicate-rate 0.1
```

调整 `.local-wiki.json` 的 `searchWeights`、改善标题，并把重要概念维护在稳定 Wiki 页面而不是只写 daily。

排名异常时查看具体证据：

```powershell
local-wiki explain "your query" --root D:\path\to\agent-memory --top-k 5
```

使用仓库脱敏 fixture 的 `--variant-set semantic` 可以把语义改写召回与普通词法门禁分开测量。

## npm 缓存出现 EPERM

受限 Windows 环境可能无法写用户 npm cache。仓库的 `test:pack` 使用受控临时目录和隔离缓存；手工命令可通过 `--cache <可写目录>` 指定缓存。
