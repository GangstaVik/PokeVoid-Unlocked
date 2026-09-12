# PokeVoid — Reverse Engineering del Sistema di Roll Post-Battaglia

> Analisi statica del bundle JavaScript di produzione — nessun codice eseguito.

---

## 1. VERSIONE BUNDLE ANALIZZATO

| Metadato | Valore |
|---|---|
| **Bundle** | `assets/index-BA2n6IsS.js` (servito live da `https://pokevoid.com/assets/index-BA2n6IsS.js`) |
| **Dimensioni** | 25.703.504 byte (22.753.130 caratteri) |
| **SHA-256** | `A2DD2F6CFD3DEA3F60D2898EFBFF49E4FE41A760B504C9A9D15B3A79E9D2407D` |
| **Dump locale** | `C:\Users\Amministratore\vsc-work\pokevoid-bundle.js` |
| **Build** | esbuild minified con `keepNames` attivo: i nomi funzione originali sono conservati tramite il pattern `u(fn, "Nome")` (3.223 funzioni nominate) |
| **Versione** | la stringa `3.1.8` **non è contenuta nel bundle** (verificata: 0 occorrenze); la versione viene iniettata altrove (HTML/meta/server). Il bundle è lo stesso file hash-nominato della sessione v3.1.8 → **v3.1.8 assumendo unchanged** |

Strumenti usati: `verify python`, ricerca per nomi simbolici (`re_names`), estrazione di contesto a offset (`re_ctx1..15`). Tutti gli offset sono byte-position **0-based** nel file dump.

---

## 2. MAPPA DEL ROLL

La schermata "pick-a-prize" post-battaglia è gestita da **`SelectModifierPhase`** (classe `su`). Flusso completo:

```
Fine battaglia
  └─> ModifierRewardPhase @ 16401781 (dispatch in base al contesto:
        GameOverModifierRewardPhase @ 17280274, ShopModifierSelectPhase @ 16886701,
        SelectPermaModifierPhase @ 17277004, SkillTreeModifierPhase @ 17211260)
  └─> su.start()  @ 17211458   ← GENERAZIONE OPZIONI (itemcount + pool)
        ├─ rimescola seed:  sp(party, getPoolType(), max(rerollCount, permaRerollCount))
        │                     (function sp @ 18556872; pool = ki.DRAFT | ki.COLLECTOR)
        ├─ slot base:        new bn(3)
        ├─ +ExtraModifierModifier (class WP @ 18360377, apply = value += stackCount, max 3)
        ├─ +PERMA_MORE_REWARD_CHOICE:  _1 → +Le(2,1)  _2 → +Le(3,1)  _3 → +Le(4,1)
        ├─ +1 slot con probabilità 5% (Le(100,1)<=5)
        └─ getModifierTypeOptions(base+extra) → Wd() @ 18558674
              (genera le N offerte; pool pesato "WeightedModifierType" @ 18495654,
               rarità via getRaritiesForRewardType @ 16259742,
               tipo reward via getRandomRewardType @ 18664952)
  └─> UI: ModifierSelectUiHandler @ 17151912 (render + costi + bottone reroll)
  └─> Payout applicato via applyModifier / addModifier (sottoclasse di ModifierTypeOption
        "ufe" @ 18569909: campo cost)
```

### Costo del reroll — `getRerollCost(t, n)` @ 17223212 (classe `su`)

Formula completa ricostruita dal bytecode:

