# Evaluation

RepoBrain's proof layer should show more than feature breadth. It should show that the core loop behaves credibly on representative cases.

## Run The Evaluation Script

```bash
npm run eval:proof
```

The script runs three evaluation buckets:

## 1. Extraction Quality

- durable repo-specific lesson is accepted and typed correctly
- low-information chatter is rejected instead of polluting `.brain/`

## 2. Inject Hit Quality

- a task-matched memory outranks generic guidance during `brain inject`
- the injected output keeps the task-aware rationale visible

## 3. Review / Supersede Quality

- a replacement memory is classified as `supersede`
- a novel workflow memory is still accepted as new knowledge

## Why These Cases

These cases map directly to the trust questions a new open-source user will ask:

- Does extraction keep useful repo knowledge and reject noise?
- Does inject surface the memory that matters now, not just the newest note?
- Can the review layer prevent stale or duplicate guidance from silently accumulating?

The evaluation script is intentionally light and deterministic. It does not benchmark token throughput or latency; it benchmarks whether the proof loop behaves correctly on representative repo-memory decisions.
