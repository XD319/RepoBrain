# RepoBrain Contract Example: Session End Extract Candidate

Adapters can emit markdown first, then optionally wrap it in the JSON envelope from `session-end.extract-candidate.json`.

```md
<!-- repobrain:extract-candidate@v1 -->
# Candidate Memory

Type: decision
Title: Keep config parsing and defaulting in one boundary
Files: src/config.ts, src/cli.ts
Tags: cli, config

## Summary

CLI config refactors stay safer when parsing, defaulting, and validation remain in `src/config.ts` before values reach command handlers.

## Detail

Keep config parsing, defaulting, and validation together in `src/config.ts` before `src/cli.ts` consumes the result.

Splitting the steps across files made default handling drift and broke session-end hook assumptions.
```
