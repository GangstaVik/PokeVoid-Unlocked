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

## 5. Gestione Save
Regola: mai scrivere durante animazioni (solo fasi statiche). Protocollo: 1) backup `data_pvu_backup_<ts>_<username>`; 2) scrittura via `gameData.setLocalStorageItem('data_'+username, ...)`; 3) validazione post-write (rileggi+confronta, mismatch→ripristina backup+notifica); 4) log console `[PokeVoid-Unlocked]`.

## 6. Phase Observer
- Primario: hook `unshiftPhase`/`pushPhase` della battle scene.
- Fallback: poll `window.gameInfo.modeChain` (500ms, 100ms in transizione).
- Mapping: Battle→Money ✓; ModifierSelect→Money+Roll ✓; Shop→Money ✓; Menu/Skill→Money+Skill ✓; Title/Loading→nessuno.

## 7. UI Components
- **Floating button**: fixed, z-index 99999, bottom-right (spazio ~134px), 40×40, icona Lucide (text/emoji inline, niente dipendenze), hover scale.
- **Panel**: destra, width 380px, pointer-events:none container / auto figli, scuro semi-opaco blur, tab: Money / Roll / Skill.
- Stili: font gioco 'emerald' (titoli) + 'pkmnems' (body) con fallback system-ui. Palette #1a1a2e/#e94560/#eee.

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
