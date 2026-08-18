# local-wiki-mcp

> 中文主文档已经统一到 [README.md](README.md)。本文件保留为旧链接兼容和简版快速指南。

`local-wiki-mcp` 是面向 Codex、Cursor 和其他 MCP 客户端的本地 Markdown 知识库检索工具。它只依赖 Node.js 20+，不需要外接大模型 API key、向量数据库、Python 或原生依赖。

## 核心能力

- BM25 风格词项评分、字符 n-gram 余弦相似度、精确短语、标题和路径加权的混合检索。
- 对中文知识、英文标识符、配置项、报错、文件路径和 API 名称都有稳定覆盖。
- 紧凑 index v3、真正增量 `sync`、MCP 进程内缓存和默认路径去重。
- `context` 紧凑启动上下文、单实例 watcher 和空闲索引卸载。
- 默认关闭、仅限 loopback 且拒绝重定向的 Ollama 本地语义重排。
- 无模型字段化排序、异构来源校准、历史来源治理、置信度和默认 2000 token 结果预算。
- 现行查询强降权归档页面，只有“历史意图 + 明确版本号 + 页面版本匹配”时放宽；项目导航页与普通业务页分开校准。
- 单实例共享 daemon、随机 token 鉴权和 daemon 故障时的直接检索回退。
- 稳定的只读 MCP 工具：`search_wiki`、`grep_wiki`、`read_wiki`、`status_wiki`。
- `search_wiki` 和 `grep_wiki` 支持项目硬隔离、跨项目白名单及默认 common 知识保留。
- `grep_wiki` 默认每个文件最多返回 3 个匹配 chunk，并支持显式调整。
- `scopeRoots` 支持在一个物理根下同时识别共享 `wiki/<project>/` 和嵌套个人 `agent-memory/wiki/<project>/`，默认 `["."]` 保持兼容。
- `local-wiki bind` 默认预览，可显式初始化、刷新并安全合并 Codex/Cursor 配置。
- `doctor`、`repair`、`watch`、`bench`、`eval`、`smoke`、`audit` 等产品运维命令。

## 快速开始

安装公开发布版本：

```powershell
npm install -g local-wiki-mcp@0.7.2
```

也可以安装 GitHub Release 中附带 SHA-256 和 manifest 的 tarball：

```powershell
npm install -g .\local-wiki-mcp-0.7.2.tgz
```

从已审核源码安装：

```powershell
npm install -g .
local-wiki version
local-wiki init --root D:\path\to\agent-memory --template agent-memory
local-wiki index --root D:\path\to\agent-memory
local-wiki smoke --root D:\path\to\agent-memory
```

一键绑定默认只预览：

```powershell
local-wiki bind --root D:\path\to\agent-memory --client codex --client cursor --initialize --refresh --daemon --install-runtime
```

预览会只读检查知识库和两个客户端配置；只有 `ok: true` 时才增加 `--apply`。`--initialize` 默认只补齐轻量 `agent-memory` 骨架，不部署完整团队 Wiki、项目映射、Rules、Skills 或 Hooks；已有知识库通常省略。写客户端配置前会生成备份；同名冲突或无效配置会停止，不会静默覆盖。完整安装、可校验分发包、Windows/macOS 包装脚本和卸载说明见 [INSTALLATION.md](INSTALLATION.md)。

知识库新增或修改后执行增量刷新：

```powershell
local-wiki sync --root D:\path\to\agent-memory
```

需要自动刷新时，单独运行 watcher：

```powershell
local-wiki watch --root D:\path\to\agent-memory
```

默认 `serve` 只读；只有显式 `serve --watch` 才会自动写索引。

推荐运行 `local-wiki daemon --root . --watch`，并让 Codex/Cursor 使用 `serve --daemon`。共享 runtime 不可用时，显式启用 daemon 的 bridge 会自动成为临时 owner；owner 退出后，其它 bridge 会在下一次调用时接管，因此重启 Codex/Cursor 不需要手动启动 daemon。只有自动接管失败时才回退直接本地检索；普通 `serve` 仍保持只读且不会启动 runtime。

多项目知识库中，项目任务应显式传项目 ID；不传项目参数时为兼容全局检索：

```powershell
local-wiki search "问卷需求" --root D:\path\to\agent-memory --project legacy-app
local-wiki grep "QUESTIONNAIRE_API" --root D:\path\to\agent-memory --project legacy-app
local-wiki search "联调问题" --root D:\path\to\agent-memory --project support-web --project support-service
local-wiki search "全库问题" --root D:\path\to\agent-memory --global
```

项目范围保留对应 `wiki/<project>/`、带匹配项目元数据的 daily chunk，以及默认 common 知识；使用 `--no-common` 可关闭 common。完整 MCP 参数见 [README.md](README.md)。

一个业务项目包含多个代码仓库时，可在 `.local-wiki.json` 配置 `projectGroups`。成员仓库 ID 会规范化为业务项目 ID，并兼容成员仓库旧路径和历史 daily 元数据；按需依赖不要加入固定项目组，联动时通过多个 `--project` 显式查询。

共享 Git Wiki 根内嵌个人记忆目录时，可同时配置 `"includes": ["wiki", "agent-memory"]` 与 `"scopeRoots": [".", "agent-memory"]`。`includes` 决定索引内容，`scopeRoots` 只决定项目/common 路径如何识别；所有知识根必须是不得越出根目录的相对路径。

全局安装后，可安装当前用户 Windows 启动项：

```powershell
$packageRoot = npm root -g
powershell -File "$packageRoot\local-wiki-mcp\scripts\install-windows-watch.ps1" -Root D:\path\to\agent-memory
```

macOS 可安装当前用户 LaunchAgent：

```bash
local-wiki runtime install --root "$HOME/agent-memory"
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
