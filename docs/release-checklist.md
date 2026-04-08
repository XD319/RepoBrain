# RepoBrain Release Checklist

Use this checklist before the first public release and before any later packaging change. Pair it with [docs/release-guide.md](./release-guide.md) for versioning, changelog, and install-verification guidance.

## Package Integrity

- [ ] `npm run build`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run smoke:package`
- [ ] `npm run demo:proof`
- [ ] `npm run eval:proof`
- [ ] `npm pack --dry-run`
- [ ] Verify every path in `package.json.files` exists and is intentionally published
- [ ] Trusted publisher is configured for `XD319/RepoBrain` on npm, or a temporary manual publish owner is identified

## Documentation

- [ ] `README.md` and `README.zh-CN.md` are both updated
- [ ] linked docs under `docs/` exist in both English and Simplified Chinese when applicable
- [ ] demo proof, evaluation, and case study links resolve from the README
- [ ] quickstart examples still match the current CLI behavior
- [ ] release notes or changelog text describe the user-visible workflow clearly

## CLI Smoke Flow

Verify the packaged CLI can complete this loop in a clean sample repo:

1. `brain setup --no-git-hook`
2. `brain extract`
3. `brain list`
4. `brain inject`
5. `brain status`
6. `brain suggest-skills --format json --task "prepare first npm release" --path package.json`

Use a concrete, repo-specific summary when testing `brain extract`. Thin or generic notes should be rejected by design.

For the first public release, also confirm the generated demo asset bundle exists under `docs/demo-assets/`.

## Cross-Platform Coverage

- [ ] CI passes on Ubuntu
- [ ] CI passes on Windows
- [ ] manual shell spot-check completed on the platform you plan to demo or support first
- [ ] Git hook installation behavior is validated in a real Git repo
- [ ] packaged install verification completed in a clean temp directory

## Manual Release Notes

Record anything the automated checks do not fully prove yet:

- known platform-specific caveats
- commands that still need manual verification
- residual risk around shell encoding or terminal behavior
- follow-up tasks that should land immediately after release
