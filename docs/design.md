# PokeVoid-Unlocked — Design Document v2.0

> Revisione del v1 applicando TUTTI i fix della review critica di Poseidon (evidenze RE bundle v3.1.8, index-BA2n6IsS.js, 25.7MB, esbuild keepNames).

## 1. Header Userscript

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

`@run-at document-start` obbligato: hook Phaser.Game prima che il bundle inietti. `@noframes` evita doppio caricamento. `@grant none`.

## 2. Accesso al Gioco — Strategia a 3 Livelli

1. **Hook Phaser.Game (primario)**: monkeypatch costruttore → `new Fn.Game(xfD)` @22747724 in startGame; salva istanza in `window.__pvu_game`.
2. **Poll window.gameInfo (stato)**: scritto da `updateGameInfo()` a ogni transizione (playTime, biome, wave, party, modeChain). Poll 500ms (100ms durante transizioni).
3. **CanvasPool fallback (battle)**: `CanvasPool.pool[0].parent.game.scene.keys.battle`. Solo se 1 e 2 falliscono, solo in combattimento.

Ordine: 1 → 2 → 3. Se nessun livello è disponibile → disabilita UI con messaggio chiaro.

## 3. Lookup Robusto Classi e Funzioni

- **Classi** (keepNames): ricerca stringa nel bundle → classe resolvibile per nome (`SelectModifierPhase`).
- **Funzioni minificate**: 10 AOB signature dalla sezione 7 del report RE come fingerprints primari; fallback string search.
- **Mappa COMPAT** `{ 'v3.1.8': { classes: {...}, functions: {...} } }` — aggiornare quando il bundle cambia.

## 4. Moduli Funzionali

### 4A. Money Override
- `scene.money` (run, init 1000) + `gameData.permaMoney` (persistente, bigint string). Aggiornare entrambi.
- Hook `updateMoneyText`/`updateGameInfo` per refresh visivo. Scrittura permaMoney via `gameData.setLocalStorageItem`.
- Cap MAX_SAFE_INTEGER in addMoney — non superare.

### 4B. Roll Controller — 3 Toggle Oneste (NON "luck" — non esiste nel roll)
Rimosso setLuck→phase.luck (inesistente). Rimosso setRollCount per itemcount (rollCount = contatore reroll).

| Toggle | Label UI | Meccanismo |
|--------|----------|------------|
| Free Reroll | "Reroll gratuito" | Hook getRerollCost → 0 una volta, poi auto-off |
| Pool Quality | "Qualità pool" | Hook getRaritiesForRewardType → tier minimo Legendary |
| Cost Override | "Nessun costo" | WAIVE_ROLL_FEE_OVERRIDE = true (flag nativo) |

**Itemcount reale**: hook `getModifierTypeOptions`/`getPlayerModifierTypeOptions`, incremento del parametro count (default +2, max +4). UI: slider extra 0–4.

### 4C. Skill Tree Editor
- Valuta: `gameData.skillPoints` (campo diretto). Champion attivo: `gameData.selectedChampionId`.
- Unlock skill: bypass check skillPoints+essenceWeights, spesa=0, push unlockableId in `unlocked<Category>` (arrayMap: megaStones→unlockedMegaStones, xms→unlockedXMs, smittyAbilities→unlockedSmittyAbilities, legendaryPokemon→unlockedLegendaryPokemon, signaturePokemon→unlockedSignaturePokemon, glitchForms→unlockedGlitchForms), remove da lockedSkills, `gameData.saveSystem()`.
- **championSkillVersion**: salvare `__pvu_unlockedVersion` con gli unlock; se diversa al load → warning UI "versione skill cambiata, unlock precedenti potrebbero non essere validi", nessuna cancellazione automatica.

### 4D. Catch Any — Guaranteed Capture (v1.4)

Rework del Catch Any (Task 0 v1.4): ogni Pokéball lanciata su un bersaglio singolo non-escluso che il gate nativo di cattura del gioco RIFIUTA viene force-iniettata e quella cattura è garantita; i lanci che il gioco accetta da solo mantengono le odds native. Approccio a 2 livelli:

