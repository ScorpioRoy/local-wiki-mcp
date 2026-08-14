# 安全说明

`local-wiki-mcp` 设计为在本机运行，并读取用户明确选择的 Markdown 知识库。

## 数据边界

- 默认运行不需要外部 API key。
- 默认运行不会主动调用外部服务。
- 可选 Ollama reranker 只允许访问 loopback 地址且拒绝 HTTP 重定向；配置远程主机会被校验拒绝。开启后，查询和候选片段会发送给用户自行运行的本地 Ollama 进程。
- 普通 MCP 调用只提供只读知识工具。
- `local-wiki bind` 默认只预览并只读预检知识库与客户端配置；只有预览为 `ok: true` 且显式 `--apply` 才会初始化知识库、刷新索引、写客户端配置或安装当前用户 runtime。
- 绑定只管理 Codex 的标记区块和 Cursor 的 `mcpServers.local-wiki`，写入前备份原配置；未托管同名项、无效 TOML 标记或无效 JSON 会阻止覆盖。
- 只有 `index`、`sync`、`repair` 等显式 CLI 命令会写索引。
- `serve --watch` 是允许自动索引写入的显式选项；普通 `serve` 保持只读。
- watcher 使用独立 `watch.lock` 保证单实例；索引写入仍受 `index.lock` 和原子替换保护。
- 共享 daemon 仅绑定 loopback，使用 256 位随机 token 鉴权，状态文件按当前用户权限写入；诊断、日志和 MCP 响应不输出 token。
- daemon 请求体默认限制为 1MB并拒绝远程 URL/HTTP 重定向；bridge 失败时只回退同一知识库的本地索引。
- Windows runtime 仅使用当前用户 Startup；macOS runtime 仅使用当前用户 LaunchAgent，不安装系统级服务。
- 源文件发现会跳过符号链接，避免 include 通过链接逃出知识库根目录。
- 索引读写拒绝根目录外的 `indexDir`，也拒绝根目录下包含符号链接的索引路径。

## 敏感内容

除非团队已批准相应存储方式，否则不要把密码、token、客户隐私、受监管数据或生产凭据写入共享知识库。

本地索引包含原文片段和可搜索特征。删除 Markdown 源文件后，还必须运行 `local-wiki sync` 或删除索引目录，不能只删除原文。

## 报告安全问题

请通过 GitHub Security Advisories 私密报告：

<https://github.com/ScorpioRoy/local-wiki-mcp/security/advisories/new>

不要在公开 Issue 中提交凭据、私有 Wiki 内容、客户数据或可直接利用的漏洞细节。
