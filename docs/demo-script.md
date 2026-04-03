# RepoBrain Demo Script

This script is the storyboard for the first public demo GIF. The goal is to show the smallest believable product loop in under three minutes.

## Goal

Show that RepoBrain can:

1. initialize durable repo memory in a real repository
2. capture one concrete lesson
3. inject that lesson into the next coding session
4. keep the workflow reviewable and Git-friendly

## Recording Setup

- Terminal font size large enough to read on mobile
- Fresh sample repository with no existing `.brain/`
- Node.js and npm already installed
- `npm install`, `npm run build`, and `npm link` already completed for RepoBrain itself

## Scene 1: Problem Statement

Open the repository root and show that no `.brain/` directory exists yet.

Narration:

`RepoBrain keeps durable repo knowledge in the repo itself, instead of hiding it in old chat logs.`

## Scene 2: Initialize RepoBrain

Run:

```bash
brain setup
```

Pause on:

- the created `.brain/` directory
- the config file
- the setup message about the optional Git hook

Narration:

`The setup step is intentionally small: it creates the local memory store and can install a low-risk post-commit hook.`

## Scene 3: Capture One Real Lesson

Create a realistic summary:

```bash
cat > session-summary.txt <<'EOF'
gotcha: ESLint no-unused-vars conflicts with TypeScript noUnusedLocals

When TypeScript is already enforcing unused locals, enabling both rules creates duplicate warnings and noisy agent feedback. In this repo, prefer TypeScript for the hard error and tune ESLint so the same issue is not reported twice.
EOF
```

Run:

```bash
cat session-summary.txt | brain extract
brain list
```

Pause on:

- the deterministic review output
- the accepted memory
- the new markdown file under `.brain/gotchas/`

Narration:

`RepoBrain does not save every note. It first checks whether the input looks durable and specific enough to keep.`

## Scene 4: Start The Next Session With Memory

Run:

```bash
brain inject --task "refactor config loading for the CLI" --path src/config.ts --path src/cli.ts --module cli
```

Pause on:

- the injected memory block
- the requirement footer

Narration:

`The next session starts with repo-specific context already loaded, so the agent does not have to rediscover the same lesson.`

## Scene 5: Show The Team Workflow

Briefly show:

```bash
brain review
brain approve --safe
brain share --all-active
```

Narration:

`Write paths stay reviewable. Teams can approve, share, and commit `.brain/` changes alongside normal code changes.`

## Closing Frame

Show these three commands together:

```bash
brain setup
cat session-summary.txt | brain extract
brain inject
```

Closing line:

`RepoBrain gives coding agents a Git-friendly repo memory loop: capture once, review once, reuse every session.`
