# Workflow 模式详解

本文承接原 `README.md` 中关于三种 workflow preset 的详细说明。

## 预设对比

| Preset | `triggerMode` | `captureMode` | `autoApproveSafeCandidates` |
| --- | --- | --- | --- |
| `ultra-safe-manual` | `manual` | `direct` | `false` |
| `recommended-semi-auto` | `detect` | `candidate` | `false` |
| `automation-first` | `detect` | `candidate` | `true` |

## 三个轴的含义

- `triggerMode`
  - `manual`：只在手动命令时提取
  - `detect`：hooks 与 `brain capture` 自动检测是否提取
- `captureMode`
  - `direct`：accept 后直接 active
  - `candidate`：先进入候选队列审核
  - `reviewable`：与 candidate 类似，并推迟 merge/supersede 决策
- `autoApproveSafeCandidates`
  - 开启后允许“严格安全条件”下自动提升

## 默认推荐流程

`recommended-semi-auto` 适合大多数仓库：

1. session 的首个 conversation：`brain start`（或回退到 `brain inject`）
2. 同一 session 里后续新 conversation：`brain inject`
3. session end：进入 candidate 队列
4. `brain review`
5. `brain approve --safe`
6. `brain approve <id>` 处理边界项
7. `brain score` + `brain sweep --dry-run` 做卫生治理

## 安全自动提升条件

自动提升必须同时满足：

- reviewer 为 `accept` 且 reason=`novel_memory`
- 类型不是 `working`
- 内容不是临时噪声
- 无 merge/supersede/reject 冲突信号

不满足则保留人工审核。

## 选型建议

- `ultra-safe-manual`：强人工控制团队
- `recommended-semi-auto`：平衡效率与可靠性（默认）
- `automation-first`：已稳定运行、审查机制成熟的团队

## 常用命令

```bash
brain init --workflow recommended-semi-auto
brain setup --workflow recommended-semi-auto
brain setup --workflow ultra-safe-manual
brain setup --workflow automation-first
brain promote-candidates --dry-run
```
