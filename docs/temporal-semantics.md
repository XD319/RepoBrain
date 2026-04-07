# Temporal Semantics

Detailed validity-window and temporal behavior moved from `README.md`.

## Design Goal

RepoBrain keeps temporal state in Markdown frontmatter, not an external database, while preserving Git reviewability.

## Consumption Rule (Current Validity)

`brain inject` and `brain suggest-skills` consume entries that are currently valid:

- active status
- not stale
- not superseded (`superseded_by` unset)
- within `valid_from` / `valid_until` when set
- not `review_state: pending_review`
- not past `expires` for short-lived working notes

Preferences follow equivalent validity checks (`status`, supersession links, windows).

## Maintenance Events

RepoBrain updates temporal metadata during normal operations:

- `brain supersede`: sets supersession links and related temporal fields
- `brain approve`: refreshes approval-oriented timestamps and review state
- `brain dismiss`/`brain score` stale actions: set or refine supersession/staleness metadata
- preference maintenance commands normalize temporal metadata consistency
- `brain normalize-memory` backfills safe defaults (`valid_from`, `observed_at`, and related fields)

## Timeline and Explainability

Commands:

```bash
brain timeline
brain timeline <file-or-id>
brain timeline --preferences
brain explain-memory <id>
brain explain-preference <id>
```

These commands provide chronology, lineage chain visibility, and "consumed now?" explanations.

## Example: Preference Evolution

1. Older preference file prefers workflow A (`active`)
2. Team captures preference for workflow B and supersedes A
3. Older entry becomes non-current (`superseded` + validity end)
4. Routing consumes only the currently valid preference set
5. Full history remains in Git for audits and rollback
