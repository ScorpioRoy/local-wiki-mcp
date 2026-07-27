# 变更日志

## 0.6.0 - 2026-07-16

- 增加字段化 BM25、确定性标识符改写、可配置 `queryAliases` 独立证据、轻量 RRF、来源分层、daily 时间衰减和过时内容降权。
- `search_wiki` 增加主题去重、相邻上下文、置信度和默认 2000 token 结果预算。
- 新增共享 loopback daemon 与轻量 MCP bridge；随机 token 鉴权，故障时自动回退直接本地检索。
- 新增 `runtime status|stop|install|uninstall`、`doctor --fix` 和 5MB runtime 日志轮转。
- eval 增加 MRR、nDCG、结果 token、主题重复率和低置信度率，并加入 hard-negative 语料。
- 新增可配置 scale benchmark，保持默认零模型、零 API key 和 index v3 兼容。
- 包验证在 Windows 清理隔离 npm cache 时增加有限重试，避免目录项释放延迟造成假失败。

## 0.5.0 - 2026-07-16

- 新增 `context` 紧凑启动上下文，减少固定读取最近 daily 全文的 token 成本。
- watch 增加单实例进程锁、失效锁恢复和索引缓存复用。
- 新增默认关闭的 Ollama 本地 embedding reranker，仅允许 loopback、拒绝 HTTP 重定向，失败自动回退词法结果。
- MCP 索引缓存支持空闲卸载和状态指标，降低多任务长期驻留内存。
- 增加真实知识库私有 eval 工作流、Windows 当前用户 watcher 启动脚本和中文 init 模板。

## 0.4.0 - 2026-07-15

- 新增 `version`、`config validate`、`doctor --verbose`、`status --metrics` 和 `explain` 产品命令。
- 增加严格配置诊断，覆盖非法 JSON、错误类型、未知字段、缺失 include 和根目录边界违规。
- 增加真实 `.tgz` 安装验证、隔离 npm 缓存和安装后 smoke test。
- 增加发布就绪检查、基于 Changelog 的 release notes、人工审核回滚计划和 npm provenance 工作流。
- 配置 Windows、macOS、Linux 与 Node.js 20、22、24 的 CI 矩阵。
- 增加短时 CI soak 和默认 12 小时 watch soak，验证连续变更、严格新鲜度和最终检索。
- 增加 UTF-8/editor 约束、占位符安全配置示例、中英文文档和正式发布说明。
- 产品评测扩展到 150 条 query，并增加分类指标、意图门禁和语义挑战集。
- 将私有集成 fixture 与脱敏自包含产品语料分离，并强制索引目录留在知识库根目录内。

## 0.3.0 - 2026-07-15

- 索引升级为紧凑 v3，增加 `tokenCount`、预计算 vector norm、逻辑校验和 v2 重建迁移。
- 查询改为遍历 query n-gram，并增加 MCP 内存索引和 freshness cache。
- 默认结果按路径去重，并支持 `max_chunks_per_path` 和 `diversity`。
- 增加 mtime/size 增量快路径，复用未修改文件的检索特征。
- 增加索引操作锁、符号链接跳过、重叠 include 去重和严格新鲜度检查。
- 增加 `watch`、显式 `serve --watch`、`smoke` 和 `init --template minimal|agent-memory`。
- 评测扩展到 50 条 query，并增加质量阈值。
- 增加 Windows、macOS 和 Linux CI 配置。

## 0.2.0 - 2026-07-07

- 增加 `.local-wiki.json`，支持 include、exclude、索引目录、chunk 大小和检索权重。
- 增加真正增量的 `sync`，复用未修改 chunk，只刷新新增或变化文件。
- 增加 `bench` 和 `eval`，用于延迟和检索质量检查。
- `search_wiki` MCP 响应增加索引过期警告。
- 增加发布元数据、排障、迁移和安全文档。

## 0.1.0 - 2026-07-06

- 增加 Markdown、文本和 HTML 的本地 JSON 索引。
- 增加 BM25 风格、n-gram、精确短语、标题和路径混合检索。
- 增加只读 MCP 工具：`search_wiki`、`grep_wiki`、`read_wiki`、`status_wiki`。
- 增加 `init`、`doctor`、`repair`、`config` 和 `audit` 产品命令。
