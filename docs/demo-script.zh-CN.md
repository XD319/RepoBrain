# RepoBrain Demo 脚本

这个脚本用来录 README 里的 Demo GIF。

## 目标

展示 RepoBrain 不是在保存聊天历史，而是在保存真正能帮助下一个 coding session 的 repo knowledge。

## 故事线

1. 准备一个带有已知 gotcha 或 convention 的仓库场景。
2. 展示一段 session summary 或 commit message，把这个经验总结出来。
3. 运行 `brain extract`，展示新的 memory 被写进 `.brain/`。
4. 开一个全新的 session，再运行 `brain inject`。
5. 展示注入内容里已经包含刚才那条 decision、gotcha 或 convention。
6. 演示 agent 因为看到了这条 repo knowledge，而没有再次犯同样的错。

## 推荐录制流程

```bash
brain init
cat session-summary.txt | brain extract
brain list
brain inject
```

## 录制时要强调什么

- `.brain/` 是普通 Markdown，不是隐藏数据库
- 保存的是仓库知识，不是整段聊天记录
- 新 session 一开始就能拿到有用上下文
- Claude Code 和 Codex 都能用这一套流程

## 时长建议

控制在 20 到 40 秒内，最好不用旁白也能看懂：

> 同一个坑修过一次，仓库记住；下一次 session，agent 自动避开。
