# Demo Proof

RepoBrain now ships with a real, executable proof asset instead of only a storyboard.

## What It Proves

The generated demo covers the smallest believable loop in a TypeScript CLI-style repo:

1. initialize RepoBrain
2. capture a first memory as a candidate
3. review and approve it
4. inject that memory into the next session
5. derive a `suggest-skills` / `invocation_plan` result for a release task

## Run It

```bash
npm run demo:proof
```

If you want to write the assets somewhere else:

```bash
node scripts/generate-demo-proof.mjs --output-dir ./tmp/demo-proof
```

## Produced Assets

The default run writes real files to [`docs/demo-assets/typescript-cli-proof/`](./demo-assets/typescript-cli-proof/):

- `transcript.md`: full command-by-command transcript
- `session-summary.txt`: the actual memory capture input
- `review-output.txt`: the real `brain review` output
- `inject-output.md`: the actual injected context
- `invocation-plan.json`: the adapter-facing `brain suggest-skills --format json` payload
- copied `.brain/` memories from the demo repo

These assets are meant to be linkable from the README, usable in screenshots or GIF recording, and inspectable during open-source evaluation.

## Proof bundles (preference, session, route diff, feedback)

For a **second layer of evidence**—beyond the single CLI transcript—run:

```bash
npm run proof:bundles
```

This writes two representative bundles (TypeScript CLI + full-stack web) under [`docs/demo-assets/proof-bundles/`](./demo-assets/proof-bundles/README.md), each with:

| Artifact | Role |
| --- | --- |
| `preference-capture-output.txt` | NL preference extraction samples (deterministic heuristics) |
| `route-before.json` / `route-after.json` | Same task + paths before vs after a policy change |
| `route-with-session.json` | Same context with `.brain/runtime/session-profile.json` applied |
| `timeline-output.txt` | Memory evolution (CLI bundle includes a supersede chain) |
| `feedback-loop-output.txt` | `applyRoutingFeedback` results (candidates, bumps, reinforcement) |
| `durable-memory-sample.md`, `preference-sample.md`, `session-profile.json` | Snapshots of the three layers |

Pair with [`docs/evaluation.md`](./evaluation.md) (`npm run eval:proof`) for automated case coverage and the metrics table.
