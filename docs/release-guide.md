# Release Guide

This guide turns the first npm release into a repeatable loop instead of a one-time launch scramble.

## Versioning Guidance

- Use semver from day one, even if the first public package is `0.x`.
- Treat CLI output shape, `.brain/` schema compatibility, and adapter contracts as release-notable surfaces.
- If a change affects `brain inject`, `brain review`, `brain suggest-skills`, packaged files, or generated adapter assets, call it out explicitly in release notes.

## Changelog Guidance

Structure release notes around user-visible proof:

1. What new repo-memory workflow became possible
2. What got safer or more reviewable
3. What open-source adopters should re-run locally after upgrading

Suggested headings:

- Added
- Changed
- Fixed
- Verification
- Known limits

## Smoke Validation

Run the packaged flow, not only the source checkout:

```bash
npm run build
npm test
npm run smoke:package
npm pack --dry-run
```

Then manually verify:

1. `npm install -g repobrain` works in a clean directory or temp environment
2. `brain --version` resolves the expected version
3. `brain setup --no-git-hook` works in a fresh Git repo
4. `brain inject` works after one approved memory exists
5. `brain suggest-skills --format json` returns a parseable invocation plan

## Install Verification

Use this exact install proof for the first public package:

```bash
mkdir repobrain-install-smoke
cd repobrain-install-smoke
git init
npm install -g repobrain
brain --version
brain setup --no-git-hook
```

If the package is not published yet, use:

```bash
npm pack
npm install -g ./repobrain-<version>.tgz
brain --version
```

## Proof Assets To Link In The Release

- [`docs/demo-proof.md`](./demo-proof.md)
- [`docs/evaluation.md`](./evaluation.md)
- [`docs/case-studies/typescript-cli.md`](./case-studies/typescript-cli.md)
- [`docs/case-studies/full-stack-web.md`](./case-studies/full-stack-web.md)

The first release is stronger if users can inspect a runnable demo, representative evaluations, and two believable adoption stories before they install.
