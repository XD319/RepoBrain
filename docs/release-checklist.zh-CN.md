# RepoBrain 发布检查清单

在首个公开 release 以及后续任何打包变更前，都先走这份清单。版本策略、changelog 建议和安装验证说明见 [docs/release-guide.zh-CN.md](./release-guide.zh-CN.md)。

## 包完整性

- [ ] `npm run build`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run smoke:package`
- [ ] `npm run demo:proof`
- [ ] `npm run eval:proof`
- [ ] `npm pack --dry-run`
- [ ] 检查 `package.json.files` 中每个路径都真实存在，且确实应该被发布

## 文档

- [ ] `README.md` 和 `README.zh-CN.md` 已同步更新
- [ ] `docs/` 下被链接的文档在适用时同时提供英文和简体中文版
- [ ] README 中的 demo proof、evaluation、case study 链接都可正常打开
- [ ] quickstart 示例与当前 CLI 行为一致
- [ ] release notes / changelog 能清楚说明用户实际会如何使用这个工具

## CLI Smoke Flow

在干净示例仓库里验证打包后的 CLI 可以完成这条闭环：

1. `brain setup --no-git-hook`
2. `brain extract`
3. `brain list`
4. `brain inject`
5. `brain status`
6. `brain suggest-skills --format json --task "prepare first npm release" --path package.json`

测试 `brain extract` 时，请使用具体、repo-specific 的总结。过薄或泛化的记录，本来就应该被拒绝。

首个公开 release 还应确认 `docs/demo-assets/` 下的 demo 资产包已成功生成。

## 跨平台覆盖

- [ ] CI 在 Ubuntu 上通过
- [ ] CI 在 Windows 上通过
- [ ] 在计划首发或首个演示平台上完成一次手工 shell spot-check
- [ ] 在真实 Git 仓库里验证 Git hook 安装行为
- [ ] 在干净临时目录里完成 packaged install verification

## 需要人工记录的事项

记录所有自动化还没有完全证明的内容：

- 平台特定 caveat
- 仍需人工验证的命令
- shell 编码或终端行为上的残余风险
- release 之后应立即补上的 follow-up
