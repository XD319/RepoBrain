# CLI 完整参考

本文承接原 `README.md` 迁出的命令细节与示例。

## 初始化与安装

- `brain init`：初始化 `.brain/`，可生成 steering rules
- `brain setup`：初始化 `.brain/`，应用 workflow preset，并在条件满足时安装低风险 post-commit hook

## 提取与捕获

- `brain extract`：从 `stdin` 提取 durable memory
- `brain extract --type working`：强制写为 `working`
- `brain extract --type goal`：强制写为 `goal`
- `brain extract-commit`：基于 commit 上下文提取
- `brain suggest-extract`：先判定当前是否值得提取
- `brain capture`：`suggest-extract + extract` 一步完成（默认 candidate-first）

示例：

```bash
cat session-summary.txt | brain extract
brain suggest-extract --task "fix refund bug" --path src/payments/handler.ts --json
echo "gotcha: retry loop exits too early" | brain capture --task "fix refund bug" --path src/payments/handler.ts
```

## 上下文与路由

- `brain inject`：生成轻量 repo context，特别适合同一 session 里后续新 conversation 的上下文刷新
- `brain suggest-skills`：生成确定性技能路由计划
- `brain route` / `brain start`：用于 session 启动的一次性 context + routing bundle

示例：

```bash
brain inject --task "refactor config loading" --path src/config.ts --path src/cli.ts --module cli
brain suggest-skills --task "debug flaky browser tests" --path tests/e2e/login.spec.ts
brain start --format json --task "fix refund bug"
```

## 候选审核与提升

- `brain review`：查看 candidate 队列
- `brain approve <id>` / `brain approve --safe` / `brain approve --all`
- `brain dismiss <id>` / `brain dismiss --all`
- `brain promote-candidates [--dry-run]`：按严格条件自动提升

## 记忆管理

- `brain list [--type <type>] [--goals]`
- `brain search "<query>" [--type] [--tag] [--status] [--all] [--json]`
- `brain stats`
- `brain goal done <keyword>`
- `brain supersede <new-memory-file> <old-memory-file>`
- `brain lineage [<file>]`
- `brain timeline [<file-or-id>] [--preferences]`
- `brain explain-memory <id>`
- `brain explain-preference <id>`

## 健康检查与治理

- `brain status`
- `brain next`
- `brain audit-memory [--json]`
- `brain score`
- `brain sweep [--dry-run|--auto]`
- `brain lint-memory`
- `brain normalize-memory`

## Reinforce 与反馈

- `brain reinforce --pending`
- `brain reinforce < session-summary.txt`
- `brain routing-feedback`（从 stdin 读取 JSON 数组或 NDJSON）
- `brain routing-feedback --explain <skill>`
- `brain routing-feedback --ack-reminders`

## 团队与集成

- `brain share <memory-id>`
- `brain share --all-active`
- `brain mcp`

## 调试

- 可用 `brain --debug ...` 或 `REPOBRAIN_DEBUG=1` 查看内部堆栈。
- 用户输入/用法错误默认保持简洁输出（`stderr`，退出码 `1`）。
