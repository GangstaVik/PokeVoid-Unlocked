# Contributing

## Requirements

- Node.js 22 LTS
- A GitHub account (Pull Requests only)

## Build

The build has **no dependencies** — there is no `package.json` and no `npm install` step:

```bash
node build.js
```

`pokevoid-unlocked.user.js` is generated from `src/` (bundled, dependency-free). Verify the build output is deterministic:

```bash
node build.js
git diff --stat -- pokevoid-unlocked.user.js   # expected: empty
```

## Automation notes

The repository uses two GitHub Actions workflows to keep the documentation fresh:

1. **docs-automation.yml** — runs the GitHub Copilot CLI on `.github/prompts/docs-maintainer.prompt.md` (scheduled + manual dispatch):
   - Units in scope: `README.md`, `CHANGELOG.md`, `LICENSE`, `docs/**`, `.github/copilot-instructions.md`, `.github/prompts/**`
   - Protected paths are force-reverted after every run: `src/`, `build.js`, `pokevoid-unlocked.user.js`, `.github/workflows/**`
   - Changes land on a feature branch and are proposed via Pull Request; `master` is never written directly.
2. **update-changelog.yml** — on tag push `v*`:
   - If the version heading already exists, or the `[Unreleased]` section is empty, the workflow skips gracefully (no PR).
   - The `## [Unreleased]` heading and its `<!-- auto-filled by CI -->` placeholder are re-affirmed at the top of `CHANGELOG.md` after every run.

## Notes for maintainers

- The game bundle ships with **mangling disabled**, so `constructor.name` stays introspectable — useful when the game updates and selectors/hooks need to be re-anchored.
- When the game ships a new build, check `docs/COMPATIBILITY.md` and the feature table in `README.md` for drift.

## Commit convention

- Conventional Commits (`feat:`, `fix:`, `docs:`, `style:`, `chore:`)
- One logical change per commit
- Keep `src/` readable; the shipped file is just the build output

## Pull request

- Base branch: `master`
- Run the verification above before opening the PR

## License

By contributing you agree that your contributions are licensed under the MIT License (see `LICENSE`).