# PokeVoid-Unlocked — Design Document v2.0

> Revision of v1 applying ALL the fixes from Poseidon's critical review (RE evidence: bundle v3.1.8, index-BA2n6IsS.js, 25.7MB, esbuild keepNames).

> **Versioning note**: three independent version spaces coexist in this document and are not meant to match: the document revision (v2.0, this title), the userscript version (`@version 1.0.0` in the header of §1), and the analyzed game bundle (v3.1.8, RE report §1). A bump in one implies nothing about the others.

## Table of Contents

- [1. Userscript Header](#1-userscript-header)
- [2. Game Access — 3-Level Strategy](#2-game-access--3-level-strategy)
- [3. Robust Class & Function Lookup](#3-robust-class-function-lookup)
- [4. Feature Modules](#4-feature-modules)
  - [4A. Money Override](#4a-money-override)
  - [4B. Roll Controller — 3 Honest Toggles](#4b-roll-controller--3-honest-toggles-no-luck--it-does-not-exist-in-the-roll)
  - [4C. Skill Tree Editor](#4c-skill-tree-editor)
  - [4D. Catch Any — Guaranteed Capture (v1.4)](#4d-catch-any--guaranteed-capture-v14)
  - [4E. Essence Editor](#4e-essence-editor)
  - [4F. Catch Special Cases](#4f-catch-special-cases)
- [5. Save Management](#5-save-management)
- [6. Phase Observer](#6-phase-observer)
- [7. UI Components (v1.6.0)](#7-ui-components-v160)
- [8. Runtime Values & Save](#8-runtime-values--save)
- [9. MVP Plan (phases with binary exit criteria)](#9-mvp-plan-phases-with-binary-exit-criteria)
- [10. Repository Structure](#10-repository-structure)
- [11. Risks](#11-risks)
  - [Verified notes (game-side console noise, NOT from the mod)](#verified-notes-game-side-console-noise-not-from-the-mod)

---

## 1. Userscript Header

```js
// ==UserScript==
// @name         PokeVoid-Unlocked
// @namespace    local.pokevoid-unlocked
// @version      1.0.0
// @description  Skill editor, roll controller, money override per PokéVoid
// @match        https://pokevoid.com/*
// @run-at       document-start
// @noframes
// @grant        none
// ==/UserScript==
```

`@run-at document-start` is required: hook Phaser.Game before the bundle injects. `@noframes` avoids double loading. `@grant none`.

> The `@description` line above is Italian because the header mirrors the userscript template in `build.js` (line 41, `HEADER`), where the string is verbatim `// @description  Skill editor, roll controller, money override per PokéVoid`. Leave it unchanged (Italian included) so the built file stays byte-identical to the template. Note: the block above is an excerpt of the template — `build.js` also emits `@author`, `@updateURL`, `@downloadURL` and currently `@version 1.6.0`.

## 2. Game Access — 3-Level Strategy

1. **Hook Phaser.Game (primary)**: monkeypatch the constructor → `new Fn.Game(xfD)` @22747724 in startGame; save the instance in `window.__pvu_game`.

> `xfD` is the minified name of the game-config object passed to the Phaser.Game constructor in the v3.1.8 bundle (`new Fn.Game(xfD)` @ 22747724, see RE report §6). It is a build artifact: the name changes on any rebuild, so the hook must not depend on it — the hook patches the `Phaser.Game` class itself, not the call site.
2. **Poll window.gameInfo (state)**: written by `updateGameInfo()` on every transition (playTime, biome, wave, party, modeChain). Poll every 500ms (100ms during transitions).
3. **CanvasPool fallback (battle)**: `CanvasPool.pool[0].parent.game.scene.keys.battle`. Only when 1 and 2 fail, only in battle.

Order: 1 → 2 → 3. If no level is available → disable the UI with a clear message.

## 3. Robust Class & Function Lookup

- **Classes** (keepNames): string search in the bundle → class resolvable by name (`SelectModifierPhase`).
- **Minified functions**: 10 AOB signatures from section 7 of the RE report as primary fingerprints; string search as fallback.
- **COMPAT map** `{ 'v3.1.8': { classes: {...}, functions: {...} } }` — update when the bundle changes.

## 4. Feature Modules

### 4A. Money Override

- `scene.money` (run, init 1000) + `gameData.permaMoney` (persistent, bigint string). Update both.
- Hook `updateMoneyText`/`updateGameInfo` for the visual refresh. Write permaMoney via `gameData.setLocalStorageItem`.
- Cap at MAX_SAFE_INTEGER in addMoney — never exceed.

### 4B. Roll Controller — 3 Honest Toggles (no "luck" — it does not exist in the roll)

Removed setLuck→phase.luck (non-existent). Removed setRollCount for itemcount (rollCount = reroll counter).

| Toggle | UI Label | Mechanism |
|--------|----------|-----------|
| Free Reroll | "Free Reroll" | Hook getRerollCost → 0 once, then auto-off |
| Pool Quality | "Pool Quality" | Hook getRaritiesForRewardType → minimum tier Legendary |
| Cost Override | "No Cost" | WAIVE_ROLL_FEE_OVERRIDE = true (native flag) |

**Real itemcount**: hook `getModifierTypeOptions`/`getPlayerModifierTypeOptions`, increment the count parameter (default +2, max +4). UI: extra slider 0–4.

### 4C. Skill Tree Editor

- Currency: `gameData.skillPoints` (direct field). Active champion: `gameData.selectedChampionId`.
- Unlock skill: bypass the skillPoints+essenceWeights check, cost=0, push unlockableId into `unlocked<Category>` (arrayMap: megaStones→unlockedMegaStones, xms→unlockedXMs, smittyAbilities→unlockedSmittyAbilities, legendaryPokemon→unlockedLegendaryPokemon, signaturePokemon→unlockedSignaturePokemon, glitchForms→unlockedGlitchForms), remove from lockedSkills, `gameData.saveSystem()`.
- **championSkillVersion**: save `__pvu_unlockedVersion` together with the unlocks; if different at load → UI warning "Champion skill version changed! Previous unlocks may no longer be valid.", no automatic removal.

### 4D. Catch Any — Guaranteed Capture (v1.4)

Rework of Catch Any (Task 0 of v1.4): every Pokéball thrown at a single, non-excluded target that the game's native capture gate REJECTS is force-injected and that capture is guaranteed; throws the game accepts on its own keep their native odds. 2-level approach:

- **L2 — wrapper on `CommandPhase.prototype.handleCommand`**: calls the native gate first; if the native accepts (return true + turnCommands assigned) it passes through and **learns the BALL command ID only on a native success of a BALL command** (`capture-override.js` ~637-647; never learns on FIGHT/etc.). If the native blocks and the command is BALL (id from `state.ballCommandId`, **fallback assumed = 1** until observed, `BALL_CMD_ID_FALLBACK`), the wrapper performs the **force-inject** replicating the native success branch exactly (turnCommands + targets + partner skip + `end()`). `level2Verified` is report-only, NO longer part of the gate: the inject runs on the first attempt.
- **L1 — live backstop**: 99 pokeballs per type (`pokeballCounts` + `typeBallCounts`) re-armed at **every CommandPhase push** (`l1BackstopInterceptor`), not only at boot. Fixes the `count=0` gate even when it expires mid-run; boss/rival/etc. gates require L2.

**Deterministic exclusions (fail-closed)** — replicated from the native BALL-case gate (bundle v3.1.8); any check that raises an exception ⇒ excluded (`isExcluded`):

- rival / scripted: `battleType===TRAINER && gameMode.checkIfRival(scene)`
- multi-target: active enemies != 1 (deep defense also inside `forceInject`)
- END biome, pre-final wave (`isWavePreFinal`)
- legendary / OP-form pre-wave-1000 (`isLegendSubOrMystical` / `isOPForm`, native gate COL 16903330)
- boss-major: `isBoss() && bossSegmentIndex>=1`; undeterminable segment ⇒ excluded

**Known limit**: species with `species.isObtainable() === false` (not obtainable in the game) → native `failCatch` pre-roll, the mod CANNOT force them.

Special cases (rival/scripted/legendaries/END/boss) remain excluded from Catch Any in v1.4; the **Catch special cases** toggle is available since v1.5.0 (default OFF).

**Capture probability override (token-armed, sentinel 65536)**: the capture roll uses `t.randSeedInt(65536)` on the target Pokémon (3 draws in the tween onRepeat of `AttemptCapturePhase.start`). On an armed attempt, the instance's `randSeedInt` is patched with scoping `v===65536 ? -1 : native` (FIX 4: patch restricted to the capture draw only). `-1 < m` for every `m>=0` (m=0 included) ⇒ the first draw always passes. The token (`{pokemon, turn, pokeballType, fieldIndex}`) is armed in the force-inject and consumed **single-capture** at the start of the `AttemptCapturePhase` (match by pokemon object identity + fieldIndex); restored in `catch`/`failCatch`/`end` (try/finally semantics); stale token invalidated at turn start (`TurnInitPhase`/`TurnStartPhase`). MASTER_BALL/VOID_BALL remain native 100% (ballMult -1/-2).

**Money pre-grant**: on trainer battles the force-inject **pre-grants** the required currency (`getRequiredMoneyForPokeBuy`) via `moneyOverride.setMoney` (BigInt-safe) before the capture — solves the native gate 5 for the trainer snatch. Telemetry counters: `injectedCount`, `capturedCount`, `blockedCount`, `errorCount` (auto-degrade to L1 after 3 errors).

### 4E. Essence Editor

- Purpose: edit run-time Type Essence counts without inventory editing or save manipulation.
- Runtime API discovery: `findGameData()` (via `window.__pvu.bridge`) → `getEssenceCount` / `addEssence` / `tryConsumeEssence`. The runtime type enum dict is located by BFS scan for the `SMITTY` key over gameData (max depth 3, MAX_CHILD_SCAN = 40 scanned properties overall) and used **only for verification** — never for id resolution.
- **Canonical map = truth**: `TYPE_IDS` is a hardcoded 24-entry table (sentry `UNKNOWN: -1` + all 23 native type ids `NORMAL: 0` … `GEN_ONE: 22`, verbatim from enum S of bundle v3.1.8). `resolveTypeIds()` always returns the canonical ids — the old id=index fallback is gone, and key→id never depends on list order or on the BFS result.
- **Native order**: `TYPE_ORDER` follows the native enum order (UNKNOWN → GEN_ONE); the combobox uses this order so the selected value always maps to the correct native id. `UNKNOWN` is filtered from the combobox (not selectable).
- **`verifyEnum()` (fail-open)**: cross-checks the runtime enum against the canonical map and reports any mismatch to the console. `findTypeEnum` requires the `SMITTY` + (`GEN_ONE`|`STELLAR`) discriminator pair to avoid false-positive enum hits. On divergence or absence the editor keeps working with the canonical ids — a console AVVISO is logged, never a hard disable.
- Absolute-value semantics: Apply sets the type count to the entered absolute value by computing the delta and calling add/consume natively — it never raw-writes gameData.
- **UX (v1.5.1)**: single input field below the combobox, bound to the selected type, pre-filled with the live current value, editable in-place with debounced apply (~350ms). The +1/−1 quick buttons and the "Current: X (total: N)" label were removed.
- Honest degradation: tab disabled with warning when the APIs are absent; empty input rejected with an explicit error (no zero-wipe); values sanitized (digits-only regex, clamp to MAX_SAFE_INTEGER, BigInt-safe reads); `init()` is idempotent and re-runs on each Essence tab render.

### 4F. Catch Special Cases

- Default-OFF toggle (Battle tab). When ON, the Catch-Any inject is allowed to also lift the five exclusion branches: scripted rival, END biome, wave-final, legendary/OP pre-1000, boss-major — every `return true;` path inside each branch gets the `if (!forceSpecial)` wrap, including the legendary catch that continues to the Outer-Catch backstop; branches that stay unconditional: multi-target throws and the outer catch.
- Money pre-grant unchanged (trainer-scoped — wild enemies have no money cost).
- Risk notes: quest progression/unlocks may be affected by forced captures during scripted/final encounters; ETERNATUS/VOID high-HP captures are only possible when the boss-major lift is accepted (opt-in, default OFF) and force-inject deliberately overrides the native VOID_BALL hpRatio gate (gate not replicated in isExcluded); species with `isObtainable() === false` still fail the native `failCatch` before the roll and cannot be forced.

## 5. Save Management

Rule: never write during animations (only static phases). Protocol: 1) backup `data_pvu_backup_<ts>_<username>`; 2) write via `gameData.setLocalStorageItem('data_'+username, ...)`; 3) post-write validation (re-read + compare, mismatch → restore backup + notify); 4) console log `[PokeVoid-Unlocked]`.

## 6. Phase Observer

- Primary: hook `unshiftPhase`/`pushPhase` of the battle scene.
- Fallback: poll `window.gameInfo.modeChain` (500ms, 100ms in transition).

Phase mapping:

| Phase | Refreshed data |
|-------|----------------|
| Battle | Money |
| ModifierSelect | Money + Roll |
| Shop | Money |
| Menu / Skill | Money + Skill |
| Title / Loading | none |

## 7. UI Components (v1.6.0)

- **Floating button**: fixed, z-index 99999, bottom-right (~134px clearance), 40×40, **PV** monogram (13px, weight 800, color #4fa3ff; no emoji, no dependencies), hover scale.
- **Panel**: right side, width 380px, pointer-events:none container / auto children, dark semi-transparent blur; **6 text tabs** (Battle / Roll / Skill / Voucher / Essence / Money), no emoji in the tabs; close button `×` (U+00D7); state conveyed via `.ok`/`.warn`/`.err` classes.
- **Status strip**: 3 chips under the header — version (`pvu.config.VERSION`), game state (`window.gameInfo`/bridge → waiting/running), active override count (try/catch on `.getState()` of encounterOverride / rollController / captureOverride); refresh via `setInterval` 2s, cleanup in `destroy()`.
- **About modal**: backdrop + centered card; rows for version / shortcut (**Rebind** button → `hotkey.startCapture`, live hint update) / feature list; closes with the Close button or a backdrop click.
- **Hotkey**: default `Ctrl+Shift+P`, rebindable; combo persisted as JSON (`data_pvu_hotkey`); accepted only with ≥1 of Ctrl/Alt/Meta, never a bare modifier key, single printable key; events from `input`/`select`/`textarea`/contentEditable ignored; 5s capture timeout.
- **Styles (design tokens)**: CSS custom properties — bg `#0e1014`, surface `#171a21`, border `#2a2f3a`, text `#e6e9ef`, secondary `#9aa4b2`, accent `#4fa3ff`, success `#3ddc97`, warning `#ffb454`, danger `#ff5c5c`; radii 8/6/4; spacing 4/8/12/16/24; type scale 11/13/15/17px; transition 0.18s; font stack `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`.
- **Language**: UI and console in **English**, with no emoji or decorative symbols (check marks, crosses, warning triangles, sparkles and lightning bolts were removed; `—` and `→` are kept); UI strings via `t()` (`PvuI18n`, `DICT.en` with key fallback), console logs as plain English literals (never `t()`). Code comments remain Italian (permanent decision).

## 8. Runtime Values & Save

- runtime: scene.money (init 1000), gameData.permaMoney (bigint string), gameData.skillPoints, gameData.selectedChampionId, window.gameInfo (snapshot).
- save `data_<username>`: trainerId, permaMoney, permaModifiers, selectedChampionId, championSkillVersion, pendingChampionLevelUps, skillPoints, championData.<id>.{lockedSkills[skillId, requiredEssenceWeights, level], unlockedMegaStones, unlockedXMs, unlockedSmittyAbilities, unlockedLegendaryPokemon, unlockedSignaturePokemon, unlockedGlitchForms}, + untouched keys.
- GameData API: saveSystem(), loadSystem(), getSystemSaveData(), setLocalStorageItem(key,val), getLocalStorageItem(key).

## 9. MVP Plan (phases with binary exit criteria)

1. **Bootstrap**: header, Phaser.Game hook, floating button → appears 10/10 starts, no console errors, click-through.
2. **Money Override**: numeric field + Apply → game shows the new amount on the next frame; persists after save/load.
3. **Free Reroll**: toggle ON → next reroll costs 0 in the game UI; auto-off after use; Cost Override for N consecutive.
4. **Item Count**: slider +2 → 5 options (3+2); +4 → 7; valid options without crashes.
5. **Skill Points Editor**: game skill menu shows the new value; unlocked skill appears; version warning; persists.
6. **Stability**: 30 min of gameplay (battle, shop, skill, save/load, reroll) without crashes; console only ≥warning; stable RAM.

## 10. Repository Structure

```
pokevoid-unlocked.user.js (entry built)
src/
├── main.js
├── game-bridge.js
├── roll-controller.js
├── skill-tree-editor.js
├── money-override.js
├── phase-observer.js
├── ui/
│   ├── panel.js
│   ├── floating-btn.js
│   ├── roll-screen.js
│   ├── skill-screen.js
│   └── styles.js
└── utils/
    ├── config.js
    ├── storage.js
    └── helpers.js
README.md
LICENSE (MIT)
docs/design.md
```

> The tree above predates the v1.6.0 layout (i18n.js, ui/hotkey.js, ui/battle-screen.js, ui/voucher-screen.js, ui/essence-screen.js, encounter-override.js, essence-editor.js, voucher-editor.js are not listed) — see README.md for the current structure.

Zero dependencies. Minimal single-file bundle in phase 2 (does not block MVP).

## 11. Risks

Function signature changes → COMPAT+AOB+string search. gameData API changes → validation+backup+try/catch rollback. championSkillVersion bump → warning, no auto-cancel. Writing during animation → phase observer. Missing font → system-ui fallback.

### Verified notes (game-side console noise, NOT from the mod)

- Residual `[LOAD ERROR] initSystem failed` (bundle v3.1.8): classified **game-side** — investigated and verified in session T4, not caused by the mod.
- Chrome `Canvas2D: Multiple readback operations using getImageData...` (willReadFrequently warning): attributable to the **game** (the canvas/bundle uses `getImageData` without `willReadFrequently`), not to the mod. See docs/COMPATIBILITY.md.
- LCP attribution ("lcp com triggered by script..." in the Performance panel): attributable to the **game** (parsing the ~25.7MB bundle), not to the mod. See docs/COMPATIBILITY.md.