```js
// n = lockModifierTiers (toggle UI), t = lista opzioni correnti
gerRerollCost(t, n):
  if WAIVE_ROLL_FEE_OVERRIDE  → {0, 0}            // dev override (test)
  if gameMode.isTestMod        → {0, 0}
  se cached                    → cache

  base s = 100
  if CollectedTypeShopPhase    → s = 1500
  else if pathNodeFilter != NONE:
      s = (MASTER_BALL_ITEMS || ROGUE_BALL_ITEMS) ? 1500 : 300

  if lockModifierTiers:
      for opzione in t: s += [50, 125, 300, 750, 2000][opzione.tier ?? 0]
  else:
      PERMA_REROLL_COST_3 → s *= 0.19
      PERMA_REROLL_COST_2 → s *= 0.30
      PERMA_REROLL_COST_1 → s *= 0.45
      nessuno             → s *= 0.60

  if draftOnly: s *= 5

  // free reroll
  if PERMA_FREE_REROLL attivo && Le(100) < 30:  cost = 0  (consuma la perma)
  else if Le(100,1) <= 5:                        cost = 0  (free reroll casuale 5%)
  else:
      wave = draftOnly && nightmare ? waveIndex % 100 : waveIndex
      cost = min( ceil(wave/10) * s * 2^rerollCount , MAX_SAFE_INTEGER )

  // permaRerollCost
  d = (CollectedTypeShopPhase || MASTER/ROGUE_BALL) ? 1250 : (pathNode ? 900 : 300)
  permaCost = min( ceil(wave/10) * d * (pathNode ? 1.2 : 1.5)^permaRerollCount , MAX )

  se rerollCostMultiplier != 1 → entrambi × mult (default 1)
```

Dettagli implementativi osservati nel bytecode:
- il costo viene pagato con `this.scene.money` (run) o `this.scene.gameData.permaMoney` (draft) — ramo `handleButtonAction` case `modifierSelectUiHandler:rerollDesc` @ 17227678;
- `this.scene.gameData.gameStats.reroll++` / `permaReroll++` contatori;
- al reroll viene consumato anche `PERMA_FREE_REROLL` (se `freeRerollFromPerma`) e c'è 50% di chance (Le(100)<=50) di rimuovere uno dei `PERMA_REROLL_COST_*`;
- il cache del costo viene svuotato con `clearCachedRerollCost()` prima della generazione.

### Quante opzioni (ITEMCOUNT) — `SelectModifierPhase.start` @ 17211458

```js
const i = new bn(3);                          // 3 slot base
applyModifiers(pN, true, i);                  // pN = ExtraModifierModifier: +1 per stack (max 3)
let l = 1;
PERMA_MORE_REWARD_CHOICE_3 → l = Le(4,1)      // +1..4
PERMA_MORE_REWARD_CHOICE_2 → l = Le(3,1)      // +1..3
PERMA_MORE_REWARD_CHOICE_1 → l = Le(2,1)      // +1..2
Le(100,1) <= 5 → l += 1;                       // +1 con probabilità 5%
const c = getModifierTypeOptions(i.value + l); // opzioni totali
```

### Lucky — `getPartyLuckValue` @ 18569979

```js
function JFe(a) { return Le(7, 1) }           // randSeedInt(7,1) → intero casuale 1..7
u(JFe, "getPartyLuckValue");
```

**Scoperta chiave:** l'attuale build **ignora completamente il party** e restituisce un intero casuale 1..7. Il solo uso in battaglia è `randomSpecies` (funzione @ 21911465) come parametro di rarità dell'incontro wild. **Il LUCK non influenza il roll post-battaglia.** L'unico "luck" nel roll è:
- 5% free reroll (`Le(100,1)<=5`);
- 30% free reroll se possiedi PERMA_FREE_REROLL (`Le(100)<30`);
- 50% di rimozione di un PERMA_REROLL_COST al reroll (`Le(100)<=50`).

> Se l'userscript deve "forzare il luck", il punto è: riscrivere il risultato di `getPartyLuckValue` (hook sul prototype della battle scene) o azzerare i percentili sopra scrivendo i campi di `gameData`.

---

## 3. VALORI RUNTIME

