# local-wiki-mcp 安装与知识库绑定

## 环境要求

- Node.js 20、22 或 24。
- 一个由当前用户可读写的本地 Markdown 知识库目录。
- 默认不需要 API key、外部模型、Python、原生数据库或向量数据库。

## 安装

公开发布版本直接从 npm 安装：

```powershell
npm install -g local-wiki-mcp@0.7.0
local-wiki version
```

GitHub Release 同时附带可校验的 `.tgz`、`.sha256` 和 `.manifest.json`。维护者从已审核源码生成同样的发布三件套：

```powershell
npm run release:package
```

命令在 `dist/` 生成同版本的三个文件，目标文件已存在时拒绝覆盖。离线或受控分发时三个文件必须一起交付。

安装前先核对 SHA-256。Windows：

```powershell
$expected = (Get-Content .\local-wiki-mcp-0.7.0.sha256).Split()[0]
$actual = (Get-FileHash .\local-wiki-mcp-0.7.0.tgz -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "local-wiki-mcp tarball SHA-256 mismatch" }
npm install -g .\local-wiki-mcp-0.7.0.tgz
local-wiki version
```

macOS：

```bash
shasum -a 256 -c local-wiki-mcp-0.7.0.sha256
npm install -g ./local-wiki-mcp-0.7.0.tgz
local-wiki version
```

manifest 用于核对包名、版本、文件数量、逐项路径和 npm integrity。不要只转发未附校验文件的 `.tgz`。

也可以从已审核源码安装：

```powershell
git clone https://github.com/ScorpioRoy/local-wiki-mcp.git
cd local-wiki-mcp
npm ci --ignore-scripts
npm run ci
npm install -g .
```

## 一键绑定

`bind` 默认只预览，不创建知识库、不刷新索引，也不修改 Codex/Cursor 配置：

```powershell
local-wiki bind --root D:\knowledge `
  --client codex --client cursor `
  --initialize --refresh --daemon --install-runtime
```

预览会验证知识库配置，并只读预检 Codex/Cursor 现有配置；发现无效配置或未托管冲突时返回 `ok: false`，且不会创建知识库、索引或客户端文件。只有预览为 `ok: true` 时才显式增加 `--apply`：

```powershell
local-wiki bind --root D:\knowledge `
  --client codex --client cursor `
  --initialize --refresh --daemon --install-runtime --apply
```

绑定行为：

- `--initialize` 默认使用轻量 `agent-memory` 骨架，只补齐 `.local-wiki.json`、`MEMORY.md`、`wiki/index.md`、`wiki/log.md`、`README.md`、`SCHEMA.md`、`daily/README.md` 和 `raw/README.md`，不覆盖已有 Markdown；`--template minimal` 只创建前四项。
- `--initialize` 不会部署团队 Wiki、完整 `agent-memory-template`、项目映射、Rules、Skills 或 Hooks。已有 Markdown 知识库通常省略该选项；完整体系应先部署相应模板，再执行绑定和刷新。
- `--refresh` 构建或增量刷新派生索引，并执行 smoke 验证。
- Codex 使用受标记的托管 TOML 区块；Cursor 只增加 `mcpServers.local-wiki`。
- 绑定配置写入当前 Node.js 的绝对路径，避免 GUI 客户端缺少终端 PATH。
- 写入已有客户端配置前创建带时间戳的同目录备份。
- 发现未托管的 Codex 同名 section、Cursor 同名冲突或无效配置时停止，不静默覆盖。
- `--install-runtime` 必须与 `--daemon` 一起使用；Windows 安装当前用户 Startup，macOS 安装当前用户 LaunchAgent。

## Windows 包装脚本

```powershell
$packageRoot = npm root -g
powershell -File "$packageRoot\local-wiki-mcp\scripts\Bind-LocalWikiKnowledgeBase.ps1" `
  -Root D:\knowledge -Initialize -Refresh -Daemon -InstallRuntime
```

确认预览后增加 `-Apply`。

## macOS 包装脚本

```bash
PACKAGE_ROOT=$(npm root -g)
sh "$PACKAGE_ROOT/local-wiki-mcp/scripts/bind-knowledge-base-macos.sh" \
  --root "$HOME/knowledge" \
  --client codex --client cursor \
  --initialize --refresh --daemon --install-runtime
```

确认预览后增加 `--apply`。LaunchAgent 位于当前用户的 `~/Library/LaunchAgents/com.local-wiki-mcp.runtime.plist`，日志位于知识库 `.state/local-wiki-runtime.log`。

## 验证

```powershell
local-wiki config validate --root <KNOWLEDGE_ROOT>
local-wiki status --root <KNOWLEDGE_ROOT> --strict --metrics
local-wiki smoke --root <KNOWLEDGE_ROOT>
local-wiki runtime status --root <KNOWLEDGE_ROOT>
```

完成绑定后重启 Codex/Cursor 或新建任务，再调用 `status_wiki` 和一条脱敏查询。

## 升级与卸载

升级包后重新执行不带 `--apply` 的 `bind`，检查 `ok`、配置路径和 Node/CLI 绝对路径，再显式应用需要的更新。

```powershell
local-wiki runtime uninstall --root <KNOWLEDGE_ROOT>
npm uninstall -g local-wiki-mcp
```

卸载不会删除知识库 Markdown、索引或客户端配置。需要移除 MCP 配置时，应根据绑定备份人工核对后处理，工具不会自动删除用户配置中的其它内容。
