# 发布指南

这份指南的目标，是把首个 npm release 变成可重复执行的闭环，而不是一次性的临场冲刺。

## 版本策略

- 从第一版开始就按 semver 思考，即使首个公开包还是 `0.x`
- CLI 输出形状、`.brain/` schema 兼容性、adapter contract 都算 release surface
- 只要改动影响 `brain inject`、`brain review`、`brain suggest-skills`、打包文件或生成的 adapter 资产，都应进入 release notes

## Changelog 建议

发布说明最好围绕“用户能验证到的价值”来写：

1. 新增了什么 repo-memory workflow
2. 哪些流程更安全、更可 review
3. 升级后开源用户应该重新验证什么

推荐标题：

- Added
- Changed
- Fixed
- Verification
- Known limits

## Smoke Validation

要验证的是“打包后的产品”，不只是源码目录：

```bash
npm run build
npm test
npm run smoke:package
npm pack --dry-run
```

然后做一轮人工确认：

1. 在干净目录或临时环境里执行 `npm install -g repobrain`
2. `brain --version` 返回预期版本
3. 在新 Git 仓库中执行 `brain setup --no-git-hook`
4. 有一条 approved memory 后，`brain inject` 能正常工作
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

## 发布时建议一起给出的 Proof 资产

- [`docs/demo-proof.zh-CN.md`](./demo-proof.zh-CN.md)
- [`docs/evaluation.zh-CN.md`](./evaluation.zh-CN.md)
- [`docs/case-studies/typescript-cli.zh-CN.md`](./case-studies/typescript-cli.zh-CN.md)
- [`docs/case-studies/full-stack-web.zh-CN.md`](./case-studies/full-stack-web.zh-CN.md)

如果首个 release 同时给出可执行 demo、代表性评测和两个可信 adoption case，用户会更容易把它当成“可用工具”，而不只是“完整原型”。
