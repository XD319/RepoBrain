# Copilot Adapter

GitHub Copilot works best as a contract-aware custom-instructions adapter. It can consume RepoBrain context well, but durable writes usually happen through a shell or CI step.

## Workflow

1. Start the task by reading the inject markdown block from `brain inject`.
2. Once the task is clear, read `brain suggest-skills --format json` and follow `invocation_plan`.
3. At the end, emit an extract candidate summary and route it to `brain extract`.
4. If the task failed against a known memory, emit a reinforce event summary and route it to `brain reinforce`.

## Minimal Integration

1. Copy [`copilot-instructions.md`](./copilot-instructions.md) to `.github/copilot-instructions.md`.
2. Run `brain inject` before significant changes.
3. Run `brain suggest-skills --format json` for task-aware routing.
4. Use markdown summaries for `brain extract` and `brain reinforce`.

## Recommended Integration

1. Keep Copilot instructions focused on consuming the shared contract.
2. Use repo scripts, Actions, or local shell helpers to collect inject output and invocation plans.
3. If your workflow already has external tooling, emit the shared JSON envelopes for extract candidates and reinforce events.
4. Keep RepoBrain Core responsible for review and durable writes.

## Limitations

- Copilot custom instructions are not a durable memory store.
- Most Copilot flows will rely on markdown summaries or external scripts for session-end writes.
- The adapter should stay lightweight and avoid turning into a Copilot-specific SDK.
