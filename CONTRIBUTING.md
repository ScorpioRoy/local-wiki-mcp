# 贡献指南

`local-wiki-mcp` 默认运行时保持零依赖、本地优先。任何改动都必须保留四个 MCP 工具名，不能引入必需的 API key、托管服务，也不能让普通 `serve` 自动写索引。

## 开发环境

使用 Node.js 20、22 或 24：

```powershell
npm ci --ignore-scripts
npm test
npm run test:pack
npm run test:soak
```

涉及检索质量时，对脱敏产品语料运行两套评测：

```powershell
npm run test:eval
npm run eval:semantic
```

行为变更必须增加聚焦测试。源码统一使用 UTF-8；索引写入保持原子性；用户可控路径和数值必须校验；不要夹带无关重构。

## 文档语言

- GitHub 主文档、版本计划、发布说明和协作模板使用中文。
- 英文用户文档维护在 `README.en.md`。
- 命令、配置键、MCP 字段、路径、错误原文和代码标识符保持英文。
- 英文测试语料仅用于检索覆盖，不代表用户主文档语言。

## Pull Request 要求

- 说明用户可见行为和兼容性影响。
- 提供测试、安装包验证和相关 benchmark/eval 结果。
- 索引格式或 MCP 协议变更必须单独说明。
- 发布可见改动同步更新 `CHANGELOG.md` 和产品文档。

发布门禁见 [RELEASING.md](RELEASING.md)。安全问题不要在公开 Issue 中披露。
