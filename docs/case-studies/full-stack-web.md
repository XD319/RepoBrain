# Case Study: Full-Stack Web Repo

## Repository Shape

- `src/api/payments/refund.ts`
- `src/web/routes/settings.tsx`
- `playwright.config.ts`
- `test/e2e/`

## Problem

A full-stack web repo tends to accumulate durable knowledge in several layers:

- API transaction boundaries and rollback gotchas
- frontend conventions around route modules and shared guards
- CI and browser-test workflow rules

Without a repo memory layer, each new session starts by rediscovering the same constraints from code and flaky tests.

## RepoBrain Workflow

1. capture a payment rollback gotcha after fixing a refund bug
2. inject that memory when the next task touches `src/api/payments/`
3. capture a browser-test routing decision that recommends Playwright-first debugging
4. route task-known work through `brain suggest-skills --format json`
5. supersede older guidance when test workflow changes after a tooling migration

## Why RepoBrain Fits

- durable repo knowledge matters across backend, frontend, and CI layers
- not every useful rule belongs in static docs or in agent-specific middleware
- the review / supersede path matters because workflow guidance changes over time

## Good Initial Memories

- `decision`: keep refund writes inside the transaction wrapper before ledger sync
- `gotcha`: browser flakes should inspect Playwright traces before retry loops
- `convention`: route settings pages through the shared auth guard
- `pattern`: keep API and e2e fixtures under focused fixture directories instead of giant demo repos
