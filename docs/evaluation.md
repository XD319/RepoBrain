# Evaluation

RepoBrain's proof layer should show more than feature breadth. It should show that the core loop behaves credibly on representative cases: **low-friction preference capture**, **routing that responds to policy**, **temporal evolution**, **session isolation from durable memory**, and a **visible feedback loop**.

## Run The Evaluation Script

```bash
npm run build
npm run eval:proof
```

The script is deterministic and does **not** call remote model APIs.

## Case matrix (what each bucket proves)

| Case category | What it proves |
| --- | --- |
| `extract_quality` | Extraction accepts durable repo lessons and rejects low-information chatter (accept/reject correctness). |
| `inject_hit` | `brain inject` prioritizes task-matched memories and keeps task-aware rationale visible. |
| `review_supersede` | Reviewer classifies supersede vs novel memory correctly. |
| `feedback_negative_workflow` | Negative workflow signal produces a **preference candidate** (`routing_feedback` → saved avoid candidate). |
| `preference_routing` | A stored `avoid` preference changes `suggest-skills` / `invocation_plan` output (route changes with policy). |
| `superseded_preference` | Preferences with `superseded_by` are **skipped** for routing (stale/superseded filtering). |
| `session_profile_routing` | Session `skill_routing` competes on the same skill as stored preferences (session overlay is visible in the plan). |
| `session_pollution` | Writing `session-profile.json` does **not** create new durable memory files. |
| `routing_feedback_loop` | Positive feedback can bump prefer confidence; `skill_ignored` queues reinforcement reminders. |
| `preference_phrase_precision` | Representative natural-language phrases resolve to the expected target + value (heuristic NL capture). |

## Metrics printed by `eval:proof`

After the per-case list, the script prints a **Metrics** table summarizing:

| Metric | Meaning |
| --- | --- |
| Extraction accept / reject | Lesson accepted + chatter rejected flags from the extract cases. |
| Preference phrase precision | Count of sampled phrases where NL extraction matched expected target and `prefer`/`avoid`. |
| Route traceability | Whether `routing_explanation` includes policy-layer notes and per-skill evidence (from `preference_routing`). |
| Stale / superseded filtering | Whether a superseded preference is skipped in routing notes. |
| Session pollution prevention | Memory record count unchanged after writing the session profile. |

This is not an LLM benchmark: it checks **local, inspectable contracts** (memory schema, routing JSON, preference eligibility).

## Representative proof bundles (fixtures + assets)

Two bundles are generated for documentation and manual inspection:

```bash
npm run proof:bundles
```

Default output: [`docs/demo-assets/proof-bundles/`](./demo-assets/proof-bundles/README.md)

| Bundle | Typical repo shape |
| --- | --- |
| `typescript-cli/` | `package.json`, release checklist paths — library / CLI style. |
| `fullstack-web/` | `e2e/`, `app/` paths — web + e2e style. |

Each bundle includes **durable memory** (`durable-memory-sample.md`), **preference** (`preference-sample.md`), **session profile** (`session-profile.json`), **route JSON** (`route-before.json`, `route-after.json`, `route-with-session.json`), **NL preference capture** (`preference-capture-output.txt`), **timeline** (`timeline-output.txt`), and **feedback loop** (`feedback-loop-output.txt`).

## Why this is not “generic chat memory”

| Generic chat log | RepoBrain durable + proof layer |
| --- | --- |
| Unstructured transcripts | Typed memories with review workflow, temporal fields, and explicit routing metadata |
| Everything equally “true forever” | `superseded_by`, validity windows, stale/skip rules for consumption |
| Session == long-term | Session profile is **runtime-local**; promotion is explicit |
| No machine-checkable routing | `suggest-skills` JSON + `routing_explanation` for traceability |

## Why preference is separate from durable repo knowledge

| Durable repo memory | Routing preference |
| --- | --- |
| Describes **what the codebase is / should do** (decisions, gotchas, conventions) | Describes **how the agent should behave** when multiple skills/workflows are plausible |
| Reviewed as knowledge candidates | Often `candidate` or low-friction capture; can conflict and require human resolution |
| Tied to tasks/paths via triggers | `prefer` / `avoid` / `require_review` on skill/workflow/task_class targets |

Preferences **do not replace** repo facts; they layer **policy** on top of facts for routing and invocation plans.

## Historical buckets (still in the script)

### 1. Extraction quality

- durable repo-specific lesson is accepted and typed correctly
- low-information chatter is rejected instead of polluting `.brain/`

### 2. Inject hit quality

- a task-matched memory outranks generic guidance during `brain inject`
- the injected output keeps the task-aware rationale visible

### 3. Review / supersede quality

- a replacement memory is classified as `supersede`
- a novel workflow memory is still accepted as new knowledge

## Why these cases matter

They map to trust questions for adopters: extraction noise, inject relevance, review hygiene, **preference capture**, **routing traceability**, **temporal validity**, **session vs durable**, and **feedback closing the loop**.

The evaluation script stays light and deterministic: it validates the proof loop on representative decisions, not token throughput or latency.
