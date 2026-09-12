# Changelog

## [1.5.0] - 2026-09-12

### Added
- Toggle Cattura casi speciali (Battle tab): allows the Catch-All force-inject to bypass the scripted / final-biome / wave-final / legendary-OP pre-1000 / boss-major exclusion branches when ON (default OFF).
- Essenze tab with Type Essence editor: combobox of 21 type keys, absolute-value input, +1/−1 quick buttons, Applica writes natively via getEssenceCount/addEssence/tryConsumeEssence (runtime API discovery, depth-3 enum scan with 21-key id=index fallback, no hardcoded enum ids).

### Changed
- Money pre-grant unchanged: stays trainer-scoped (wild enemies have no native money cost — verified bundle v3.1.8, both `money < cost` gate and `addMoney(-c)` deduction live inside `battleType === TRAINER` branches).

### Docs
- design.md: added section 4E Essence Editor and section 4F Cattura casi speciali (4D was already taken by Catch Any).
- COMPATIBILITY.md: added v1.5 entry incl. ETERNATUS opt-in caveat and species.isObtainable() limit.

## [1.4.0] - 2026-09-12

### Added
- Catch Any toggle (Battle tab): when ON (default), any Pokéball that the game's native catch gate would reject for a single, non-excluded target is force-injected, and that catch is guaranteed; throws the game accepts on its own keep native catch odds.
- Priority ladder in Battle tab showing enabled/disabled state, error/warn classes, and the error suffix pre-last.

### Changed
- Money pre-grant added: trainer battles auto-grant funds so the native trainer catch money check succeeds; wild enemies unaffected (no native money cost).

### Docs
- design.md: added sections 4A Money, 4B Roll Odds, 4C Skill Tree; documented fail-closed exclusions and the species.isObtainable() limit.

All notable changes to this project are documented in this file.

## [1.3.0] - 2026-09-11
### Added
- feat: version bump + build order (d6f80bc)
- feat: settings persist helpers for toggles (884d768)
- feat: always-shiny with force bypass for boss/rival/legendary (03b2e4f)
- feat: catch-any with L2 wrapper + L1 fallback (5cc8131)
- feat: battle tab with shiny/capture toggles + wiring (6e8f3e5)

### Docs
- docs: feature table + v1.3.0 build (12841bc)

## [1.2.1] - 2026-09-11
### Fixed
- fix: permaMoney BigInt corruption (omega freeze + load error) (087a8e4)

## [1.2.0] - 2026-09-11
### Added
- feat: event-driven skill refresh + voucher editor (a53b798)

## [1.1.1] - 2026-09-11
### Fixed
- fix: champion hook resolved from scene (findGameData/getGame self-heal), conditional stop poll (8b1d23a)

## [1.1.0] - 2026-09-10
### Fixed
- fix: CanvasPool path, AOB roll hooks, dedup inj, money fmt, lockedSkills guard (7f61f8f)
- fix: toggle desync, skill points per-run, luck lock (3 bug fixes) (0048640)
- fix: remove dead toggles, robust luck pool scaling (anti-riwrap), fix battle lag, champion run hook, cache (347baa1)

### Changed
- style: readable font (system-ui/Segoe UI/Roboto) + UI panel sizing (901cb6a)

## [1.0.0] - 2026-09-10
### Added
- feat: complete MVP — roll controller (3 honest toggles + itemcount), skill editor, money override (fa9db79)

### Docs
- docs: design v2 (Poseidon review fixes) (bd9e024)
- chore: scaffold PokeVoid-Unlocked (header v2, structure, RE report) (238814b)

[Unreleased]: https://github.com/GangstaVik/PokeVoid-Unlocked/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/GangstaVik/PokeVoid-Unlocked/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/GangstaVik/PokeVoid-Unlocked/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/GangstaVik/PokeVoid-Unlocked/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/GangstaVik/PokeVoid-Unlocked/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/GangstaVik/PokeVoid-Unlocked/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/GangstaVik/PokeVoid-Unlocked/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/GangstaVik/PokeVoid-Unlocked/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/GangstaVik/PokeVoid-Unlocked/releases/tag/v1.0.0