| Valore | Dove | Note |
|---|---|---|
| `scene.money` | battle scene (classe estesa da `Ee/Err`...) | money della run corrente; `this.money=Math.min(this.money+t, MAX_SAFE_INTEGER)` @ 21926897 (metodo `addMoney`); init run normale: `money=1e3` @ 17550404; init draft/tutorial: `money=0`/`5e3`/`5e4` (fasi @ 21803476–21807341) |
| `gameData.permaMoney` | run save champion | monete persistenti fuori run; `addPermaMoney(-f.rerollCost)` nel draft; aggiornamento stat `18.09–18.19M` |
| `gameData.permaModifiers` | run save champion | lista modificatori perma (102 occorrenze) |
| `gameData.skillPoints` | skill tree | assegnazioni @ 16401121, 18311558, 18410525, 21235845 (`skillPoints+=`); nessun setter isolato: si scrive direttamente sul campo del GameData |
| `gameData.gameStats` | statistiche run | `rouletteCount`, `reroll`, `permaReroll`, ecc. (hash di stringhe nel modulo) |
| reward money wave | `Le(500,200) + battlePathWave*5` @ 17418223 (chaos/return to battle path); payout via `money+=t` + UI `Xs` @ 17418753 | |
| reward type pool | `getRandomRewardType` @ 18664952 | `PERMA_MONEY_1..5` per percentili 20/50/75/90; `PERMA_MODIFIER`/`PERMA_MONEY_AND_MODIFIER` sotto l'80; `PERMA_MONEY_*` sopra |
| rarità | `getRaritiesForRewardType` @ 16259742; `isRewardAvailableAtRarity` @ 16259827 | enum St: ROGUE, MASTER, LEGENDARY, GREAT |

---

## 4. SAVE

- **Chiave principale:** `` `data_${username}` `` — il nome non è hardcoded; con utente guest la chiave è `data_guest` (verificata 1 occorrenza @ 18879832: lettura `localStorage.getItem("data_guest")` per decidere intro).
- **Writer:** `setLocalStorageItem(\`data_${username}\`, Cd(s, Lr))` @ 18092538; reader `getLocalStorageItem(...)` → `fl(...)` @ 18093031.
- **Cifratura:** `function Cd(a,t){return a}` = `encrypt` @ 18070594 e `fl` = `decrypt` → **identità: il save è JSON in chiaro** (nessuna compressione/cifratura in questa build). L'argomento `Lr` è solo un placeholder.
- **Backup:** `data_backup_VERSION_${KA}_${username}` (con KA = versione attuale) @ 18089052–18089216; snapshot `.replace(/[^a-zA-Z0-9]/g,"_")`; backup `_bak` usati da `updateUserInfo` (`${n}_${Bt.username}_bak` @ 15292462); pulizia backup versione @ 18086330 e 18180992.
- **Formato interno:** campo `combinedData` serializzato con `serializeBigInt` (i bigint → string) @ 18094928; `JSON.parse(fl(getLocalStorageItem(...)))` per lettura; esportazione/import blob @ 18143018 (`getExportDataBlob`).
- **Migrazione:** `updateVersionBackup(t,n)` @ 18089052 (salva backup prima di migrare da versione più vecchia); invalidazione backup con version breach @ 18179796.

> **Implicazione userscript:** si può scrivere direttamente `localStorage[\`data_${username}\`]` con JSON valido (bigint come stringa), oppure — più sicuro — manipolare i campi in memoria tramite l'oggetto `gameData` e lasciare che il gioco salvi al momento giusto (`scene.saveToLocalStorage()`).

---

## 5. GAMEINFO

- **Writer:** `updateGameInfo()` metodo della battle scene @ 21940791 → assegna `window.gameInfo` @ 21941177:
  ```js
  window.gameInfo = {
    playTime, gameMode, biome, wave, party: [{name, level}], modeChain
  }
  ```
- **Caller di `updateGameInfo`:** 17418095, 17506663, 21706840, 21708229, 21708805, 21856900, 21886456, 21940791 (start scene, cambio modalità UI, fine battaglia).
- Se l'userscript modifica valori runtime (money, luck, slot), il refresh del valore esposto si ottiene invocando `scene.updateGameInfo()` (oppure hooking della funzione e riscrittura dei campi dopo).

