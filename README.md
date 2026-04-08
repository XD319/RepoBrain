# RepoBrain

**Git-friendly repo memory for coding agents.**

[English](./README.md) | [中文](./README.zh-CN.md)

<p align="center">
  <!-- <a href="https://github.com/XD319/RepoBrain/stargazers"><img src="https://img.shields.io/github/stars/XD319/RepoBrain?style=social" alt="GitHub stars" /></a>
  <a href="https://github.com/XD319/RepoBrain/forks"><img src="https://img.shields.io/github/forks/XD319/RepoBrain?style=social" alt="GitHub forks" /></a>
  <a href="https://github.com/XD319/RepoBrain/issues"><img src="https://img.shields.io/github/issues/XD319/RepoBrain" alt="GitHub issues" /></a> -->
  <a href="https://github.com/XD319/RepoBrain/blob/main/LICENSE"><img src="https://img.shields.io/github/license/XD319/RepoBrain" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/repobrain"><img src="https://img.shields.io/npm/v/repobrain?style=flat" alt="npm version" /></a>
</p>

RepoBrain is local, Git-friendly memory infrastructure for coding agents (Claude Code, Codex, Cursor, Copilot). It acts as a durable repository knowledge base, holding onto architecture decisions, gotchas, conventions, and reusable implementation patterns so they persist across sessions.

**Core value:** Stop re-explaining the same repo context to your agent at the start of every new session!

---

## 🚀 Quick Start

**1. Install**
```bash
npm install -g repobrain
```

**2. Setup your repo**
```bash
brain setup
```

**3. TUI Interface (Optional, but recommended for interactive management)**
```bash
brain tui
```

**4. Core Loop Examples (3 Workflow Modes)**

`ultra-safe-manual` (strict manual control)
```bash
# Setup once
brain setup --workflow ultra-safe-manual

# MANUAL: capture via input text
brain capture --task "define API validation boundary" --input "decision: keep API validation at controller boundary"

# MANUAL: start next session with memory context
brain inject
```

`recommended-semi-auto` (default, candidate-first)
```bash
# Setup once
brain setup --workflow recommended-semi-auto

# AUTO: hooks/detect mode can trigger candidate capture opportunities
# MANUAL (optional): explicitly capture this session summary
brain capture --task "fix payment timeout" --input "gotcha: retry loop exits too early when timeout is unset"

# MANUAL: review + approve safe items, then inject
brain review
brain approve --safe
brain inject --task "continue payment timeout fix"
```

`automation-first` (safe auto-promotion enabled)
```bash
# Setup once
brain setup --workflow automation-first

# AUTO: hooks/detect mode can trigger candidate capture opportunities
# MANUAL (optional): explicitly capture this session summary
brain capture --task "stabilize config loader" --input "pattern: normalize env booleans before config branching"

# AUTO: safe candidates can be auto-promoted (when checks pass)
# MANUAL: force an immediate promotion pass now
brain promote-candidates

# MANUAL: start next task with bundled routing context
brain route --task "refactor config loading" --format json
```

---

## 🧩 How It Works (Project Flow Diagram)

Here is a high-level overview of RepoBrain's workflow. It securely extracts, reviews, stores, and then injects repo knowledge back into your coding agents.

```mermaid
flowchart TD
    subgraph Capture & Extract
        A[Git Hooks / Session Log / User Input] -->|stdin| B(brain capture / extract)
    end
    
    subgraph Review & Store
        B --> C{Deterministic Review}
        C -- merge/supersede/reject --> D[Candidate Queue]
        C -- accept --> E[Active Memory]
        D -->|brain review / approve| E
        E -->|Markdown + Frontmatter| F((.brain/))
    end
    
    subgraph Inject & Route
        F --> G(brain inject)
        F --> H(brain suggest-skills)
        F --> I(brain start / route)
        G -.->|Context String| J[Claude Code / Cursor / Codex]
        H -.->|Routing JSON| J
        I -.->|Bundle| J
    end
```

---

## 📂 Architecture & Memory Structure

RepoBrain manages memories locally within the `.brain/` directory.

```mermaid
graph LR
    subgraph RepoRoot[Project Directory]
        direction TB
        B1[(.brain/)]
        subgraph Layers[Knowledge Layers]
            L1[durable/] --> |decisions, gotchas, conventions, patterns| B1
            L2[preferences/] --> |routing preference, skills| B1
            L3[runtime/] --> |session profile| B1
        end
    end
```

### Knowledge Layers
| Layer | Location | Purpose |
| --- | --- | --- |
| **Durable repo knowledge** | `.brain/{decisions,gotchas,...}/` | Long-term memory logic (decisions, rules) to keep in Git. |
| **Routing preference** | `.brain/preferences/` | Team workflows and rules (prefer/avoid/require skills). |
| **Session profile** | `.brain/runtime/session-profile.json` | Ephemeral hints for *this* session only. Ignored by git. |

---

## 🛠️ Commands Matrix

| Action | Command | Purpose |
| ------ | ------- | ------- |
| **Setup** | `brain setup` | Start a `.brain/` Workspace in repo. |
| **Ingest** | `brain extract`, `brain capture` | Translate stdin or files into `.brain/` Candidate Markdown. |
| **Review** | `brain review`, `brain approve` | View candidate memories and save to Active Store. |
| **Inject** | `brain inject` | Generate the Memory Payload Context block for your agent prompt. |
| **Query** | `brain search`, `brain list` | Find memories across titles, summaries, tags, and status. |
| **Analyze** | `brain audit-memory`, `brain stats` | Lints and maintains schema & structural integrity over time. |

> For extended integrations (MCP, Claude plugin, Cursor directives), please review `/docs` and the `/integrations` directories! Let your agents actually remember.