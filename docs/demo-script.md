# RepoBrain Demo Script

Use this script to record a short README demo GIF.

## Goal

Show that RepoBrain is not saving chat history. It is saving durable repo knowledge that helps the next coding session make better decisions.

## Story

1. Start in a repo with a known gotcha or convention.
2. Show a session summary or commit message that captures the lesson.
3. Run `brain extract` and show the new memory landing in `.brain/`.
4. Start a fresh session and run `brain inject`.
5. Show the injected context mentioning the same decision, gotcha, or convention.
6. Demonstrate the agent following that knowledge instead of repeating the old mistake.

## Suggested Recording Flow

```bash
brain init
cat session-summary.txt | brain extract
brain list
brain inject
```

## What To Highlight

- `.brain/` is plain Markdown, not a hidden database
- The memory is about the repo, not the whole conversation
- The next session starts with useful context right away
- The workflow works with Claude Code and Codex

## Keep It Short

Aim for 20 to 40 seconds. The punchline should be obvious without narration:

> Fix it once, remember it in the repo, avoid it next time.
