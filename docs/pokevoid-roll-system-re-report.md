# PokeVoid — Post-Battle Roll System Reverse Engineering

> Static analysis of the production JavaScript bundle — no code executed.

## Table of Contents

- [1. Analyzed Bundle Version](#1-analyzed-bundle-version)
- [2. Roll Map](#2-roll-map)
- [3. Runtime Values](#3-runtime-values)
- [4. Save](#4-save)
- [5. GameInfo](#5-gameinfo)
- [6. Phaser.Game Hook](#6-phasergame-hook)
- [7. Implementation Recommendations](#7-implementation-recommendations)
- [v1.4 Update](#v14-update)

---

## 1. Analyzed Bundle Version

| Metadata | Value |
|---|---|
| **Bundle** | `assets/index-BA2n6IsS.js` (served live from `https://pokevoid.com/assets/index-BA2n6IsS.js`) |
| **Size** | 25,703,504 bytes (22,753,130 characters) |
| **SHA-256** | `A2DD2F6CFD3DEA3F60D2898EFBFF49E4FE41A760B504C9A9D15B3A79E9D2407D` |
| **Local dump** | `C:\Users\Amministratore\vsc-work\pokevoid-bundle.js` |
| **Build** | esbuild minified with `keepNames` enabled: original function names are preserved via the `u(fn, "Name")` pattern (3,223 named functions) |
| **Version** | the string `3.1.8` is **not contained in the bundle** (verified: 0 occurrences); the version is injected elsewhere (HTML/meta/server). The bundle is the same hash-named file as the v3.1.8 session → **v3.1.8 assumed unchanged** |

Tools used: `verify` python, symbolic-name search (`re_names`), context extraction at offset (`re_ctx1..15`). All offsets are **0-based byte positions** in the dump file.

---

## 2. Roll Map

The post-battle "pick-a-prize" screen is handled by **`SelectModifierPhase`** (class `su`). Full flow:

```
End of battle
  └─> ModifierRewardPhase @ 16401781 (dispatched by context:
        GameOverModifierRewardPhase @ 17280274, ShopModifierSelectPhase @ 16886701,
        SelectPermaModifierPhase @ 17277004, SkillTreeModifierPhase @ 17211260)
  └─> su.start()  @ 17211458   ← OPTION GENERATION (itemcount + pool)
        ├─ reshuffles seed:  sp(party, getPoolType(), max(rerollCount, permaRerollCount))
        │                     (function sp @ 18556872; pool = ki.DRAFT | ki.COLLECTOR)
        ├─ base slots:        new bn(3)
        ├─ +ExtraModifierModifier (class WP @ 18360377, apply = value += stackCount, max 3)
        ├─ +PERMA_MORE_REWARD_CHOICE:  _1 → +Le(2,1)  _2 → +Le(3,1)  _3 → +Le(4,1)
        ├─ +1 slot with 5% probability (Le(100,1)<=5)
        └─ getModifierTypeOptions(base+extra) → Wd() @ 18558674
              (generates the N offers; weighted pool "WeightedModifierType" @ 18495654,
               rarity via getRaritiesForRewardType @ 16259742,
               reward type via getRandomRewardType @ 18664952)
  └─> UI: ModifierSelectUiHandler @ 17151912 (render + costs + reroll button)
  └─> Payout applied via applyModifier / addModifier (subclass of ModifierTypeOption
        "ufe" @ 18569909: cost field)
```

### Reroll cost — `getRerollCost(t, n)` @ 17223212 (class `su`)

Full formula reconstructed from bytecode:

```js
// n = lockModifierTiers (UI toggle), t = current option list
getRerollCost(t, n):
  if WAIVE_ROLL_FEE_OVERRIDE  → {0, 0}            // dev override (testing)
  if gameMode.isTestMod        → {0, 0}
  if cached                    → cache

  base s = 100
  if CollectedTypeShopPhase    → s = 1500
  else if pathNodeFilter != NONE:
      s = (MASTER_BALL_ITEMS || ROGUE_BALL_ITEMS) ? 1500 : 300

  if lockModifierTiers:
      for option in t: s += [50, 125, 300, 750, 2000][option.tier ?? 0]
  else:
      PERMA_REROLL_COST_3 → s *= 0.19
      PERMA_REROLL_COST_2 → s *= 0.30
      PERMA_REROLL_COST_1 → s *= 0.45
      none               → s *= 0.60

  if draftOnly: s *= 5

  // free reroll
  if PERMA_FREE_REROLL active && Le(100) < 30:  cost = 0  (consumes the perma)
  else if Le(100,1) <= 5:                        cost = 0  (random 5% free reroll)
  else:
      wave = draftOnly && nightmare ? waveIndex % 100 : waveIndex
      cost = min( ceil(wave/10) * s * 2^rerollCount , MAX_SAFE_INTEGER )

  // permaRerollCost
  d = (CollectedTypeShopPhase || MASTER/ROGUE_BALL) ? 1250 : (pathNode ? 900 : 300)
  permaCost = min( ceil(wave/10) * d * (pathNode ? 1.2 : 1.5)^permaRerollCount , MAX )

  if rerollCostMultiplier != 1 → both × mult (default 1)
```

Implementation details observed in the bytecode:
- the cost is paid with `this.scene.money` (run) or `this.scene.gameData.permaMoney` (draft) — `handleButtonAction` case `modifierSelectUiHandler:rerollDesc` branch @ 17227678;
- `this.scene.gameData.gameStats.reroll++` / `permaReroll++` counters;
- the reroll also consumes `PERMA_FREE_REROLL` (if `freeRerollFromPerma`) and there is a 50% chance (Le(100)<=50) of removing one of the `PERMA_REROLL_COST_*`;
- the cost cache is flushed with `clearCachedRerollCost()` before generation.

### How many options (ITEMCOUNT) — `SelectModifierPhase.start` @ 17211458

```js
const i = new bn(3);                          // 3 base slots
applyModifiers(pN, true, i);                  // pN = ExtraModifierModifier: +1 per stack (max 3)
let l = 1;
PERMA_MORE_REWARD_CHOICE_3 → l = Le(4,1)      // +1..4
PERMA_MORE_REWARD_CHOICE_2 → l = Le(3,1)      // +1..3
PERMA_MORE_REWARD_CHOICE_1 → l = Le(2,1)      // +1..2
Le(100,1) <= 5 → l += 1;                       // +1 with 5% probability
const c = getModifierTypeOptions(i.value + l); // total options
```

### Lucky — `getPartyLuckValue` @ 18569979

```js
function JFe(a) { return Le(7, 1) }           // randSeedInt(7,1) → random integer 1..7
u(JFe, "getPartyLuckValue");
```

**Key discovery:** the current build **completely ignores the party** and returns a random integer 1..7. Its only in-battle use is `randomSpecies` (function @ 21911465) as the wild-encounter rarity parameter. **LUCK does not influence the post-battle roll.** The only "luck" in the roll is:
- 5% free reroll (`Le(100,1)<=5`);
- 30% free reroll if you own PERMA_FREE_REROLL (`Le(100)<30`);
- 50% removal of a PERMA_REROLL_COST on reroll (`Le(100)<=50`).

> If the userscript must "force luck", the point is: rewrite the result of `getPartyLuckValue` (hook on the battle scene prototype) or zero out the above percentiles by writing the `gameData` fields.

---

## 3. Runtime Values

| Value | Where | Notes |
|---|---|---|
| `scene.money` | battle scene (class extended from `Ee/Err`...) | current run money; `this.money=Math.min(this.money+t, MAX_SAFE_INTEGER)` @ 21926897 (`addMoney` method); normal run init: `money=1e3` @ 17550404; draft/tutorial init: `money=0`/`5e3`/`5e4` (phases @ 21803476–21807341) |
| `gameData.permaMoney` | champion run save | persistent out-of-run coins; `addPermaMoney(-f.rerollCost)` in draft; stat update `18.09–18.19M` |
| `gameData.permaModifiers` | champion run save | perma modifier list (102 occurrences) |
| `gameData.skillPoints` | skill tree | assignments @ 16401121, 18311558, 18410525, 21235845 (`skillPoints+=`); no isolated setter: written directly on the GameData field |
| `gameData.gameStats` | run stats | `rouletteCount`, `reroll`, `permaReroll`, etc. (string hash in the module) |
| reward money wave | `Le(500,200) + battlePathWave*5` @ 17418223 (chaos/return to battle path); payout via `money+=t` + UI `Xs` @ 17418753 | |
| reward type pool | `getRandomRewardType` @ 18664952 | `PERMA_MONEY_1..5` for percentiles 20/50/75/90; `PERMA_MODIFIER`/`PERMA_MONEY_AND_MODIFIER` below the 80th; `PERMA_MONEY_*` above |
| rarity | `getRaritiesForRewardType` @ 16259742; `isRewardAvailableAtRarity` @ 16259827 | enum St: ROGUE, MASTER, LEGENDARY, GREAT |

---

## 4. Save

- **Primary key:** `` `data_${username}` `` — the name is not hardcoded; with a guest user the key is `data_guest` (verified 1 occurrence @ 18879832: `localStorage.getItem("data_guest")` read to decide intro).
- **Writer:** `setLocalStorageItem(\`data_${username}\`, Cd(s, Lr))` @ 18092538; reader `getLocalStorageItem(...)` → `fl(...)` @ 18093031.
- **Encryption:** `function Cd(a,t){return a}` = `encrypt` @ 18070594 and `fl` = `decrypt` → **identity: the save is plaintext JSON** (no compression/encryption in this build). The `Lr` argument is only a placeholder.
- **Backup:** `data_backup_VERSION_${KA}_${username}` (with KA = current version) @ 18089052–18089216; snapshot `.replace(/[^a-zA-Z0-9]/g,"_")`; `_bak` backups used by `updateUserInfo` (`${n}_${Bt.username}_bak` @ 15292462); version backup cleanup @ 18086330 and 18180992.
- **Internal format:** `combinedData` field serialized with `serializeBigInt` (bigints → string) @ 18094928; `JSON.parse(fl(getLocalStorageItem(...)))` for reading; blob export/import @ 18143018 (`getExportDataBlob`).
- **Migration:** `updateVersionBackup(t,n)` @ 18089052 (saves a backup before migrating from an older version); backup invalidation on version breach @ 18179796.

> **Userscript implication:** you can write `localStorage[\`data_${username}\`]` directly with valid JSON (bigint as string), or — more safely — manipulate the fields in memory via the `gameData` object and let the game save at the right time (`scene.saveToLocalStorage()`).

---

## 5. GameInfo

- **Writer:** `updateGameInfo()` method of the battle scene @ 21940791 → assigns `window.gameInfo` @ 21941177:
  ```js
  window.gameInfo = {
    playTime, gameMode, biome, wave, party: [{name, level}], modeChain
  }
  ```
- **`updateGameInfo` callers:** 17418095, 17506663, 21706840, 21708229, 21708805, 21856900, 21886456, 21940791 (scene start, UI mode change, end of battle).
- If the userscript modifies runtime values (money, luck, slots), refresh the exposed value by invoking `scene.updateGameInfo()` (or by hooking the function and rewriting the fields afterwards).

---

## 6. Phaser.Game Hook

- Game construction: **`new Fn.Game(xfD)`** @ 22747724, followed by `ji.sound.pauseOnBlur=!1`. `Fn` is the renamed Phaser import (local alias), `xfD` the game config variable defined in the same module.
- The statement is wrapped in `startGame` (function `YfD`, try/catch with `console.error("Error starting the game:")`).
- Boot flow: `KfD()` (boot: fetch `/manifest.json` → `ji.manifest`) followed by a `visibilitychange` listener (driveSyncService).
- For a reliable post-start hook: poll `window.gameInfo` (written by `updateGameInfo` at every phase transition) to latch onto the battle scene, or hook the cost/options prototype via `Fn.Game` (all classes are on window-scope module level, reachable through the module chain with `keepNames`).

---

## 7. Implementation Recommendations

1. **Do not touch the cost formula at runtime**: hooking `getRerollCost`'s result is destabilizing (cache + constant `Math.min`). Better to directly overwrite the `money`/`permaMoney` fields or force a `WAIVE_ROLL_FEE_OVERRIDE`-style path only for the test dropdowns, not in production.
2. **Slots (ITEMCOUNT)** should be increased by acting on `getModifierTypeOptions` → through the `Wd` binding (battle scene prototype) you can return a larger number of options; alternatively apply an `ExtraModifierModifier` in memory (`applyModifiers(pN, true, holder)`) — an existing, safe native behavior.
3. **LUCK**: there is no real "party luck" in the roll; to influence roll fortune act on the free-reroll percentages (5%/30%) or on the weighted pool (`WeightedModifierType`); for the value exposed in battle hook `getPartyLuckValue` returning 7 (or the desired value).
4. **Save**: plaintext JSON payload under `data_${username}`; if writing from outside, respect the bigint→string conversion (`serializeBigInt`) and **create the backup first** (`data_backup_VERSION_${KA}_${username}`) for rollback.
5. **Target functions (`keepNames` names, 3,223-array):** `SelectModifierPhase`, `getRerollCost`, `getPlayerModifierTypeOptions`, `getNewModifierTypeOption`, `ExtraModifierModifier`, `getPartyLuckValue`, `getRandomRewardType`, `getRaritiesForRewardType`, `updateGameInfo`, `startGame`.

### Critical AOB signatures (build byte-code, hex)

```text
SelectModifierPhase (class su start)                          @ 17211337
73 75 3D 63 6C 61 73 73 20 73 75 20 65 78 74 65 6E 64 73 20 47 69 7B 63 6F 6E 73 74 72 75 63 74 6F 72 28 74 2C 6E 3D 30 2C 73 2C 69 3D 21 31 2C

getRerollCost (method start)                                  @ 17223212
67 65 74 52 65 72 6F 6C 6C 43 6F 73 74 28 74 2C 6E 29 7B 69 66 28 6F 74 2E 57 41 49 56 45 5F 52 4F 4C 4C 5F 46 45 45 5F 4F 56 45 52 52 49 44 45

getPartyLuckValue (JFe)                                       @ 18569979
75 28 4A 46 65 2C 22 67 65 74 50 61 72 74 79 4C 75 63 6B 56 61 6C 75 65 22 29 3B 63 6F 6E 73 74 20 64 66 65 3D 63 6C 61 73 73 20 64 66 65 20 65

getPlayerModifierTypeOptions (Wd)                             @ 18558674
75 28 57 64 2C 22 67 65 74 50 6C 61 79 65 72 4D 6F 64 69 66 69 65 72 54 79 70 65 4F 70 74 69 6F 6E 73 22 29 3B 66 75 6E 63 74 69 6F 6E 20 71 46

getRandomRewardType (fWe)                                     @ 18664952
75 28 66 57 65 2C 22 67 65 74 52 61 6E 64 6F 6D 52 65 77 61 72 64 54 79 70 65 22 29 3B 66 75 6E 63 74 69 6F 6E 20 58 6E 65 28 61 2C 74 29 7B 6C

gameInfo setter                                               @ 21941177
77 69 6E 64 6F 77 2E 67 61 6D 65 49 6E 66 6F 3D 74 7D 69 6E 69 74 46 69 6E 61 6C 42 6F 73 73 50 68 61 73 65 54 77 6F 28 74 29 7B 69 66 28 74 20

new Fn.Game (game start)                                      @ 22747724
6E 65 77 20 46 6E 2E 47 61 6D 65 28 78 66 44 29 2C 6A 69 2E 73 6F 75 6E 64 2E 70 61 75 73 65 4F 6E 42 6C 75 72 3D 21 31 7D 63 61 74 63 68 28 61

encrypt (identity, plaintext save)                            @ 18070594
66 75 6E 63 74 69 6F 6E 20 43 64 28 61 2C 74 29 7B 72 65 74 75 72 6E 20 61 7D 75 28 43 64 2C 22 65 6E 63 72 79 70 74 22 29 3B 66 75 6E 63 74 69

save writer data_${username}                                  @ 18092538
60 64 61 74 61 5F 24 7B 42 74 3D 3D 6E 75 6C 6C 3F 76 6F 69 64 20 30 3A 42 74 2E 75 73 65 72 6E 61 6D 65 7D 60 2C 43 64 28 73 2C 4C 72 29 29 2C

money reward (chaos, Le(500,200)+wave*5)                      @ 17418223
65 78 3D 74 68 69 73 2E 62 61 74 74 6C 65 50 61 74 68 57 61 76 65 7D 61 64 64 57 61 76 65 54 6F 52 69 76 61 6C 57 61 76 65 73 28 74 29 7B 74 68
```

> The signatures are substrings of the minified bundle: in Tampermonkey patterns use the offset as a carpet-bomb guard (e.g. anchor the find on the unique match of the 24+ byte signature), since the bundle is a single line.

---

### Appendix — extraction scripts used
`re_map.py` (string map), `re_names.py` (3,223 symbol list → `re_names_out.txt`), `re_ctx1.py`…`re_ctx15.py` (±N character context extraction with redirect to `.txt`). All in `C:\Users\Amministratore\vsc-work\`.

---

## v1.4 Update

- **«Modifier type option is null» fix (T1)**: `getModifierTypeOptions` of the roll controller now probes the native with the **nominal** count and, if the filtered pool is saturated, **clamps** effectiveCount to `min(nominal + extra, probed length)` instead of forcing `+extra` on an empty pool (roll-controller.js ~143-162), with resync of the `modifierTiers` (luck lock) on effectiveCount (`luckTierPool(state.luckValue, effectiveCount)`). Eliminated the cause of duplicate choices/emptied pool.
- **Reroll hooks warning reworked (T2)**: the immediate warn on non-applied `applyHooks()` was a systematic false positive (the actual application happens at the first push/unshift of a `su` phase). Now: immediate `console.log` + **a single delayed warn at 60s** (`setTimeout(..., 60000)` in main.js ~117-126) that only fires if `hooksApplied` is still false — an honest incompatibility signal, not noise.