// ==UserScript==
// @name         PokeVoid-Unlocked
// @namespace    local.pokevoid-unlocked
// @version      1.3.0
// @description  Skill editor, roll controller, money override per PokéVoid
// @author       PokeRogueMOD
// @match        https://pokevoid.com/*
// @updateURL    https://raw.githubusercontent.com/GangstaVik/PokeVoid-Unlocked/master/pokevoid-unlocked.user.js
// @downloadURL  https://raw.githubusercontent.com/GangstaVik/PokeVoid-Unlocked/master/pokevoid-unlocked.user.js
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function() {
"use strict";

// --- src/utils/config.js ---
const PvuConfig = {
  VERSION: '1.3.0',
  PREFIX: 'data_pvu_',
  BUILD_VERSION_FALLBACK: 'v3.1.8',
  MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,

  // compat map: bundle version → known offsets/patterns (verified against pokevoid-bundle.js)
  COMPAT: {
    'v3.1.8': {
      classes: {
        SelectModifierPhase: {
          search: 'SelectModifierPhase',
          minifiedName: 'su',       // class su extends Gi{constructor...
          offset: 17211390,          // byte offset of 'class su '
        },
      },
      functions: {
        getRerollCost: {
          // NOTE: this method is ON SelectModifierPhase (su), NOT on the scene
          aob: 'getRerollCost(t,n){if(ot.WAIVE_ROLL_FEE_OVERRIDE)return{rerollCost:0,permaRerollCost:0}',
          offset: 17223262,
          occurrences: 38,
          instanceHook: true,  // patch on phase instance, not class prototype
        },
        getPlayerModifierTypeOptions: {
          // standalone function Wd, referenced via keepNames: u(Wd,"getPlayerModifierTypeOptions")
          // PARTE 2: NON patchabile (funzione standalone, non un metodo di prototype).
          // Il vecchio hook sceneProto era morto — rimosso dal roll-controller.
          aob: 'u(Wd,"getPlayerModifierTypeOptions")',
          offset: 18558724,
          occurrences: 2,
          instanceHook: false,
          deprecated: true,
        },
        getRaritiesForRewardType: {
          // standalone function bne, referenced via keepNames: u(bne,"getRaritiesForRewardType")
          // PARTE 2: NON patchabile (standalone). Rimosso dal roll-controller.
          aob: 'u(bne,"getRaritiesForRewardType")',
          offset: 16259791,
          occurrences: 1,
          instanceHook: false,
          deprecated: true,
        },
        updateMoneyText: {
          // method on battle scene — scene.updateMoneyText()
          aob: 'updateMoneyText(t=!0){if(this.money===void 0)return',
          offset: 21902723,
          occurrences: 16,
          instanceHook: false,
        },
        updateGameInfo: {
          // method on battle scene — this.updateGameInfo()
          aob: 'updateGameInfo(){var n,s;const t={playTime',
          offset: 21940845,
          occurrences: 8,
          instanceHook: false,
        },
        unshiftPhase: {
          stringSearch: 'unshiftPhase',
        },
        pushPhase: {
          stringSearch: 'pushPhase',
        },
        getModifierTypeOptionsOnPhase: {
          // method su SelectModifierPhase (su): legge this.scene.lockModifierTiers ? this.modifierTiers : void 0
          // Punto di aggancio REALE per item count + luck pool (istanza phase, NON standalone)
          aob: 'getModifierTypeOptions(t){let n=this.pathNodeFilter',
          offset: 17225564,
          occurrences: 2, // su (roll) + classe diversa (shop, @17411223)
          instanceHook: true,
        },
        getPartyLuckValue: {
          // standalone module fn JFe(a){return Le(7,1)} — NON raggiungibile via BFS graph
          // unico call site: this.arena.randomSpecies(t,n,void 0,JFe(this.party)) @21906050
          aob: 'u(JFe,"getPartyLuckValue")',
          offset: 18570036,
          occurrences: 1,
          instanceHook: false, // il luck entra come 4° argomento di arena.randomSpecies
        },
        randomSpeciesOnArena: {
          // metodo sull'istanza arena: randomSpecies(t,n,s,i) — i = luck (overridabile)
          aob: 'randomSpecies(t,n,s,i){var y;const l=this.scene.debugDuelmonWild',
          offset: 15026398,
          occurrences: 1,
          instanceHook: true,
        },
        tierEnumEe: {
          // Ee: MEH=-1, COMMON=0, GREAT=1, ULTRA=2, ROGUE=3, MASTER=4, LUXURY=5
          aob: 'MEH=-1',
          offset: 1664935,
          occurrences: 1,
        },
        rarityEnumSt: {
          // St: COMMON="common", GREAT="great", ULTRA="ultra", ROGUE="rogue", MASTER="master", LEGENDARY="legendary"
          aob: 'COMMON="common"',
          offset: 14460592,
          occurrences: 1,
        },
        WAIVE_ROLL_FEE_OVERRIDE: {
          aob: 'WAIVE_ROLL_FEE_OVERRIDE=!1,this.WAIVE_SHOP_FEES_OVERRIDE',
          offset: 1601620,
          occurrences: 16,
        },
      },
    },
  },

  // mapping fase → features abilitate
  PHASE_FEATURES: {
    battle: ['money'],
    modifierSelect: ['money', 'roll'],
    shop: ['money'],
    skillTree: ['money', 'skill'],
    menu: ['money', 'skill'],
    title: [],
    loading: [],
  },

  // mapping nome unlockable → chiave in unlocked<>
  UNLOCK_MAP: {
    megaStones: 'unlockedMegaStones',
    xms: 'unlockedXMs',
    smittyAbilities: 'unlockedSmittyAbilities',
    legendaryPokemon: 'unlockedLegendaryPokemon',
    signaturePokemon: 'unlockedSignaturePokemon',
    glitchForms: 'unlockedGlitchForms',
  },
};

// esporta come globale
window.__pvu = window.__pvu || {};
window.__pvu.config = PvuConfig;


// --- src/utils/helpers.js ---
const PvuHelpers = (() => {
  const LOG_PREFIX = '[PvuHelpers]';

  /**
   * Cerca un AOB (hex string) nel bundle.
   * L'utente fornisce hex bytes (es: "73 75 3D 63 6C 61 73 73") → convertiti a stringa → indexOf nel bundle.
   * @param {string} hexPattern - Pattern hex separato da spazi
   * @param {string} bundleSource - Contenuto del bundle (opzionale, cercato in window se non fornito)
   * @returns {boolean}
   */
  function aobScan(hexPattern, bundleSource) {
    try {
      const bytes = hexPattern.trim().split(/\s+/).map(h => String.fromCharCode(parseInt(h, 16)));
      const needle = bytes.join('');
      const source = bundleSource || window.__pvu._bundleSource || '';
      if (!source) return false;
      const idx = source.indexOf(needle);
      if (idx === -1) return false;
      window.__pvu._aobHits = window.__pvu._aobHits || {};
      window.__pvu._aobHits[hexPattern.substring(0, 40)] = idx;
      return true;
    } catch (e) {
      console.warn(LOG_PREFIX, 'AOB parse error:', e);
      return false;
    }
  }

  /**
   * Cerca un pattern testuale nel bundle tramite eval indiretto (scrittura script → exec).
   * NOTA: il bundle è un'unica linea → busca direttamente la stringa.
   * @param {string} pattern - Stringa da cercare (es: "getRerollCost")
   * @param {string} contextRange - Byte di contesto attorno al match (default 80)
   * @returns {{ found: boolean, context?: string }}
   */
  function findStringInBundle(pattern, contextRange) {
    contextRange = contextRange || 80;
    try {
      const source = window.__pvu._bundleSource || '';
      if (!source) return { found: false };
      const idx = source.indexOf(pattern);
      if (idx === -1) return { found: false };
      const start = Math.max(0, idx - 30);
      const end = Math.min(source.length, idx + pattern.length + contextRange);
      const context = source.substring(start, end);
      return { found: true, context: context };
    } catch (e) {
      console.warn(LOG_PREFIX, 'string search error:', e);
      return { found: false };
    }
  }

  /**
   * Trova il riferimento a una funzioneprototype cercando il pattern keepNames: u(Ref, "name")
   * @param {string} functionName - Nome della funzione (es: "getRerollCost")
   * @returns {{ ref?: any, found: boolean }}
   */
  function findFunctionRef(functionName) {
    try {
      const result = findStringInBundle('"' + functionName + '"');
      if (!result.found) return { found: false };
      // Cerca il pattern u(Ref, "name") — il ref è il parametro prima della stringa
      const pattern = functionName + '"';
      const source = window.__pvu._bundleSource || '';
      // Cerca "functionName"" (con virgolette) nel contesto della keepNames call
      // Pattern: u(VARIABLE, "functionName") — il nome è dopo u(...,
      // Usiamo exec su regex per estrarre il riferimento
      const regex = new RegExp('u\\((\\w+),"\\' + functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\)', 'g');
      const match = regex.exec(source);
      if (match) {
        // match[1] è il nome della variabile locale — non è direttamente accessibile
        // Serve hooking tramite il prototype
        return { found: true, varName: match[1] };
      }
      return { found: result.found };
    } catch (e) {
      console.warn(LOG_PREFIX, 'findFunctionRef error:', e);
      return { found: false };
    }
  }

  /**
   * Hook una funzione su un prototype, wrappando la funzione esistente.
   * @param {Function} Proto - Il prototype target
   * @param {string} methodName - Nome metodo
   * @param {Function} interceptor - (original, ...args) => result — puoi modificare args o return
   * @returns {{ unpatch: Function }} per rimuovere l'hook
   */
  function hookPrototype(Proto, methodName, interceptor) {
    if (!Proto || !Proto[methodName]) {
      console.warn(LOG_PREFIX, 'hookPrototype: target not found', methodName);
      return { unpatch: function() {} };
    }
    // PARTE 4: anti-riwrap — se già wrappato da noi, non rimpiazzare di nuovo
    if (Proto[methodName][Symbol.for('pvuPatched')]) {
      return { unpatch: function() {} };
    }
    const original = Proto[methodName];
    const wrapped = function() {
      const args = Array.from(arguments);
      try {
        return interceptor.call(this, original, args);
      } catch (e) {
        console.error(LOG_PREFIX, 'hook error on', methodName, e);
        return original.apply(this, arguments);
      }
    };
    wrapped[Symbol.for('pvuPatched')] = true;
    Proto[methodName] = wrapped;
    return {
      unpatch: function() {
        Proto[methodName] = original;
      }
    };
  }

  /**
   * Hook un setter su window per un property name.
   * @param {string} prop
   * @param {Function} interceptor - (originalSetter, value) => void
   */
  function hookWindowSetter(prop, interceptor) {
    let _value = window[prop];
    let _desc = Object.getOwnPropertyDescriptor(window, prop);
    if (!_desc) {
      // crea descriptor vazio
      _desc = { configurable: true, enumerable: true };
    }
    const originalSet = _desc.set;
    const originalGet = _desc.get || function() { return _value; };

    Object.defineProperty(window, prop, {
      configurable: true,
      enumerable: true,
      get: originalGet,
      set: function(val) {
        try {
          interceptor(originalSet ? originalSet.bind(this) : function(v) { _value = v; }, val);
        } catch (e) {
          console.error(LOG_PREFIX, 'hookWindowSetter error on', prop, e);
          if (originalSet) originalSet.call(this, val);
          else _value = val;
        }
      },
    });
  }

  /**
   * Debounce semplice
   */
  function debounce(fn, ms) {
    let timer = null;
    return function() {
      const ctx = this;
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
    };
  }

  /**
   * Clamp number a [min, max]
   */
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  return {
    aobScan: aobScan,
    findStringInBundle: findStringInBundle,
    findFunctionRef: findFunctionRef,
    hookPrototype: hookPrototype,
    hookWindowSetter: hookWindowSetter,
    debounce: debounce,
    clamp: clamp,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.helpers = PvuHelpers;


// --- src/utils/storage.js ---
const PvuStorage = (() => {
  const LOG_PREFIX = '[PvuStorage]';

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function error() {
    console.error.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * Crea backup dello save corrente prima di ogni modifica.
   * @returns {{ ok: boolean, key?: string, error?: string }}
   */
  function createBackup(username) {
    try {
      const key = 'data_' + username;
      const data = localStorage.getItem(key);
      if (!data) {
        warn('Nessun save da backupare per utente:', username);
        return { ok: true }; // nothing to backup
      }
      const ts = Date.now();
      const backupKey = 'data_pvu_backup_' + ts + '_' + username;
      localStorage.setItem(backupKey, data);
      log('Backup creato:', backupKey, '(' + data.length + ' bytes)');
      return { ok: true, key: backupKey };
    } catch (e) {
      error('Backup fallito:', e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * Validazione post-write: rilegge il save, confronta col valore scritto.
   * Se mismatch → rollback al backup + notifica.
   * @param {string} username
   * @param {string} expectedValue - Il valore che abbiamo scritto
   * @param {string} backupKey - La key del backup (da rollbackare in caso di errore)
   * @returns {{ ok: boolean, mismatch?: boolean, error?: string }}
   */
  function validatePostWrite(username, expectedValue, backupKey) {
    try {
      const key = 'data_' + username;
      const actual = localStorage.getItem(key);
      if (actual !== expectedValue) {
        warn('MISMATCH post-write! Prendo rollback da backup:', backupKey);
        if (backupKey) {
          const backupData = localStorage.getItem(backupKey);
          if (backupData) {
            localStorage.setItem(key, backupData);
            log('Rollback completato da:', backupKey);
          } else {
            error('Backup non trovato:', backupKey);
          }
        }
        return { ok: false, mismatch: true };
      }
      log('Validazione post-write OK');
      return { ok: true };
    } catch (e) {
      error('Validazione fallita:', e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * Scrivi save con protocollo completo: backup → write → validate → log.
   * @param {string} username
   * @param {object} saveObject - L'oggetto save da serializzare
   * @returns {{ ok: boolean, error?: string }}
   */
  function writeSave(username, saveObject) {
    try {
      // 1. backup
      const backup = createBackup(username);
      if (!backup.ok) {
        return { ok: false, error: 'Backup failed: ' + backup.error };
      }

      // 2. serializza (bigint → string)
      const serialized = serializeBigInt(saveObject);
      const jsonStr = JSON.stringify(serialized);

      // 3. scrivi
      const key = 'data_' + username;
      localStorage.setItem(key, jsonStr);
      log('Save scritto:', key, '(' + jsonStr.length + ' bytes)');

      // 4. valida
      const validation = validatePostWrite(username, jsonStr, backup.key);
      if (!validation.ok) {
        return { ok: false, error: 'Validation failed: mismatch=' + validation.mismatch };
      }

      return { ok: true };
    } catch (e) {
      error('writeSave fallito:', e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * Leggi il save corrente.
   * @param {string} username
   * @returns {object|null}
   */
  function readSave(username) {
    try {
      const key = 'data_' + username;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      error('readSave fallito:', e);
      return null;
    }
  }

  /**
   * Serializza oggetto convertendo bigint → string (come il gioco).
   */
  function serializeBigInt(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (Array.isArray(obj)) return obj.map(serializeBigInt);
    if (typeof obj === 'object') {
      const result = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = serializeBigInt(obj[key]);
        }
      }
      return result;
    }
    return obj;
  }

  /**
   * Recursive: normalizza ogni `permaMoney` corrotto dentro un oggetto save.
   * Il gioco salva permaMoney come number; un BigInt (o la stringa "123n" prodotta
   * dalla serializzazione usercamp) rompe al load (`[... initSystem failed:
   * Cannot convert a BigInt value to a number`).
   * @param {object} obj - nodo corrente (oggetto o array)
   * @returns {boolean} true se qualcosa è stato modificato
   */
  function sanitizePermaMoney(obj) {
    let changed = false;
    if (obj === null || typeof obj !== 'object') return false;

    // Primo livello: proprietà "permaMoney" (propria del nodo).
    if (Object.prototype.hasOwnProperty.call(obj, 'permaMoney')) {
      const v = obj.permaMoney;
      if (typeof v === 'string') {
        const m = /^(\d+)n?$/.exec(v.trim());
        if (m) {
          obj.permaMoney = Number(m[1]);
          changed = true;
        }
      } else if (typeof v === 'bigint') {
        obj.permaMoney = Number(v);
        changed = true;
      }
    }

    // Livello successivo: array e oggetti annidati (walk ricorsiva).
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (obj[i] !== null && typeof obj[i] === 'object') {
          if (sanitizePermaMoney(obj[i])) changed = true;
        }
      }
    } else {
      for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const v = obj[key];
        if (v !== null && typeof v === 'object') {
          if (sanitizePermaMoney(v)) changed = true;
        }
      }
    }
    return changed;
  }

  /**
   * Sanitizzazione allo start: scansiona TUTTI i save `data_*` nel localStorage e
   * corregge ogni permaMoney corrotto (stringa "123n" / BigInt) → number.
   *
   * - Solo chiavi con prefisso `data_` (i save del gioco), esclusi i nostri backup
   *   (`data_pvu_backup_*`) e i backup legacy (`data_backup*`).
   * - NON tocca `settings`, `sessionData*`, `runHistoryData_*` → verificabili il gioco.
   * - Idempotente: nessun write se non c'è nulla da correggere. Pattern createBackup
   *   + validatePostWrite su ogni chiave modificata (rollback su mismatch).
   * @returns {{ ok: boolean, fixed: number, error?: string }}
   */
  function sanitizeSavedData() {
    try {
      let fixed = 0;
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (!k.startsWith('data_')) continue;
        if (k.startsWith('data_pvu_') || k.startsWith('data_backup')) continue;
        keys.push(k);
      }

      for (let ki = 0; ki < keys.length; ki++) {
        const key = keys[ki];
        const raw = localStorage.getItem(key);
        if (!raw) continue;

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          // Save non-JSON: lascialo stare (il gioco lo gestirà).
          continue;
        }
        if (parsed === null || typeof parsed !== 'object') continue;

        if (sanitizePermaMoney(parsed)) {
          const jsonStr = JSON.stringify(parsed);

          // Usa protocollo standard: backup → write → validate
          const username = key.substring(5);
          const backup = createBackup(username);
          if (!backup.ok) {
            warn('Backup fallito durante sanitize, chiave saltata:', key, backup.error);
            continue;
          }

          try {
            localStorage.setItem(key, jsonStr);
            const validation = validatePostWrite(username, jsonStr, backup.key);
            if (!validation.ok) {
              error('Validazione sanitize fallita per', key, '— rollback applicato');
              continue;
            }
            fixed++;
            log('Sanitizzato', key, '(permaMoney corretto)' + (backup.key ? ' | backup: ' + backup.key : ''));
          } catch (e) {
            error('Write sanitize fallito per', key, e);
            // rollback manuale se validatePostWrite non ha potuto agire
            try {
              const bk = localStorage.getItem(backup.key);
              if (bk) localStorage.setItem(key, bk);
            } catch (e2) { /* ignore */ }
          }
        }
      }

      if (fixed > 0) {
        log('Sanitizzazione completata:', fixed, 'chiavi corrette');
      }
      return { ok: true, fixed: fixed };
    } catch (e) {
      error('sanitizeSavedData fallito:', e);
      return { ok: false, fixed: 0, error: e.message || String(e) };
    }
  }

  /**
   * Get username corrente dal localStorage o fallback a 'guest'.
   */
  function getUsername() {
    try {
      // Il gioco salva il campo "username" nel localStorage
      const userInfo = localStorage.getItem('userInfo');
      if (userInfo) {
        const parsed = JSON.parse(userInfo);
        if (parsed && parsed.username) return parsed.username;
      }
      // fallback: cerca chiavi "data_*" per dedurre lo username
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('data_') && !k.startsWith('data_pvu_backup') && !k.startsWith('data_backup')) {
          return k.substring(5); // "data_" + username
        }
      }
    } catch (e) { /* ignore */ }
    return 'guest';
  }

  // --- Settings utente (toggle shiny / capture) ---
  // Chiave localStorage separata dai save di gioco: mai toccata da sanitizeSavedData
  // (che scansiona solo prefissi data_, ed esclude data_pvu_/data_backup).
  const SETTINGS_KEY = '__pvu_settings';

  // Default settings. `v` = versione schema (forward-compat: il merge in
  // getSettings aggiunge i campi mancanti ai save scritti con schemi vecchi).
  const DEFAULT_SETTINGS = { v: 1, shiny: false, capture: false };

  /**
   * Legge settings con fallback ai default.
   * - JSON corrotto o assente → default (mai crash).
   * - Merge con default per campi mancanti (forward-compat).
   * @returns {{ v: number, shiny: boolean, capture: boolean }}
   */
  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      // Merge con default per campi mancanti (forward-compat)
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Scrive settings (read-modify-write per preservare campi futuri).
   * - Patch parziale: ogni chiave passata viene mergiata sullo stato corrente.
   * - `v` forzato allo schema corrente (mai retrocesso da patch malevole).
   * - Silenzioso su errore (localStorage pieno/privato): il gioco non deve
   *   crashare per colpa dei nostri toggle.
   * @param {object} patch - Campi da aggiornare (es. { shiny: true })
   */
  function setSettings(patch) {
    try {
      const current = getSettings();
      const merged = { ...current, ...patch, v: DEFAULT_SETTINGS.v };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    } catch (e) {
      // silenzioso
    }
  }

  return {
    createBackup: createBackup,
    validatePostWrite: validatePostWrite,
    writeSave: writeSave,
    readSave: readSave,
    serializeBigInt: serializeBigInt,
    sanitizeSavedData: sanitizeSavedData,
    getUsername: getUsername,
    getSettings: getSettings,
    setSettings: setSettings,
    log: log,
    warn: warn,
    error: error,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.storage = PvuStorage;


// --- src/game-bridge.js ---
const PvuGameBridge = (() => {
  const LOG_PREFIX = '[PvuGameBridge]';
  const STATE = {
    gameInstance: null,
    battleScene: null,
    username: 'guest',
    currentPhase: null,
    hooked: false,
  };

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * LIVELLO 1: Hook Phaser.Game constructor al document-start.
   * Cerca il pattern new Fn.Game(...) nel bundle e wrappa il costruttore.
   */
  function hookPhaserGame() {
    try {
      const Phaser = window.Phaser;
      if (!Phaser || !Phaser.Game) {
        log('Phaser non disponibile, retry più tardi');
        return false;
      }

      // FIX 3: guardia anti-doppio-hook — idempotente, safe da ri-chiamare
      if (Phaser.Game[Symbol.for('pvuPatched')]) {
        log('hookPhaserGame già applicato, skip');
        return true;
      }

      const OriginalGame = Phaser.Game;

      Phaser.Game = function() {
        const instance = OriginalGame.apply(this, arguments) || this;
        STATE.gameInstance = instance;
        window.__pvu_game = instance;
        log('Phaser.Game catturato via constructor hook');
        return instance;
      };

      // Copia prototype
      Phaser.Game.prototype = OriginalGame.prototype;
      Phaser.Game.prototype.constructor = Phaser.Game;

      // FIX 3: marca come patchato — next call ritorna true senza re-wrap
      Phaser.Game[Symbol.for('pvuPatched')] = true;

      log('Hook Phaser.Game applicato (attende istanza...)');
      return true;
    } catch (e) {
      warn('hookPhaserGame fallito:', e);
      return false;
    }
  }

  /**
   * Cattura il bundle source per lookups.
   */
  function captureBundleSource() {
    try {
      if (window.__pvu._bundleSource) return true;
      const scripts = document.querySelectorAll('script[src]');
      for (const s of scripts) {
        if (s.src && s.src.indexOf('assets/index') !== -1) {
          log('Bundle script trovato:', s.src);
        }
      }
      const allScripts = document.querySelectorAll('script:not([src])');
      let combined = '';
      for (const s of allScripts) {
        if (s.textContent && s.textContent.length > 1000) {
          combined += s.textContent;
        }
      }
      if (combined.length > 10000) {
        window.__pvu._bundleSource = combined;
        log('Bundle inline catturato:', combined.length, 'chars');
        return true;
      }
      return false;
    } catch (e) {
      warn('captureBundleSource fallito:', e);
      return false;
    }
  }

  /**
   * LIVELLO 2: Poll window.gameInfo per stato corrente.
   */
  function pollGameInfo() {
    const gi = window.gameInfo;
    if (gi) {
      STATE.currentPhase = inferPhase(gi.modeChain || []);
      return true;
    }
    return false;
  }

  function inferPhase(modeChain) {
    if (!modeChain || !modeChain.length) return null;
    const last = modeChain[modeChain.length - 1];
    if (!last) return null;
    const name = (typeof last === 'string' ? last : last.name || last.constructor?.name || '').toLowerCase();
    if (name.indexOf('battle') !== -1 || name.indexOf('fight') !== -1) return 'battle';
    if (name.indexOf('modifier') !== -1 || name.indexOf('select') !== -1) return 'modifierSelect';
    if (name.indexOf('shop') !== -1 || name.indexOf('collected') !== -1) return 'shop';
    if (name.indexOf('skill') !== -1) return 'skillTree';
    if (name.indexOf('menu') !== -1 || name.indexOf('option') !== -1) return 'menu';
    if (name.indexOf('title') !== -1 || name.indexOf('loading') !== -1) return 'title';
    return name;
  }

  /**
   * LIVELLO 3: CanvasPool fallback.
   * FIX BUG 1: Phaser.Display.Canvas.CanvasPool (reale) con fallback a window.Phaser.CanvasPool.
   */
  function getFromCanvasPool() {
    try {
      const pool = (window.Phaser && window.Phaser.Display && window.Phaser.Display.Canvas && window.Phaser.Display.Canvas.CanvasPool)
                 || (window.Phaser && window.Phaser.CanvasPool)
                 || null;
      if (!pool || !pool.pool || !pool.pool.length) return null;
      const entry = pool.pool[0];
      if (!entry || !entry.parent || !entry.parent.game) return null;
      const sceneKeys = entry.parent.game.scene && entry.parent.game.scene.keys;
      if (sceneKeys && sceneKeys.battle) {
        STATE.battleScene = sceneKeys.battle;
        log('Battle scene via CanvasPool');
        return sceneKeys.battle;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * Get game instance (da tutti i livelli).
   * FIX 2: auto-riparante — se i livelli cache falliscono, prova CanvasPool
   * direttamente (NON getBattleScene, evita ricorsione getGame→getBattleScene→getGame)
   * e ri-esegue hookPhaserGame se Phaser è arrivato dopo il primo tentativo.
   */
  function getGame() {
    if (STATE.gameInstance) return STATE.gameInstance;
    if (window.__pvu_game) {
      STATE.gameInstance = window.__pvu_game;
      return STATE.gameInstance;
    }

    // FIX 2a: CanvasPool diretto — stesso pool usato da getFromCanvasPool(),
    // ma qui estraiamo entry.parent.game (l'istanza Game) senza toccare
    // getBattleScene() (che a sua volta chiama getGame() → ricorsione).
    try {
      const pool = (window.Phaser && window.Phaser.Display && window.Phaser.Display.Canvas && window.Phaser.Display.Canvas.CanvasPool)
                 || (window.Phaser && window.Phaser.CanvasPool)
                 || null;
      if (pool && pool.pool && pool.pool.length) {
        const entry = pool.pool[0];
        if (entry && entry.parent && entry.parent.game) {
          STATE.gameInstance = entry.parent.game;
          window.__pvu_game = entry.parent.game;
          log('Game recuperato via CanvasPool (getGame self-heal)');
          return STATE.gameInstance;
        }
      }
    } catch (e) { /* ignore */ }

    // FIX 2b: Phaser.Game esiste ma hook non applicato → ri-esegui
    // hookPhaserGame (idempotente grazie alla guardia Symbol) e ritenta.
    if (window.Phaser && window.Phaser.Game
        && !window.Phaser.Game[Symbol.for('pvuPatched')]) {
      hookPhaserGame();
      if (STATE.gameInstance) return STATE.gameInstance;
    }

    return null;
  }

  /**
   * Get battle scene (caching).
   */
  function getBattleScene() {
    if (STATE.battleScene) return STATE.battleScene;
    const game = getGame();
    if (game && game.scene && game.scene.keys && game.scene.keys.battle) {
      STATE.battleScene = game.scene.keys.battle;
      return STATE.battleScene;
    }
    return getFromCanvasPool();
  }

/**
   * SAFETY NET v1.2.1 (anti-corruzione BigInt): normalizza permaMoney a runtime.
   * Il gioco tratta permaMoney come number in ogni uso (updatePermaMoney →
   * Math.round, UI, `(permaMoney||0)+d`, confronti). Un BigInt (o la stringa
   * "123n" prodotta da serializeBigInt) fa:
   *   - freeze Ω in-sessione: (permaMoney||0)+d → BigInt+Number → TypeError
   *   - [LOAD ERROR] al riavvio: initSystem restore → Cannot convert a BigInt
   * Idempotente: se permaMoney è già number non tocca nulla (nessun log di rumore
   * dal poll 500ms).
   * @param {object|null} gameData
   * @returns {object|null}
   */
  function sanitizeGameDataRuntime(gameData) {
    try {
      if (!gameData || typeof gameData !== 'object' || gameData.__pvu_sanitized) {
        return gameData;
      }
      const v = gameData.permaMoney;
      if (typeof v === 'bigint') {
        gameData.permaMoney = Number(v);
        warn('permaMoney era BigInt → normalizzato a Number (safety net runtime)');
      } else if (typeof v === 'string') {
        const m = /^(\d+)n?$/.exec(v.trim());
        if (m) {
          gameData.permaMoney = Number(m[1]);
          warn('permaMoney era stringa ("' + v + '") → normalizzato a Number (safety net runtime)');
        }
      }
      // Marca per evitare re-check inutili nello stesso oggetto (poll 500ms).
      // Usa defineProperty non-enumerabile per non sporcare falsificazione del save
      // (JSON.stringify la ignora, ma il gioco la ridefinirebbe comunque in updatePermaMoney).
      try {
        Object.defineProperty(gameData, '__pvu_sanitized', { value: true, writable: false, configurable: true, enumerable: false });
      } catch (e) { /* ignore */ }
    } catch (e) {
      warn('sanitizeGameDataRuntime fallito:', e);
    }
    return gameData;
  }

  /**
   * Get game data dal game instance.
   */
  function getGameData() {
    const scene = getBattleScene();
    if (scene && scene.gameData) return sanitizeGameDataRuntime(scene.gameData);
    const game = getGame();
    if (game && game.scene && game.scene.scenes) {
      for (const key in game.scene.scenes) {
        const s = game.scene.scenes[key];
        if (s && s.gameData) return sanitizeGameDataRuntime(s.gameData);
      }
    }
    return null;
  }

  /**
   * PARTE 5: cattura la battle scene da un'istanza di phase (phaseObj.scene).
   * Chiamato dal phase observer su ogni push/unshift — garantisce che la scene
   * sia disponibile appena esiste QUALSIASI phase (title incluso).
   * @param {object} phaseObj - L'istanza della fase
   */
  function captureSceneFromPhase(phaseObj) {
    try {
      if (STATE.battleScene) return STATE.battleScene;
      if (phaseObj && typeof phaseObj === 'object' && phaseObj.scene) {
        const candidate = phaseObj.scene;
        // La scene della phase è la battle scene (ha moveUpgradesEnabledForRun ecc.)
        if (candidate && candidate.game) {
          STATE.battleScene = candidate;
          window.__pvu_battleScene = candidate;
          log('Battle scene catturato da phase instance (' +
              (phaseObj.constructor ? phaseObj.constructor.name : '?') + ')');
        }
      }
    } catch (e) { /* ignore */ }
    return STATE.battleScene;
  }

  /**
   * Get username dal gioco o dallo storage.
   */
  function getUsername() {
    if (STATE.username && STATE.username !== 'guest') return STATE.username;
    STATE.username = window.__pvu.storage.getUsername();
    return STATE.username;
  }

  /**
   * Refresh cache dello username.
   */
  function refreshUsername() {
    STATE.username = window.__pvu.storage.getUsername();
    return STATE.username;
  }

  /**
   * Init: hook + polling + fallback.
   */
  function init() {
    log('init');

    // Hook immediato (document-start)
    hookPhaserGame();

    // Captura bundle source per lookups
    setTimeout(function() {
      captureBundleSource();
    }, 100);

    // Polling: quando il gioco parte, cattura gameData
    let pollCount = 0;
    const pollInterval = setInterval(function() {
      pollCount++;
      const game = getGame();
      if (game) {
        const gd = getGameData();
        if (gd) {
          log('gameData trovato via game instance');
          clearInterval(pollInterval);
          return;
        }
      }

      const scene = getBattleScene();
      if (scene) {
        log('battle scene trovato via CanvasPool');
        clearInterval(pollInterval);
        return;
      }

      if (pollGameInfo()) {
        log('gameInfo disponibile');
      }

      if (pollCount > 120) {
        log('timeout polling — il gioco non è partito?');
        clearInterval(pollInterval);
      }
    }, 500);
  }

  /**
   * Distruggi hooks.
   */
  function destroy() {
    STATE.gameInstance = null;
    STATE.battleScene = null;
    STATE.hooked = false;
    log('destroy');
  }

  /**
   * PARTE 5: rimuove il vecchio cache-first, ora preferisce LA battle scene
   * (autoritativa durante la run) prima di scandire tutte le scene del manager.
   * FIX 1: NON early-returna su getGame() null — la battle scene può esistere
   * via CanvasPool anche quando getGame() è ancora null (stesso pattern di
   * getGameData qui sopra).
   */
  function findGameData() {
    // 1. Battle scene prima — ha il gameData della run corrente
    // (getBattleScene ha il fallback CanvasPool interno)
    const bs = getBattleScene();
    if (bs && bs.gameData) return sanitizeGameDataRuntime(bs.gameData);

    // 2. Solo come ultima spiaggia: game instance → scan scene registrate
    const game = getGame();
    if (!game) return null;

    if (game.scene && game.scene.scenes) {
      const scenes = game.scene.scenes;
      for (const key in scenes) {
        const s = scenes[key];
        if (s && s.gameData) return sanitizeGameDataRuntime(s.gameData);
      }
    }

    return null;
  }

  /**
   * Get la current username dal gameData.
   */
  function getGameUsername() {
    const gd = findGameData();
    if (gd && gd.username) return gd.username;
    return getUsername();
  }

  return {
    init: init,
    destroy: destroy,
    getGame: getGame,
    getBattleScene: getBattleScene,
    getGameData: getGameData,
    findGameData: findGameData,
    captureSceneFromPhase: captureSceneFromPhase,
    getUsername: getUsername,
    getGameUsername: getGameUsername,
    refreshUsername: refreshUsername,
    pollGameInfo: pollGameInfo,
    getCurrentPhase: function() { return STATE.currentPhase; },
    setCurrentPhase: function(p) { STATE.currentPhase = p; },
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.bridge = PvuGameBridge;


// --- src/phase-observer.js ---
const PvuPhaseObserver = (() => {
  const LOG_PREFIX = '[PvuPhaseObserver]';
  const listeners = [];
  const pushInterceptors = [];   // callbacks(phaseInstance) when phase is pushed
  const unshiftInterceptors = []; // callbacks(phaseInstance) when phase is unshifted
  let lastPhase = null;
  let pollTimer = null;
  let unpatchFns = [];
  // PARTE 4: guardia anti doppio-hook — main.js richiama hookPhaseMethods()
  // dopo aver trovato la battle scene, ma anche init() retry ogni 1s.
  let phaseMethodsHooked = false;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * Registra un listener per cambi fase.
   * @param {Function} fn - (newPhase, oldPhase) => void
   */
  function onPhaseChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  /**
   * Registra un interceptor per phase push.
   * @param {Function} fn - (phaseInstance) => void — chiamato con l'istanza della fase
   */
  function onPhasePush(fn) {
    if (typeof fn === 'function') pushInterceptors.push(fn);
  }

  /**
   * Registra un interceptor per phase unshift.
   * @param {Function} fn - (phaseInstance) => void
   */
  function onPhaseUnshift(fn) {
    if (typeof fn === 'function') unshiftInterceptors.push(fn);
  }

  function emitPhaseChange(newPhase, oldPhase) {
    if (newPhase === oldPhase) return;
    for (let i = 0; i < listeners.length; i++) {
      try {
        listeners[i](newPhase, oldPhase);
      } catch (e) {
        console.error(LOG_PREFIX, 'listener error:', e);
      }
    }
  }

  function emitPush(phaseObj) {
    for (let i = 0; i < pushInterceptors.length; i++) {
      try { pushInterceptors[i](phaseObj); } catch (e) { /* ignore */ }
    }
  }

  function emitUnshift(phaseObj) {
    for (let i = 0; i < unshiftInterceptors.length; i++) {
      try { unshiftInterceptors[i](phaseObj); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Hook unshiftPhase e pushPhase sulla battle scene prototype.
   * Ora emette anche il phase instance per gli interceptor.
   */
  function hookPhaseMethods() {
    const bridge = window.__pvu.bridge;
    const helpers = window.__pvu.helpers;
    if (!bridge || !helpers) return false;

    // PARTE 4: già hookati — evita wrapper annidati (ri-wrap = lag + stack growth)
    if (phaseMethodsHooked) return true;

    const scene = bridge.getBattleScene();
    if (!scene) {
      log('battle scene non ancora disponibile per phase hook');
      return false;
    }

    const proto = Object.getPrototypeOf(scene);
    if (!proto) {
      log('proto non trovato');
      return false;
    }

    // Hook unshiftPhase — ora passa anche la phase instance agli interceptor
    if (proto.unshiftPhase) {
      const r1 = helpers.hookPrototype(proto, 'unshiftPhase', function(original, args) {
        const result = original.apply(this, args);
        try {
          var phaseObj = args[0];
          handlePhaseChange(phaseObj);
          emitUnshift(phaseObj);
        } catch(e) { /* ignore */ }
        return result;
      });
      unpatchFns.push(r1.unpatch);
      log('unshiftPhase hooked');
    }

    // Hook pushPhase — ora passa anche la phase instance agli interceptor
    if (proto.pushPhase) {
      const r2 = helpers.hookPrototype(proto, 'pushPhase', function(original, args) {
        const result = original.apply(this, args);
        try {
          var phaseObj = args[0];
          handlePhaseChange(phaseObj);
          emitPush(phaseObj);
        } catch(e) { /* ignore */ }
        return result;
      });
      unpatchFns.push(r2.unpatch);
      log('pushPhase hooked');
    }

    // Hook updateMoneyText per sapere quando il money viene aggiornato
    if (proto.updateMoneyText) {
      const r3 = helpers.hookPrototype(proto, 'updateMoneyText', function(original, args) {
        try {
          window.__pvu._lastMoneyUpdate = Date.now();
        } catch(e) {}
        return original.apply(this, args);
      });
      unpatchFns.push(r3.unpatch);
      log('updateMoneyText hooked');
    }

    phaseMethodsHooked = true;

    return true;
  }

  function handlePhaseChange(phaseObj) {
    const bridge = window.__pvu.bridge;
    if (!bridge) return;

    // PARTE 5: cattura la battle scene dall'istanza phase (phaseObj.scene)
    // appena esiste una qualsiasi phase — risolve il timing del bridge.
    if (phaseObj && typeof phaseObj === 'object') {
      bridge.captureSceneFromPhase(phaseObj);
    }

    let phaseName = 'unknown';
    if (typeof phaseObj === 'string') {
      phaseName = phaseObj;
    } else if (phaseObj && phaseObj.constructor && phaseObj.constructor.name) {
      phaseName = phaseObj.constructor.name;
    } else if (phaseObj && phaseObj.toString) {
      phaseName = phaseObj.toString();
    }

    const normalized = normalizePhaseName(phaseName);
    const oldPhase = bridge.getCurrentPhase();
    bridge.setCurrentPhase(normalized);

    if (normalized !== oldPhase) {
      log('Fase cambiata:', oldPhase, '->', normalized);
      emitPhaseChange(normalized, oldPhase);
    }
  }

  function normalizePhaseName(name) {
    const n = name.toLowerCase();
    if (n.indexOf('battle') !== -1 || n.indexOf('fight') !== -1) return 'battle';
    if (n.indexOf('modifier') !== -1 && n.indexOf('select') !== -1) return 'modifierSelect';
    if (n.indexOf('shop') !== -1 || n.indexOf('collected') !== -1) return 'shop';
    if (n.indexOf('skill') !== -1) return 'skillTree';
    if (n.indexOf('menu') !== -1 || n.indexOf('option') !== -1) return 'menu';
    if (n.indexOf('title') !== -1) return 'title';
    if (n.indexOf('loading') !== -1) return 'title';
    if (n.indexOf('gameover') !== -1 || n.indexOf('game_over') !== -1) return 'title';
    return n.substring(0, 30);
  }

  /**
   * Fallback: poll window.gameInfo.modeChain
   */
  function startPolling() {
    if (pollTimer) return;
    let lastModeChain = '';

    pollTimer = setInterval(function() {
      const gi = window.gameInfo;
      if (!gi) return;

      const chain = gi.modeChain;
      if (!chain) return;

      const chainStr = JSON.stringify(chain);
      if (chainStr === lastModeChain) return;
      lastModeChain = chainStr;

      const bridge = window.__pvu.bridge;
      if (!bridge) return;

      const phase = inferPhaseFromChain(chain);
      const oldPhase = bridge.getCurrentPhase();
      bridge.setCurrentPhase(phase);

      if (phase !== oldPhase) {
        log('[poll] Fase cambiata:', oldPhase, '->', phase);
        emitPhaseChange(phase, oldPhase);
      }
    }, 500);
  }

  function inferPhaseFromChain(chain) {
    if (!chain || !chain.length) return 'title';
    const last = chain[chain.length - 1];
    if (!last) return 'title';
    const name = (typeof last === 'string' ? last : last.name || last.constructor?.name || '').toLowerCase();
    return normalizePhaseName(name);
  }

  /**
   * Init: hook + poll.
   */
  function init() {
    log('init');

    let hookAttempts = 0;
    const hookInterval = setInterval(function() {
      hookAttempts++;
      const hooked = hookPhaseMethods();
      if (hooked) {
        clearInterval(hookInterval);
        log('Phase hooks applicati');
        return;
      }
      // FIX 4: stop anche se window.gameInfo esiste OPPURE la battle scene è
      // raggiungibile via getBattleScene (fallback CanvasPool) — il phase hook
      // può non riuscire ma il gioco è partito; il polling gameInfo continua.
      const bridge = window.__pvu.bridge;
      if (window.gameInfo || (bridge && bridge.getBattleScene())) {
        clearInterval(hookInterval);
        log('Phase hooks: gameInfo/battle scene disponibile, stop retry');
        return;
      }
      if (hookAttempts > 30) {
        clearInterval(hookInterval);
        log('Phase hooks: timeout, uso solo polling');
      }
    }, 1000);

    startPolling();
  }

  function destroy() {
    for (let i = 0; i < unpatchFns.length; i++) {
      try { unpatchFns[i](); } catch(e) {}
    }
    unpatchFns = [];
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    phaseMethodsHooked = false;
    listeners.length = 0;
    pushInterceptors.length = 0;
    unshiftInterceptors.length = 0;
    log('destroy');
  }

  return {
    init: init,
    destroy: destroy,
    onPhaseChange: onPhaseChange,
    onPhasePush: onPhasePush,
    onPhaseUnshift: onPhaseUnshift,
    hookPhaseMethods: hookPhaseMethods,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.phaseObserver = PvuPhaseObserver;


// --- src/roll-controller.js ---
// PARTE 2: rimossi toggle morti (freeReroll, poolQuality) + hook su funzioni standalone inutili
// PARTE 3: luck reale — hook su getModifierTypeOptions dell'istanza phase (su) + arena.randomSpecies
// PARTE 4: niente BFS (era il lag a OGNI phase push), anti-riwrap Symbol.for('pvuPatched')
const PvuRollController = (() => {
  const LOG_PREFIX = '[PvuRollController]';
  const PVU_PATCHED = Symbol.for('pvuPatched');

  // Tier enum verificato sul bundle (Ee @1664935):
  // MEH=-1, COMMON=0, GREAT=1, ULTRA=2, ROGUE=3, MASTER=4, LUXURY=5
  const TIER = { COMMON: 0, GREAT: 1, ULTRA: 2, ROGUE: 3, MASTER: 4 };

  // Stato toggle
  const state = {
    costOverride: false,
    itemCountExtra: 2,
    luckValue: 5,
    luckLock: false,
    active: false,
    hooksApplied: false,
    patchedPhaseCount: 0,   // quante phase sono state patchate
    lastPatchedPhase: null, // tipo dell'ultima phase patchata
    _arenaHooked: false,    // arena.randomSpecies hookato (una volta sola)
  };

  // Hook refs per unpatch dei wrapper su prototype/istanze long-lived
  const unpatchFns = [];

  // Original functions for delegation (set when patching)
  const originals = {
    getRerollCost: null,
    updateMoneyText: null,
  };

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * PARTE 3: pool di tier per la luck lock.
   * luckValue 1-7 (5 = default/naturale → nessun intervento).
   * Il risultato sostituisce this.modifierTiers della phase (su) forzando
   * scene.lockModifierTiers=true SOLO durante la chiamata originale.
   * @param {number} luckValue
   * @param {number} count - numero opzioni (array per-slot, come legge Wd: n[f])
   * @returns {number[]|null} array tier (Ee) o null se neutrale
   */
  function luckTierPool(luckValue, count) {
    let pool;
    switch (luckValue) {
      case 1: pool = [TIER.COMMON]; break;
      case 2: pool = [TIER.COMMON, TIER.GREAT]; break;
      case 3: pool = [TIER.GREAT]; break;
      case 4: pool = [TIER.GREAT, TIER.ULTRA]; break;
      // 5 = default del gioco (JFe torna 1-7 random) → vanilla
      case 6: pool = [TIER.ULTRA, TIER.ROGUE]; break;
      case 7: pool = [TIER.ROGUE, TIER.MASTER]; break;
      default: return null;
    }
    const n = Math.max(1, typeof count === 'number' ? count : 3);
    const arr = new Array(n);
    for (let i = 0; i < n; i++) {
      arr[i] = pool[i % pool.length];
    }
    return arr;
  }

  /**
   * Patch una phase instance con i nostri hook.
   * Chiamata dal phase observer interceptor quando una fase viene pushata o unshiftata.
   * PARTE 4: guard anti-riwrap con Symbol — mai doppio wrap sulla stessa istanza.
   * @param {object} phaseObj - L'istanza della fase
   */
  function patchPhase(phaseObj) {
    if (!phaseObj) return;
    const helpers = window.__pvu.helpers;
    if (!helpers) return;

    // Anti-riwrap: l'istanza è già stata patchata
    if (phaseObj[PVU_PATCHED]) return false;

    // Le phase di interesse sono quelle con getRerollCost (SelectModifierPhase = su).
    // NOTA: getModifierTypeOptions è un method DI QUESTA STESSA CLASSE (istanza),
    // NON una funzione standalone — per questo il vecchio hook su sceneProto/BFS falliva.
    if (typeof phaseObj.getRerollCost !== 'function') return false;
    if (typeof phaseObj.getModifierTypeOptions !== 'function') return false;

    let patched = false;

    // --- getRerollCost: costo del reroll (istanza su) ---
    if (!phaseObj._pvu_rerollHooked) {
      originals.getRerollCost = phaseObj.getRerollCost.bind(phaseObj);
      const orig = phaseObj.getRerollCost;
      phaseObj.getRerollCost = function() {
        try {
          // Cost Override: WAIVE_ROLL_FEE_OVERRIDE nativo
          if (state.costOverride) {
            return { rerollCost: 0, permaRerollCost: 0 };
          }
          return orig.apply(this, arguments);
        } catch (e) {
          warn('hook getRerollCost error:', e);
          return orig.apply(this, arguments);
        }
      };
      phaseObj._pvu_rerollHooked = true;
      patched = true;
    }

    // --- getModifierTypeOptions: item count extra + luck pool (istanza su) ---
    if (!phaseObj._pvu_optionsHooked) {
      const origOptions = phaseObj.getModifierTypeOptions;
      phaseObj.getModifierTypeOptions = function() {
        const scene = this && this.scene ? this.scene : null;
        let count = arguments.length > 0 && typeof arguments[0] === 'number' ? arguments[0] : undefined;

        // Item count extra: aumenta il numero di opzioni nel pool
        if (state.itemCountExtra > 0 && count !== undefined) {
          count = count + state.itemCountExtra;
        }

        // Luck lock: forza i tier del pool forzando lockModifierTiers SOLO durante la chiamata
        let tierPatch = null;
        if (state.luckLock) {
          const tiers = luckTierPool(state.luckValue, count);
          if (tiers && scene) {
            tierPatch = {
              oldLock: scene.lockModifierTiers,
              oldTiers: this.modifierTiers,
            };
            scene.lockModifierTiers = true;
            this.modifierTiers = tiers;
          }
        }

        try {
          return origOptions.call(this, count);
        } finally {
          // Ripristino sempre (anche su errore) — nessun side effect residuo
          if (tierPatch && scene) {
            scene.lockModifierTiers = tierPatch.oldLock;
            this.modifierTiers = tierPatch.oldTiers;
          }
        }
      };
      phaseObj._pvu_optionsHooked = true;
      patched = true;
      log('getModifierTypeOptions patched su phase instance (itemcount + luck pool)');
    }

    // Hook wild luck una volta sola (istanza arena long-lived)
    if (!state._arenaHooked) {
      hookWildLuck();
      patched = patched || state._arenaHooked;
    }

    if (patched) {
      phaseObj[PVU_PATCHED] = true;
      state.patchedPhaseCount++;
      state.lastPatchedPhase = phaseObj.constructor ? phaseObj.constructor.name : 'unknown';
      log('Phase patchata:', state.lastPatchedPhase);
    }
    return patched;
  }

  /**
   * PARTE 3: wild luck — hook su scene.arena.randomSpecies.
   * Bundle verificato: getPartyLuckValue (JFe) è una standalone fn che NON si può
   * raggiungere via BFS; l'unico call site è:
   *   this.arena.randomSpecies(t,n,void 0,JFe(this.party))   @21906050
   * → il luck è il 4° argomento di randomSpecies (param i, usato come h=i*(d?.5:2)).
   * Con luckLock ON forziamo args[3] = luckValue.
   */
  function hookWildLuck() {
    try {
      const bridge = window.__pvu.bridge;
      const scene = bridge.getBattleScene();
      if (!scene || !scene.arena) return false;
      const arena = scene.arena;
      const orig = arena.randomSpecies;
      if (typeof orig !== 'function') return false;
      if (orig[PVU_PATCHED]) {
        state._arenaHooked = true;
        return true;
      }
      const wrapped = function() {
        const args = Array.from(arguments);
        if (state.luckLock && args.length >= 4 && typeof args[3] === 'number') {
          args[3] = state.luckValue;
        }
        return orig.apply(this, args);
      };
      wrapped[PVU_PATCHED] = true;
      arena.randomSpecies = wrapped;
      state._arenaHooked = true;
      unpatchFns.push(function() {
        if (arena.randomSpecies === wrapped) arena.randomSpecies = orig;
      });
      log('arena.randomSpecies hooked (wild luck overridable)');
      return true;
    } catch (e) {
      warn('hookWildLuck fallito:', e);
      return false;
    }
  }

  /**
   * Forza WAIVE_ROLL_FEE_OVERRIDE sul gameData se disponibile.
   *
   * NOTA (verificata su pokevoid-bundle.js, Task 4 — nessuna modifica funzionale):
   * il gioco legge TUTTI i 16 consumatori come `ot.WAIVE_ROLL_FEE_OVERRIDE`, dove
   * `ot` è un singleton plain-object di modulo creato UNA volta:
   *   ot = { ...new DefaultOverrides(), ...L4e }          (@1605540)
   * Non è una static class property, non è esportato, NON è raggiungibile dal
   * window scope (closure webpack), e non viene MAI scritto a runtime
   * (0 assignments a `ot.WAIVE_ROLL_FEE_OVERRIDE` nel bundle).
   * La field d'istanza `this.WAIVE_ROLL_FEE_OVERRIDE = !1` (DefaultOverrides,
   * @1601620) è scritta una volta sola e non è MAI letta dal gioco.
   * → Questa scrittura su gameData è un **no-op innocuo**: lasciata invariata
   *   (conservativo). Il free roll che funziona davvero è l'hook su getRerollCost
   *   dell'istanza phase (`su`), che replica esattamente il ramo nativo
   *   `if (ot.WAIVE_ROLL_FEE_OVERRIDE) return { rerollCost: 0, permaRerollCost: 0 }`
   *   (@17223287) — shape oggetto consumata correttamente ovunque, nessun vettore NaN.
   */
  function setWaiveRollFeeOverride(val) {
    const bridge = window.__pvu.bridge;
    const gameData = bridge.findGameData();
    if (gameData) {
      // no-op documentato: il gioco non legge mai questo campo (vedi JSDoc sopra)
      gameData.WAIVE_ROLL_FEE_OVERRIDE = val;
      log('WAIVE_ROLL_FEE_OVERRIDE =', val);
      return true;
    }
    return false;
  }

  /**
   * Register phase interceptors con il phase observer.
   * Chiamato da init().
   */
  function registerPhaseInterceptors() {
    const observer = window.__pvu.phaseObserver;
    if (!observer) {
      warn('phaseObserver non disponibile');
      return;
    }

    observer.onPhasePush(function(phaseObj) {
      patchPhase(phaseObj);
      checkHooksApplied();
    });
    observer.onPhaseUnshift(function(phaseObj) {
      patchPhase(phaseObj);
      checkHooksApplied();
    });

    log('Phase interceptors registrati');
  }

  /**
   * Verifica se gli hooks critici sono stati applicati.
   */
  function checkHooksApplied() {
    if (state.hooksApplied) return;

    if (originals.getRerollCost) {
      state.hooksApplied = true;
      state.active = true;
      log('Hooks applicati con successo (getRerollCost patched)');
      emitStateChange();
    }
  }

  /**
   * Applica hooks — ora registra interceptor invece di cercare direttamente.
   */
  function applyHooks() {
    if (state.hooksApplied) return true;

    registerPhaseInterceptors();
    tryPatchCurrentPhase();

    return state.hooksApplied;
  }

  /**
   * Tenta di patchare la phase corrente dalla coda del scene.
   */
  function tryPatchCurrentPhase() {
    try {
      const bridge = window.__pvu.bridge;
      if (!bridge) return;
      const game = bridge.getGame();
      if (!game || !game.scene) return;

      const sceneManager = game.scene;
      const scenes = sceneManager.scenes;
      if (!scenes) return;

      for (const key in scenes) {
        const s = scenes[key];
        if (!s || !s.scene || !s.scene._phases) continue;
        const phases = s.scene._phases;
        for (let i = 0; i < phases.length; i++) {
          const p = phases[i];
          if (p && typeof p.getRerollCost === 'function' && !p[PVU_PATCHED]) {
            patchPhase(p);
            checkHooksApplied();
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  function emitStateChange() {
    try {
      window.__pvu._rollStateChange = Date.now();
    } catch(e) {}
  }

  // === Toggle API ===

  function toggleCostOverride(val) {
    state.costOverride = val !== undefined ? val : !state.costOverride;
    setWaiveRollFeeOverride(state.costOverride);
    log('Cost Override:', state.costOverride ? 'ON' : 'OFF');
    emitStateChange();
    return state.costOverride;
  }

  function setItemCountExtra(val) {
    state.itemCountExtra = Math.max(0, Math.min(4, parseInt(val, 10) || 0));
    log('Item Count extra:', '+' + state.itemCountExtra);
    emitStateChange();
    return state.itemCountExtra;
  }

  // === Luck API ===

  function setLuckValue(val) {
    state.luckValue = Math.max(1, Math.min(7, parseInt(val, 10) || 5));
    log('Luck value:', state.luckValue);
    emitStateChange();
    return state.luckValue;
  }

  function toggleLuckLock(val) {
    state.luckLock = val !== undefined ? val : !state.luckLock;
    log('Luck Lock:', state.luckLock ? 'ON (luck=' + state.luckValue + ')' : 'OFF');
    emitStateChange();
    return state.luckLock;
  }

  function getState() {
    return {
      costOverride: state.costOverride,
      itemCountExtra: state.itemCountExtra,
      luckValue: state.luckValue,
      luckLock: state.luckLock,
      active: state.active,
      hooksApplied: state.hooksApplied,
      patchedPhaseCount: state.patchedPhaseCount,
      lastPatchedPhase: state.lastPatchedPhase,
    };
  }

  function destroy() {
    for (let i = 0; i < unpatchFns.length; i++) {
      try { unpatchFns[i](); } catch(e) {}
    }
    unpatchFns.length = 0;
    originals.getRerollCost = null;
    originals.updateMoneyText = null;
    state.hooksApplied = false;
    state.active = false;
    state.patchedPhaseCount = 0;
    state._arenaHooked = false;
    log('destroy');
  }

  return {
    init: function() { log('init'); },
    destroy: destroy,
    applyHooks: applyHooks,
    getState: getState,
    toggleCostOverride: toggleCostOverride,
    setItemCountExtra: setItemCountExtra,
    setLuckValue: setLuckValue,
    toggleLuckLock: toggleLuckLock,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.rollController = PvuRollController;

// --- src/encounter-override.js ---
// Task 3 v1.3.0. Analisi bundle v3.1.8 (COL 20225068):
//
// trySetShiny(t) interno ha GUARDIE che bloccano lo shiny anche con t=65536:
//   1. Endless + biome END
//   2. forma speciale (MEGA / PRIMAL / SMITTY)
//   3. wavePreFinal (boss di wave finale)
//   4. legendary / mythical / subLegendary
//   5. rival
// Se una guardia scatta → return senza scrivere this.shiny.
//
// Soluzione: per i Pokemon NEMICI bypass diretto (this.shiny=65536 +
// initShinySparkle() + generateVariant(), replicando la coda nativa SENZA
// guardie); per i Pokemon del PLAYER delega al trySetShiny nativo (65536).
//
// NOTA: bundle v3.1.8 con mangling OFF → i nomi (.shiny, .isPlayer(),
// initShinySparkle, generateVariant, trySetShiny) sono preservati in chiaro.
const PvuEncounterOverride = (() => {
  const LOG_PREFIX = '[PvuEncounterOverride]';
  // Symbol diverso dal generico 'pvuPatched' → anti-riwrap dedicato al modulo:
  // main.js e gli altri moduli non interferiscono con questo hook.
  const ENCOUNTER_PATCHED = Symbol.for('pvuEncounterPatched');

  // Stato toggle. `shiny` è persistito in localStorage via storage.setSettings
  // (chiave '__pvu_settings', campo `shiny` già previsto in DEFAULT_SETTINGS).
  const state = {
    shiny: false,        // toggle Always Shiny (letto da storage in init)
    active: false,       // hooks pronti e funzionanti
    hooksApplied: false, // wrapper su trySetShiny installato
    pokemonProto: null,  // prototype di Pokemon (scoperto a runtime)
    pokemonClass: null,  // nome classe per logging
    hookStats: {
      total: 0,          // chiamate totali intercettate
      forced: 0,         // shiny forzati (bypass diretto su nemici)
      player: 0,         // shiny delegati al nativo (player)
    },
  };

  let originalTrySetShiny = null; // riferimento al metodo nativo

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * Scopre il prototype della classe Pokemon a runtime.
   * Percorsi in ordine di affidabilità:
   *   1. Campi noti della battle scene (enemyField, playerField) → children
   *   2. scene.party (ogni membro è un Pokemon)
   *   3. Scan di fallback: qualsiasi oggetto nella scene con trySetShiny
   * Il prototype è condiviso da TUTTI i Pokemon → hooking una volta sola.
   * @returns {object|null} Il prototype di Pokemon
   */
  function discoverPokemonProto() {
    try {
      const bridge = window.__pvu.bridge;
      if (!bridge) return null;
      const scene = bridge.getBattleScene();
      if (!scene) return null;

      const candidates = [];

      // 1. Field container (Phaser) → children sono istanze Pokemon
      const fieldNames = ['enemyField', 'playerField', 'partyField'];
      for (let i = 0; i < fieldNames.length; i++) {
        const field = scene[fieldNames[i]];
        if (!field) continue;
        const children = (field.children && field.children.list) ? field.children.list : null;
        if (!children) continue;
        for (let j = 0; j < children.length; j++) {
          const c = children[j];
          if (c && typeof c.trySetShiny === 'function') candidates.push(c);
        }
      }

      // 2. party della battle scene
      if (scene.party) {
        const party = scene.party;
        if (Array.isArray(party)) {
          for (let i = 0; i < party.length; i++) {
            const p = party[i];
            if (p && typeof p.trySetShiny === 'function') candidates.push(p);
          }
        } else {
          for (const key in party) {
            const p = party[key];
            if (p && typeof p.trySetShiny === 'function') candidates.push(p);
          }
        }
      }

      // 3. Scan di fallback: proprietà della scene
      for (const key in scene) {
        const v = scene[key];
        if (v && typeof v === 'object' &&
            typeof v.trySetShiny === 'function') {
          candidates.push(v);
        }
      }

      // Estrai il prototype dal primo candidato valido
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const proto = c.constructor && c.constructor.prototype;
        if (proto && typeof proto.trySetShiny === 'function' &&
            !proto[ENCOUNTER_PATCHED]) {
          state.pokemonProto = proto;
          state.pokemonClass = (c.constructor.name) || 'unknown';
          log('Pokemon prototype scoperto:', state.pokemonClass);
          return proto;
        }
      }
    } catch (e) {
      warn('discoverPokemonProto fallito:', e);
    }
    return null;
  }

  /**
   * Bypass diretto per i Pokemon nemici: replica la coda nativa di
   * trySetShiny (scrittura shiny + sparkle + variant) SENZA passare dalle
   * guardie che bloccano boss/rival/legendary anche con t=65536.
   * @param {object} poke - Istanza Pokemon
   * @returns {undefined} Come il metodo originale (nessun valore di ritorno)
   */
  function forceShiny(poke) {
    poke.shiny = 65536;

    // Sparkle: animazione di brillio — va dopo la scrittura di .shiny
    // perché l'implementazione interna controlla il flag.
    if (typeof poke.initShinySparkle === 'function') {
      try { poke.initShinySparkle(); } catch (e) { /* la sparkle è cosmetic */ }
    }

    // Variant: la texture/forma shiny (valori enormi per le varianti sparkle)
    if (typeof poke.generateVariant === 'function') {
      try { poke.generateVariant(); } catch (e) { /* la variant è cosmetic */ }
    }

    return undefined;
  }

  /**
   * Interceptor installato su Pokemon.prototype.trySetShiny.
   * @param {Function} original - Il trySetShiny nativo
   * @param {Array} args - [t] dove t è il valore shiny rolling (0 | 65536)
   */
  function trySetShinyInterceptor(original, args) {
    const t = args.length > 0 ? args[0] : 0;
    state.hookStats.total++;

    // Toggle OFF → vanilla (delega incondizionata)
    if (!state.shiny) {
      return original.apply(this, args);
    }

    // Pokemon del PLAYER → delega al nativo con 65536: il percorso nativo
    // gestisce sparkle/variant del party in modo corretto (nessuna guardia
    // nemica qui, e il party va trattato come il gioco intende).
    if (typeof this.isPlayer === 'function' && this.isPlayer()) {
      state.hookStats.player++;
      return original.call(this, 65536);
    }

    // Nemici → bypass diretto (guardie interne aggirate)
    if (t !== 65536) {
      state.hookStats.forced++;
    }
    return forceShiny(this);
  }

  /**
   * Installa il wrapper su Pokemon.prototype.trySetShiny.
   * Usa helpers.hookPrototype (anti-riwrap con Symbol.for('pvuPatched'))
   * più la nostra guardia ENCOUNTER_PATCHED dedicata.
   * @returns {boolean} true se applicato
   */
  function hookTrySetShiny() {
    try {
      if (state.hooksApplied) return true;

      const proto = state.pokemonProto || discoverPokemonProto();
      if (!proto) {
        log('Pokemon prototype non ancora disponibile (retry)');
        return false;
      }

      const helpers = window.__pvu.helpers;
      if (!helpers || typeof helpers.hookPrototype !== 'function') {
        warn('helpers non disponibile, impossibile hookare');
        return false;
      }

      // Guardia dedicata: se già wrappato da noi, skip (mai doppio wrap)
      if (proto.trySetShiny && proto.trySetShiny[ENCOUNTER_PATCHED]) {
        originalTrySetShiny = proto.trySetShiny.__pvuOriginal || proto.trySetShiny;
        state.hooksApplied = true;
        state.active = true;
        log('trySetShiny già hookato, skip');
        return true;
      }

      originalTrySetShiny = proto.trySetShiny;

      const result = helpers.hookPrototype(proto, 'trySetShiny',
        trySetShinyInterceptor);

      // Marca il wrapper col Symbol dedicato (in aggiunta a 'pvuPatched'
      // che mette hookPrototype) per il mutuo riconoscimento
      try {
        const wrapped = proto.trySetShiny;
        wrapped[ENCOUNTER_PATCHED] = true;
        wrapped.__pvuOriginal = originalTrySetShiny;
      } catch (e) { /* proprietary attrs su function: safe in pratica */ }

      state.hooksApplied = true;
      state.active = true;
      log('trySetShiny hookato su Pokemon.prototype (class: ' + state.pokemonClass + ')');
      return true;
    } catch (e) {
      warn('hookTrySetShiny fallito:', e);
      return false;
    }
  }

  /**
   * Applica hooks con retry: il prototype Pokemon può apparire solo dopo
   * che la battle scene esiste. Idempotente.
   */
  function applyHooks() {
    if (state.hooksApplied) return true;

    let attempts = 0;
    const timer = setInterval(function() {
      attempts++;
      if (hookTrySetShiny()) {
        clearInterval(timer);
        return;
      }
      // Stop retry se il gioco è partito ma il proto non è trovabile:
      // discoverPokemonProto è chiamato ad ogni tentativo.
      if (attempts > 30) {
        clearInterval(timer);
        warn('Timeout: Pokemon prototype non trovato dopo 30s');
      }
    }, 1000);

    return state.hooksApplied;
  }

  /**
   * Toggle Always Shiny. Persistito in localStorage via storage.setSettings.
   * @param {boolean|undefined} val - valore desiderato (default: inverti)
   * @returns {boolean} stato finale
   */
  function toggleShiny(val) {
    state.shiny = val !== undefined ? !!val : !state.shiny;

    const storage = window.__pvu.storage;
    if (storage && typeof storage.setSettings === 'function') {
      storage.setSettings({ shiny: state.shiny });
    }

    log('Always Shiny:', state.shiny ? 'ON' : 'OFF');
    return state.shiny;
  }

  /**
   * Legge lo stato persistito all'avvio.
   * @returns {boolean} stato shiny persistito
   */
  function loadPersistedState() {
    try {
      const storage = window.__pvu.storage;
      if (!storage || typeof storage.getSettings !== 'function') return false;
      const settings = storage.getSettings() || {};
      state.shiny = !!settings.shiny;
      return state.shiny;
    } catch (e) {
      warn('loadPersistedState fallito:', e);
      return false;
    }
  }

  /**
   * Init: carica lo stato persistito e avvia il retry degli hooks.
   */
  function init() {
    log('init');

    loadPersistedState();
    if (state.shiny) {
      log('Always Shiny attivo da settings precedente');
    }

    applyHooks();
  }

  /**
   * Rimuove il wrapper e ripristina il trySetShiny nativo.
   */
  function destroy() {
    try {
      if (state.pokemonProto && originalTrySetShiny) {
        const proto = state.pokemonProto;
        const wrapped = proto.trySetShiny;
        if (wrapped && wrapped[ENCOUNTER_PATCHED]) {
          proto.trySetShiny = originalTrySetShiny;
          log('trySetShiny ripristinato');
        }
      }
    } catch (e) {
      warn('destroy fallito:', e);
    }
    originalTrySetShiny = null;
    state.hooksApplied = false;
    state.active = false;
    state.pokemonProto = null;
    log('destroy');
  }

  /**
   * Stato completo per la UI.
   */
  function getState() {
    return {
      shiny: state.shiny,
      active: state.active,
      hooksApplied: state.hooksApplied,
      pokemonClass: state.pokemonClass,
      hookStats: { ...state.hookStats },
    };
  }

  return {
    init: init,
    destroy: destroy,
    applyHooks: applyHooks,
    toggleShiny: toggleShiny,
    getState: getState,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.encounterOverride = PvuEncounterOverride;

// --- src/capture-override.js ---
// Task 4 v1.3.0. Analisi bundle v3.1.8:
//
// CommandPhase.handleCommand(t, n, ...s) — COL 16900189, case ro.BALL (enum ro.BALL = 1):
//
// GATE di blocco (cascata nel case ro.BALL):
//   1. tutorial → blocca
//   2. dynamicMode.noCatch → blocca
//   3. force-block: biomeType===k.END || isWavePreFinal || (legendary && wave<=1000) || isOPForm && wave<=1000
//   4. rival: battleType===TRAINER && checkIfRival
//   5. money: scene.money < getRequiredMoneyForPokeBuy
//   6. multi-target: enemyField.length > 1
//   7. boss-major: isBoss() && bossSegmentIndex>=1 && !WONDER_GUARD && !MASTER/VOID
//   8. void-ball HP: VOID_BALL && hpRatio > 0.25
//
// RAMO SUCCESSO (COL 16905667):
//   turnCommands[fieldIndex] = { command: ro.BALL, cursor: n, args: s.length ? [...s] : void 0 }
//   turnCommands[fieldIndex].targets = enemyField.filter(active).map(getBattlerIndex)
//   fieldIndex && (turnCommands[fieldIndex - 1].skip = true)
//   c = true
//   return c && this.end(), c          ← end() = setMode(MESSAGE).then(super.end())
//
// CHIAMANTE — BallSelectUiHandler COL 20420735:
//   E.handleCommand(ro.BALL, T.pokeballType) && (setMode(COMMAND, E.getFieldIndex()), setMode(MESSAGE), s = true)
//   → se false: niente (il nativo ha già gestito il blocco + UI)
//
// AttemptCapturePhase (Q1e) — COL 25069:
//   new gte(scene, targets[0]%2, cursor, args?.[0])
//   MASTER_BALL ballMult = -1 → catch 100%, VOID_BALL = -2 → catch 100%
//
// Strategia L2: wrapper generico su CommandPhase.prototype.handleCommand.
//   1. Chiamo il gate nativo → lo nativo giudica se accetta o blocca.
//   2. Se accetta (return true + turnCommands assegnato) → passo through.
//   3. Se blocca + toggle ON + L2 verificato → forza injection nel ramo successo.
//      a. Scrivo turnCommands con command/cursor/args/targets/skip
//      b. ui.clearText() → cancello il testo di blocco
//      c. phase.end() → termina la CommandPhase
//      d. return true → il chiamante procede normalmente
//   4. Dopo 3 errori → auto-degrade a L1 (pokeballCounts=99).
//
// L1 fallback (passivo): su ogni CommandPhase, setta pokeballCounts = 99 per
// tutti i tipi. Risolve solo il blocco "count=0"; i gate boss/rival/etc.
// richiedono L2.
//
// NOTA: bundle v3.1.8 con mangling OFF → CommandPhase.handleCommand è
// preservato in chiaro; il wrapper è trasparente.
const PvuCaptureOverride = (() => {
  const LOG_PREFIX = '[PvuCaptureOverride]';
  const CAPTURE_PATCHED = Symbol.for('pvuCapturePatched');

  // ro.BALL = 1 verificato nel bundle v3.1.8.
  // Fallback usato prima che il wrapper abbia osservato un successo nativo.
  const BALL_CMD_ID_FALLBACK = 1;

  const state = {
    enabled: false,
    level: 0,                // 0 = off, 1 = L1 (grant balls), 2 = L2 (wrapper)
    level2Verified: false,   // true dopo il primo successo nativo osservato
    commandProto: null,      // prototype di CommandPhase (scoperto a runtime)
    ballCommandId: null,     // ID del comando BALL nel Command enum (scoperto)
    injectedCount: 0,        // catture forzate con successo
    blockedCount: 0,         // tentativi bloccati (debug)
    errorCount: 0,           // errori del wrapper (auto-degrade >= 3)
    hooksApplied: false,     // wrapper installato su CommandPhase.prototype
    l1Applied: false,        // L1 applicato almeno una volta
    _discoveryRegistered: false, // discovery interceptor registrato
  };

  let originalHandleCommand = null;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  // ─── HELPERS ────────────────────────────────────────────────────────

  /**
   * Restituisce l'ID del comando BALL.
   * Dopo il primo successo nativo osservato il valore è in state.ballCommandId;
   * altrimenti usa il fallback hardcoded (1 = ro.BALL nel bundle v3.1.8).
   */
  function getBallCommandId() {
    if (state.ballCommandId !== null) return state.ballCommandId;
    return BALL_CMD_ID_FALLBACK;
  }

  /**
   * Deriva il fieldIndex dall'istanza CommandPhase.
   * CommandPhase ha this.fieldIndex dal costruttore (set via super(t) in xc).
   * Fallback: 0 (player sinistro).
   */
  function deriveFieldIndex(phase) {
    if (typeof phase.fieldIndex === 'number') return phase.fieldIndex;
    return 0;
  }

  /**
   * Verifica se turnCommands[fieldIndex] è già stato assegnato dal nativo.
   * @returns {boolean} true se il nativo ha già scritto il comando
   */
  function turnCommandsAlreadyAssigned(turnCommands, fi) {
    return !!(turnCommands && turnCommands[fi] && turnCommands[fi].command !== undefined);
  }

  function checkAutoDegrade() {
    if (state.errorCount >= 3 && state.level === 2) {
      state.level = 1;
      state.level2Verified = false;
      log('Auto-degrade a L1 dopo', state.errorCount, 'errori del wrapper');
    }
  }

  // ─── L1: GRANT BALL COUNTS ──────────────────────────────────────────

  /**
   * L1: garantisce 99 pokeballs per tutti i tipi nella battle scene.
   * Passivo: chiamato ad ogni CommandPhase push. Risolve solo il gate
   * "pokeballCounts[ballType] <= 0"; i gate boss/rival/etc. richiedono L2.
   * @param {object} scene - Battle scene
   * @returns {boolean} true se applicato
   */
  function applyLevel1(scene) {
    if (!state.enabled) return false;
    if (!scene) return false;

    try {
      // Pokeball counts (POKEBALL, GREAT_BALL, ULTRA_BALL, MASTER_BALL, ecc.)
      if (scene.pokeballCounts) {
        var balls = scene.pokeballCounts;
        for (var key in balls) {
          if (typeof balls[key] === 'number' && balls[key] < 99) {
            balls[key] = 99;
          }
        }
      }

      // Type ball counts
      if (scene.typeBallCounts) {
        var tb = scene.typeBallCounts;
        for (var key2 in tb) {
          if (typeof tb[key2] === 'number' && tb[key2] < 99) {
            tb[key2] = 99;
          }
        }
      }

      state.l1Applied = true;
      return true;
    } catch (e) {
      warn('applyLevel1 error:', e);
      return false;
    }
  }

  // ─── L2: WRAPPER SU CommandPhase.prototype.handleCommand ────────────

  /**
   * Forza l'injection nel ramo successo della CommandPhase.
   * Replica esattamente il nativo: turnCommands + targets + skip partner + end().
   * @returns {boolean} true se injection riuscita
   */
  function forceInject(scene, turnCommands, fi, t, n, s, phase) {
    try {
      var enemies = (scene.getEnemyField() || []).filter(function(p) {
        return p && typeof p.isActive === 'function' && p.isActive(true);
      });
      if (!enemies.length) {
        log('forceInject: nessun nemico attivo, skip');
        return false;
      }

      var tc = {
        command: t,
        cursor: n,
        args: (s && s.length > 0) ? Array.prototype.slice.call(s) : void 0
      };
      // targets = array di battlerIndex dei nemici attivi (come il nativo: getBattlerIndex())
      tc.targets = enemies.map(function(p) {
        return (typeof p.getBattlerIndex === 'function') ? p.getBattlerIndex() : 8;
      });

      turnCommands[fi] = tc;
      if (fi > 0 && turnCommands[fi - 1]) {
        turnCommands[fi - 1].skip = true;
      }

      // Cancella il testo di blocco e il suo pending prompt
      if (scene.ui && typeof scene.ui.clearText === 'function') {
        scene.ui.clearText();
      }

      // Termina la CommandPhase (setMode(MESSAGE).then(super.end()))
      if (typeof phase.end === 'function') {
        phase.end();
      }

      state.injectedCount++;
      log('Cattura forzata (#' + state.injectedCount + ') fieldIndex=' + fi +
          ', cmd=' + t + ', target=' + enemies.map(function(e) {
            return e.species ? e.species.speciesId : '?';
          }).join(','));
      return true;

    } catch (e) {
      state.errorCount++;
      checkAutoDegrade();
      warn('forceInject error:', e);
      return false;
    }
  }

  /**
   * Interceptor principale installato su CommandPhase.prototype.handleCommand.
   * Flusso:
   *   1. Toggle off / scena non disponibile → nativo incondizionato
   *   2. Chiama il gate nativo → giudica successo/blocco
   *   3. Successo nativo → passa through + impara ballCommandId
   *   4. Blocco + L2 verificato + toggle ON → forceInject + return true
   *   5. Altrimenti → passa il risultato nativo (false)
   *
   * @param {Function} original - handleCommand nativo
   * @param {Array} args - [t, n, ...s]
   * @returns {boolean}
   */
  function wrapperInterceptor(original, args) {
    var phase = this;
    var t = args[0];
    var n = args.length > 1 ? args[1] : undefined;
    var s = args.slice(2);

    // Toggle OFF o scena non pronta → nativo incondizionato
    if (!state.enabled) return original.apply(this, args);

    var scene = phase.scene;
    if (!scene || !scene.currentBattle) return original.apply(this, args);

    var turnCommands = scene.currentBattle.turnCommands;
    var fi = deriveFieldIndex(phase);

    try {
      // 1. Chiamo il gate nativo
      var result = original.apply(this, args);

      // 2. Successo nativo → impara ballCommandId (se non noto)
      if (result === true && turnCommands && turnCommandsAlreadyAssigned(turnCommands, fi)) {
        var tcCmd = turnCommands[fi].command;
        if (state.ballCommandId === null && tcCmd !== undefined) {
          state.ballCommandId = tcCmd;
          state.level2Verified = true;
          log('L2 verificato: ballCommandId =', state.ballCommandId);
        }
        return true;
      }

      // 3. Nativo è tornato true ma turnCommands non assegnato → anomal, passa
      if (result === true) return true;

      // 4. Bloccato → valuta force inject
      if (!state.enabled || !state.level2Verified) return result;

      // Verifica: era un comando BALL?
      var cmd = getBallCommandId();
      if (cmd !== null && t !== cmd) return result;

      // Force inject
      return forceInject(scene, turnCommands, fi, t, n, s, phase);

    } catch (e) {
      state.errorCount++;
      checkAutoDegrade();
      warn('Wrapper error:', e);
      // Fallback: prova il nativo
      try { return original.apply(phase, args); } catch (e2) { return false; }
    }
  }

  // ─── DISCOVERY: CommandPhase.prototype ───────────────────────────────

  /**
   * Discovery interceptor registrato via phaseObserver.onPhasePush.
   * Al primo CommandPhase rilevato, ne cattura il prototype e installa il wrapper.
   * @param {object} phaseObj - istanza della fase pushata
   */
  function discoveryInterceptor(phaseObj) {
    if (state.hooksApplied) return; // già installato

    // Identifica CommandPhase: ha handleCommand (metodo) + fieldIndex (proprietà)
    if (!phaseObj || typeof phaseObj.handleCommand !== 'function') return;
    if (typeof phaseObj.fieldIndex !== 'number') return;

    var proto = Object.getPrototypeOf(phaseObj);
    if (!proto || typeof proto.handleCommand !== 'function') return;

    // Anti-riwrap dedicato
    if (proto.handleCommand[CAPTURE_PATCHED]) {
      log('handleCommand già wrappato (CAPTURE_PATCHED)');
      state.hooksApplied = true;
      state.commandProto = proto;
      return;
    }

    log('CommandPhase scoperto via discovery interceptor');
    installWrapper(proto);
  }

  /**
   * Tenta di scoprire e wrappare CommandPhase.prototype direttamente
   * dalla battle scene (senza attendere il phase push).
   */
  function discoverAndHook() {
    if (state.hooksApplied) return true;

    var bridge = window.__pvu.bridge;
    var scene = bridge && bridge.getBattleScene();
    if (!scene) return false;

    // Scan _phases per trovare un CommandPhase
    var phases = scene._phases;
    if (phases && Array.isArray(phases)) {
      for (var i = 0; i < phases.length; i++) {
        var p = phases[i];
        if (p && typeof p.handleCommand === 'function' &&
            typeof p.fieldIndex === 'number') {
          var proto = Object.getPrototypeOf(p);
          if (proto && typeof proto.handleCommand === 'function' &&
              !proto.handleCommand[CAPTURE_PATCHED]) {
            state.commandProto = proto;
            installWrapper(proto);
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Installa il wrapper su CommandPhase.prototype.handleCommand tramite
   * helpers.hookPrototype (anti-riwrap pvuPatched) + CAPTURE_PATCHED dedicato.
   * @param {object} proto - CommandPhase.prototype
   * @returns {boolean} true se installato con successo
   */
  function installWrapper(proto) {
    if (state.hooksApplied) return true;

    var helpers = window.__pvu.helpers;
    if (!helpers || typeof helpers.hookPrototype !== 'function') {
      warn('helpers non disponibile');
      return false;
    }

    if (proto.handleCommand && proto.handleCommand[CAPTURE_PATCHED]) {
      log('handleCommand già wrappato (installWrapper)');
      state.hooksApplied = true;
      return true;
    }

    originalHandleCommand = proto.handleCommand;
    helpers.hookPrototype(proto, 'handleCommand', wrapperInterceptor);

    // Marca col Symbol dedicato (anti-riwrap interno al modulo)
    try {
      proto.handleCommand[CAPTURE_PATCHED] = true;
    } catch (e) { /* proprietary attrs su function: safe in pratica */ }

    state.hooksApplied = true;
    log('handleCommand wrapper installato su CommandPhase.prototype');
    return true;
  }

  // ─── API PUBBLICA ───────────────────────────────────────────────────

  /**
   * Applica hooks: registra discovery interceptor + tenta discovery diretta.
   * Idempotente. Chiamato da main.js boot loop.
   * @returns {boolean} true se wrapper installato
   */
  function applyHooks() {
    if (state.hooksApplied) return true;

    var bridge = window.__pvu.bridge;
    var phaseObserver = window.__pvu.phaseObserver;
    var helpers = window.__pvu.helpers;

    if (!bridge || !helpers) return false;

    // Registra discovery interceptor (trigger: ogni CommandPhase push)
    if (!state._discoveryRegistered && phaseObserver &&
        typeof phaseObserver.onPhasePush === 'function') {
      phaseObserver.onPhasePush(discoveryInterceptor);
      state._discoveryRegistered = true;
      log('Discovery interceptor registrato');
    }

    // Tentativo diretto (senza attendere il prossimo phase push)
    if (!state.hooksApplied) {
      discoverAndHook();
    }

    // Applica L1 anche se L2 non è ancora pronto
    var scene = bridge.getBattleScene();
    if (scene && state.enabled) {
      applyLevel1(scene);
    }

    return state.hooksApplied;
  }

  /**
   * Toggle Catch Any Pokemon. Persistito in localStorage via storage.setSettings.
   * @param {boolean|undefined} val - valore desiderato (default: inverti)
   * @returns {boolean} stato finale
   */
  function toggleCapture(val) {
    state.enabled = val !== undefined ? !!val : !state.enabled;
    state.level = state.enabled ? 2 : 0;

    var storage = window.__pvu.storage;
    if (storage && typeof storage.setSettings === 'function') {
      storage.setSettings({ capture: state.enabled });
    }

    log('Catch Any:', state.enabled ? 'ON (L2)' : 'OFF');
    return state.enabled;
  }

  /**
   * Legge lo stato persistito all'avvio.
   * @returns {boolean} stato capture persistito
   */
  function loadPersistedState() {
    try {
      var storage = window.__pvu.storage;
      if (!storage || typeof storage.getSettings !== 'function') return false;
      var settings = storage.getSettings() || {};
      state.enabled = !!settings.capture;
      state.level = state.enabled ? 2 : 0;
      return state.enabled;
    } catch (e) {
      warn('loadPersistedState fallito:', e);
      return false;
    }
  }

  /**
   * Init: carica stato persistito e avvia hook.
   * Da chiamare da main.js bootstrap (dopo encounterOverride.init).
   */
  function init() {
    log('init');

    loadPersistedState();
    if (state.enabled) {
      log('Catch Any attivo da settings precedente');
    }

    applyHooks();
  }

  /**
   * Stato completo per la UI.
   */
  function getState() {
    return {
      enabled: state.enabled,
      level: state.level,
      level2Verified: state.level2Verified,
      ballCommandId: state.ballCommandId,
      hooksApplied: state.hooksApplied,
      l1Applied: state.l1Applied,
      injectedCount: state.injectedCount,
      blockedCount: state.blockedCount,
      errorCount: state.errorCount,
    };
  }

  /**
   * Rimuove il wrapper e ripristina handleCommand nativo.
   */
  function destroy() {
    try {
      if (state.commandProto && originalHandleCommand) {
        var proto = state.commandProto;
        if (proto.handleCommand && proto.handleCommand[CAPTURE_PATCHED]) {
          proto.handleCommand = originalHandleCommand;
          log('handleCommand ripristinato');
        }
      }
    } catch (e) {
      warn('destroy fallito:', e);
    }
    originalHandleCommand = null;
    state.hooksApplied = false;
    state.commandProto = null;
    state.level2Verified = false;
    state.ballCommandId = null;
    log('destroy');
  }

  return {
    init: init,
    destroy: destroy,
    applyHooks: applyHooks,
    toggleCapture: toggleCapture,
    getState: getState,
    applyLevel1: applyLevel1,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.captureOverride = PvuCaptureOverride;


// --- src/money-override.js ---
const PvuMoneyOverride = (() => {
  const LOG_PREFIX = '[PvuMoneyOverride]';
  const MAX = Number.MAX_SAFE_INTEGER;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * Imposta money nella run corrente + permaMoney persistente.
   * @param {number} amount - Nuovo importo
   * @returns {{ ok: boolean, error?: string, sceneMoney?: number, permaMoney?: number }}
   */
  function setMoney(amount) {
    try {
      // FIX v1.2.1 (corruzione BigInt): normalizza l'input.
      // Il gioco tratta permaMoney come number — mai bigint o stringa "123n".
      // BigInt(amount) qui causava freeze Ω in-sessione ((permaMoney||0)+d → BigInt+number)
      // e [LOAD ERROR] initSystem failed: Cannot convert a BigInt value to a number al riavvio.
      if (typeof amount === 'bigint' || typeof amount === 'string') {
        amount = Number(amount);
      }
      if (!Number.isFinite(amount)) {
        amount = 0;
      }
      amount = Math.max(0, Math.min(Math.floor(amount), MAX));
      const bridge = window.__pvu.bridge;
      const scene = bridge.getBattleScene();

      if (!scene) {
        return { ok: false, error: 'Battle scene non disponibile' };
      }

      // scene.money (run corrente)
      scene.money = amount;
      log('scene.money impostato a', amount);

      // gameData.permaMoney (persistente)
      const gameData = bridge.findGameData();
      if (gameData) {
        // Difensivo: se permaMoney è già bigint/stringa "123n" (save corrotto in memoria),
        // normalizzalo prima che il gioco lo usi (Math.round/NaN-freeze).
        if (typeof gameData.permaMoney === 'bigint') {
          warn('permaMoney era BigInt (' + String(gameData.permaMoney) + ') → normalizzato a Number');
          gameData.permaMoney = Number(gameData.permaMoney);
        } else if (typeof gameData.permaMoney === 'string') {
          const m = /^(\d+)n?$/.exec(gameData.permaMoney.trim());
          if (m) {
            warn('permaMoney era stringa ("' + gameData.permaMoney + '") → normalizzato a Number');
            gameData.permaMoney = Number(m[1]);
          }
        }

        // FIX v1.2.1: era BigInt(amount) — corrompeva permaMoney (freeze Ω + load error).
        // Il gioco tratta permaMoney come number: assegniamo sempre Number.
        gameData.permaMoney = Number(amount);
        log('permaMoney impostato a', gameData.permaMoney);

        // Refresh UI — cerca updateMoneyText o updateGameInfo
        try {
          if (typeof scene.updateMoneyText === 'function') {
            scene.updateMoneyText();
          }
        } catch(e) {
          warn('updateMoneyText non disponibile:', e);
        }

        try {
          if (typeof scene.updateGameInfo === 'function') {
            scene.updateGameInfo();
          }
        } catch(e) {
          // updateGameInfo potrebbe non essere disponibile fuori dalla fase giusta
        }

        // Trigger save
        triggerSave(gameData);

        return { ok: true, sceneMoney: amount, permaMoney: amount };
      } else {
        warn('gameData non disponibile — money solo in run');
        return { ok: true, sceneMoney: amount, error: 'gameData non trovato, solo run money aggiornato' };
      }
    } catch (e) {
      warn('setMoney fallito:', e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * Leggi il money corrente.
   */
  function getMoney() {
    try {
      const bridge = window.__pvu.bridge;
      const scene = bridge.getBattleScene();
      if (scene && scene.money !== undefined) return Number(scene.money);

      const gameData = bridge.findGameData();
      if (gameData && gameData.permaMoney !== undefined) {
        // FIX v1.2.1: Number("123n") = NaN — gestisci stringa bigint-serializzata.
        const v = gameData.permaMoney;
        if (typeof v === 'bigint') return Number(v);
        if (typeof v === 'string') {
          const m = /^(\d+)n?$/.exec(v.trim());
          return m ? Number(m[1]) : Number(v);
        }
        return Number(v);
      }
    } catch(e) {}
    return 0;
  }

  /**
   * Trigger save tramite gameData.
   */
  function triggerSave(gameData) {
    try {
      if (gameData && typeof gameData.saveSystem === 'function') {
        gameData.saveSystem();
        log('saveSystem() invocato');
      }
    } catch(e) {
      warn('saveSystem fallito:', e);
    }
  }

  /**
   * Apply da UI: prende il valore dal campo input e lo applica.
   */
  function applyFromInput(inputElement) {
    if (!inputElement) return { ok: false, error: 'Input element not found' };
    const val = parseInt(inputElement.value, 10);
    if (isNaN(val)) return { ok: false, error: 'Valore non valido' };
    return setMoney(val);
  }

  return {
    setMoney: setMoney,
    getMoney: getMoney,
    applyFromInput: applyFromInput,
    triggerSave: triggerSave,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.moneyOverride = PvuMoneyOverride;


// --- src/skill-tree-editor.js ---
// BUG 2 FIX: read/write activeSkillTree.skillPoints (per-run SP), not gd.skillPoints (global)
// FIX: use resolveActiveChampionId fallback chain for champion detection
const PvuSkillTreeEditor = (() => {
  const LOG_PREFIX = '[PvuSkillTreeEditor]';
  const UNLOCK_MAP = {
    megaStones: 'unlockedMegaStones',
    xms: 'unlockedXMs',
    smittyAbilities: 'unlockedSmittyAbilities',
    legendaryPokemon: 'unlockedLegendaryPokemon',
    signaturePokemon: 'unlockedSignaturePokemon',
    glitchForms: 'unlockedGlitchForms',
  };

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * Get the activeSkillTree object from gameData.
   * This is the per-run skill tree instance containing skillPoints, tokens, unlockedBranches, etc.
   */
  function getActiveSkillTree() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return null;
    return gd.activeSkillTree || null;
  }

  // PARTE 5: log diagnostico throttlato — logga SOLO quando cambia (champId|source).
  // skill-screen chiama refreshUI ogni 3s → senza throttle spammeremmo la console.
  let lastChampLogKey = null;

  /**
   * Resolve the active champion ID using the game's own fallback chain:
   * selectedChampionId → activeSkillTree.championId → gender-based default
   * This matches bundle: resolveActiveChampionId() @15090868
   *
   * PARTE 5: label della sorgente + log diagnostico throttlato.
   * Il null qui NON è un risultato legittimo se gameData esiste (la catena cade
   * sempre sul gender-default) → un eventuale "champion non trovato" in UI è
   * un problema di timing del bridge (gameData non ancora visibile), non di logica.
   */
  function resolveActiveChampionId() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return null;

    let champId = null;
    let source = 'none';

    if (gd.selectedChampionId) {
      champId = gd.selectedChampionId;
      source = 'selectedChampionId';
    } else if (gd.activeSkillTree && gd.activeSkillTree.championId) {
      champId = gd.activeSkillTree.championId;
      source = 'activeSkillTree.championId';
    }

    if (champId === 'apollo_diana') {
      champId = gd.gender === 'FEMALE' ? 'diana' : 'apollo';
      source = source + '→apollo_diana:gender';
    }
    if (champId) {
      const key = champId + '|' + source;
      if (key !== lastChampLogKey) {
        lastChampLogKey = key;
        log('Champion risolto:', champId, '(source:', source + ')');
      }
      return champId;
    }

    // Caduta finale: default per gender (identico al gioco)
    const fallback = gd.gender === 'FEMALE' ? 'diana' : 'apollo';
    const key = fallback + '|gender-default';
    if (key !== lastChampLogKey) {
      lastChampLogKey = key;
      log('Champion risolto (gender default):', fallback, '(source: gender-default)');
    }
    return fallback;
  }

  /**
   * Leggi skillPoints correnti dal per-run activeSkillTree.
   * Bundle path: gameData.activeSkillTree.skillPoints (not gameData.skillPoints!)
   */
  function getSkillPoints() {
    const ast = getActiveSkillTree();
    if (!ast) return 0;
    return Number(ast.skillPoints || 0);
  }

  /**
   * Imposta skillPoints sul per-run activeSkillTree.
   */
  function setSkillPoints(amount) {
    const ast = getActiveSkillTree();
    if (!ast) {
      warn('activeSkillTree non disponibile (nessuna run attiva?)');
      return false;
    }
    ast.skillPoints = Math.max(0, Math.floor(amount));
    log('activeSkillTree.skillPoints impostato a', ast.skillPoints);
    return true;
  }

  /**
   * Get champion ID corrente — uses resolveActiveChampionId fallback.
   */
  function getSelectedChampionId() {
    return resolveActiveChampionId();
  }

  /**
   * BUG 5 FIX: normalizza lockedSkills in un array.
   * Il gioco può salvarlo come array, Map, o oggetto { [skillId]: {...} }.
   */
  function toSkillArray(locked) {
    if (!locked) return [];
    if (Array.isArray(locked)) return locked;
    if (typeof locked === 'string') return [{ skillId: locked }];
    if (typeof locked === 'object') {
      // Map-like
      if (typeof locked.values === 'function' && typeof locked.size === 'number') {
        return Array.from(locked.values());
      }
      // Object-like: { [skillId]: data }
      return Object.keys(locked).map(function(k) {
        const v = locked[k];
        if (v && typeof v === 'object') {
          return Object.assign({ skillId: k }, v);
        }
        return { skillId: k };
      });
    }
    return [];
  }

  /**
   * Get locked skills del champion corrente.
   * Reads from championData[championId].lockedSkills.
   */
  function getLockedSkills() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return [];
    const champId = resolveActiveChampionId();
    if (!champId) return [];
    const champData = gd.championData && gd.championData[champId];
    if (!champData) return [];
    return toSkillArray(champData.lockedSkills);
  }

  /**
   * Get champion skill version corrente.
   */
  function getChampionSkillVersion() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return null;
    const champId = resolveActiveChampionId();
    if (!champId) return null;
    const champData = gd.championData && gd.championData[champId];
    if (!champData) return null;
    return champData.championSkillVersion || gd.championSkillVersion || null;
  }

  /**
   * Sblocca una skill: bypass prerequisiti, spesa 0, push in unlocked<>.
   * @param {string} skillId - L'ID della skill da sbloccare
   * @param {string} unlockableCategory - La categoria (megaStones, xms, etc.)
   * @returns {{ ok: boolean, error?: string }}
   */
  function unlockSkill(skillId, unlockableCategory) {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return { ok: false, error: 'gameData non disponibile' };

    const champId = resolveActiveChampionId();
    if (!champId) return { ok: false, error: 'Nessun champion attivo nella run' };

    let champData = gd.championData && gd.championData[champId];
    if (!champData) {
      // Crea struttura se non esiste
      gd.championData = gd.championData || {};
      gd.championData[champId] = { lockedSkills: [] };
      champData = gd.championData[champId];
    }

    // 1. Rimuovi da lockedSkills (supporta array, Map, oggetto)
    if (champData.lockedSkills) {
      const lockedArr = toSkillArray(champData.lockedSkills);
      const idx = lockedArr.findIndex(function(s) {
        return s.skillId === skillId || s.id === skillId || s === skillId;
      });
      if (idx !== -1) {
        lockedArr.splice(idx, 1);
        champData.lockedSkills = lockedArr; // riscrivi normalizzato
        log('Skill', skillId, 'rimossa da lockedSkills');
      }
    }

    // 2. Push in unlocked<category>
    const unlockedKey = UNLOCK_MAP[unlockableCategory];
    if (unlockedKey) {
      champData[unlockedKey] = champData[unlockedKey] || [];
      if (champData[unlockedKey].indexOf(skillId) === -1) {
        champData[unlockedKey].push(skillId);
        log('Skill', skillId, 'aggiunta a', unlockedKey);
      }
    }

    // 3. Trigger save
    try {
      if (typeof gd.saveSystem === 'function') {
        gd.saveSystem();
        log('saveSystem() invocato dopo unlock');
      }
    } catch(e) {
      warn('saveSystem fallito:', e);
    }

    return { ok: true };
  }

  /**
   * Check se la champion skill version è cambiata rispetto all'ultima volta
   * che abbiamo fatto unlock (warning).
   */
  function checkVersionWarning() {
    const currentVer = getChampionSkillVersion();
    try {
      const saved = localStorage.getItem('__pvu_unlockedVersion');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.version !== currentVer) {
          return { changed: true, oldVersion: parsed.version, newVersion: currentVer };
        }
      }
    } catch(e) {}
    return { changed: false };
  }

  /**
   * Salva la versione corrente dopo unlock.
   */
  function saveVersion() {
    const ver = getChampionSkillVersion();
    if (ver) {
      try {
        localStorage.setItem('__pvu_unlockedVersion', JSON.stringify({ version: ver, ts: Date.now() }));
      } catch(e) {}
    }
  }

  /**
   * Get lista di tutti gli unlockables possibili (dai lockedSkills).
   */
  function getUnlockablesList() {
    const locked = getLockedSkills();
    const result = [];
    for (let i = 0; i < locked.length; i++) {
      const skill = locked[i];
      if (!skill) continue;
      const skillId = skill.skillId || skill.id || ('skill_' + i);
      const category = skill.category || skill.type || guessCategory(skill);
      const requiredLevel = skill.unlockLevel || skill.level || 0;
      const requiredEssence = skill.requiredEssenceWeights || skill.essenceWeights || null;
      result.push({
        skillId: skillId,
        category: category,
        requiredLevel: requiredLevel,
        requiredEssence: requiredEssence,
        raw: skill,
      });
    }
    return result;
  }

  function guessCategory(skill) {
    const s = JSON.stringify(skill).toLowerCase();
    if (s.indexOf('mega') !== -1) return 'megaStones';
    if (s.indexOf('xm') !== -1 || s.indexOf('key_m') !== -1) return 'xms';
    if (s.indexOf('smitty') !== -1 || s.indexOf('ability') !== -1) return 'smittyAbilities';
    if (s.indexOf('legendary') !== -1 || s.indexOf('legend') !== -1) return 'legendaryPokemon';
    if (s.indexOf('signature') !== -1 || s.indexOf('sig') !== -1) return 'signaturePokemon';
    if (s.indexOf('glitch') !== -1) return 'glitchForms';
    return 'megaStones'; // default
  }

  return {
    getSkillPoints: getSkillPoints,
    setSkillPoints: setSkillPoints,
    getSelectedChampionId: getSelectedChampionId,
    getLockedSkills: getLockedSkills,
    getChampionSkillVersion: getChampionSkillVersion,
    unlockSkill: unlockSkill,
    checkVersionWarning: checkVersionWarning,
    saveVersion: saveVersion,
    getUnlockablesList: getUnlockablesList,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.skillTreeEditor = PvuSkillTreeEditor;


// --- src/voucher-editor.js ---
const PvuVoucherEditor = (() => {
  const LOG_PREFIX = '[PvuVoucherEditor]';
  const TYPES = [0, 1, 2, 3];
  const LABELS = ['REGULAR', 'PLUS', 'PREMIUM', 'GOLDEN'];
  const VOUCHER_EMOJI = ['🎫', '🎟️', '⭐', '👑'];

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function getGameData() {
    const bridge = window.__pvu.bridge;
    if (bridge) return bridge.findGameData();
    return null;
  }

  function getVoucherCounts() {
    try {
      const gd = getGameData();
      if (!gd) return null;
      if (!gd.voucherCounts || typeof gd.voucherCounts !== 'object') {
        gd.voucherCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
      }
      return {
        REGULAR: gd.voucherCounts[0] || 0,
        PLUS: gd.voucherCounts[1] || 0,
        PREMIUM: gd.voucherCounts[2] || 0,
        GOLDEN: gd.voucherCounts[3] || 0,
      };
    } catch (e) {
      log('getVoucherCounts error:', e);
      return null;
    }
  }

  function setVoucherCount(typeIndex, value) {
    try {
      if (typeIndex < 0 || typeIndex > 3) {
        return { ok: false, error: 'Tipo non valido' };
      }
      const numVal = Math.max(0, Math.floor(Number(value)));
      if (isNaN(numVal)) {
        return { ok: false, error: 'Valore non valido' };
      }
      const gd = getGameData();
      if (!gd) {
        return { ok: false, error: 'gameData non disponibile' };
      }
      if (!gd.voucherCounts || typeof gd.voucherCounts !== 'object') {
        gd.voucherCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
      }
      gd.voucherCounts[typeIndex] = numVal;
      log('setVoucherCount:', LABELS[typeIndex], '=', numVal);
      return { ok: true };
    } catch (e) {
      log('setVoucherCount error:', e);
      return { ok: false, error: e.message };
    }
  }

  function setAllVoucherCounts(countsObj) {
    try {
      const gd = getGameData();
      if (!gd) {
        return { ok: false, error: 'gameData non disponibile' };
      }
      if (!gd.voucherCounts || typeof gd.voucherCounts !== 'object') {
        gd.voucherCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
      }
      if (countsObj.REGULAR !== undefined) {
        const v = Math.max(0, Math.floor(Number(countsObj.REGULAR)));
        if (!isNaN(v)) gd.voucherCounts[0] = v;
      }
      if (countsObj.PLUS !== undefined) {
        const v = Math.max(0, Math.floor(Number(countsObj.PLUS)));
        if (!isNaN(v)) gd.voucherCounts[1] = v;
      }
      if (countsObj.PREMIUM !== undefined) {
        const v = Math.max(0, Math.floor(Number(countsObj.PREMIUM)));
        if (!isNaN(v)) gd.voucherCounts[2] = v;
      }
      if (countsObj.GOLDEN !== undefined) {
        const v = Math.max(0, Math.floor(Number(countsObj.GOLDEN)));
        if (!isNaN(v)) gd.voucherCounts[3] = v;
      }
      log('setAllVoucherCounts:', JSON.stringify(countsObj));
      return { ok: true };
    } catch (e) {
      log('setAllVoucherCounts error:', e);
      return { ok: false, error: e.message };
    }
  }

  return {
    TYPES: TYPES,
    LABELS: LABELS,
    VOUCHER_EMOJI: VOUCHER_EMOJI,
    getVoucherCounts: getVoucherCounts,
    setVoucherCount: setVoucherCount,
    setAllVoucherCounts: setAllVoucherCounts,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.voucherEditor = PvuVoucherEditor;


// --- src/ui/styles.js ---
const PvuStyles = (() => {
  const LOG_PREFIX = '[PvuStyles]';
  let injected = false;

  function inject() {
    if (injected) return;
    injected = true;

    const css = `
/* PokeVoid-Unlocked Styles */
#pvu-container {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 380px;
  pointer-events: none;
  z-index: 99998;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  transition: transform 0.3s ease;
}
#pvu-container.pvu-hidden {
  transform: translateX(100%);
}

/* Floating button */
#pvu-fab {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  background: #1a1a2e;
  border: 2px solid #e94560;
  border-radius: 50%;
  color: #e94560;
  font-size: 18px;
  cursor: pointer;
  z-index: 99999;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, background 0.2s;
  user-select: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
#pvu-fab:hover {
  transform: scale(1.1);
  background: #e94560;
  color: #1a1a2e;
}
#pvu-fab:active {
  transform: scale(0.95);
}

/* Panel */
#pvu-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 380px;
  background: rgba(26, 26, 46, 0.95);
  backdrop-filter: blur(10px);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: #eee;
}

/* Header */
#pvu-panel .pvu-header {
  padding: 12px 16px;
  background: #e94560;
  color: #1a1a2e;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 18px;
  font-weight: 700;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
#pvu-panel .pvu-header .pvu-close {
  cursor: pointer;
  font-size: 20px;
  color: #1a1a2e;
  background: none;
  border: none;
  padding: 0 4px;
}

/* Tabs */
#pvu-panel .pvu-tabs {
  display: flex;
  border-bottom: 1px solid #333;
}
#pvu-panel .pvu-tab {
  flex: 1;
  padding: 10px 8px;
  text-align: center;
  cursor: pointer;
  color: #888;
  font-size: 14px;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  font-family: inherit;
}
#pvu-panel .pvu-tab:hover {
  color: #eee;
}
#pvu-panel .pvu-tab.pvu-tab-active {
  color: #e94560;
  border-bottom-color: #e94560;
}

/* Tab content */
#pvu-panel .pvu-tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

/* Section */
#pvu-panel .pvu-section {
  margin-bottom: 16px;
}
#pvu-panel .pvu-section-title {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 16px;
  color: #e94560;
  margin-bottom: 8px;
  text-transform: uppercase;
}

/* Toggle switch */
#pvu-panel .pvu-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #333;
}
#pvu-panel .pvu-toggle-label {
  font-size: 14px;
  color: #f0f0f0;
}
#pvu-panel .pvu-toggle-desc {
  font-size: 13px;
  color: #aaa;
}
#pvu-panel .pvu-switch {
  width: 40px;
  height: 22px;
  background: #333;
  border-radius: 11px;
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}
#pvu-panel .pvu-switch.on {
  background: #e94560;
}
#pvu-panel .pvu-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: #eee;
  border-radius: 50%;
  transition: transform 0.2s;
}
#pvu-panel .pvu-switch.on::after {
  transform: translateX(18px);
}

/* Input row */
#pvu-panel .pvu-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
#pvu-panel .pvu-input {
  flex: 1;
  background: #111;
  border: 1px solid #444;
  color: #eee;
  padding: 6px 10px;
  border-radius: 4px;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
}
#pvu-panel .pvu-input:focus {
  border-color: #e94560;
  outline: none;
}
#pvu-panel .pvu-btn {
  background: #e94560;
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  white-space: nowrap;
}
#pvu-panel .pvu-btn:hover {
  background: #d63851;
}
#pvu-panel .pvu-btn:active {
  transform: scale(0.97);
}
#pvu-panel .pvu-btn.pvu-btn-sm {
  padding: 4px 10px;
  font-size: 13px;
}
#pvu-panel .pvu-btn.pvu-btn-outline {
  background: transparent;
  border: 1px solid #e94560;
  color: #e94560;
}
#pvu-panel .pvu-btn.pvu-btn-outline:hover {
  background: #e9456022;
}

/* Slider */
#pvu-panel .pvu-slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
#pvu-panel .pvu-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: #333;
  border-radius: 2px;
  outline: none;
}
#pvu-panel .pvu-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #e94560;
  border-radius: 50%;
  cursor: pointer;
}
#pvu-panel .pvu-slider-val {
  min-width: 30px;
  text-align: center;
  font-size: 14px;
  color: #e94560;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* Status badge */
#pvu-panel .pvu-status {
  font-size: 13px;
  color: #aaa;
  margin-top: 4px;
}
#pvu-panel .pvu-status.ok { color: #66bb6a; }
#pvu-panel .pvu-status.warn { color: #ffb74d; }
#pvu-panel .pvu-status.err { color: #ef5350; }

/* Skill list */
#pvu-panel .pvu-skill-item {
  padding: 8px;
  background: #111;
  border-radius: 4px;
  margin-bottom: 6px;
  border-left: 3px solid #e94560;
}
#pvu-panel .pvu-skill-name {
  font-size: 14px;
  color: #f0f0f0;
  margin-bottom: 4px;
}
#pvu-panel .pvu-skill-meta {
  font-size: 13px;
  color: #aaa;
}

/* Warning box */
#pvu-panel .pvu-warning {
  background: rgba(255, 152, 0, 0.15);
  border: 1px solid #ff9800;
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #ffb74d;
}

/* Info box */
#pvu-panel .pvu-info {
  background: rgba(33, 150, 243, 0.1);
  border: 1px solid #2196f3;
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #90caf9;
}

/* Scrollbar */
#pvu-panel .pvu-tab-content::-webkit-scrollbar {
  width: 6px;
}
#pvu-panel .pvu-tab-content::-webkit-scrollbar-track {
  background: transparent;
}
#pvu-panel .pvu-tab-content::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 3px;
}

/* Champion selector */
#pvu-panel .pvu-champ-select {
  background: #111;
  border: 1px solid #444;
  color: #eee;
  padding: 6px 10px;
  border-radius: 4px;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  width: 100%;
  margin-bottom: 8px;
}
#pvu-panel .pvu-champ-select option {
  background: #1a1a2e;
  color: #eee;
}

/* Version badge */
#pvu-panel .pvu-ver {
  font-size: 12px;
  color: #888;
  text-align: right;
  margin-top: 8px;
}
`;

    const style = document.createElement('style');
    style.id = 'pvu-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    console.log('[PvuStyles] CSS iniettato');
  }

  return { inject: inject };
})();

window.__pvu = window.__pvu || {};
window.__pvu.styles = PvuStyles;


// --- src/ui/floating-btn.js ---
const PvuFloatingBtn = (() => {
  const LOG_PREFIX = '[PvuFloatingBtn]';
  let btnEl = null;
  let panelEl = null;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function create(onClick) {
    if (btnEl) return btnEl;

    btnEl = document.createElement('button');
    btnEl.id = 'pvu-fab';
    btnEl.textContent = '⚡';
    btnEl.title = 'PokeVoid-Unlocked';
    btnEl.setAttribute('aria-label', 'PokeVoid-Unlocked');

    btnEl.addEventListener('click', function(e) {
      e.stopPropagation();
      if (typeof onClick === 'function') {
        onClick();
      }
    });

    // Inserisci nel body appena disponibile
    if (document.body) {
      document.body.appendChild(btnEl);
      log('Bottone creato');
    } else {
      // document-start: aspetta body
      const observer = new MutationObserver(function() {
        if (document.body) {
          document.body.appendChild(btnEl);
          observer.disconnect();
          log('Bottone creato (after body)');
        }
      });
      observer.observe(document.documentElement || document, { childList: true, subtree: true });
    }

    return btnEl;
  }

  function show() {
    if (btnEl) btnEl.style.display = 'flex';
  }

  function hide() {
    if (btnEl) btnEl.style.display = 'none';
  }

  function destroy() {
    if (btnEl && btnEl.parentNode) btnEl.parentNode.removeChild(btnEl);
    btnEl = null;
    log('destroy');
  }

  return {
    create: create,
    show: show,
    hide: hide,
    destroy: destroy,
    getElement: function() { return btnEl; },
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.floatingBtn = PvuFloatingBtn;


// --- src/ui/roll-screen.js ---
// PARTE 2: rimossi toggle morti (freeReroll, poolQuality)
// Luck Lock: influisce SOLO sulle offerte del roll (getModifierTypeOptions su), non su party luck/battle
const PvuRollScreen = (() => {
  const LOG_PREFIX = '[PvuRollScreen]';
  let containerEl = null;
  let refreshTimer = null;

  // Track toggle switch DOM elements by state key for sync
  const toggleRefs = {};

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function render(parentEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'pvu-roll-screen';

    // === Reroll Section ===
    const rerollSection = document.createElement('div');
    rerollSection.className = 'pvu-section';

    const rerollTitle = document.createElement('div');
    rerollTitle.className = 'pvu-section-title';
    rerollTitle.textContent = 'ROLL CONTROLLER';
    rerollSection.appendChild(rerollTitle);

    // Cost Override
    const costOverrideResult = createToggle('Nessun costo', 'WAIVE_ROLL_FEE_OVERRIDE — tutti i reroll gratis', false, function(val) {
      window.__pvu.rollController.toggleCostOverride(val);
    });
    rerollSection.appendChild(costOverrideResult.row);
    toggleRefs.costOverride = costOverrideResult.switchEl;

    containerEl.appendChild(rerollSection);

    // === BUG 3: Luck Lock Section ===
    const luckSection = document.createElement('div');
    luckSection.className = 'pvu-section';

    const luckTitle = document.createElement('div');
    luckTitle.className = 'pvu-section-title';
    luckTitle.textContent = 'LUCK LOCK';
    luckSection.appendChild(luckTitle);

    // Luck slider
    const luckSliderRow = document.createElement('div');
    luckSliderRow.className = 'pvu-slider-row';

    const luckSlider = document.createElement('input');
    luckSlider.type = 'range';
    luckSlider.className = 'pvu-slider';
    luckSlider.min = '1';
    luckSlider.max = '7';
    luckSlider.value = '5';
    luckSlider.id = 'pvu-luck-slider';

    const luckValLabel = document.createElement('span');
    luckValLabel.className = 'pvu-slider-val';
    luckValLabel.textContent = '5';
    luckValLabel.id = 'pvu-luck-val';

    luckSlider.addEventListener('input', function() {
      const v = parseInt(luckSlider.value, 10);
      luckValLabel.textContent = v;
      window.__pvu.rollController.setLuckValue(v);
    });

    luckSliderRow.appendChild(luckSlider);
    luckSliderRow.appendChild(luckValLabel);
    luckSection.appendChild(luckSliderRow);

    // Luck Lock toggle
    const luckLockResult = createToggle('Lock luck', 'Fissa il valore di luck (1-7) per le offerte del roll', false, function(val) {
      window.__pvu.rollController.toggleLuckLock(val);
    });
    luckSection.appendChild(luckLockResult.row);
    toggleRefs.luckLock = luckLockResult.switchEl;

    // Luck info
    const luckInfo = document.createElement('div');
    luckInfo.className = 'pvu-status';
    luckInfo.textContent = '1-7 (5 = default). Influenza la qualità delle offerte del roll; non tocca il party luck delle battle e non raggiunge shop/ball-lock.';
    luckSection.appendChild(luckInfo);

    containerEl.appendChild(luckSection);

    // === Item Count Section ===
    const itemSection = document.createElement('div');
    itemSection.className = 'pvu-section';

    const itemTitle = document.createElement('div');
    itemTitle.className = 'pvu-section-title';
    itemTitle.textContent = 'ITEM COUNT';
    itemSection.appendChild(itemTitle);

    const sliderRow = document.createElement('div');
    sliderRow.className = 'pvu-slider-row';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'pvu-slider';
    slider.min = '0';
    slider.max = '4';
    slider.value = '2';
    slider.id = 'pvu-item-slider';

    const valLabel = document.createElement('span');
    valLabel.className = 'pvu-slider-val';
    valLabel.textContent = '+2';
    valLabel.id = 'pvu-item-val';

    slider.addEventListener('input', function() {
      const v = parseInt(slider.value, 10);
      valLabel.textContent = '+' + v;
      window.__pvu.rollController.setItemCountExtra(v);
    });

    sliderRow.appendChild(slider);
    sliderRow.appendChild(valLabel);
    itemSection.appendChild(sliderRow);

    const itemInfo = document.createElement('div');
    itemInfo.className = 'pvu-status';
    itemInfo.textContent = 'Aggiunge opzioni alle offerte del roll (es: +2 = 5 opzioni con le 3 base).';
    itemSection.appendChild(itemInfo);

    containerEl.appendChild(itemSection);

    // === Status ===
    const statusSection = document.createElement('div');
    statusSection.className = 'pvu-section';

    const statusTitle = document.createElement('div');
    statusTitle.className = 'pvu-section-title';
    statusTitle.textContent = 'STATO HOOK';
    statusSection.appendChild(statusTitle);

    const statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.id = 'pvu-roll-status';
    statusEl.textContent = 'In attesa...';
    statusSection.appendChild(statusEl);

    containerEl.appendChild(statusSection);

    // Version badge
    const verEl = document.createElement('div');
    verEl.className = 'pvu-ver';
    verEl.textContent = 'PokeVoid-Unlocked v' + (window.__pvu.config ? window.__pvu.config.VERSION : '1.0.0');
    containerEl.appendChild(verEl);

    parentEl.appendChild(containerEl);

    // Auto-refresh stato
    refreshTimer = setInterval(refreshUI, 2000);
    refreshUI();
  }

  /**
   * Create a toggle row. Returns { row, switchEl } so caller can reference the switch DOM.
   * BUG 1 FIX: caller now receives switchEl for sync in refreshUI.
   */
  function createToggle(label, description, initial, onChange) {
    const row = document.createElement('div');
    row.className = 'pvu-toggle';

    const left = document.createElement('div');
    const labelEl = document.createElement('div');
    labelEl.className = 'pvu-toggle-label';
    labelEl.textContent = label;
    left.appendChild(labelEl);

    if (description) {
      const descEl = document.createElement('div');
      descEl.className = 'pvu-toggle-desc';
      descEl.textContent = description;
      left.appendChild(descEl);
    }

    const switchEl = document.createElement('div');
    switchEl.className = 'pvu-switch' + (initial ? ' on' : '');

    switchEl.addEventListener('click', function() {
      const isOn = switchEl.classList.toggle('on');
      if (typeof onChange === 'function') {
        onChange(isOn);
      }
    });

    row.appendChild(left);
    row.appendChild(switchEl);
    return { row: row, switchEl: switchEl };
  }

  /**
   * BUG 1 FIX: sync all toggle switches and sliders from controller state.
   * Called on every refresh interval and after user actions.
   */
  function refreshUI() {
    if (!containerEl) return;
    const state = window.__pvu.rollController.getState();

    // Sync toggle switches from controller state
    if (toggleRefs.costOverride) {
      setSwitchState(toggleRefs.costOverride, state.costOverride);
    }
    if (toggleRefs.luckLock) {
      setSwitchState(toggleRefs.luckLock, state.luckLock);
    }

    // Sync status text
    const statusEl = containerEl.querySelector('#pvu-roll-status');
    if (statusEl) {
      const hookStatus = state.hooksApplied ? '✓ Hooks attivi' : '⏳ In attesa hooks...';
      const costStatus = state.costOverride ? ' | Cost Override: ON' : '';
      const luckStatus = state.luckLock ? ' | Luck Lock: ' + state.luckValue : '';
      const patchInfo = state.patchedPhaseCount > 0 ? ' | Phase patchate: ' + state.patchedPhaseCount : '';
      statusEl.textContent = hookStatus + costStatus + luckStatus + patchInfo;
      statusEl.className = 'pvu-status ' + (state.hooksApplied ? 'ok' : 'warn');
    }

    // Sync item count slider
    const slider = containerEl.querySelector('#pvu-item-slider');
    const valLabel = containerEl.querySelector('#pvu-item-val');
    if (slider && valLabel) {
      if (document.activeElement !== slider) {
        slider.value = state.itemCountExtra;
        valLabel.textContent = '+' + state.itemCountExtra;
      }
    }

    // BUG 3: Sync luck slider
    const luckSlider = containerEl.querySelector('#pvu-luck-slider');
    const luckValLabel = containerEl.querySelector('#pvu-luck-val');
    if (luckSlider && luckValLabel) {
      if (document.activeElement !== luckSlider) {
        luckSlider.value = state.luckValue;
        luckValLabel.textContent = state.luckValue;
      }
    }
  }

  /**
   * Sync a switch element's visual state from a boolean.
   * Does NOT trigger the click handler — only updates DOM class.
   */
  function setSwitchState(switchEl, isOn) {
    if (!switchEl) return;
    if (isOn && !switchEl.classList.contains('on')) {
      switchEl.classList.add('on');
    } else if (!isOn && switchEl.classList.contains('on')) {
      switchEl.classList.remove('on');
    }
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    Object.keys(toggleRefs).forEach(function(k) { toggleRefs[k] = null; });
    if (containerEl && containerEl.parentNode) containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
  }

  return {
    render: render,
    refreshUI: refreshUI,
    destroy: destroy,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.rollScreen = PvuRollScreen;


// --- src/ui/skill-screen.js ---
// FIX BUG 2: reads from activeSkillTree (per-run SP) + resolved champion ID
const PvuSkillScreen = (() => {
  const LOG_PREFIX = '[PvuSkillScreen]';
  let containerEl = null;
  let registeredPhaseFn = null;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function render(parentEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'pvu-skill-screen';

    // Skill Points Section
    const spSection = document.createElement('div');
    spSection.className = 'pvu-section';

    const spTitle = document.createElement('div');
    spTitle.className = 'pvu-section-title';
    spTitle.textContent = 'SKILL POINTS';
    spSection.appendChild(spTitle);

    // Active champion display (readonly — shows the run's active champion)
    const champActiveLabel = document.createElement('div');
    champActiveLabel.className = 'pvu-toggle-label';
    champActiveLabel.textContent = 'Champion attivo:';
    spSection.appendChild(champActiveLabel);

    const champActiveDisplay = document.createElement('div');
    champActiveDisplay.className = 'pvu-status ok';
    champActiveDisplay.id = 'pvu-champ-active';
    champActiveDisplay.textContent = 'Rilevamento...';
    spSection.appendChild(champActiveDisplay);

    // Champion selector (for manual override)
    const champLabel = document.createElement('div');
    champLabel.className = 'pvu-toggle-label';
    champLabel.textContent = 'Seleziona Champion (override):';
    champLabel.style.marginTop = '8px';
    spSection.appendChild(champLabel);

    const champSelect = document.createElement('select');
    champSelect.className = 'pvu-champ-select';
    champSelect.id = 'pvu-champ-select';
    champSelect.addEventListener('change', function() { refreshUI(); });
    spSection.appendChild(champSelect);

    // Skill points input
    const spRow = document.createElement('div');
    spRow.className = 'pvu-input-row';

    const spInput = document.createElement('input');
    spInput.type = 'number';
    spInput.className = 'pvu-input';
    spInput.id = 'pvu-sp-input';
    spInput.placeholder = 'Skill Points';
    spInput.min = '0';
    spInput.value = '0';

    const spApplyBtn = document.createElement('button');
    spApplyBtn.className = 'pvu-btn';
    spApplyBtn.textContent = 'Apply';
    spApplyBtn.addEventListener('click', function() {
      const val = parseInt(spInput.value, 10);
      if (isNaN(val)) return;
      const result = window.__pvu.skillTreeEditor.setSkillPoints(val);
      if (result) {
        spInput.style.borderColor = '#4caf50';
        setTimeout(function() { spInput.style.borderColor = ''; }, 1000);
        refreshUI();
      } else {
        spInput.style.borderColor = '#f44336';
        setTimeout(function() { spInput.style.borderColor = ''; }, 1500);
      }
    });

    spRow.appendChild(spInput);
    spRow.appendChild(spApplyBtn);
    spSection.appendChild(spRow);

    // Version warning
    const versionWarning = document.createElement('div');
    versionWarning.className = 'pvu-warning';
    versionWarning.style.display = 'none';
    versionWarning.id = 'pvu-version-warning';
    versionWarning.textContent = '⚠️ Champion skill version cambiata! Unlock precedenti potrebbero non essere validi.';
    spSection.appendChild(versionWarning);

    // Status
    const statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.id = 'pvu-skill-status';
    statusEl.textContent = 'In attesa...';
    spSection.appendChild(statusEl);

    containerEl.appendChild(spSection);

    // Locked Skills Section
    const lockedSection = document.createElement('div');
    lockedSection.className = 'pvu-section';

    const lockedTitle = document.createElement('div');
    lockedTitle.className = 'pvu-section-title';
    lockedTitle.textContent = 'SKILL BLOCCATE';
    lockedSection.appendChild(lockedTitle);

    const lockedList = document.createElement('div');
    lockedList.id = 'pvu-locked-list';
    lockedSection.appendChild(lockedList);

    containerEl.appendChild(lockedSection);

    // Version badge
    const verEl = document.createElement('div');
    verEl.className = 'pvu-ver';
    verEl.textContent = 'PokeVoid-Unlocked v' + (window.__pvu.config ? window.__pvu.config.VERSION : '1.0.0');
    containerEl.appendChild(verEl);

    parentEl.appendChild(containerEl);

    // Event-driven refresh via phase observer (una sola registrazione)
    if (!registeredPhaseFn && window.__pvu.phaseObserver) {
      registeredPhaseFn = function() { if (containerEl) refreshUI(); };
      window.__pvu.phaseObserver.onPhasePush(registeredPhaseFn);
    }

    refreshUI();
  }

  function refreshUI() {
    if (!containerEl) return;
    if (!document.body.contains(containerEl)) return;
    const editor = window.__pvu.skillTreeEditor;
    const bridge = window.__pvu.bridge;

    // Aggiorna skill points from activeSkillTree
    const spInput = containerEl.querySelector('#pvu-sp-input');
    if (spInput) {
      const sp = editor.getSkillPoints();
      if (document.activeElement !== spInput) {
        spInput.value = sp;
      }
    }

    // Show active champion from resolveActiveChampionId
    const champActiveDisplay = containerEl.querySelector('#pvu-champ-active');
    if (champActiveDisplay) {
      const activeChampId = editor.getSelectedChampionId();
      champActiveDisplay.textContent = activeChampId || 'Nessuna run attiva';
    }

    // Aggiorna champion selector (populated from championData keys)
    const champSelect = containerEl.querySelector('#pvu-champ-select');
    if (champSelect) {
      const currentChamp = editor.getSelectedChampionId();
      const gameData = bridge.findGameData();
      if (gameData && gameData.championData) {
        const champs = Object.keys(gameData.championData);
        if (champSelect.options.length !== champs.length + 1) {
          champSelect.innerHTML = '<option value="">-- Seleziona Champion --</option>';
          for (let i = 0; i < champs.length; i++) {
            const opt = document.createElement('option');
            opt.value = champs[i];
            opt.textContent = champs[i];
            champSelect.appendChild(opt);
          }
        }
        if (currentChamp) champSelect.value = currentChamp;
      }
    }

    // Version warning
    const versionWarning = containerEl.querySelector('#pvu-version-warning');
    if (versionWarning) {
      const ver = editor.checkVersionWarning();
      versionWarning.style.display = ver.changed ? 'block' : 'none';
      if (ver.changed) {
        versionWarning.textContent = '⚠️ Champion skill version cambiata! (era ' + ver.oldVersion + ', ora ' + ver.newVersion + ')';
      }
    }

    // Locked skills list
    const lockedList = containerEl.querySelector('#pvu-locked-list');
    if (lockedList) {
      const unlockables = editor.getUnlockablesList();
      lockedList.innerHTML = '';
      if (unlockables.length === 0) {
        const info = document.createElement('div');
        info.className = 'pvu-info';
        info.textContent = 'Nessuna skill bloccata (o nessun champion attivo nella run)';
        lockedList.appendChild(info);
      } else {
        for (let i = 0; i < unlockables.length; i++) {
          const skill = unlockables[i];
          const item = document.createElement('div');
          item.className = 'pvu-skill-item';

          const nameEl = document.createElement('div');
          nameEl.className = 'pvu-skill-name';
          nameEl.textContent = skill.skillId;
          item.appendChild(nameEl);

          const metaEl = document.createElement('div');
          metaEl.className = 'pvu-skill-meta';
          metaEl.textContent = 'Cat: ' + skill.category + ' | Lv: ' + skill.requiredLevel;
          item.appendChild(metaEl);

          const unlockBtn = document.createElement('button');
          unlockBtn.className = 'pvu-btn pvu-btn-sm pvu-btn-outline';
          unlockBtn.textContent = 'Sblocca';
          unlockBtn.addEventListener('click', function() {
            const result = editor.unlockSkill(skill.skillId, skill.category);
            if (result.ok) {
              item.style.borderColor = '#4caf50';
              refreshUI();
            } else {
              item.style.borderColor = '#f44336';
              setTimeout(function() { item.style.borderColor = '#e94560'; }, 1500);
            }
          });
          item.appendChild(unlockBtn);

          lockedList.appendChild(item);
        }
      }
    }

    // Status
    const statusEl = containerEl.querySelector('#pvu-skill-status');
    if (statusEl) {
      const sp = editor.getSkillPoints();
      const champId = editor.getSelectedChampionId();
      const locked = (editor.getLockedSkills && editor.getLockedSkills()) || [];
      statusEl.textContent = 'SP: ' + sp + ' | Champion: ' + (champId || 'nessuno') + ' | Bloccate: ' + locked.length;
      statusEl.className = 'pvu-status ok';
    }
  }

  function destroy() {
    if (containerEl && containerEl.parentNode) containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
  }

  return {
    render: render,
    refreshUI: refreshUI,
    destroy: destroy,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.skillScreen = PvuSkillScreen;


// --- src/ui/voucher-screen.js ---
const PvuVoucherScreen = (() => {
  const LOG_PREFIX = '[PvuVoucherScreen]';
  let containerEl = null;
  let statusEl = null;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function render(parentEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'pvu-voucher-screen';

    const section = document.createElement('div');
    section.className = 'pvu-section';

    const title = document.createElement('div');
    title.className = 'pvu-section-title';
    title.textContent = '🎟️ Voucher Editor';
    section.appendChild(title);

    const info = document.createElement('div');
    info.className = 'pvu-info';
    info.textContent = 'Modifica i voucher. Il gioco salva automaticamente.';
    section.appendChild(info);

    const editor = window.__pvu.voucherEditor;
    const labels = editor.LABELS;
    const emojis = editor.VOUCHER_EMOJI;
    const rows = [];

    for (let t = 0; t < labels.length; t++) {
      (function(typeIdx) {
        const row = document.createElement('div');
        row.className = 'pvu-input-row';

        const label = document.createElement('span');
        label.style.minWidth = '110px';
        label.style.display = 'inline-block';
        label.textContent = emojis[typeIdx] + ' ' + labels[typeIdx];
        row.appendChild(label);

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'pvu-input';
        input.style.width = '90px';
        input.min = '0';
        input.value = '0';
        row.appendChild(input);

        // Quick buttons +1, +10, +100
        const deltas = [1, 10, 100];
        for (let d = 0; d < deltas.length; d++) {
          (function(delta) {
            const btn = document.createElement('button');
            btn.className = 'pvu-btn pvu-btn-sm';
            btn.textContent = '+' + delta;
            btn.addEventListener('click', function() {
              const cur = Math.max(0, parseInt(input.value, 10) || 0);
              input.value = cur + delta;
              applyVoucher(typeIdx, input);
            });
            row.appendChild(btn);
          })(deltas[d]);
        }

        // Apply button per tipo
        const applyBtn = document.createElement('button');
        applyBtn.className = 'pvu-btn';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', function() {
          applyVoucher(typeIdx, input);
        });
        row.appendChild(applyBtn);

        section.appendChild(row);

        rows.push({ type: typeIdx, inputEl: input });
      })(t);
    }

    // Apply All button
    const allRow = document.createElement('div');
    allRow.className = 'pvu-input-row';
    allRow.style.marginTop = '8px';

    const applyAllBtn = document.createElement('button');
    applyAllBtn.className = 'pvu-btn';
    applyAllBtn.textContent = 'Apply All';
    applyAllBtn.addEventListener('click', function() {
      const counts = {};
      for (let i = 0; i < rows.length; i++) {
        counts[labels[rows[i].type]] = Math.max(0, parseInt(rows[i].inputEl.value, 10) || 0);
      }
      const result = editor.setAllVoucherCounts(counts);
      showStatus(result.ok ? '✓ Tutti i voucher aggiornati' : '✗ ' + (result.error || 'Errore'), result.ok);
    });
    allRow.appendChild(applyAllBtn);
    section.appendChild(allRow);

    // Status
    statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.textContent = 'In attesa...';
    section.appendChild(statusEl);

    containerEl.appendChild(section);
    parentEl.appendChild(containerEl);

    refreshUI();
  }

  function applyVoucher(typeIdx, inputEl) {
    const val = parseInt(inputEl.value, 10);
    const editor = window.__pvu.voucherEditor;
    const result = editor.setVoucherCount(typeIdx, val);
    showStatus(result.ok ? '✓ ' + editor.LABELS[typeIdx] + ' = ' + Math.max(0, val || 0) : '✗ ' + (result.error || 'Errore'), result.ok);
  }

  function showStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = ok ? 'pvu-status ok' : 'pvu-status err';
  }

  function refreshUI() {
    if (!containerEl) return;
    if (!document.body.contains(containerEl)) return;

    const editor = window.__pvu.voucherEditor;
    const counts = editor.getVoucherCounts();
    if (!counts) {
      showStatus('gameData non disponibile', false);
      return;
    }

    const labels = editor.LABELS;
    for (let i = 0; i < containerEl.querySelectorAll('.pvu-input').length; i++) {
      const input = containerEl.querySelectorAll('.pvu-input')[i];
      if (i < labels.length && input && document.activeElement !== input) {
        input.value = counts[labels[i]] || 0;
      }
    }
  }

  function destroy() {
    if (containerEl && containerEl.parentNode) containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
    statusEl = null;
  }

  return {
    render: render,
    refreshUI: refreshUI,
    destroy: destroy,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.voucherScreen = PvuVoucherScreen;


// --- src/ui/battle-screen.js ---
// Segue il pattern di roll-screen.js: createToggle, setSwitchState, refreshUI 2s
const PvuBattleScreen = (() => {
  const LOG_PREFIX = '[PvuBattleScreen]';
  let containerEl = null;
  let refreshTimer = null;

  // Riferimenti DOM ai toggle switch per sync nello refreshUI
  const toggleRefs = {};

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function render(parentEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'pvu-battle-screen';

    // === INCONTRI — Sempre Shiny ===
    const encounterSection = document.createElement('div');
    encounterSection.className = 'pvu-section';

    const encounterTitle = document.createElement('div');
    encounterTitle.className = 'pvu-section-title';
    encounterTitle.textContent = 'SEMPRE SHINY';
    encounterSection.appendChild(encounterTitle);

    var encounterState = window.__pvu.encounterOverride?.getState?.() || {};
    var shinyResult = createToggle(
      'Sempre Shiny',
      'Ogni Pokemon incontrato nasce shiny (wild, boss, rival, legendary)',
      !!encounterState.shiny,
      function(val) {
        window.__pvu.encounterOverride?.toggleShiny?.(val);
      }
    );
    encounterSection.appendChild(shinyResult.row);
    toggleRefs.shiny = shinyResult.switchEl;

    // Stato hooks encounter
    var shinyStatus = document.createElement('div');
    shinyStatus.className = 'pvu-status';
    shinyStatus.id = 'pvu-battle-shiny-status';
    shinyStatus.textContent = 'In attesa...';
    encounterSection.appendChild(shinyStatus);

    containerEl.appendChild(encounterSection);

    // === CATTURA — Cattura Tutto ===
    const captureSection = document.createElement('div');
    captureSection.className = 'pvu-section';

    const captureTitle = document.createElement('div');
    captureTitle.className = 'pvu-section-title';
    captureTitle.textContent = 'CATTURA TUTTO';
    captureSection.appendChild(captureTitle);

    var captureState = window.__pvu.captureOverride?.getState?.() || {};
    var captureResult = createToggle(
      'Cattura Tutto',
      'Qualsiasi lancio di Pokeball cattura sempre il Pokemon (L2 wrapper, fallback L1)',
      !!captureState.enabled,
      function(val) {
        window.__pvu.captureOverride?.toggleCapture?.(val);
      }
    );
    captureSection.appendChild(captureResult.row);
    toggleRefs.capture = captureResult.switchEl;

    // Status row cattura
    var captureStatus = document.createElement('div');
    captureStatus.className = 'pvu-status';
    captureStatus.id = 'pvu-battle-capture-status';
    captureStatus.textContent = 'In attesa...';
    captureSection.appendChild(captureStatus);

    containerEl.appendChild(captureSection);

    // Version badge
    var verEl = document.createElement('div');
    verEl.className = 'pvu-ver';
    verEl.textContent = 'PokeVoid-Unlocked v' + (window.__pvu.config ? window.__pvu.config.VERSION : '1.0.0');
    containerEl.appendChild(verEl);

    parentEl.appendChild(containerEl);

    // Auto-refresh stato (2s, come roll-screen)
    refreshTimer = setInterval(refreshUI, 2000);
    refreshUI();
  }

  /**
   * Crea un toggle switch con label e descrizione.
   * Restituisce { row, switchEl } — stesso pattern di roll-screen.js.
   */
  function createToggle(label, description, initial, onChange) {
    const row = document.createElement('div');
    row.className = 'pvu-toggle';

    const left = document.createElement('div');
    const labelEl = document.createElement('div');
    labelEl.className = 'pvu-toggle-label';
    labelEl.textContent = label;
    left.appendChild(labelEl);

    if (description) {
      const descEl = document.createElement('div');
      descEl.className = 'pvu-toggle-desc';
      descEl.textContent = description;
      left.appendChild(descEl);
    }

    const switchEl = document.createElement('div');
    switchEl.className = 'pvu-switch' + (initial ? ' on' : '');

    switchEl.addEventListener('click', function() {
      const isOn = switchEl.classList.toggle('on');
      if (typeof onChange === 'function') {
        onChange(isOn);
      }
    });

    row.appendChild(left);
    row.appendChild(switchEl);
    return { row: row, switchEl: switchEl };
  }

  /**
   * Aggiorna tutti gli switch e i testi di stato dallo stato reale dei moduli.
   * Chiamata ogni 2s dal refreshTimer e al primo render.
   */
  function refreshUI() {
    if (!containerEl) return;

    var encounterState = window.__pvu.encounterOverride?.getState?.() || {};
    var captureState = window.__pvu.captureOverride?.getState?.() || {};

    // --- Shiny toggle + status ---
    setSwitchState(toggleRefs.shiny, !!encounterState.shiny);

    var shinyStatusEl = containerEl.querySelector('#pvu-battle-shiny-status');
    if (shinyStatusEl) {
      var encHooks = encounterState.hooksApplied ? '✓ Hooks attivi' : '⏳ In attesa hooks...';
      var encDetail = encounterState.hooksApplied
        ? ' — Pokemon: ' + (encounterState.hookStats?.pokemonPatched || 0)
        : '';
      shinyStatusEl.textContent = encHooks + encDetail;
      shinyStatusEl.className = 'pvu-status ' + (encounterState.hooksApplied ? 'ok' : 'warn');
    }

    // --- Capture toggle + status ---
    setSwitchState(toggleRefs.capture, !!captureState.enabled);

    var captureStatusEl = containerEl.querySelector('#pvu-battle-capture-status');
    if (captureStatusEl && captureState.enabled) {
      var levelText = captureState.level === 2
        ? (captureState.level2Verified ? 'L2 (wrapper) ✅' : 'L2 (wrapper) ⏳ in verifica')
        : captureState.level === 1
          ? 'L1 (fallback) ⚠️'
          : '—';
      var captured = captureState.injectedCount || 0;
      var errors = captureState.errorCount || 0;
      captureStatusEl.textContent =
        'Livello: ' + levelText +
        ' | Catture forzate: ' + captured +
        ' | Errori: ' + errors;
      captureStatusEl.className = 'pvu-status ' +
        (errors >= 3 ? 'err' : errors > 0 ? 'warn' : 'ok');
    } else if (captureStatusEl) {
      captureStatusEl.textContent = 'Cattura Tutto disattivata';
      captureStatusEl.className = 'pvu-status';
    }
  }

  /**
   * Sync stato visuale di uno switch con un booleano (senza triggerare l'onChange).
   */
  function setSwitchState(switchEl, isOn) {
    if (!switchEl) return;
    if (isOn && !switchEl.classList.contains('on')) {
      switchEl.classList.add('on');
    } else if (!isOn && switchEl.classList.contains('on')) {
      switchEl.classList.remove('on');
    }
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    Object.keys(toggleRefs).forEach(function(k) { toggleRefs[k] = null; });
    if (containerEl && containerEl.parentNode) containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
  }

  return {
    render: render,
    refreshUI: refreshUI,
    destroy: destroy,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.battleScreen = PvuBattleScreen;


// --- src/ui/panel.js ---
const PvuPanel = (() => {
  const LOG_PREFIX = '[PvuPanel]';
  let containerEl = null;
  let panelEl = null;
  let isOpen = false;
  let activeTab = 'roll';
  // PARTE 4: interval money creato a ogni renderMoneyTab senza clear = leak di timer
  // a ogni cambio tab. Un solo timer alla volta, pulito su re-render e destroy.
  let moneyTimer = null;
  let activeScreen = null;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  // BUG 4 FIX: formatta importi grandi come 1K/10K/100K/1000K (max 1 decimale, senza .0)
  function formatMoney(n) {
    if (n < 1000) return String(n);
    const k = n / 1000;
    const rounded = Math.round(k * 10) / 10;
    return (rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(1)) + 'K';
  }

  function create() {
    if (containerEl) return containerEl;

    // Container (pointer-events: none)
    containerEl = document.createElement('div');
    containerEl.id = 'pvu-container';
    containerEl.className = 'pvu-hidden';

    // Panel (pointer-events: auto)
    panelEl = document.createElement('div');
    panelEl.id = 'pvu-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'pvu-header';
    const title = document.createElement('span');
    title.textContent = '⚡ PokeVoid-Unlocked';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pvu-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', toggle);
    header.appendChild(closeBtn);
    panelEl.appendChild(header);

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'pvu-tabs';

    const tabMoney = createTab('💰 Money', 'money');
    const tabRoll = createTab('🎲 Roll', 'roll');
    const tabSkill = createTab('🌳 Skill', 'skill');
    const tabVoucher = createTab('🎟️ Voucher', 'voucher');
    const tabBattle = createTab('🎯 Battle', 'battle');

    tabs.appendChild(tabMoney);
    tabs.appendChild(tabRoll);
    tabs.appendChild(tabSkill);
    tabs.appendChild(tabVoucher);
    tabs.appendChild(tabBattle);
    panelEl.appendChild(tabs);

    // Tab content area
    const tabContent = document.createElement('div');
    tabContent.className = 'pvu-tab-content';
    tabContent.id = 'pvu-tab-content';
    panelEl.appendChild(tabContent);

    containerEl.appendChild(panelEl);

    // Inserisci nel body
    if (document.body) {
      document.body.appendChild(containerEl);
    } else {
      const observer = new MutationObserver(function() {
        if (document.body) {
          document.body.appendChild(containerEl);
          observer.disconnect();
        }
      });
      observer.observe(document.documentElement || document, { childList: true, subtree: true });
    }

    // Render tab iniziale
    renderTabContent(activeTab);

    log('Panel creato');
    return containerEl;
  }

  function createTab(label, tabId) {
    const tab = document.createElement('button');
    tab.className = 'pvu-tab' + (tabId === activeTab ? ' pvu-tab-active' : '');
    tab.textContent = label;
    tab.dataset.tab = tabId;
    tab.addEventListener('click', function() {
      switchTab(tabId);
    });
    return tab;
  }

  function switchTab(tabId) {
    activeTab = tabId;

    // Aggiorna tab buttons
    const tabs = containerEl.querySelectorAll('.pvu-tab');
    for (let i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('pvu-tab-active', tabs[i].dataset.tab === tabId);
    }

    renderTabContent(tabId);
  }

  function renderTabContent(tabId) {
    const content = document.getElementById('pvu-tab-content');
    if (!content) return;

    // Distruggi la schermata precedente (evita leak di listener/timer su cambio tab)
    if (activeScreen && activeScreen.destroy) {
      try { activeScreen.destroy(); } catch (e) { /* ignore */ }
    }
    activeScreen = null;

    // Pulisci contenuto
    content.innerHTML = '';

    switch (tabId) {
      case 'money':
        renderMoneyTab(content);
        break;
      case 'roll':
        window.__pvu.rollScreen.render(content);
        activeScreen = window.__pvu.rollScreen;
        break;
      case 'skill':
        window.__pvu.skillScreen.render(content);
        activeScreen = window.__pvu.skillScreen;
        break;
      case 'voucher':
        window.__pvu.voucherScreen.render(content);
        activeScreen = window.__pvu.voucherScreen;
        break;
      case 'battle':
        window.__pvu.battleScreen.render(content);
        activeScreen = window.__pvu.battleScreen;
        break;
    }
  }

  function renderMoneyTab(parentEl) {
    const section = document.createElement('div');
    section.className = 'pvu-section';

    const title = document.createElement('div');
    title.className = 'pvu-section-title';
    title.textContent = 'MONEY OVERRIDE';
    section.appendChild(title);

    // Money input
    const row = document.createElement('div');
    row.className = 'pvu-input-row';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'pvu-input';
    input.id = 'pvu-money-input';
    input.placeholder = 'Nuovo importo';
    input.min = '0';
    input.max = String(Number.MAX_SAFE_INTEGER);
    input.value = '0';

    // Aggiorna valore corrente
    try {
      const currentMoney = window.__pvu.moneyOverride.getMoney();
      input.value = currentMoney;
    } catch(e) {}

    const applyBtn = document.createElement('button');
    applyBtn.className = 'pvu-btn';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', function() {
      const result = window.__pvu.moneyOverride.applyFromInput(input);
      const statusEl = parentEl.querySelector('#pvu-money-status');
      if (statusEl) {
        if (result.ok) {
          statusEl.textContent = '✓ Money aggiornato a ' + (result.sceneMoney || input.value);
          statusEl.className = 'pvu-status ok';
          input.style.borderColor = '#4caf50';
          setTimeout(function() { input.style.borderColor = ''; }, 1000);
        } else {
          statusEl.textContent = '✗ ' + (result.error || 'Errore');
          statusEl.className = 'pvu-status err';
        }
      }
    });

    row.appendChild(input);
    row.appendChild(applyBtn);
    section.appendChild(row);

    // Quick buttons
    const quickRow = document.createElement('div');
    quickRow.className = 'pvu-input-row';
    const presets = [1000, 10000, 99999, 999999];
    for (let i = 0; i < presets.length; i++) {
      const btn = document.createElement('button');
      btn.className = 'pvu-btn pvu-btn-sm';
      // BUG 4 FIX: 99999/1000 = 99.999 → formatta pulito (max 1 decimale, senza .0)
      btn.textContent = formatMoney(presets[i]);
      btn.addEventListener('click', function() {
        input.value = presets[i];
        applyBtn.click();
      });
      quickRow.appendChild(btn);
    }
    section.appendChild(quickRow);

    // Status
    const statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.id = 'pvu-money-status';
    statusEl.textContent = 'In attesa...';
    section.appendChild(statusEl);

    // Info
    const info = document.createElement('div');
    info.className = 'pvu-info';
    info.textContent = 'Modifica scene.money (run) + permaMoney (persistente). Il save viene salvato automaticamente.';
    section.appendChild(info);

    parentEl.appendChild(section);

    // Aggiorna stato
    updateMoneyStatus(statusEl, input);
    // PARTE 4: nessun leak — clear del timer precedente prima di crearne uno nuovo
    if (moneyTimer) clearInterval(moneyTimer);
    moneyTimer = setInterval(function() { updateMoneyStatus(statusEl, input); }, 2000);
  }

  function updateMoneyStatus(statusEl, input) {
    if (!statusEl) return;
    const money = window.__pvu.moneyOverride.getMoney();
    statusEl.textContent = 'Money corrente: $' + money.toLocaleString();
    statusEl.className = 'pvu-status ok';
    if (document.activeElement !== input) {
      input.value = money;
    }
  }

  function toggle() {
    isOpen = !isOpen;
    if (containerEl) {
      containerEl.classList.toggle('pvu-hidden', !isOpen);
    }
    log('Panel', isOpen ? 'aperto' : 'chiuso');
  }

  function open() {
    isOpen = true;
    if (containerEl) containerEl.classList.remove('pvu-hidden');
  }

  function close() {
    isOpen = false;
    if (containerEl) containerEl.classList.add('pvu-hidden');
  }

  function destroy() {
    if (moneyTimer) clearInterval(moneyTimer);
    moneyTimer = null;
    if (containerEl && containerEl.parentNode) containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
    panelEl = null;
    isOpen = false;
    log('destroy');
  }

  return {
    create: create,
    toggle: toggle,
    open: open,
    close: close,
    destroy: destroy,
    isOpen: function() { return isOpen; },
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.panel = PvuPanel;


// --- src/main.js ---
(function() {
  'use strict';

  const LOG_PREFIX = '[PokeVoid-Unlocked]';

  // BUG 3 FIX: guard doppia iniezione
  if (window.__pvu && window.__pvu._injected) {
    return; // già iniettato, esci subito
  }

  const pvu = window.__pvu || {};
  window.__pvu = pvu;
  pvu._injected = true;
  pvu._injectedAt = Date.now();

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  log('Avvio PokeVoid-Unlocked v' + (pvu.config ? pvu.config.VERSION : '?') );

  // 0. Sanitizza salvataggi esistenti (prima che il gioco carichi i dati — anti-BigInt)
  //   Fix v1.2.1: permaMoney serializzato come BigInt/stringa "123n" causava
  //   [LOAD ERROR] initSystem failed: Cannot convert a BigInt value to a number al riavvio.
  if (pvu.storage && typeof pvu.storage.sanitizeSavedData === 'function') {
    try {
      pvu.storage.sanitizeSavedData();
    } catch (e) {
      warn('Sanitizzazione salvataggi fallita:', e);
    }
  }

  // 1. Inietta stili CSS
  if (pvu.styles) pvu.styles.inject();

  // 2. Crea floating button (prima di tutto, anche se il gioco non è partito)
  let panelCreated = false;

  if (pvu.floatingBtn) {
    pvu.floatingBtn.create(function() {
      if (!panelCreated) {
        createPanelAndUI();
      } else {
        pvu.panel.toggle();
      }
    });
  }

  // 3. Init game bridge (hook Phaser.Game)
  if (pvu.bridge) {
    pvu.bridge.init();
  }

  // 4. Init phase observer (hook phase methods)
  if (pvu.phaseObserver) {
    pvu.phaseObserver.init();
  }

  // 5. Init roll controller
  if (pvu.rollController) {
    pvu.rollController.init();
  }

  // 5b. Init encounter override (Always Shiny) — lo stato persistito viene
  // letto qui; gli hooks vengono applicati con retry su Pokemon.prototype
  // quando la battle scene esiste.
  if (pvu.encounterOverride) {
    pvu.encounterOverride.init();
  }

  // 5c. Init capture override (Catch Any) — stato persistito letto qui;
  // gli hooks vengono applicati con retry su CommandPhase.prototype
  // quando la battle scene esiste (nel hookInterval sotto).
  if (pvu.captureOverride) {
    pvu.captureOverride.init();
  }

  // 6. Attendi che il gioco sia pronto e applica hooks
  let hookAttempts = 0;
  const hookInterval = setInterval(function() {
    hookAttempts++;

    const bridge = pvu.bridge;
    if (!bridge) return;

    // FIX 5: lo stop è condizionato a getBattleScene() (che include il fallback
    // CanvasPool), NON a getGame() — quindi il loop si ferma anche se
    // getGame() è null ma la battle scene è raggiungibile via CanvasPool.
    const scene = bridge.getBattleScene();
    if (!scene) {
      if (hookAttempts > 60) {
        clearInterval(hookInterval);
        log('Timeout: battle scene non trovato dopo 30s');
      }
      return;
    }

    // Battle scene trovato — applica hooks
    log('Battle scene trovato, applico hooks...');

    if (pvu.rollController) {
      const applied = pvu.rollController.applyHooks();
      if (applied) {
        log('Roll hooks applicati con successo');
      } else {
        warn('Alcuni roll hooks non applicati (in attesa phase push/unshift)');
      }
    }

    // Hook phase methods
    if (pvu.phaseObserver) {
      pvu.phaseObserver.hookPhaseMethods();
    }

    // Hook encounter override (Always Shiny) — retry interno su Pokemon.prototype
    if (pvu.encounterOverride) {
      pvu.encounterOverride.applyHooks();
    }

    // Hook capture override (Catch Any) — retry interno su CommandPhase.prototype
    if (pvu.captureOverride) {
      pvu.captureOverride.applyHooks();
    }

    clearInterval(hookInterval);
    log('Tutti gli hooks applicati');
  }, 1000);

  function createPanelAndUI() {
    if (panelCreated) return;
    panelCreated = true;

    log('Creazione UI...');

    if (pvu.panel) {
      pvu.panel.create();
    }

    log('UI creata');
  }

  // 7. Keyboard shortcut: Ctrl+Shift+P per toggle panel
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      if (!panelCreated) {
        createPanelAndUI();
      } else {
        pvu.panel.toggle();
      }
    }
  });

  log('Bootstrap completato — in attesa del gioco...');

})();


})();
