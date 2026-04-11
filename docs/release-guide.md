# Release Guide

This guide turns the first npm release into a repeatable loop instead of a one-time launch scramble.

## Versioning Guidance

- Use semver from day one, even if the first public package is `0.x`.
- Treat CLI output shape, `.brain/` schema compatibility, and adapter contracts as release-notable surfaces.
- If a change affects `brain inject`, `brain conversation-start`, `brain review`, `brain suggest-skills`, packaged files, or generated adapter assets, call it out explicitly in release notes.

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
npm run release:verify
```

Then manually verify:

1. `npm install -g repobrain` works in a clean directory or temp environment
2. `brain --version` resolves the expected version
3. `brain setup --no-git-hook` works in a fresh Git repo
4. `brain conversation-start --format json --task "..."` works after one approved memory exists
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

## Trusted Publishing Setup

RepoBrain now auto-selects a publish path in CI:

- always prefer npm Trusted Publishing inside GitHub Actions
- use `NPM_TOKEN` automatically only for local maintainer publishing
- force the token fallback in CI only when you explicitly set `REPOBRAIN_PUBLISH_STRATEGY=token`
- after a `v*` tag is pushed, the publish workflow also creates or updates the matching GitHub Release with generated notes

That keeps the default CI path aligned with Trusted Publishing even if an old `NPM_TOKEN` repository secret still exists.

One-time npm setup:

1. Open the `repobrain` package settings on npm
2. Add `XD319/RepoBrain` as a trusted publisher
3. Point it at the `Publish` workflow in this repository
4. Reuse the tag trigger `v*` so tagged releases match the trusted publisher rule

Repo expectations:

- keep `permissions.id-token: write` in `.github/workflows/publish.yml`
- keep `permissions.contents: write` in `.github/workflows/publish.yml` so GitHub Releases can be created from CI
- keep the publish workflow on npm `>=11.5.1` (RepoBrain currently does this by running the publish workflow on Node `24`)
- publish through `npm run release:publish`
- let the script choose `npm publish --provenance` by default in GitHub Actions
- only force plain `npm publish` in CI when you intentionally set `REPOBRAIN_PUBLISH_STRATEGY=token`

GitHub Release behavior:

- pushing `v*` now handles both npm publish and the matching GitHub Release in one workflow
- the workflow uses `gh release create --generate-notes` the first time a tag is published
- if the Release already exists, the workflow keeps the existing body and simply marks it as the latest release

Optional repository fallback:

1. Add an `NPM_TOKEN` repository secret
2. Use an npm automation token or another publish-capable token for the `repobrain` package
3. Leave trusted publishing configured when possible; the fallback should reduce release friction, not replace long-term setup
4. If the fallback must run in CI, set `REPOBRAIN_PUBLISH_STRATEGY=token` explicitly so the workflow does not silently bypass trusted publishing

Local maintainer flow:

- run `npm run release:verify`
- if you still need to publish locally, export `NPM_TOKEN` and run `npm run release:publish`
- the script prints a clear error if trusted publishing is selected outside GitHub Actions

## Proof Assets To Link In The Release

- [`docs/demo-proof.md`](./demo-proof.md)
- [`docs/evaluation.md`](./evaluation.md)
- [`docs/case-studies/typescript-cli.md`](./case-studies/typescript-cli.md)
- [`docs/case-studies/full-stack-web.md`](./case-studies/full-stack-web.md)

The first release is stronger if users can inspect a runnable demo, representative evaluations, and two believable adoption stories before they install.
