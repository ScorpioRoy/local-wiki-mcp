# local-wiki-mcp 发布说明

本仓库是 `local-wiki-mcp` 包的唯一源码维护源。知识库模板和 agent-memory 应消费带标签的包或经过审核的 `.tgz`，不要在每个知识库中复制并维护第二份源码。

## 本地发布就绪检查

在 Node.js 20、22 或 24 下运行：

```powershell
npm ci --ignore-scripts
npm run ci
npm run test:soak
npm run release:check
```

`test:pack` 会生成真实 tarball，安装到全新临时项目，再执行知识库初始化、配置校验、索引和 smoke。`test:soak` 是短时变更测试；`npm run soak:watch` 默认运行 12 小时。

## GitHub 与 npm 前置条件

公开发布前必须完成：

1. 配置真实 GitHub `origin`。
2. 在 `package.json` 中配置真实 `repository`、`homepage`、`bugs` URL。
3. 在 `SECURITY.md` 中配置私密安全报告入口。
4. 确认 npm 包名和所有权。
5. 配置 GitHub `npm` Environment，以及 trusted publishing 或 `NPM_TOKEN`。

严格门禁：

```powershell
npm run release:check:publish
```

任何真实发布边界未满足时，该命令必须失败。

## 版本与发布

1. 同步更新 `package.json`、`package-lock.json`、`src/version.js` 和 `CHANGELOG.md`。
2. 运行本地发布就绪检查。
3. 提交 release commit。
4. 先推送并确认 CI 通过。
5. 创建带注释的 `vX.Y.Z` 标签并推送。
6. release workflow 在 Windows、macOS、Linux 和 Node.js 20、22、24 验证后，以 npm provenance 发布。

GitHub release notes 从匹配版本的 Changelog 段落提取。

## 回滚

发布回滚不会自动执行。先生成待审核命令计划：

```powershell
npm run release:rollback-plan -- --version 0.6.0 --previous 0.5.0
```

计划会弃用失败版本，并把指定 dist-tag 移回已知可用版本。它不会自动执行网络命令，也不会删除 npm 历史版本。
