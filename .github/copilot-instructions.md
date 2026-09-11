# GitHub Copilot Instructions

Repository-wide rules for the GitHub Copilot CLI.

## General

- English only: code, comments, documentation, commit messages.
- Never touch the following paths: `src/`, `build.js`, `pokevoid-unlocked.user.js`, `.github/workflows/`.
- Never push to `master`, never force-push, never run `git rebase`.

## Documentation

- Keep `README.md`, `CHANGELOG.md` and all files under `docs/` coherent with each other.
- Keep the **features table** in `README.md` in sync with the modules in `src/`: `encounter-override.js` (Always Shiny), `capture-override.js` (Catch Any), `roll-controller.js`, `skill-tree-editor.js`, `money-override.js`, `voucher-editor.js`, `battle-screen.js`, `storage.js`.
- Keep `CHANGELOG.md` sorted: newest release on top, below the `[Unreleased]` block.
- The `## [Unreleased]` heading and the `<!-- auto-filled by CI -->` placeholder must always be the first block of `CHANGELOG.md`.
- Do not invent versions, dates, commit hashes or features. Only use data already present in the repository history and in `src/`.
- Do not document features that are not present in `src/` (you may read `src/` — you may not modify it).

## Build output

- `pokevoid-unlocked.user.js` is **generated from `src/` by `node build.js`** (bundled, dependency-free) and is committed intentionally. Never edit it directly — edit `src/` instead.