- **L2 — wrapper su `CommandPhase.prototype.handleCommand`**: chiama prima il gate nativo; se il nativo accetta (return true + turnCommands assegnato) passa through e **impara l'ID del comando BALL solo su un successo nativo di comando BALL** (`capture-override.js` ~637-647; aprendimento mai su FIGHT/etc.). Se il nativo blocca e il comando è BALL (id da `state.ballCommandId`, **fallback assunto = 1** finché non osservato, `BALL_CMD_ID_FALLBACK`), il wrapper esegue il **force-inject** replicando esattamente il ramo successo nativo (turnCommands + targets + skip partner + `end()`). `level2Verified` è solo report, NON è più nel gate: l'inject gira al primo tentativo.
- **L1 — backstop live**: 99 pokeball per ogni tipo (`pokeballCounts` + `typeBallCounts`) ri-armati ad **ogni CommandPhase push** (`l1BackstopInterceptor`), non solo al boot. Risolve il gate `count=0` anche se scade in corsa; i gate boss/rival/etc. richiedono L2.

**Esclusioni deterministiche (fail-closed)** — replicate dal gate nativo del case BALL (bundle v3.1.8), ogni controllo che solleva eccezione ⇒ escluso (`isExcluded`):
- rival / scripted: `battleType===TRAINER && gameMode.checkIfRival(scene)`
- multi-target: nemici attivi != 1 (difesa in profondità anche in `forceInject`)
- biome END, wave pre-final (`isWavePreFinal`)
- leggendario / OP-form pre-wave-1000 (`isLegendSubOrMystical` / `isOPForm`, gate nativo COL 16903330)
- boss-major: `isBoss() && bossSegmentIndex>=1`; segmento non determinabile ⇒ escluso

**Limite noto**: specie con `species.isObtainable() === false` (non ottenibili nel gioco) → `failCatch` nativo pre-roll, il mod NON può forzarla.

I casi speciali (rival/scripted/leggendari/END/boss) restano esclusi da Catch Any in v1.4; il toggle **Cattura casi speciali** è disponibile da v1.5.0 (default OFF).

**Override probabilità di cattura (token-arm, sentinel 65536)**: il roll di cattura usa `t.randSeedInt(65536)` sul Pokémon bersaglio (3 draw nel tween onRepeat di `AttemptCapturePhase.start`). A tentativo armato, `randSeedInt` dell'istanza viene patchato con scoping `v===65536 ? -1 : nativo` (FIX 4: patch ristretta al solo draw di cattura). `-1 < m` per ogni `m>=0` (m=0 incluso) ⇒ il primo draw passa sempre. Il token (`{pokemon, turn, pokeballType, fieldIndex}`) è armato nel force-inject e consumato **monocattura** allo start della `AttemptCapturePhase` (match per identità dell'oggetto pokemon + fieldIndex); restore in `catch`/`failCatch`/`end` (try/finally-semantics); token stantio invalidato a inizio turno (`TurnInitPhase`/`TurnStartPhase`). MASTER_BALL/VOID_BALL restano 100% nativi (ballMult -1/-2).

**Money pre-grant**: su battaglia trainer il force-inject **pre-granta** la moneta necessaria (`getRequiredMoneyForPokeBuy`) via `moneyOverride.setMoney` (BigInt-safe) prima della cattura — risolve il gate 5 del nativo per lo snatch trainer. Contatori di telemetria: `injectedCount`, `capturedCount`, `blockedCount`, `errorCount` (auto-degrade a L1 dopo 3 errori).

## 5. Gestione Save
Regola: mai scrivere durante animazioni (solo fasi statiche). Protocollo: 1) backup `data_pvu_backup_<ts>_<username>`; 2) scrittura via `gameData.setLocalStorageItem('data_'+username, ...)`; 3) validazione post-write (rileggi+confronta, mismatch→ripristina backup+notifica); 4) log console `[PokeVoid-Unlocked]`.

