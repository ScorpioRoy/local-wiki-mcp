# local-wiki-mcp 协作规则

## 语言规则

- 与用户沟通、Issue/PR 模板、版本计划、发布说明、维护指南和安全说明默认使用中文。
- GitHub 主入口 `README.md` 使用中文；国际用户文档放在 `README.en.md`，并保持关键能力和命令同步。
- 代码、CLI/MCP 字段、配置键、命令、路径、错误原文和 npm 元数据标识保留英文。
- `test/fixtures/product-kb/` 与 eval query 属于中英文检索测试语料，可按测试目的保留英文。

## 产品兼容边界

- 默认运行保持零 API key、零必需外部服务和零运行时依赖。
- 保持 MCP 工具名 `search_wiki`、`grep_wiki`、`read_wiki`、`status_wiki` 稳定。
- 普通 `serve` 保持只读，自动写索引必须显式使用 `--watch`。
- 修改后至少执行相关单测；发布相关修改执行 `npm run ci`。