---

## 6. HOOK PHASER.GAME

- Costruzione gioco: **`new Fn.Game(xfD)`** @ 22747724, seguito da `ji.sound.pauseOnBlur=!1`. `Fn` è l'import di Phaser rinominato (alias locale), `xfD` la variabile di config del gioco definita nello stesso modulo.
- L'istruzione è racchiusa in `startGame` (funzione `YfD`, try/catch con `console.error("Error starting the game:")`).
- Flusso di boot: `KfD()` (boot: fetch `/manifest.json` → `ji.manifest`) seguito da `visibilitychange` listener (driveSyncService).
- Per hook post-avvio affidabile: fare polling su `window.gameInfo` (scritto da `updateGameInfo` a ogni transizione di fase) per agganciare la battle scene, oppure hook del prototype del costo/opzioni via `Fn.Game` (tutte le classi sono su `window` scope module-level, accessibili attraverso la catena di moduli con `keepNames`).

---

## 7. RACCOMANDAZIONI IMPLEMENTATIVE

1. **Non toccare la formula del costo a runtime**: agganciare il risultato di `getRerollCost` è destabilizzante (cache + `Math.min` constante). Meglio sovrascrivere direttamente i campi `money`/`permaMoney` o forzare `WAIVE_ROLL_FEE_OVERRIDE`-style solo per i dropdown di test, non in produzione.
2. **Gli slot (ITEMCOUNT)** vanno aumentati agendo su `getModifierTypeOptions` → con il binding `Wd` (prototype della battle scene) si può restituire un numero maggiore di opzioni; in alternativa applicare un `ExtraModifierModifier` in memoria (`applyModifiers(pN, true, holder)`) — comportamento nativo già esistente e safe.
3. **LUCK**: non esiste un "party luck" reale nel roll; per influenzare la fortuna del roll agire sui percentuali free-reroll (5%/30%) o sul pool pesato (`WeightedModifierType`); per il valore esposto in battaglia hook `getPartyLuckValue` restituendo 7 (o il valore desiderato).
4. **Save**: payload JSON in chiaro sotto `data_${username}`; se si scrive dall'esterno, rispettare la conversione bigint→string (`serializeBigInt`) e **creare prima il backup** (`data_backup_VERSION_${KA}_${username}`) per rollback.
5. **Funzioni target (nomi `keepNames`, array di 3.223):** `SelectModifierPhase`, `getRerollCost`, `getPlayerModifierTypeOptions`, `getNewModifierTypeOption`, `ExtraModifierModifier`, `getPartyLuckValue`, `getRandomRewardType`, `getRaritiesForRewardType`, `updateGameInfo`, `startGame`.

### Firme AOB critiche (byte-code della build, hex)

