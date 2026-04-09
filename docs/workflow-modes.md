# Workflow Modes

Detailed workflow preset comparison moved from `README.md`.

## Presets

| Preset | `triggerMode` | `captureMode` | `autoApproveSafeCandidates` |
| --- | --- | --- | --- |
| `ultra-safe-manual` | `manual` | `direct` | `false` |
| `recommended-semi-auto` | `detect` | `candidate` | `false` |
| `automation-first` | `detect` | `candidate` | `true` |

## Axis Definitions

- `triggerMode`
  - `manual`: extraction only via explicit CLI calls
  - `detect`: hooks and `brain capture` auto-detect extraction opportunities
- `captureMode`
  - `direct`: accepted memory becomes active immediately
  - `candidate`: new memory starts reviewable as candidate
  - `reviewable`: candidate-like mode that also defers merge/supersede decisions
- `autoApproveSafeCandidates`
  - enables strict safe auto-promotion path when true

## Recommended Default Loop

`recommended-semi-auto` is the default for most repositories:

1. first conversation in session: `brain start` (or `brain inject` as fallback)
2. fresh conversation later in same session: `brain inject`
3. session end: extract to candidate queue
4. review: `brain review`
5. quick pass: `brain approve --safe`
6. edge cases: `brain approve <id>`
7. hygiene: `brain score` and `brain sweep --dry-run`

## Safe Auto-Approve Rules

Auto-promotion applies only when all checks pass:

- reviewer decision is `accept` with reason `novel_memory`
- type is not `working`
- content is not temporary/noise
- no merge/supersede/reject signals

Otherwise, the item remains for manual review.

## Mode Selection Guidance

- Choose `ultra-safe-manual` for strict human-controlled repos
- Choose `recommended-semi-auto` for balanced everyday usage
- Choose `automation-first` only when team quality gates and review discipline are stable

## Useful Commands

```bash
brain init --workflow recommended-semi-auto
brain setup --workflow recommended-semi-auto
brain setup --workflow ultra-safe-manual
brain setup --workflow automation-first
brain promote-candidates --dry-run
```
