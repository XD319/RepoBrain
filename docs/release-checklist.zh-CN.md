# RepoBrain 发布检查清单

这份清单用于首个公开版本发布前，以及之后每次涉及打包改动的发布前检查。

## 打包完整性

- [ ] `npm run build`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run smoke:package`
- [ ] `npm pack --dry-run`
- [ ] 确认 `package.json.files` 中列出的每个路径都真实存在，并且就是你打算发布的内容

## 文档

- [ ] `README.md` 和 `README.zh-CN.md` 都已同步更新
- [ ] `docs/` 下被链接的文档在需要时同时提供英文版和简体中文版
- [ ] quickstart 里的示例仍然和当前 CLI 行为一致
- [ ] release notes 或 changelog 能清楚说明用户实际会怎么使用这个工具

## CLI 冒烟流程

确认打包后的 CLI 能在一个干净的示例仓库里跑通这条最小闭环：

1. `brain setup --no-git-hook`
2. `brain extract`
3. `brain list`
4. `brain inject`
5. `brain status`

测试 `brain extract` 时，请务必使用具体、带仓库上下文的总结。过薄或过泛的输入本来就应该被拒绝。

## 跨平台覆盖

- [ ] CI 在 Ubuntu 上通过
- [ ] CI 在 Windows 上通过
- [ ] 在你计划首发演示或优先支持的平台上做过一次手工 spot-check
- [ ] 在真实 Git 仓库里验证过 Git hook 安装行为

## 手工发布备注

把自动化还不能完全证明的内容单独记下来：

- 已知的平台差异或 caveat
- 仍需手动验证的命令
- shell 编码或终端显示的剩余风险
- 发布后应该尽快继续补上的后续任务
