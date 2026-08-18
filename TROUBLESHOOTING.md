# 排障指南

## `bind` 预览后没有写入配置

这是默认安全行为。先确认输出中的 `ok`、知识库根、Codex/Cursor 配置路径和动作；只有 `ok: true` 时才显式增加 `--apply`。`--initialize`、`--refresh` 和 `--install-runtime` 在预览模式下也不会执行。

## `bind` 报告已有冲突配置

- Codex 已存在未被 `local-wiki-mcp managed` 标记的 `[mcp_servers.local_wiki]` 时，工具不会接管。
- Cursor 已存在内容不同的 `mcpServers.local-wiki` 时，工具不会覆盖。
- 先核对现有配置和绑定预览；确需切换根目录时，人工移除或迁移冲突项后重新运行。不要直接删除整个 Codex/Cursor 配置文件。
- 预览会返回具体客户端的 `error`，且不会先创建知识库或索引；先修复错误并重新预览，不要跳过门禁。
- 成功写入前会在同目录创建 `.bak-<时间>-<pid>` 备份；备份可能包含其它客户端配置，应按用户配置同等级保护。

## macOS LaunchAgent 未启动

```bash
local-wiki runtime status --root "$HOME/agent-memory"
launchctl print "gui/$(id -u)/com.local-wiki-mcp.runtime"
```

确认 `~/Library/LaunchAgents/com.local-wiki-mcp.runtime.plist` 存在、Node 路径仍有效，并检查知识库 `.state/local-wiki-runtime.log`。Node 升级或安装路径变化后，重新运行 `runtime install` 生成 LaunchAgent；需要先移除时使用 `runtime uninstall`。

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

需要自动刷新时，推荐独立运行一个 `local-wiki watch --root <ROOT>`。多个 `serve --watch` 会通过 `watch.lock` 复用同一个 writer。

## 索引缺失或损坏

```powershell
local-wiki repair --root D:\path\to\agent-memory
local-wiki doctor --root D:\path\to\agent-memory --verbose
```

需要完整重建时增加 `--force`。

索引 v2 仍可读取；运行 `local-wiki sync` 会升级为紧凑 index v3。

## 提示已有索引操作运行

`index`、`sync`、`repair` 和 watch 更新使用 `.local-wiki-index/index.lock`。等待当前操作结束。超过十分钟的锁会被视为 stale lock 并自动恢复。

## 提示已有 watcher 运行

`.local-wiki-index/watch.lock` 记录当前 watcher PID。进程仍存在时不要删除该锁；PID 已失效时，新 watcher 会自动恢复。运行 `doctor --verbose` 可查看 watch lock 状态。

## Shared runtime 不可用或进入 fallback

运行 `local-wiki runtime status --root <ROOT>` 查看 `active` 与 `reachable`。显式使用 `serve --daemon` 时，bridge 会先复用现有 daemon；不存在时自动成为临时 owner，启动 runtime 和 watcher，owner 退出后其它 bridge 会在下一次调用时接管。只有自动接管也失败时才回退直接索引，并在 MCP 响应中返回 `runtime.mode=fallback`。也可以单独运行 `local-wiki daemon --root <ROOT> --watch` 恢复长期共享模式；失效状态文件和锁由新 runtime 自动清理。不要把 `.local-wiki-index/runtime.json` 上传或写入日志，其中包含本地认证 token。

## `doctor --fix` 的边界

`doctor --fix` 只重建缺失、损坏、旧版或过期的派生索引，不修改 Markdown、Codex/Cursor 配置或系统启动项。配置 JSON 无效、根目录不可访问等问题仍需人工处理。

## 本地语义重排没有生效

先确认 `.local-wiki.json` 的 `reranker.provider` 为 `ollama`，并在本机准备对应模型。`baseUrl` 必须是 loopback 地址。搜索响应中的 `reranker.warning` 表示已安全回退到词法结果，不会导致搜索失败。

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
    "expected": ["wiki/common/memory-wiki-system.md"],
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

先改善标题，并把重要概念维护在稳定 Wiki 页面而不是只写 daily。稳定的领域同义词可写入 `.local-wiki.json` 的 `queryAliases`；alias 只在查询包含配置键时展开，并提供独立 `bm25_alias` 与 `path_alias` 证据。配置后应重跑基础与语义 eval，避免过宽 alias 引入误召回。只有在评测证明有必要时再调整全局 `searchWeights`。

排名异常时查看具体证据：

```powershell
local-wiki explain "your query" --root D:\path\to\agent-memory --top-k 5
```

使用仓库脱敏 fixture 的 `--variant-set semantic` 可以把语义改写召回与普通词法门禁分开测量。

## npm 缓存出现 EPERM

受限 Windows 环境可能无法写用户 npm cache。仓库的 `test:pack` 使用受控临时目录和隔离缓存；手工命令可通过 `--cache <可写目录>` 指定缓存。
