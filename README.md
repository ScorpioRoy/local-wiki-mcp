# local-wiki-mcp

[![CI](https://github.com/ScorpioRoy/local-wiki-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ScorpioRoy/local-wiki-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/local-wiki-mcp.svg)](https://www.npmjs.com/package/local-wiki-mcp)
[![license](https://img.shields.io/npm/l/local-wiki-mcp.svg)](LICENSE)

`local-wiki-mcp` 是面向 Codex、Cursor 和其他 MCP 客户端的本地 Markdown 知识库检索工具。它默认只在本机运行，不需要外接大模型 API key、托管服务、Python、原生数据库或向量数据库。

English documentation: [README.en.md](README.en.md)

它适合 `agent-memory`、LLM Wiki 和团队内部技术知识库：

- 将本地 Markdown、文本和 HTML 构建为 `.local-wiki-index/index.json`。
- 使用 BM25 风格词项评分、字符 n-gram 余弦相似度、精确短语、标题和路径加权进行混合检索。
- 稳定覆盖中文知识、英文标识符、配置项、报错、API 名和文件路径。
- 提供稳定的只读 MCP 工具：`search_wiki`、`grep_wiki`、`read_wiki`、`status_wiki`。
- 支持真正增量的 `sync`、MCP 进程内缓存、路径去重和索引过期提示。
- 使用字段化 BM25、确定性标识符改写、轻量 RRF、来源分层、异构来源校准和 daily 时间衰减改善无模型排序。
- 提供 `context` 紧凑启动上下文、单实例 watcher 和 MCP 空闲索引卸载。
- 提供单实例 loopback daemon 与轻量 MCP bridge，多个 Codex/Cursor 共享一份解析索引。
- 可选使用仅限 loopback 的 Ollama embedding 对词法候选重排，默认关闭且失败自动回退。
- 提供配置校验、详细诊断、索引指标、检索解释、评测、打包验证和 watch 耐久性测试。

## 环境要求

- Node.js 20 或更高版本。
- 一个本地 Markdown 知识库目录。
- 默认运行不需要外部模型、向量数据库或 API key。

## 快速开始

安装公开发布版本：

```powershell
npm install -g local-wiki-mcp@0.7.0
```

离线或受控环境也可以安装 GitHub Release 附带 SHA-256 和 manifest 的 `.tgz`：

```powershell
npm install -g .\local-wiki-mcp-0.7.0.tgz
```

也可在已审核源码目录进行本地全局安装：

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

完整的 `.tgz`、源码、npm 安装边界和卸载说明见 [INSTALLATION.md](INSTALLATION.md)。

## 一键绑定 Codex 与 Cursor

`bind` 默认只预览，不创建文件、不刷新索引，也不修改客户端配置：

```powershell
local-wiki bind --root D:\path\to\agent-memory --client codex --client cursor --initialize --refresh --daemon --install-runtime
```

确认根目录、配置路径和动作后才显式应用：

```powershell
local-wiki bind --root D:\path\to\agent-memory --client codex --client cursor --initialize --refresh --daemon --install-runtime --apply
```

预览会只读检查知识库与两个客户端的现有配置；冲突时返回 `ok: false` 且保持零写入。`--initialize` 默认只补齐轻量 `agent-memory` 骨架，不部署完整团队 Wiki、项目映射、Rules、Skills 或 Hooks；已有知识库通常省略该选项。`--refresh` 构建或刷新派生索引。写客户端配置前会在同目录创建备份；未托管的同名 Codex section、不同的 Cursor `local-wiki` 项或无效配置都会阻止写入。绑定结果使用当前 Node.js 的绝对路径，避免 GUI 客户端缺少终端 PATH。

Windows 和 macOS 薄包装脚本：

```powershell
$packageRoot = npm root -g
powershell -File "$packageRoot\local-wiki-mcp\scripts\Bind-LocalWikiKnowledgeBase.ps1" -Root D:\path\to\agent-memory -Initialize -Refresh -Daemon
```

```bash
PACKAGE_ROOT=$(npm root -g)
sh "$PACKAGE_ROOT/local-wiki-mcp/scripts/bind-knowledge-base-macos.sh" --root "$HOME/agent-memory" --client codex --client cursor --initialize --refresh --daemon
```

两个脚本同样默认预览；Windows 增加 `-Apply`、macOS 增加 `--apply` 才写入。

## 配置文件

在知识库根目录创建 `.local-wiki.json`：

```json
{
  "includes": ["wiki", "MEMORY.md"],
  "scopeRoots": ["."],
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
  },
  "projectGroups": {
    "support-suite": ["case-service", "data-sync", "support-web", "support-service", "admin-service", "workorder-service", "workorder-web"]
  },
  "mcpCache": {
    "reloadCheckTtlMs": 1000,
    "freshnessTtlMs": 5000,
    "idleUnloadMs": 300000
  },
  "reranker": {
    "provider": "none",
    "baseUrl": "http://127.0.0.1:11434",
    "model": "nomic-embed-text",
    "timeoutMs": 5000,
    "candidateLimit": 20,
    "semanticWeight": 0.35
  },
  "runtime": {
    "mode": "off",
    "timeoutMs": 1500,
    "requestLimitBytes": 1048576
  },
  "watch": {
    "intervalMs": 2000,
    "strictEvery": 30
  }
}
```

归档或已替代页面在普通现行查询中保持强降权。只有查询同时表达历史追溯意图、包含明确版本号，并且该版本匹配页面标题或路径时，对应历史页面才恢复正常最终倍率并优先于正文交叉引用。项目级 `index.md`、`log.md` 和 `project-map.md` 按导航页处理；明确查询项目 Map、知识索引或变更日志时仍可正常优先命中。

命令行参数会覆盖配置文件：

```powershell
local-wiki index --root . --include wiki --index-dir .custom-index --max-chars 1800
```

默认索引 `wiki` 和 `MEMORY.md`。内置跳过目录包括 `.git`、`.state`、`.local-wiki-index` 和 `node_modules`。

`scopeRoots` 声明项目路径和 common 路径的相对知识根，默认 `["."]`，因此继续识别根目录下的 `wiki/<project>/`。共享 Git Wiki 根内再嵌套个人 `agent-memory/` 时可配置 `[".", "agent-memory"]`，同时识别 `wiki/<project>/` 与 `agent-memory/wiki/<project>/`。该配置只控制项目 scope 识别；实际索引内容仍由 `includes` 决定。数组必须非空，且所有项必须是不得越出知识库根的相对路径。

`queryAliases` 用于维护当前知识库特有的确定性同义词。只有查询包含左侧短语时才展开右侧词项；alias 使用独立 BM25 与路径证据，不调用模型。建议只配置经过 eval 验证的稳定领域词，避免加入过宽的通用词。

`projectGroups` 用于表达一个业务项目由多个代码仓库组成。传业务项目 ID 或任一成员仓库 ID 时，响应统一回显业务项目 ID，并匹配业务项目 Wiki、成员仓库旧路径及历史 daily 项目元数据。同一成员只能属于一个项目组；按需依赖不要加入固定成员，应在查询时通过 `projects` 显式放开。

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
bind    [--root DIR] --client NAME        预览或应用 Codex/Cursor 知识库绑定
index   [--root DIR] [--include PATH]    完整构建本地 JSON 索引
sync    [--root DIR] [--include PATH]    增量刷新索引
context [--root DIR] [--days N]          输出紧凑启动上下文
        [--max-tasks N] [--max-chars N]
search  <query> [--root DIR] [--rerank]  混合检索并可选本地语义重排
        [--project NAME ...] [--no-common] [--global]
explain <query> [--root DIR]             解释查询分析和结果评分
grep    <pattern> [--root DIR]           精确子字符串检索
        [--project NAME ...] [--no-common] [--global]
read    <path-or-id> [--root DIR]        读取索引片段
status  [--root DIR] [--strict]          查看索引元数据和过期状态
        [--metrics]                      输出索引大小和密度指标
doctor  [--root DIR] [--verbose] [--fix] 诊断并修复可重建索引状态
repair  [--root DIR] [--force]           重建缺失、损坏或过期索引
bench   [--root DIR] [--query TEXT]      测量加载和检索延迟
eval    [--root DIR] --fixture FILE      运行检索质量评测
        [--variant-set NAME] [--summary] 选择 query 集并省略逐条结果
smoke   [--root DIR]                     验证索引和 MCP 检索是否可用
watch   [--root DIR] [--interval-ms N]   自动同步知识文件变化
daemon  [--root DIR] [--watch]           启动共享 loopback 检索运行时
runtime status|stop [--root DIR]         查看或停止共享运行时
runtime install|uninstall [--root DIR]   管理 Windows Startup 或 macOS LaunchAgent
config  codex|cursor [--root DIR]        输出 MCP 配置片段
config  validate [--root DIR]            校验配置值和源路径
audit   [--root DIR]                     检查乱码和遗留 qmd 规则
serve   [--root DIR] [--watch]           启动 MCP stdio 服务
```

`explain` 适合排查排名异常。它会输出规范化查询、token、trigram 数量、query rewrite、alias、启用权重、BM25/vector/boost 分项、异构来源校准、命中词项和多样性过滤情况，但不会修改索引。

## MCP 工具

### `search_wiki`

用于概念、决策、方案、历史经验和工作流知识：

```json
{
  "query": "Codex MCP 本地知识库",
  "project": "legacy-app",
  "top_k": 8,
  "max_chunks_per_path": 1,
  "diversity": true,
  "topic_diversity": true,
  "context_chars": 0,
  "max_output_tokens": 2000,
  "rerank": false
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
  "project": "legacy-app",
  "top_k": 20,
  "max_chunks_per_path": 3
}
```

`grep_wiki` 默认每个文件最多返回 3 个匹配 chunk，避免长文占满结果；需要更多或更少上下文时显式调整 `max_chunks_per_path`。CLI 使用 `--max-chunks-per-path`。

### 多项目检索隔离

项目任务应向 `search_wiki` 和 `grep_wiki` 传 `project`，跨项目联动则传 `projects` 白名单。项目范围是结果返回前的硬过滤：只保留每个 `scopeRoots` 下的 `wiki/<project>/`、chunk 内 `项目·模块:` / `project:` / `projects:` 匹配的内容，以及默认启用的 common 知识；同一 daily 文件中的其他项目 chunk 和相邻上下文也会被排除。

```json
{
  "query": "问卷需求",
  "projects": ["support-web", "support-service"],
  "include_common": true
}
```

未传 `project` / `projects` 时保持兼容，仍执行全库检索；也可显式传 `"scope": "global"`。只有明确不需要公共规则、模板和工具知识时才设置 `"include_common": false`。响应中的 `scope` 会回显实际项目白名单和 common 状态，便于调用方核验。

配置 `projectGroups` 后，成员仓库 ID 会规范化为业务项目。例如 `project: "support-web"` 可回显并检索为 `project: "support-suite"`；Legacy App 等按需依赖不应加入组内，联动时使用 `projects: ["support-suite", "legacy-app"]`。

命令行等价用法：

```powershell
local-wiki search "问卷需求" --root . --project legacy-app
local-wiki grep "QUESTIONNAIRE_API" --root . --project legacy-app --no-common
local-wiki search "联调问题" --root . --project support-web --project support-service
local-wiki search "全库问题" --root . --global
```

### `read_wiki`

按完整路径、路径后缀或 chunk id 读取索引文本：

```json
{
  "target": "wiki/common/memory-wiki-system.md",
  "max_chars": 12000
}
```

### `status_wiki`

返回索引版本、创建时间、chunk 数、include、added/changed/deleted 和当前 MCP 索引缓存状态。通过 daemon bridge 调用时还会标明 `runtime.mode`。设置 `strict: true` 会对当前源文件执行完整哈希校验。

普通搜索使用短时 freshness cache，避免每次 MCP 调用都扫描整个知识库。解析索引默认空闲 5 分钟后释放，下次调用按需重新加载。

## 紧凑启动上下文

```powershell
local-wiki context --root . --days 3 --max-tasks 12 --max-chars 8000
```

`context` 只机械读取 `MEMORY.md`，并提取时间窗口内 daily 的任务标题、项目模块和待办，不调用模型、不生成总结，也不修改 Markdown。适合替代会话启动时整页读取最近 daily；需要完整事实时再使用 `search_wiki`、`read_wiki` 或读取原文。

## 共享运行时与自动刷新

推荐为一个知识库运行一个共享 daemon：

```powershell
local-wiki daemon --root . --watch
```

Codex/Cursor 使用轻量 bridge：

```powershell
local-wiki serve --root . --daemon
```

daemon 只绑定 `127.0.0.1`，使用状态文件中的随机 token 鉴权，请求体默认上限 1MB。bridge 在 daemon 缺失、失效或超时时自动回退直接读取本地索引；配置 `runtime.mode=required` 或使用 `--no-fallback` 才会禁止回退。

单独运行 watcher：

```powershell
local-wiki watch --root . --interval-ms 5000
```

或者显式允许 MCP 服务自动刷新：

```powershell
local-wiki serve --root . --watch
```

默认 `serve` 始终只读。只有显式 `--watch` 才会自动写索引。watch 使用 `watch.lock` 保证一个知识库只有一个 watcher；并发 `serve --watch` 会复用已存在的 watcher，避免多个 Codex 任务重复扫描和抢写。失效 PID 锁会自动恢复。

生产使用建议让 daemon 独占 watcher，所有 Codex/Cursor MCP 使用 `serve --daemon`。Windows 全局安装后可将共享 runtime 加入当前用户启动项：

```powershell
$packageRoot = npm root -g
powershell -File "$packageRoot\local-wiki-mcp\scripts\install-windows-watch.ps1" -Root D:\path\to\agent-memory
```

macOS 使用当前用户 LaunchAgent：

```bash
local-wiki runtime install --root "$HOME/agent-memory"
```

Windows 日志写入知识库的 `.state/local-wiki-runtime.log` 并在达到 5MB 后轮转；Startup 包装器在 daemon 异常退出时按 5～60 秒退避重启，正常 `runtime stop` 不重启。macOS LaunchAgent 也写入同一路径。若系统策略阻止后台启动，显式使用 `serve --daemon` 的 Codex/Cursor bridge 会在启动时自动成为临时 runtime owner；owner 退出后，其它 bridge 会在下一次调用时接管，因此重启客户端不需要手动启动 daemon。普通 `serve` 仍保持只读且不会自动托管 runtime。`runtime uninstall` 仅移除当前用户 Startup/LaunchAgent，不删除 Markdown 或索引。

## 可选本地语义重排

默认 `reranker.provider` 为 `none`，不需要 Ollama 或模型。启用示例：

```json
{
  "reranker": {
    "provider": "ollama",
    "baseUrl": "http://127.0.0.1:11434",
    "model": "nomic-embed-text",
    "timeoutMs": 5000,
    "candidateLimit": 20,
    "semanticWeight": 0.35
  }
}
```

启用后，`search --rerank` 或 MCP `rerank: true` 会把查询与词法候选一次性发送到本机 `/api/embed`，再融合词法分数与余弦相似度。只允许 `localhost`、`127.0.0.1` 和 `::1`，并拒绝 HTTP 重定向；超时、模型缺失或响应异常时返回 warning，并保持原词法结果。工具不会自动安装 Ollama 或下载模型。

## Codex 配置

生成安全的 TOML 片段：

```powershell
local-wiki config codex --root D:\path\to\agent-memory --daemon
```

示例：

```toml
[mcp_servers.local_wiki]
command = 'node'
args = ['D:/path/to/local-wiki-mcp/src/cli.js', 'serve', '--root', 'D:/path/to/agent-memory', '--daemon']
startup_timeout_sec = 10
tool_timeout_sec = 30
enabled = true
enabled_tools = ['search_wiki', 'grep_wiki', 'read_wiki', 'status_wiki']
```

Windows 路径使用正斜杠或 TOML 单引号，避免反斜杠触发非法转义。

## Cursor 配置

生成 Cursor MCP 片段：

```powershell
local-wiki config cursor --root D:\path\to\agent-memory --daemon
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
        "D:/path/to/agent-memory",
        "--daemon"
      ]
    }
  }
}
```

配置生成命令只输出片段，不会自动修改 Codex 或 Cursor 的全局配置。需要安全合并配置时使用默认预览、显式 `--apply` 的 `local-wiki bind`。

## Benchmark 与 Eval

延迟测试：

```powershell
local-wiki bench --root . --query "local-wiki Product v1.4" --iterations 20
```

自定义评测 fixture：

```json
[
  {
    "query": "Codex MCP 本地知识库",
    "expected": ["wiki/common/memory-wiki-system.md"],
    "top_k": 3
  }
]
```

运行质量门禁：

```powershell
local-wiki eval --root . --fixture eval.json --summary --min-top1 0.85 --min-top5 0.97 --max-duplicate-rate 0.1
```

`eval` 输出 top1/top3/top5/topK、MRR、nDCG、结果 token、主题/路径重复率、低置信度率、空结果和延迟，并在阈值失败时以退出码 3 结束。

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
npm run bench:scale
```

- `test:pack` 会通过正式发布包生成器创建真实 `.tgz`、SHA-256 和 manifest，校验后安装到全新临时项目，再执行 init、配置校验、索引和 smoke。
- `release:package` 在 `dist/` 生成拒绝覆盖的 `.tgz`、SHA-256 和 manifest，供内部受控分享。
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
