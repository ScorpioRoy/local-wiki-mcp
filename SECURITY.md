# 安全说明

`local-wiki-mcp` 设计为在本机运行，并读取用户明确选择的 Markdown 知识库。

## 数据边界

- 默认运行不需要外部 API key。
- 运行时不会主动调用外部服务。
- 普通 MCP 调用只提供只读知识工具。
- 只有 `index`、`sync`、`repair` 等显式 CLI 命令会写索引。
- `serve --watch` 是允许自动索引写入的显式选项；普通 `serve` 保持只读。
- 源文件发现会跳过符号链接，避免 include 通过链接逃出知识库根目录。
- 索引读写拒绝根目录外的 `indexDir`，也拒绝根目录下包含符号链接的索引路径。

## 敏感内容

除非团队已批准相应存储方式，否则不要把密码、token、客户隐私、受监管数据或生产凭据写入共享知识库。

本地索引包含原文片段和可搜索特征。删除 Markdown 源文件后，还必须运行 `local-wiki sync` 或删除索引目录，不能只删除原文。

## 报告安全问题

请通过 GitHub Security Advisories 私密报告：

<https://github.com/ScorpioRoy/local-wiki-mcp/security/advisories/new>

不要在公开 Issue 中提交凭据、私有 Wiki 内容、客户数据或可直接利用的漏洞细节。
