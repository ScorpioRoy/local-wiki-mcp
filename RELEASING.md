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

`test:pack` 会通过正式发布包生成器创建真实 tarball、SHA-256 和 manifest，校验三者一致后安装到全新临时项目，再执行知识库初始化、配置校验、索引和 smoke。`test:soak` 是短时变更测试；`npm run soak:watch` 默认运行 12 小时。

内部受控分发使用：

```powershell
npm run release:package
```

该命令向 `dist/` 输出同版本的 `.tgz`、`.sha256` 和 `.manifest.json` 并拒绝覆盖；三者必须一起分享。正式打包前确保 `dist/` 不含旧版本同名文件。

## GitHub 与 npm 前置条件

公开发布前必须完成：

1. 配置真实 GitHub `origin`。
2. 确认仓库对公众可见，匿名访问 GitHub 仓库 URL 返回成功。
3. 在 `package.json` 中配置真实 `repository`、`homepage`、`bugs` URL。
4. 在 `SECURITY.md` 中配置私密安全报告入口。
5. 确认 npm 包名和所有权。
6. 配置 GitHub `npm` Environment。首次发布可使用最小权限的 granular `NPM_TOKEN`；包建立后推荐配置 npm trusted publisher，并撤销不再需要的长期 token。

严格门禁：

```powershell
npm run release:check:publish
```

任何真实发布边界未满足时，该命令必须失败。

GitHub release workflow 还会通过仓库 API 校验 `visibility=public`；私有仓库不能进入 npm 发布步骤。

## 版本与发布

1. 同步更新 `package.json`、`package-lock.json`、`src/version.js` 和 `CHANGELOG.md`。
2. 运行本地发布就绪检查。
3. 提交 release commit。
4. 先推送并确认 CI 通过；macOS Node.js 24 作业必须完成真实 LaunchAgent 安装、daemon 可达、smoke 和卸载验收。
5. 创建带注释的 `vX.Y.Z` 标签并推送。
6. release workflow 在 Windows、macOS、Linux 和 Node.js 20、22、24 验证后生成发布三件套，使用其中的同一份 `.tgz` 进行 npm provenance 发布。
7. workflow 创建 GitHub Release，并附加 `.tgz`、`.sha256` 和 `.manifest.json`。

GitHub release notes 从匹配版本的 Changelog 段落提取。

如果 npm 已发布但 GitHub Release 创建失败，不要重新发布相同版本。先核对 npm 上该版本的 integrity 与本次 manifest 一致，再人工补建同 Tag 的 GitHub Release 并上传原三件套；integrity 不一致时停止并按回滚计划处理。

## 回滚

发布回滚不会自动执行。先生成待审核命令计划：

```powershell
npm run release:rollback-plan -- --version 0.7.2 --previous 0.7.1
```

计划会弃用失败版本，并把指定 dist-tag 移回已知可用版本。它不会自动执行网络命令，也不会删除 npm 历史版本。
