# 发布指南

这份指南的目标，是把 npm 发布从一次性的临场操作，变成可重复执行的标准流程。

## 版本策略

- 从第一版开始就按 semver 思路管理版本，即使首个公开包还是 `0.x`
- CLI 输出形态、`.brain/` schema 兼容性，以及 adapter contract 都应视为 release surface
- 只要改动影响 `brain inject`、`brain conversation-start`、`brain review`、`brain suggest-skills`、打包文件或生成的 adapter 资产，都应该写进 release notes

## Changelog 建议

发布说明最好围绕“用户能验证到的价值”来写：

1. 新增了什么 repo-memory workflow
2. 哪些流程变得更安全、更容易 review
3. 升级后开源用户应该重新验证什么

推荐标题：

- Added
- Changed
- Fixed
- Verification
- Known limits

## Smoke Validation

要验证的是“打包后的产物”，不只是源码目录：

```bash
npm run release:verify
```

然后做一轮人工确认：

1. 在干净目录或临时环境里执行 `npm install -g repobrain`
2. `brain --version` 返回预期版本
3. 在新 Git 仓库中执行 `brain setup --no-git-hook`
4. 有一条 approved memory 后，`brain conversation-start --format json --task "..."` 能正常工作
5. `brain suggest-skills --format json` 返回可解析的 invocation plan

## 安装验证

首个公开包建议按下面这条路径做安装证明：

```bash
mkdir repobrain-install-smoke
cd repobrain-install-smoke
git init
npm install -g repobrain
brain --version
brain setup --no-git-hook
```

如果包还没正式发布，可以先验证 tarball：

```bash
npm pack
npm install -g ./repobrain-<version>.tgz
brain --version
```

## Trusted Publishing 配置

RepoBrain 现在会在 CI 中自动选择发布路径：

- 在 GitHub Actions 中始终优先走 npm Trusted Publishing
- `NPM_TOKEN` 默认只用于本地维护者发布
- 只有在你显式设置 `REPOBRAIN_PUBLISH_STRATEGY=token` 时，CI 才会强制走 token fallback

这样即使仓库里还保留着旧的 `NPM_TOKEN` secret，CI 默认也不会再误走 token 发布路径。

npm 侧一次性配置：

1. 打开 npm 上 `repobrain` 的 package 设置
2. 把 `XD319/RepoBrain` 添加为 trusted publisher
3. 绑定本仓库里的 `Publish` workflow
4. 继续使用 `v*` tag 触发规则，保证 tag 发布和 trusted publisher 规则一致

仓库侧需要保持：

- `.github/workflows/publish.yml` 里保留 `permissions.id-token: write`
- 发布命令统一走 `npm run release:publish`
- 让脚本在 GitHub Actions 里默认执行 `npm publish --provenance`
- 只有在你有意测试 CI token fallback 时，才显式设置 `REPOBRAIN_PUBLISH_STRATEGY=token`

可选的仓库级 fallback：

1. 在 GitHub 仓库 secrets 中配置 `NPM_TOKEN`
2. 使用对 `repobrain` 具备发布权限的 npm automation token 或等效 token
3. 仍然推荐保留 trusted publishing；fallback 的目标是降低发布阻塞，而不是替代长期配置
4. 如果 CI 必须临时走 token fallback，请显式设置 `REPOBRAIN_PUBLISH_STRATEGY=token`

本地维护者路径：

- 先执行 `npm run release:verify`
- 如果仍需本机发布，导出 `NPM_TOKEN` 后执行 `npm run release:publish`
- 如果在非 GitHub Actions 环境里误走 trusted publishing，脚本会直接报出明确错误

## 发布时建议一起给出的 Proof 资产

- [`docs/demo-proof.zh-CN.md`](./demo-proof.zh-CN.md)
- [`docs/evaluation.zh-CN.md`](./evaluation.zh-CN.md)
- [`docs/case-studies/typescript-cli.zh-CN.md`](./case-studies/typescript-cli.zh-CN.md)
- [`docs/case-studies/full-stack-web.zh-CN.md`](./case-studies/full-stack-web.zh-CN.md)

如果首个 release 同时给出可执行 demo、代表性评测和两个可信 adoption case，用户会更容易把它当成“可用工具”，而不只是“完整原型”。