```text
SelectModifierPhase (inizio classe su)                      @ 17211337
73 75 3D 63 6C 61 73 73 20 73 75 20 65 78 74 65 6E 64 73 20 47 69 7B 63 6F 6E 73 74 72 75 63 74 6F 72 28 74 2C 6E 3D 30 2C 73 2C 69 3D 21 31 2C

getRerollCost (inizio metodo)                               @ 17223212
67 65 74 52 65 72 6F 6C 6C 43 6F 73 74 28 74 2C 6E 29 7B 69 66 28 6F 74 2E 57 41 49 56 45 5F 52 4F 4C 4C 5F 46 45 45 5F 4F 56 45 52 52 49 44 45

getPartyLuckValue (JFe)                                     @ 18569979
75 28 4A 46 65 2C 22 67 65 74 50 61 72 74 79 4C 75 63 6B 56 61 6C 75 65 22 29 3B 63 6F 6E 73 74 20 64 66 65 3D 63 6C 61 73 73 20 64 66 65 20 65

getPlayerModifierTypeOptions (Wd)                           @ 18558674
75 28 57 64 2C 22 67 65 74 50 6C 61 79 65 72 4D 6F 64 69 66 69 65 72 54 79 70 65 4F 70 74 69 6F 6E 73 22 29 3B 66 75 6E 63 74 69 6F 6E 20 71 46

getRandomRewardType (fWe)                                   @ 18664952
75 28 66 57 65 2C 22 67 65 74 52 61 6E 64 6F 6D 52 65 77 61 72 64 54 79 70 65 22 29 3B 66 75 6E 63 74 69 6F 6E 20 58 6E 65 28 61 2C 74 29 7B 6C

gameInfo setter                                             @ 21941177
77 69 6E 64 6F 77 2E 67 61 6D 65 49 6E 66 6F 3D 74 7D 69 6E 69 74 46 69 6E 61 6C 42 6F 73 73 50 68 61 73 65 54 77 6F 28 74 29 7B 69 66 28 74 20

new Fn.Game (avvio gioco)                                   @ 22747724
6E 65 77 20 46 6E 2E 47 61 6D 65 28 78 66 44 29 2C 6A 69 2E 73 6F 75 6E 64 2E 70 61 75 73 65 4F 6E 42 6C 75 72 3D 21 31 7D 63 61 74 63 68 28 61

encrypt (identità, save in chiaro)                          @ 18070594
66 75 6E 63 74 69 6F 6E 20 43 64 28 61 2C 74 29 7B 72 65 74 75 72 6E 20 61 7D 75 28 43 64 2C 22 65 6E 63 72 79 70 74 22 29 3B 66 75 6E 63 74 69

save writer data_${username}                                @ 18092538
60 64 61 74 61 5F 24 7B 42 74 3D 3D 6E 75 6C 6C 3F 76 6F 69 64 20 30 3A 42 74 2E 75 73 65 72 6E 61 6D 65 7D 60 2C 43 64 28 73 2C 4C 72 29 29 2C

money reward (chaos, Le(500,200)+wave*5)                    @ 17418223
65 78 3D 74 68 69 73 2E 62 61 74 74 6C 65 50 61 74 68 57 61 76 65 7D 61 64 64 57 61 76 65 54 6F 52 69 76 61 6C 57 61 76 65 73 28 74 29 7B 74 68
```

> Le signature sono substring del bundle minificato: nei pattern Tampermonkey usare l'offset come `carpet-bomb`-proof (es. find a partire dal match unico della firma di 24+ byte), dato che il bundle è un'unica linea.

---

### Appendice — script di estrazione usati
`re_map.py` (mappa stringhe), `re_names.py` (elenco 3.223 simboli → `re_names_out.txt`), `re_ctx1.py`…`re_ctx15.py` (estrazione contesto ±N caratteri con redirect su `.txt`). Tutti in `C:\Users\Amministratore\vsc-work\`.

---

## Aggiornamento v1.4

- **Fix «Modifier type option is null» (T1)**: `getModifierTypeOptions` del roll-controller ora sonda il nativo con il conteggio **nominale** e, se il pool filtrato è saturo, **clampa** l'effectiveCount a `min(nominale + extra, lunghezza sondata)` invece di forzare `+extra` a vuoto (roll-controller.js ~143-162), con resync dei `modifierTiers` (luck lock) sull'effectiveCount (`luckTierPool(state.luckValue, effectiveCount)`). Eliminata la causa delle scelte duplicate/pool svuotato.
- **Warning roll hooks ridefinito (T2)**: il warn immediato a `applyHooks()` non-applicato era un falso positivo sistematico (l'applicazione vera avviene alla prima push/unshift di una phase `su`). Ora: `console.log` immediato + **un solo warn ritardato a 60s** (`setTimeout(..., 60000)` in main.js ~117-126) che scatta solo se `hooksApplied` risulta ancora false — segnale onesto di incompatibilità, non rumore.