## 6. Phase Observer
- Primario: hook `unshiftPhase`/`pushPhase` della battle scene.
- Fallback: poll `window.gameInfo.modeChain` (500ms, 100ms in transizione).
- Mapping: Battle→Money ✓; ModifierSelect→Money+Roll ✓; Shop→Money ✓; Menu/Skill→Money+Skill ✓; Title/Loading→nessuno.

## 7. UI Components (v1.6.0)
- **Floating button**: fixed, z-index 99999, bottom-right (spazio ~134px), 40×40, monogramma **PV** (13px, weight 800, colore #4fa3ff; niente emoji, niente dipendenze), hover scale.
- **Panel**: destra, width 380px, pointer-events:none container / auto figli, scuro semi-opaco blur; **6 tab testuali** (Battle / Roll / Skill / Voucher / Essence / Money), niente emoji nei tab; close button `×` (U+00D7); stato conveyed via classi `.ok`/`.warn`/`.err`.
- **Status strip**: 3 chip sotto l'header — versione (`pvu.config.VERSION`), stato del gioco (`window.gameInfo`/bridge → waiting/running), conteggio override attivi (try/catch su `.getState()` di encounterOverride / rollController / captureOverride); refresh via `setInterval` 2s, cleanup in `destroy()`.
- **About modal**: backdrop + card centrata; righe per versione / scorciatoia (bottone **Rebind** → `hotkey.startCapture`, aggiorna live la hint) / elenco funzionalità; chiusura con bottone Close o click sul backdrop.
- **Hotkey**: default `Ctrl+Shift+P`, rebindabile; combo persistita come JSON (`data_pvu_hotkey`); accettata solo con ≥1 di Ctrl/Alt/Meta, non tasto modificatore nudo, tasto singolo stampabile; eventi da `input`/`select`/`textarea`/contentEditable ignorati; capture con timeout 5s.
- **Stili (design token)**: CSS custom properties — bg `#0e1014`, surface `#171a21`, border `#2a2f3a`, text `#e6e9ef`, secondary `#9aa4b2`, accent `#4fa3ff`, success `#3ddc97`, warning `#ffb454`, danger `#ff5c5c`; radii 8/6/4; spacing 4/8/12/16/24; type scale 11/13/15/17px; transition 0.18s; font stack `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`.
- **Lingua**: UI e console in **inglese**, senza emoji né simboli (✓/✗/⚠️/✅/⚡ rimossi; restano `—` e `→`); stringhe UI via `t()` (`PvuI18n`, `DICT.en` con fallback key), log console come literal inglesi (mai `t()`). I commenti nel codice restano italiani (decisione permanente).

## 8. Valori Runtime & Save
- runtime: scene.money (init 1000), gameData.permaMoney (bigint string), gameData.skillPoints, gameData.selectedChampionId, window.gameInfo (snapshot).
- save `data_<username>`: trainerId, permaMoney, permaModifiers, selectedChampionId, championSkillVersion, pendingChampionLevelUps, skillPoints, championData.<id>.{lockedSkills[skillId, requiredEssenceWeights, level], unlockedMegaStones, unlockedXMs, unlockedSmittyAbilities, unlockedLegendaryPokemon, unlockedSignaturePokemon, unlockedGlitchForms}, + chiavi non toccate.
- GameData API: saveSystem(), loadSystem(), getSystemSaveData(), setLocalStorageItem(key,val), getLocalStorageItem(key).

## 9. Piano MVP (fasi con criterio di uscita binario)
1. **Bootstrap**: header, hook Phaser.Game, floating button → appare 10/10 avvii, no errori console, click-through.
2. **Money Override**: campo numerico+Apply → gioco mostra nuovo importo al prossimo frame; persiste dopo save/load.
3. **Free Reroll**: toggle ON → prossimo reroll costo 0 in UI gioco; auto-off dopo uso; Cost Override per N consecutivi.
4. **Item Count**: slider +2 → 5 opzioni (3+2); +4 → 7; opzioni valide senza crash.
5. **Skill Points Editor**: menu skill gioco mostra nuovo valore; skill sbloccata appare; warning versione; persiste.
6. **Stabilità**: 30 min gameplay (battle, shop, skill, save/load, reroll) senza crash; console solo ≥warning; RAM stabile.

## 10. Struttura Repo
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

Zero dipendenze. Bundle minimale singolo file in fase 2 (non blocca MVP).

## 11. Rischi
Firma funzione cambia → COMPAT+AOB+string search. API gameData cambia → validazione+backup+try/catch rollback. championSkillVersion bump → warning, no auto-cancel. Scrittura in animazione → phase observer. Font assente → fallback system-ui.

### Note verificate (rumore console game-side, NON del mod)

- Residual `[LOAD ERROR] initSystem failed` (bundle v3.1.8): classificato **game-side** — investigato e verificato in sessione T4, non causato dal mod.
- Chrome `Canvas2D: Multiple readback operations using getImageData...` (willReadFrequently warning): attribuibile al **gioco** (canvas/bundle usa `getImageData` senza `willReadFrequently`), non al mod. Vedi docs/COMPATIBILITY.md.
- LCP attribution («lcp com triggered by script...» in Performance panel): attribuibile al **gioco** (parse del bundle ~25.7MB), non al mod. Vedi docs/COMPATIBILITY.md.

### 4E. Essence Editor

- Purpose: edit run-time Type Essence counts without inventory editing or save manipulation.
- Runtime API discovery: `findGameData()` (via `window.__pvu.bridge`) → `getEssenceCount` / `addEssence` / `tryConsumeEssence`. The runtime type enum dict is located by BFS scan for the `SMITTY` key over gameData (max depth 3, MAX_CHILD_SCAN = 40 scanned properties overall) and used **only for verification** — never for id resolution.
- **Canonical map = truth**: `TYPE_IDS` is a hardcoded 24-entry table (sentry `UNKNOWN: -1` + all 23 native type ids `NORMAL: 0` … `GEN_ONE: 22`, verbatim from enum S of bundle v3.1.8). `resolveTypeIds()` always returns the canonical ids — the old id=index fallback is gone, and key→id never depends on list order or on the BFS result.
- **Native order**: `TYPE_ORDER` follows the native enum order (UNKNOWN → GEN_ONE); the combobox uses this order so the selected value always maps to the correct native id. `UNKNOWN` is filtered from the combobox (not selectable).
- **`verifyEnum()` (fail-open)**: cross-checks the runtime enum against the canonical map and reports any mismatch to the console. `findTypeEnum` requires the `SMITTY` + (`GEN_ONE`|`STELLAR`) discriminator pair to avoid false-positive enum hits. On divergence or absence the editor keeps working with the canonical ids — a console AVVISO is logged, never a hard disable.
- Absolute-value semantics: Applica sets the type count to the entered absolute value by computing delta and calling add/consume natively — it never raw-writes gameData.
- **UX (v1.5.1)**: single input field below the combobox, bound to the selected type, pre-filled with the live current value, editable in-place with debounced apply (~350ms). The +1/−1 quick buttons and the "Attuale: X (totale: N)" label were removed.
- Honest degradation: tab disabled with warning when the APIs are absent; empty input rejected with an explicit error (no zero-wipe); values sanitized (digits-only regex, clamp to MAX_SAFE_INTEGER, BigInt-safe reads); `init()` is idempotent and re-runs on each Essenze tab render.

### 4F. Cattura casi speciali

- Default-OFF toggle (Battle tab). When ON, the Catch-Any inject is allowed to also lift the five exclusion branches: scripted rival, END biome, wave-final, legendary/OP pre-1000, boss-major — every `return true;` path inside each branch gets the `if (!forceSpecial)` wrap, including the legendary catch that continues to the Outer-Catch backstop; branches that stay unconditional: multi-target throws and the outer catch.
- Money pre-grant unchanged (trainer-scoped — wild enemies have no money cost).
- Risk notes: quest progression/unlocks may be affected by forced captures during scripted/final encounters; ETERNATUS/VOID high-HP captures are only possible when the boss-major lift is accepted (opt-in, default OFF) and force-inject deliberately overrides the native VOID_BALL hpRatio gate (gate not replicated in isExcluded); species with `isObtainable() === false` still fail the native `failCatch` before the roll and cannot be forced.
