# Case Study: TypeScript CLI Repo

## Repository Shape

- `src/cli.ts`
- `src/config.ts`
- `package.json`
- `docs/release-checklist.md`

## Problem

The team keeps re-explaining two things to coding agents:

- config defaults are loaded in `src/config.ts` before Commander parsing
- release work should start from the checklist and packaged smoke validation, not from ad hoc shell steps

## RepoBrain Workflow

1. capture a config-parsing gotcha from a real fix
2. review and approve it as durable repo knowledge
3. inject it in the next session when `src/config.ts` or `src/cli.ts` is in scope
4. use `brain suggest-skills --format json` when the task becomes "prepare first npm release"

## Why RepoBrain Fits

- the knowledge is repo-specific, durable, and easy to review
- the output needs to stay local-first and Git-friendly
- the workflow benefits from both `inject` and `invocation_plan`

## Proof Assets

- runnable demo: [`docs/demo-proof.md`](../demo-proof.md)
- generated transcript: [`docs/demo-assets/typescript-cli-proof/transcript.md`](../demo-assets/typescript-cli-proof/transcript.md)
- generated invocation plan: [`docs/demo-assets/typescript-cli-proof/invocation-plan.json`](../demo-assets/typescript-cli-proof/invocation-plan.json)
