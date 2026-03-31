# Codex Installation

Project Brain treats Codex support as a lightweight workflow amplifier. The core product is still repo knowledge memory: extract high-value repo knowledge, store it in `.brain/`, and inject it into future sessions.

## 1. Install dependencies

From the repo root:

```bash
npm install
npm run build
```

If you want the `brain` command to be available in your shell and Git hooks:

```bash
npm link
```

If you do not want to link globally, you can still run the CLI with:

```bash
node dist/cli.js <command>
```

## 2. Initialize Project Brain

Create the local `.brain/` workspace for this repository:

```bash
brain init
```

## 3. Use `brain inject` before a new Codex session

Before starting a new session in this repo, run:

```bash
brain inject
```

Paste or reference the output in your session so Codex starts with the latest repo decisions, gotchas, and conventions.

## 4. Install the lightweight Git hook

To let Project Brain extract from the latest commit message after each commit:

```bash
sh scripts/setup-git-hooks.sh
```

The installed `post-commit` hook stays lightweight:

- It only reads the latest commit message
- It runs `brain extract --source git-commit`
- It silently skips if `brain` is not installed
- It never blocks your commit flow

## 5. Manual extract

You can always extract manually from a summary file:

```bash
cat session-summary.txt | brain extract
```

Or from the latest commit message without the hook:

```bash
git log -1 --pretty=format:"%B" | brain extract --source git-commit
```
