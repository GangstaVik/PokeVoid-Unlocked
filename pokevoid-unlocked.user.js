// ==UserScript==
// @name         PokeVoid-Unlocked
// @namespace    local.pokevoid-unlocked
// @version      1.6.0
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
  VERSION: '1.6.0',
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


// --- src/i18n.js ---
// i18n.js — UI dictionary and translation helper (v1.6.0)
/* global window */
'use strict';

window.__pvu = window.__pvu || {};

const PvuI18n = (function () {
  const DICT = {
    en: {
      // Panel / tabs
      'panel.title': 'PokeVoid-Unlocked',
      'tab.money': 'Money',
      'tab.roll': 'Roll',
      'tab.skill': 'Skill',
      'tab.voucher': 'Voucher',
      'tab.battle': 'Battle',
      'tab.essence': 'Essence',
      // Money tab
      'money.title': 'MONEY OVERRIDE',
      'money.placeholder': 'New amount',
      'money.waiting': 'Waiting...',
      'money.info': 'Edits scene.money (run) + permaMoney (persistent). The save is written automatically.',
      'money.current': 'Current money: $',
      'money.updated': 'Money updated to ',
      'money.error': 'Error',
      // Roll tab
      'roll.title': 'ROLL CONTROLLER',
      'roll.noCost': 'No Cost',
      'roll.noCostDesc': 'WAIVE_ROLL_FEE_OVERRIDE — all rerolls free',
      'roll.luckLock': 'LUCK LOCK',
      'roll.luckLockDesc': 'Locks the luck value (1-7) for roll offers',
      'roll.luckInfo': '1-7 (5 = default). Affects the quality of roll offers; does not touch battle party luck and does not affect shop/ball-lock.',
      'roll.itemCount': 'ITEM COUNT',
      'roll.itemInfo': 'Adds options to roll offers (e.g. +2 = 5 options with the 3 base ones).',
      'roll.hookStatus': 'HOOK STATUS',
      'roll.waiting': 'Waiting...',
      'roll.hooksActive': 'Hooks active',
      'roll.waitingHooks': 'Waiting for hooks...',
      // Skill tab
      'skill.title': 'SKILL POINTS',
      'skill.activeChampion': 'Active champion:',
      'skill.detecting': 'Detecting...',
      'skill.selectChampion': 'Select Champion (override):',
      'skill.versionWarning': 'Champion skill version changed! Previous unlocks may no longer be valid.',
      'skill.waiting': 'Waiting...',
      'skill.lockedTitle': 'LOCKED SKILLS',
      'skill.noneLocked': 'No locked skills (or no active champion in the run)',
      'skill.selectPlaceholder': 'Select Champion',
      'skill.unlock': 'Unlock',
      'skill.category': 'Cat: ',
      'skill.locked': 'Locked: ',
      'skill.statusLocked': 'SP: ',
      'skill.noActiveRun': 'No active run',
      // Battle tab
      'battle.shinyTitle': 'ALWAYS SHINY',
      'battle.shinyName': 'Always Shiny',
      'battle.shinyDesc': 'Every Pokemon encountered is born shiny (wild, boss, rival, legendary)',
      'battle.waiting': 'Waiting...',
      'battle.catchTitle': 'CATCH ANY',
      'battle.catchName': 'Catch Any',
      'battle.catchDesc': 'When the Catch toggle is active: the first Pokéball on a single target (non-rival/non-scripted) always catches.',
      'battle.specialsName': 'Catch special cases',
      'battle.specialsDesc': 'Allows forced capture also on scripted, final, special and boss-major encounters (risk: quest progression). Default OFF.',
      'battle.l1Fallback': 'L1 (fallback)',
      'battle.wrapperNotActive': 'wrapper NOT active (waiting for battle)',
      'battle.wrapperActive': 'wrapper active',
      'battle.idConfirmed': 'id confirmed',
      'battle.overrideArmed': 'override armed',
      'battle.overrideNotActive': '— probability override NOT active',
      'battle.level': 'Level: ',
      'battle.forcedCatches': 'Forced catches: ',
      'battle.realizedCatches': 'Realized catches: ',
      'battle.specialCases': 'Special cases: ',
      'battle.errors': 'Errors: ',
      'battle.disabled': 'Catch Any disabled',
      // Voucher tab
      'voucher.title': 'Voucher Editor',
      'voucher.info': 'Edits vouchers. The game saves automatically.',
      'voucher.updated': 'All vouchers updated',
      'voucher.waiting': 'Waiting...',
      'voucher.error': 'Error',
      // Essence tab
      'essence.title': 'TYPE ESSENCE',
      'essence.apiMissing': 'Type Essence API not found in this build: editor disabled.',
      'essence.error': 'Error: ',
      // Status strip
      'strip.gameWaiting': 'Waiting for game...',
      'strip.gameRunning': 'Game running',
      'strip.overrides': 'Overrides',
      // About modal
      'about.title': 'About',
      'about.shortcut': 'Shortcut',
      'about.rebind': 'Rebind',
      'about.version': 'Version',
      'about.features': 'Features',
      'about.pressKey': 'Press new shortcut...',
      'about.hintToggle': 'toggles the panel'
    }
  };

  function t(key) {
    return DICT.en[key] || key;
  }

  return {
    t: t,
    DICT: DICT
  };
})();

window.__pvu.i18n = PvuI18n;

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
        warn('No save to back up for user:', username);
        return { ok: true }; // nothing to backup
      }
      const ts = Date.now();
      const backupKey = 'data_pvu_backup_' + ts + '_' + username;
      localStorage.setItem(backupKey, data);
      log('Backup created:', backupKey, '(' + data.length + ' bytes)');
      return { ok: true, key: backupKey };
    } catch (e) {
      error('Backup failed:', e);
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
        warn('MISMATCH after write! Taking rollback from backup:', backupKey);
        if (backupKey) {
          const backupData = localStorage.getItem(backupKey);
          if (backupData) {
            localStorage.setItem(key, backupData);
            log('Rollback completed from:', backupKey);
          } else {
            error('Backup not found:', backupKey);
          }
        }
        return { ok: false, mismatch: true };
      }
      log('Post-write validation OK');
      return { ok: true };
    } catch (e) {
      error('Validation failed:', e);
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
      error('writeSave failed:', e);
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
      error('readSave failed:', e);
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
   * Recursive: normalizza ogni `voucherCounts` corrotto dentro un oggetto save.
   * Task 4 v1.4.0: initSystem carica `voucherCounts` con `|| 0` SENZA coerce —
   * un BigInt (o la stringa "123n" prodotta da scritture third-party / mod
   * vecchie) supera il load perché BigInt è truthy, ma crasha la sessione alla
   * prima aritmetica: `+=` (AddVoucherModifier.apply), `-=` con Math.max
   * (consumeVouchers), `++` (unlock achievement).
   * Stesso pattern di sanitizePermaMoney (second walk, idempotente).
   * @param {object} obj - nodo corrente (oggetto o array)
   * @returns {boolean} true se qualcosa è stato modificato
   */
  function sanitizeVoucherCounts(obj) {
    let changed = false;
    if (obj === null || typeof obj !== 'object') return false;

    // Mappa {0..3: number} — propria del nodo.
    const vc = obj.voucherCounts;
    if (vc !== null && typeof vc === 'object' && !Array.isArray(vc)) {
      for (const k in vc) {
        if (!Object.prototype.hasOwnProperty.call(vc, k)) continue;
        const v = vc[k];
        if (typeof v === 'string') {
          const m = /^(\d+)n?$/.exec(v.trim());
          if (m) {
            vc[k] = Number(m[1]);
            changed = true;
          }
        } else if (typeof v === 'bigint') {
          vc[k] = Number(v);
          changed = true;
        }
      }
    }

    // Livello successivo: array e oggetti annidati (walk ricorsiva).
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (obj[i] !== null && typeof obj[i] === 'object') {
          if (sanitizeVoucherCounts(obj[i])) changed = true;
        }
      }
    } else {
      for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const v = obj[key];
        if (v !== null && typeof v === 'object') {
          if (sanitizeVoucherCounts(v)) changed = true;
        }
      }
    }
    return changed;
  }

  /**
   * Sanitizzazione allo start: scansiona TUTTI i save `data_*` nel localStorage e
   * corregge ogni campo numerico corrotto → number: `permaMoney` (BigInt) e,
   * da v1.4.0, la mappa `voucherCounts` (BigInt / stringa "123n").
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

        if (sanitizePermaMoney(parsed) || sanitizeVoucherCounts(parsed)) {
          const jsonStr = JSON.stringify(parsed);

          // Usa protocollo standard: backup → write → validate
          const username = key.substring(5);
          const backup = createBackup(username);
          if (!backup.ok) {
            warn('Backup failed during sanitize, key skipped:', key, backup.error);
            continue;
          }

          try {
            localStorage.setItem(key, jsonStr);
            const validation = validatePostWrite(username, jsonStr, backup.key);
            if (!validation.ok) {
              error('Sanitize validation failed for', key, '— rollback applied');
              continue;
            }
            fixed++;
            log('Sanitized', key, '(numeric fields corrected)' + (backup.key ? ' | backup: ' + backup.key : ''));
          } catch (e) {
            error('Sanitize write failed for', key, e);
            // rollback manuale se validatePostWrite non ha potuto agire
            try {
              const bk = localStorage.getItem(backup.key);
              if (bk) localStorage.setItem(key, bk);
            } catch (e2) { /* ignore */ }
          }
        }
      }

      if (fixed > 0) {
        log('Sanitization completed:', fixed, 'keys corrected');
      }
      return { ok: true, fixed: fixed };
    } catch (e) {
      error('sanitizeSavedData failed:', e);
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
        log('Phaser unavailable, retrying later');
        return false;
      }

      // FIX 3: guardia anti-doppio-hook — idempotente, safe da ri-chiamare
      if (Phaser.Game[Symbol.for('pvuPatched')]) {
        log('hookPhaserGame already applied, skipping');
        return true;
      }

      const OriginalGame = Phaser.Game;

      Phaser.Game = function() {
        const instance = OriginalGame.apply(this, arguments) || this;
        STATE.gameInstance = instance;
        window.__pvu_game = instance;
        log('Phaser.Game captured via constructor hook');
        return instance;
      };

      // Copia prototype
      Phaser.Game.prototype = OriginalGame.prototype;
      Phaser.Game.prototype.constructor = Phaser.Game;

      // FIX 3: marca come patchato — next call ritorna true senza re-wrap
      Phaser.Game[Symbol.for('pvuPatched')] = true;

      log('Phaser.Game hook applied (waiting for instance...)');
      return true;
    } catch (e) {
      warn('hookPhaserGame failed:', e);
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
          log('Bundle script found:', s.src);
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
        log('Inline bundle captured:', combined.length, 'chars');
        return true;
      }
      return false;
    } catch (e) {
      warn('captureBundleSource failed:', e);
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
          log('Game recovered via CanvasPool (getGame self-heal)');
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
        warn('permaMoney was BigInt → normalized to Number (runtime safety net)');
      } else if (typeof v === 'string') {
        const m = /^(\d+)n?$/.exec(v.trim());
        if (m) {
          gameData.permaMoney = Number(m[1]);
          warn('permaMoney was string ("' + v + '") → normalized to Number (runtime safety net)');
        }
      }
      // Marca per evitare re-check inutili nello stesso oggetto (poll 500ms).
      // Usa defineProperty non-enumerabile per non sporcare falsificazione del save
      // (JSON.stringify la ignora, ma il gioco la ridefinirebbe comunque in updatePermaMoney).
      try {
        Object.defineProperty(gameData, '__pvu_sanitized', { value: true, writable: false, configurable: true, enumerable: false });
      } catch (e) { /* ignore */ }
    } catch (e) {
      warn('sanitizeGameDataRuntime failed:', e);
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
          log('Battle scene captured from phase instance (' +
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
          log('gameData found via game instance');
          clearInterval(pollInterval);
          return;
        }
      }

      const scene = getBattleScene();
      if (scene) {
        log('battle scene found via CanvasPool');
        clearInterval(pollInterval);
        return;
      }

      if (pollGameInfo()) {
        log('gameInfo available');
      }

      if (pollCount > 120) {
        log('polling timeout — did the game start?');
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
      log('battle scene not yet available for phase hook');
      return false;
    }

    const proto = Object.getPrototypeOf(scene);
    if (!proto) {
      log('proto not found');
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
      log('Phase changed:', oldPhase, '->', normalized);
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
        log('[poll] Phase changed:', oldPhase, '->', phase);
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
        log('Phase hooks applied');
        return;
      }
      // FIX 4: stop anche se window.gameInfo esiste OPPURE la battle scene è
      // raggiungibile via getBattleScene (fallback CanvasPool) — il phase hook
      // può non riuscire ma il gioco è partito; il polling gameInfo continua.
      const bridge = window.__pvu.bridge;
      if (window.gameInfo || (bridge && bridge.getBattleScene())) {
        clearInterval(hookInterval);
        log('Phase hooks: gameInfo/battle scene available, stopping retry');
        return;
      }
      if (hookAttempts > 30) {
        clearInterval(hookInterval);
        log('Phase hooks: timeout, polling only');
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

      // T1.1: cattura la sorgente del nativo (verifica semantica del parametro
      // count) — registrata una sola volta sul primo patch, snippete nel report.
      if (!window.__pvu._rollOptionsNativeSrc) {
        try {
          window.__pvu._rollOptionsNativeSrc = origOptions.toString();
        } catch (e) {
          window.__pvu._rollOptionsNativeSrc = null;
        }
        if (window.__pvu._rollOptionsNativeSrc) {
          const src = window.__pvu._rollOptionsNativeSrc;
          log('Native getModifierTypeOptions source captured:', src.slice(0, 240) + ' ... ' + src.slice(-160));
        }
      }

      phaseObj.getModifierTypeOptions = function() {
        const scene = this && this.scene ? this.scene : null;
        const requestedCount = arguments.length > 0 && typeof arguments[0] === 'number' ? arguments[0] : undefined;

        // Item count extra: aumenta il numero di opzioni nel pool.
        // T1: il nativo (su @17225514, j0 shop @17410811) può restituire MENO
        // elementi del richiesto quando il pool filtrato è saturo (ramo con
        // modificatori disabilitati / filtro collected + top-up). Prima si sonda
        // il nativo con il conteggio NOMINALE per misurare la lunghezza reale;
        // se il sondaggio è già corto => pool saturo: clamp a
        // min(nominale + extra, lunghezza sondata) invece di forzare +extra a
        // vuoto (causa delle scelte duplicate / pool svuotato).
        let poolLength = null;
        if (state.itemCountExtra > 0 && requestedCount !== undefined) {
          try {
            const probe = origOptions.call(this, requestedCount);
            if (probe && typeof probe.length === 'number') {
              poolLength = probe.length;
            }
          } catch (e) {
            warn('getModifierTypeOptions probe failed, no clamp applied:', e);
            poolLength = null;
          }
        }
        let effectiveCount = requestedCount;
        if (state.itemCountExtra > 0 && requestedCount !== undefined) {
          effectiveCount = requestedCount + state.itemCountExtra;
          if (poolLength !== null && poolLength < requestedCount) {
            effectiveCount = Math.min(effectiveCount, poolLength);
            log('Clamp T1: pool saturated (probe ' + poolLength + ' < nominal ' + requestedCount + ') => ' + effectiveCount + ' options');
          }
        }

        // Luck lock: forza i tier del pool forzando lockModifierTiers SOLO durante la chiamata
        let tierPatch = null;
        if (state.luckLock) {
          const tiers = luckTierPool(state.luckValue, effectiveCount);
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
          return origOptions.call(this, effectiveCount);
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
      log('getModifierTypeOptions patched on phase instance (itemcount + luck pool + clamp T1)');
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
      log('Patched phase:', state.lastPatchedPhase);
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
      warn('hookWildLuck failed:', e);
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
      warn('phaseObserver unavailable');
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

    log('Phase interceptors registered');
  }

  /**
   * Verifica se gli hooks critici sono stati applicati.
   */
  function checkHooksApplied() {
    if (state.hooksApplied) return;

    if (originals.getRerollCost) {
      state.hooksApplied = true;
      state.active = true;
      log('Hooks applied successfully (getRerollCost patched)');
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

  // Task 3 v1.4.0: specie già segnalate per variant-asset mancanti.
  // → un solo warn deduplicato per specie, mai spam.
  const warnedMissingVariantAssets = new Set();

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
          log('Pokemon prototype discovered:', state.pokemonClass);
          return proto;
        }
      }
    } catch (e) {
      warn('discoverPokemonProto failed:', e);
    }
    return null;
  }

  /**
   * Key sprite che il gioco userebbe per la variante EPIC (tier 2) — l'unica
   * variante che cambia la key texture (suffisso `_3`: in getSpriteId quando
   * `f[i] === 2` e in initShinySparkle come `_${this.variant + 1}`). Le
   * varianti 0/1 riusano la stessa key base + tint (getVariantTint).
   * @param {object} poke
   * @returns {string|null} Key animated attesa, o null se non calcolabile
   */
  function expectedVariantKey(poke) {
    try {
      if (typeof poke.getSpriteKey !== 'function') return null;
      const prev = poke.variant;
      poke.variant = 2; // EPIC — unica tier con key dedicata
      let key = null;
      try {
        key = poke.getSpriteKey(true);
      } finally {
        poke.variant = prev;
      }
      return key;
    } catch (e) {
      return null;
    }
  }

  /**
   * Probe asset per la variante EPIC (Task 3): verifica che i asset della
   * variante esistano PRIMA di chiamare generateVariant. Stessa semantica del
   * guard nativo del gioco (bundle v3.1.8, textures.exists per la sprite key).
   * 1. Sparkle EPIC globale (`shiny_3`) — presente solo se il build ha le
   *    varianti sparkle.
   * 2. Sprite di battaglia EPIC (`pkmn__<id>_3`) — se la key manca nel
   *    texture manager, la variante non può renderizzare.
   * @param {object} poke
   * @returns {boolean} true = asset presenti (o non verificabili → assume OK)
   */
  function variantAssetsExist(poke) {
    try {
      const scene = poke.scene;
      if (!scene || !scene.textures) return true; // non verificabile → assume presente
      if (!scene.textures.exists('shiny_3')) return false; // sparkle EPIC globale assente
      const key = expectedVariantKey(poke);
      if (key && !scene.textures.exists(key)) return false; // sprite EPIC mancante
      return true;
    } catch (e) {
      return true; // fail-safe: mai bloccare la shiny su errori imprevisti
    }
  }

  /**
   * Variant assente (asset non disponibili per questa specie) → skip silenzioso.
   * Variant forzata a 0: il costruttore Pokemon fa `variant === void 0` →
   * non ri-rolla generateVariant, quindi la shiny resta sulla texture base.
   * La sparkle è già stata inizializzata prima (base, variant 0).
   * @param {object} poke
   */
  function skipMissingVariant(poke) {
    poke.variant = 0;
    let name = 'unknown';
    try {
      name = (poke.species && poke.species.name) || poke.name || 'unknown';
    } catch (e) { /* name è solo per il log */ }
    if (!warnedMissingVariantAssets.has(name)) {
      warnedMissingVariantAssets.add(name);
      warn('Shiny variant assets unavailable for', name,
        '— variant skipped, keeping base sparkle and shiny texture');
    }
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
    // Task 3 v1.4.0: probe asset PRIMA di generateVariant. Se la sprite EPIC
    // (o la sparkle EPIC globale) non esiste nel texture manager, la variant
    // viene saltata → sparkle + texture shiny base restano (skip silenzioso,
    // 1 warn deduplicato per specie tramite warnedMissingVariantAssets).
    if (typeof poke.generateVariant === 'function') {
      try {
        if (!variantAssetsExist(poke)) {
          skipMissingVariant(poke);
          return undefined;
        }
        poke.generateVariant();
      } catch (e) { /* la variant è cosmetic */ }
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
        log('Pokemon prototype not yet available (retry)');
        return false;
      }

      const helpers = window.__pvu.helpers;
      if (!helpers || typeof helpers.hookPrototype !== 'function') {
        warn('helpers unavailable, cannot hook');
        return false;
      }

      // Guardia dedicata: se già wrappato da noi, skip (mai doppio wrap)
      if (proto.trySetShiny && proto.trySetShiny[ENCOUNTER_PATCHED]) {
        originalTrySetShiny = proto.trySetShiny.__pvuOriginal || proto.trySetShiny;
        state.hooksApplied = true;
        state.active = true;
        log('trySetShiny already hooked, skipping');
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
      log('trySetShiny hooked on Pokemon.prototype (class: ' + state.pokemonClass + ')');
      return true;
    } catch (e) {
      warn('hookTrySetShiny failed:', e);
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
        warn('Timeout: Pokemon prototype not found after 30s');
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
      warn('loadPersistedState failed:', e);
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
      log('Always Shiny active from previous settings');
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
          log('trySetShiny restored');
        }
      }
    } catch (e) {
      warn('destroy failed:', e);
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
// Strategia L2 (v1.4 Task 0): wrapper generico su CommandPhase.prototype.handleCommand.
//   1. Chiamo il gate nativo → lo nativo giudica se accetta o blocca.
//   2. Se accetta (return true + turnCommands assegnato) → passo through.
//   3. Se blocca + toggle ON + comando BALL + NON escluso → force inject.
//      NOTE v1.4:
//      - level2Verified NON è più nel gate (rimosso): l'inject gira al primo
//        tentativo; level2Verified resta solo come dato di report (confermato
//        SOLO su successo nativo di comando BALL = fallback 1, mai FIGHT/etc.).
//      - Esclusioni deterministiche fail-closed: rival (battleType===TRAINER &&
//        gameMode.checkIfRival(scene)), biome END, wave pre-final, multi-target
//        (nemici attivi != 1), boss-major (isBoss() && bossSegmentIndex>=1;
//        segmento non determinabile ⇒ escluso).
//      - L1 backstop live: pokeballCounts=99 re-armato ad OGNI CommandPhase push.
//
// Override probabilità (nuovo, v1.4): il roll di cattura usa t.randSeedInt(65536)
// chiamato sul POKEMON bersaglio (3 draw nel tween onRepeat di
// AttemptCapturePhase.start). A tentativo ARMATO sovrascriviamo randSeedInt
// dell'istanza pokemon con () => -1 → -1 < m per ogni m>=0 (m=0 incluso)
// ⇒ cattura garantita. Token-arm: armato nel force-inject (pokemon + turno),
// consumato allo start della AttemptCapturePhase (match per identità pokemon),
// restore del randSeedInt in failCatch/catch/end; i token pendenti vengono
// invalidati all'inizio del turno successivo (TurnInitPhase/TurnStartPhase).
// Limite noto: !species.isObtainable() && c!==-2 → failCatch prima del roll
// (non sovrascrivibile senza reimplementare start()).
//
// NOTA: bundle v3.1.8 con mangling OFF → nomi di classe preservati
// (TurnInitPhase/TurnStartPhase/AttemptCapturePhase); wrapper trasparente.
const PvuCaptureOverride = (() => {
  const LOG_PREFIX = '[PvuCaptureOverride]';
  const CAPTURE_PATCHED = Symbol.for('pvuCapturePatched');

  // ro.BALL = 1 verificato nel bundle v3.1.8.
  // Fallback usato prima che il wrapper abbia osservato un successo nativo.
  const BALL_CMD_ID_FALLBACK = 1;

  const state = {
    enabled: false,
    forceSpecial: false,     // V1.5: bypass selettivo esclusioni scripted/final/special
    level: 0,                // 0 = off, 1 = L1 (grant balls), 2 = L2 (wrapper)
    level2Verified: false,   // v1.4: report only — BALL confermato su successo nativo
    commandProto: null,      // prototype di CommandPhase (scoperto a runtime)
    ballCommandId: null,     // ID del comando BALL nel Command enum (scoperto)
    injectedCount: 0,        // catture forzate con successo
    blockedCount: 0,         // tentativi bloccati (debug)
    errorCount: 0,           // errori del wrapper (auto-degrade >= 3)
    hooksApplied: false,     // wrapper installato su CommandPhase.prototype
    l1Applied: false,        // L1 applicato almeno una volta
    _discoveryRegistered: false, // discovery interceptor registrato
    // V1.4: override probabilità di cattura (token-arm)
    capturedCount: 0,        // catture realizzate (catch con override armato)
    rollOverrideReady: null, // tri-state: null=non determinato, true=wrappabile, false=NON attivo
    rollOverrideArmed: false,// transitorio: randSeedInt patched in questo istante
    captureTokens: [],       // [{ pokemon, turn, pokeballType, fieldIndex }] armati in force-inject (D3)
    _attemptRegistered: false,
    _turnBoundaryRegistered: false,
    _l1BackstopRegistered: false,
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
      log('Auto-degrade to L1 after', state.errorCount, 'wrapper errors');
    }
  }

  // ─── V1.4: OVERRIDE PROBABILITÀ DI CATTURA (TOKEN-ARM) ────────────────
  // Enum bundle v3.1.8: Ua.BattleType.WILD=0, TRAINER=1; k.BiomeId.END=50.

  const BATTLE_TYPE_TRAINER = 1;
  const BIOME_END = 50;

  function removeTokenAt(idx) {
    if (idx >= 0 && idx < state.captureTokens.length) {
      state.captureTokens.splice(idx, 1);
    }
  }

  function clearCaptureTokens(reason) {
    if (!state.captureTokens.length) return;
    if (reason) log('Catch tokens invalidated (' + reason + ')');
    state.captureTokens = [];
  }

  /**
   * Esclusioni deterministiche (fail-closed) per il force-inject.
   * Replica i gate deterministici del nativo (bundle v3.1.8, case ro.BALL):
   * rival, multi-target, biome END, wave pre-final,
   * leggendario/OP-form pre-wave-1000 e boss-major.
   * Non replicati: bypass casuale 1/10000 (Le(1e4,1)<=1) e il jolly
   * activeSkillTree.legendaryEncounterChanceBySpecies.
   * Ogni controllo che solleva eccezione ⇒ escluso (fail-closed): mai
   * force-catch su un eventuale rival/scripted/boss (C1+C2).
   * @returns {boolean} true = escludi (NON iniettare)
   */
  function isExcluded(scene) {
    try {
      // V1.5: forceSpecial bypassa selettivamente le esclusioni
      // scripted/END/pre-final/leggendario/boss-major; B2 multi-target,
      // "nessun nemico attivo" e l'outer catch restano unconditional.
      var forceSpecial = !!state.forceSpecial;
      var battle = scene.currentBattle;
      if (!battle) return true;

      // 1. rival/scripted: battleType===TRAINER && gameMode.checkIfRival(scene)
      //    C1 (fail-closed): checkIfRival che solleva ⇒ escluso (mai
      //    force-catch su un eventuale rival/scripted) — a meno di forceSpecial.
      var gMode = scene.gameMode;
      if (battle.battleType === BATTLE_TYPE_TRAINER && gMode &&
          typeof gMode.checkIfRival === 'function') {
        var rival = false;
        try {
          rival = gMode.checkIfRival(scene) === true;
        } catch (e) {
          if (!forceSpecial) {
            return true;
          }
        }
        if (rival) {
          if (!forceSpecial) {
            log('Exclusion: rival (scripted)');
            return true;
          }
          log('Special cases: rival (scripted) passed (forceSpecial ON)');
        }
      }

      // 2. multi-target: deve esserci esattamente 1 nemico attivo
      var enemies = (scene.getEnemyField ? (scene.getEnemyField() || []) : [])
        .filter(function (p) {
          return p && typeof p.isActive === 'function' && p.isActive(true);
        });
      if (enemies.length > 1) {
        log('Exclusion: multi-target (' + enemies.length + ' active enemies)');
        return true;
      }
      if (enemies.length < 1) {
        log('Exclusion: no active enemy');
        return true;
      }

      // 3. biome END
      var arena = scene.arena;
      if (arena && typeof arena.biomeType === 'number' && arena.biomeType === BIOME_END) {
        if (!forceSpecial) {
          log('Exclusion: END biome');
          return true;
        }
        log('Special cases: END biome passed (forceSpecial ON)');
      }

      // 4. wave pre-final (C1: isWavePreFinal che solleva ⇒ escluso — a meno
      //    di forceSpecial)
      if (gMode && typeof gMode.isWavePreFinal === 'function') {
        var preFinal = false;
        try {
          preFinal = gMode.isWavePreFinal(scene) === true;
        } catch (e) {
          if (!forceSpecial) {
            return true;
          }
        }
        if (preFinal) {
          if (!forceSpecial) {
            log('Exclusion: pre-final wave');
            return true;
          }
          log('Special cases: pre-final wave passed (forceSpecial ON)');
        }
      }

      // 5. leggendario / OP-form pre-wave-1000 (gate nativo v3.1.8, COL
      //    16903330: T = currentBattle.waveIndex<=1000; branch leggendario =
      //    enemyField.some(active && species.isLegendSubOrMystical() && T);
      //    branch OP-form = enemyField.some(active && isOPForm()) && T).
      //    C2 (fail-closed): throw ⇒ escluso — a meno di forceSpecial.
      try {
        var waveIdx = battle.waveIndex;
        if (typeof waveIdx === 'number' && waveIdx <= 1000) {
          var preThousand = enemies.some(function (p) {
            if (!p || !p.species) return false;
            if (typeof p.isOPForm === 'function' && p.isOPForm()) return true;
            if (typeof p.species.isLegendSubOrMystical === 'function' &&
                p.species.isLegendSubOrMystical()) return true;
            return false;
          });
          if (preThousand) {
            if (!forceSpecial) {
              log('Exclusion: legendary/OP-form pre-wave-1000 (wave=' + waveIdx + ')');
              return true;
            }
            log('Special cases: legendary/OP-form pre-wave-1000 passed (forceSpecial ON)');
          }
        }
      } catch (e) {
        if (!forceSpecial) {
          return true;
        }
        // forceSpecial ON: check failed, ma utente ha optato in — continua a B6
      }

      // 6. boss-major segment >= 1 (fail-closed: segmento ignoto ⇒ escluso —
      //    a meno di forceSpecial)
      var target = enemies[0];
      if (target && typeof target.isBoss === 'function' && target.isBoss()) {
        var seg = target.bossSegmentIndex;
        if (typeof seg !== 'number' || seg >= 1) {
          if (!forceSpecial) {
            log('Exclusion: boss-major (segmentIndex=' + seg + ')');
            return true;
          }
          log('Special cases: boss-major passed (forceSpecial ON)');
        }
      }

      return false;
    } catch (e) {
      warn('isExcluded failed, fail-closed:', e);
      return true;
    }
  }

  /**
   * Arma l'override probabilità: sostituisce pokemon.randSeedInt con una
   * versione scoped che forza -1 SOLO per il draw di cattura (v===65536, il
   * t.randSeedInt(65536) del tween onRepeat di AttemptCapturePhase.start).
   * -1 < m per ogni m>=0 (m=0 incluso: -1 < 0 true), quindi il primo draw
   * passa sempre; ogni altro draw (range != 65536) passa al nativo. FIX 4.
   * Restore in disarmCapture. @returns {boolean} true se patchato
   */
  function armCapture(self, pokemon) {
    if (!pokemon || typeof pokemon.randSeedInt !== 'function') return false;
    if (!pokemon.__pvuRandPatched) {
      pokemon.__pvuOrigRandSeedInt = pokemon.randSeedInt;
      // FIX 4: scope del patch al solo draw di cattura (65536); ogni altro
      // draw passa al nativo. Niente più patch wholesale () => -1.
      pokemon.randSeedInt = function (v) {
        return v === 65536 ? -1 : pokemon.__pvuOrigRandSeedInt.apply(this, arguments);
      };
      pokemon.__pvuRandPatched = true;
    }
    self.__pvuPokemon = pokemon;
    self.__pvuArmed = true;
    state.rollOverrideArmed = true;
    return true;
  }

  /**
   * Disarma (idempotente): ripristina il randSeedInt originale sul pokemon.
   */
  function disarmCapture(self) {
    if (!self) return;
    var pokemon = self.__pvuPokemon;
    if (pokemon && pokemon.__pvuRandPatched && pokemon.__pvuOrigRandSeedInt) {
      pokemon.randSeedInt = pokemon.__pvuOrigRandSeedInt;
      delete pokemon.__pvuOrigRandSeedInt;
      delete pokemon.__pvuRandPatched;
    }
    self.__pvuPokemon = null;
    self.__pvuArmed = false;
    state.rollOverrideArmed = false;
  }

  /**
   * Cerca il token per la AttemptCapturePhase corrente.
   * Match primario: identità dell'oggetto pokemon (phase.getPokemon() ===
   * token.pokemon). Fallback (getPokemon non disponibile): pokeballType uguale
   * e stesso turno. D3: in entrambe le vie il fieldIndex della phase
   * (PokemonPhase: battlerIndex=ENEMY+slot → fieldIndex=slot 0/1) deve
   * combaciare col fieldIndex del token (fi del CommandPhase mittente): un
   * lancio dello stesso turno da un partner su campo diverso NON consuma.
   * Token stantio (turno cambiato) ⇒ rimosso.
   */
  function findTokenForPhase(phaseObj) {
    if (!state.captureTokens.length) return null;
    var pokemon = null;
    try {
      if (phaseObj && typeof phaseObj.getPokemon === 'function') {
        pokemon = phaseObj.getPokemon();
      }
    } catch (e) { /* phase non ancora iniziata */ }

    var battle = phaseObj && phaseObj.scene ? phaseObj.scene.currentBattle : null;
    var phaseFi = (phaseObj && typeof phaseObj.fieldIndex === 'number')
      ? phaseObj.fieldIndex : null;
    for (var i = state.captureTokens.length - 1; i >= 0; i--) {
      var tk = state.captureTokens[i];
      if (battle && typeof battle.turn === 'number' && typeof tk.turn === 'number' &&
          battle.turn !== tk.turn) {
        removeTokenAt(i); // stantio → token morto
        continue;
      }
      if (pokemon) {
        if (tk.pokemon === pokemon &&
            (phaseFi === null || tk.fieldIndex === phaseFi)) {
          tk.pokemon = pokemon;
          return tk;
        }
      } else if (tk.pokeballType !== undefined && tk.pokeballType === phaseObj.pokeballType) {
        if (phaseFi !== null && tk.fieldIndex === phaseFi) {
          return tk;
        }
      }
    }
    return null;
  }

  /**
   * Wrappa le funzioni per-istanza della AttemptCapturePhase:
   *  - start: trova il token → armCapture (patch randSeedInt PRIMA di orig)
   *  - catch: conta capturedCount se armato + restore (try/finally-semantics)
   *  - failCatch: restore
   *  - end: restore (idempotente)
   * Idempotente per istanza (__pvuCaptureWired).
   */
  function wireAttemptPhase(phaseObj) {
    if (!phaseObj || phaseObj.__pvuCaptureWired) return;
    if (typeof phaseObj.start !== 'function' ||
        typeof phaseObj.catch !== 'function' ||
        typeof phaseObj.failCatch !== 'function') {
      if (state.rollOverrideReady === null) {
        state.rollOverrideReady = false;
        warn('AttemptCapturePhase without wrappable methods: probability override NOT active');
      }
      return;
    }
    if (state.rollOverrideReady === null) {
      state.rollOverrideReady = true;
    }

    var origStart = phaseObj.start;
    phaseObj.start = function () {
      var self = this;
      try {
        var token = findTokenForPhase(self);
        if (token && token.pokemon) {
          if (armCapture(self, token.pokemon)) {
            removeTokenAt(state.captureTokens.indexOf(token));
            log('Probability override armed: catch #' + state.injectedCount + ' (randSeedInt → -1)');
          }
        }
      } catch (e) {
        warn('start wrapper error:', e);
      }
      return origStart.apply(self, arguments);
    };

    var origCatch = phaseObj.catch;
    phaseObj.catch = function () {
      var self = this;
      try {
        if (self.__pvuArmed) {
          state.capturedCount++;
          log('Catch realized (#' + state.capturedCount + ')');
        }
        disarmCapture(self);
      } catch (e) {
        warn('catch wrapper error:', e);
      }
      return origCatch.apply(self, arguments);
    };

    var origFail = phaseObj.failCatch;
    phaseObj.failCatch = function () {
      var self = this;
      try { disarmCapture(self); } catch (e) {}
      return origFail.apply(self, arguments);
    };

    if (typeof phaseObj.end === 'function') {
      var origEnd = phaseObj.end;
      phaseObj.end = function () {
        var self = this;
        try { disarmCapture(self); } catch (e) {}
        return origEnd.apply(self, arguments);
      };
    }

    phaseObj.__pvuCaptureWired = true;
    log('AttemptCapturePhase wrapped (probability override active)');
  }

  /**
   * Interceptor tentativi di cattura (push + unshift): aggancia la
   * AttemptCapturePhase appena creata.
   */
  function attemptInterceptor(phaseObj) {
    if (!state.enabled) return;
    if (!phaseObj || typeof phaseObj !== 'object' || !phaseObj.constructor) return;
    try {
      var name = phaseObj.constructor.name || '';
      if (name.indexOf('AttemptCapturePhase') === 0) {
        wireAttemptPhase(phaseObj);
      }
    } catch (e) {
      warn('attempt interceptor error:', e);
    }
  }

  /**
   * Interceptor confine di turno (push + unshift): invalida i token pendenti
   * quando inizia un nuovo turno (TurnInitPhase/TurnStartPhase).
   */
  function turnBoundaryInterceptor(phaseObj) {
    if (!state.captureTokens.length) return;
    if (!phaseObj || typeof phaseObj !== 'object' || !phaseObj.constructor) return;
    try {
      var name = phaseObj.constructor.name || '';
      if (name === 'TurnInitPhase' || name === 'TurnStartPhase') {
        clearCaptureTokens(name);
      }
    } catch (e) { /* ignore */ }
  }

  /**
   * L1 backstop live: ri-arma 99 pokeballs ad ogni CommandPhase push
   * (non solo al boot) — risolve il gate count=0 anche se scade in corsa.
   */
  function l1BackstopInterceptor(phaseObj) {
    if (!state.enabled) return;
    if (!phaseObj || typeof phaseObj !== 'object') return;
    try {
      if (typeof phaseObj.handleCommand !== 'function' ||
          typeof phaseObj.fieldIndex !== 'number') return;
      var scene = phaseObj.scene;
      if (!scene) {
        var bridge = window.__pvu.bridge;
        if (bridge && typeof bridge.getBattleScene === 'function') {
          scene = bridge.getBattleScene();
        }
      }
      applyLevel1(scene);
    } catch (e) { /* ignore */ }
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
      // FIX F: turnCommands è SEMPRE un oggetto in ogni battle type (bundle v3.1.8):
      // Battle.incrementTurn rialloca this.turnCommands = Object.fromEntries(...)
      // a inizio turno e dentro scene.newBattle — mai un array. I ||=[] nei node
      // handler (wild E trainer) sono no-op ({}/null-map sono truthy); il
      // turnCommands=[] di setupBattleFlow gira solo al run-start, prima della
      // battle successiva. La vecchia guardia Array.isArray disattivava forceInject
      // in OGNI battle (regressione introdotta in fa53abd, shipped in v1.5.0).
      // Scarta solo null/undefined.
      if (!turnCommands || typeof turnCommands !== 'object') return false;

      var enemies = (scene.getEnemyField() || []).filter(function(p) {
        return p && typeof p.isActive === 'function' && p.isActive(true);
      });
      // V1.4: override solo bersaglio singolo (ridondante con isExcluded,
      // difesa in profondità contro race condition multi-target)
      if (enemies.length !== 1) {
        log('forceInject: active enemies =', enemies.length, '→ injecting single target only, skip');
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

      // V1.4: token-arm per l'override probabilità di cattura.
      // D3: il token porta il fieldIndex del CommandPhase mittente (fi):
      // il consumo (findTokenForPhase) richiede match di campo.
      var target = enemies[0];
      state.captureTokens.push({
        pokemon: target,
        turn: (scene.currentBattle && typeof scene.currentBattle.turn === 'number')
          ? scene.currentBattle.turn : 0,
        pokeballType: n,
        fieldIndex: fi
      });

      // V1.4: pre-grant economico per snatch trainer (la cattura forza la
      // deduzione di getRequiredMoneyForPokeBuy; rival esclusi qui perché
      // esclusi da isExcluded prima del force-inject)
      var battle = scene.currentBattle;
      if (battle && battle.battleType === BATTLE_TYPE_TRAINER) {
        var cost = (typeof scene.getRequiredMoneyForPokeBuy === 'function')
          ? scene.getRequiredMoneyForPokeBuy() : 0;
        var moneyOverride = window.__pvu.moneyOverride;
        if (typeof scene.money === 'number' && scene.money < cost &&
            moneyOverride && typeof moneyOverride.setMoney === 'function') {
          moneyOverride.setMoney(cost);
          log('Money pre-granted for trainer snatch:', cost);
        }
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
      log('Forced catch (#' + state.injectedCount + ') fieldIndex=' + fi +
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

      // 2. Successo nativo → impara ballCommandId SOLO per comando BALL
      //    (fallback 1), mai per FIGHT/etc. — evita apprendimento avvelenato.
      if (result === true && turnCommands && turnCommandsAlreadyAssigned(turnCommands, fi)) {
        var tcCmd = turnCommands[fi].command;
        if (tcCmd === BALL_CMD_ID_FALLBACK && t === BALL_CMD_ID_FALLBACK) {
          if (state.ballCommandId === null) {
            state.ballCommandId = tcCmd;
            state.level2Verified = true; // report only (v1.4, NON è nel gate)
            log('BALL ID natively confirmed: ballCommandId =', state.ballCommandId);
          }
        }
        return true;
      }

      // 3. Nativo è tornato true ma turnCommands non assegnato → anomal, passa
      if (result === true) return true;

      // 4. Bloccato → valuta force inject (level2Verified NON è più nel gate)
      var cmd = getBallCommandId();
      if (cmd === null || t !== cmd) return result;

      // Esclusioni deterministiche (rival/END/pre-final/multi-target/boss-major)
      if (isExcluded(scene)) {
        state.blockedCount++;
        log('BALL action blocked natively and DECLINED due to exclusion (#', state.blockedCount, ')');
        return result;
      }

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
      log('handleCommand already wrapped (CAPTURE_PATCHED)');
      state.hooksApplied = true;
      state.commandProto = proto;
      return;
    }

    log('CommandPhase found via discovery interceptor');
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
      warn('helpers unavailable');
      return false;
    }

    if (proto.handleCommand && proto.handleCommand[CAPTURE_PATCHED]) {
      log('handleCommand already wrapped (installWrapper)');
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
    log('handleCommand wrapper installed on CommandPhase.prototype');
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
      log('Discovery interceptor registered');
    }

    // V1.4: interceptor tentativi cattura (AttemptCapturePhase, push+unshift)
    if (!state._attemptRegistered && phaseObserver &&
        typeof phaseObserver.onPhasePush === 'function') {
      phaseObserver.onPhasePush(attemptInterceptor);
      phaseObserver.onPhaseUnshift(attemptInterceptor);
      state._attemptRegistered = true;
      log('Attempt-capture interceptor registered');
    }

    // V1.4: interceptor confine di turno (invalida token pendenti)
    if (!state._turnBoundaryRegistered && phaseObserver &&
        typeof phaseObserver.onPhasePush === 'function') {
      phaseObserver.onPhasePush(turnBoundaryInterceptor);
      phaseObserver.onPhaseUnshift(turnBoundaryInterceptor);
      state._turnBoundaryRegistered = true;
      log('Turn-boundary interceptor registered');
    }

    // V1.4: L1 backstop live (99 balls a ogni CommandPhase push)
    if (!state._l1BackstopRegistered && phaseObserver &&
        typeof phaseObserver.onPhasePush === 'function') {
      phaseObserver.onPhasePush(l1BackstopInterceptor);
      phaseObserver.onPhaseUnshift(l1BackstopInterceptor);
      state._l1BackstopRegistered = true;
      log('L1 backstop interceptor registered');
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
   * Toggle casi speciali (forceSpecial): bypass selettivo delle esclusioni
   * deterministiche scripted/END/pre-final/leggendario/boss-major in
   * isExcluded. B2 multi-target, "nessun nemico attivo" e l'outer catch
   * restano unconditional fail-closed. Persistito via storage.setSettings.
   * @param {boolean|undefined} val - valore desiderato (default: inverti)
   * @returns {boolean} stato finale
   */
  function toggleForceSpecial(val) {
    state.forceSpecial = val !== undefined ? !!val : !state.forceSpecial;

    var storage = window.__pvu.storage;
    if (storage && typeof storage.setSettings === 'function') {
      storage.setSettings({ forceSpecial: state.forceSpecial });
    }

    log('Special cases (forceSpecial): ' + (state.forceSpecial ? 'ON' : 'OFF'));
    return state.forceSpecial;
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
      if (typeof settings.forceSpecial === 'boolean') state.forceSpecial = settings.forceSpecial;
      return state.enabled;
    } catch (e) {
      warn('loadPersistedState failed:', e);
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
      log('Catch Any active from previous settings');
    }

    applyHooks();
  }

  /**
   * Stato completo per la UI.
   */
  function getState() {
    return {
      enabled: state.enabled,
      forceSpecial: state.forceSpecial,
      level: state.level,
      level2Verified: state.level2Verified,
      ballCommandId: state.ballCommandId,
      hooksApplied: state.hooksApplied,
      l1Applied: state.l1Applied,
      injectedCount: state.injectedCount,
      blockedCount: state.blockedCount,
      errorCount: state.errorCount,
      // V1.4
      capturedCount: state.capturedCount,
      rollOverrideReady: state.rollOverrideReady,
      rollOverrideArmed: state.rollOverrideArmed,
      rollOverrideWired: state._attemptRegistered,
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
          log('handleCommand restored');
        }
      }
    } catch (e) {
      warn('destroy failed:', e);
    }
    clearCaptureTokens('destroy');
    originalHandleCommand = null;
    state.hooksApplied = false;
    state.commandProto = null;
    state.level2Verified = false;
    state.ballCommandId = null;
    state.capturedCount = 0;
    state.rollOverrideReady = null;
    state.rollOverrideArmed = false;
    state._attemptRegistered = false;
    state._turnBoundaryRegistered = false;
    state._l1BackstopRegistered = false;
    log('destroy');
  }

  return {
    init: init,
    destroy: destroy,
    applyHooks: applyHooks,
    toggleCapture: toggleCapture,
    toggleForceSpecial: toggleForceSpecial,
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
        return { ok: false, error: 'Battle scene unavailable' };
      }

      // scene.money (run corrente)
      scene.money = amount;
      log('scene.money set to', amount);

      // gameData.permaMoney (persistente)
      const gameData = bridge.findGameData();
      if (gameData) {
        // Difensivo: se permaMoney è già bigint/stringa "123n" (save corrotto in memoria),
        // normalizzalo prima che il gioco lo usi (Math.round/NaN-freeze).
        if (typeof gameData.permaMoney === 'bigint') {
          warn('permaMoney was BigInt (' + String(gameData.permaMoney) + ') → normalized to Number');
          gameData.permaMoney = Number(gameData.permaMoney);
        } else if (typeof gameData.permaMoney === 'string') {
          const m = /^(\d+)n?$/.exec(gameData.permaMoney.trim());
          if (m) {
            warn('permaMoney was string ("' + gameData.permaMoney + '") → normalized to Number');
            gameData.permaMoney = Number(m[1]);
          }
        }

        // FIX v1.2.1: era BigInt(amount) — corrompeva permaMoney (freeze Ω + load error).
        // Il gioco tratta permaMoney come number: assegniamo sempre Number.
        gameData.permaMoney = Number(amount);
        log('permaMoney set to', gameData.permaMoney);

        // Refresh UI — cerca updateMoneyText o updateGameInfo
        try {
          if (typeof scene.updateMoneyText === 'function') {
            scene.updateMoneyText();
          }
        } catch(e) {
          warn('updateMoneyText unavailable:', e);
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
        warn('gameData unavailable — money run-only');
        return { ok: true, sceneMoney: amount, error: 'gameData not found, run money updated only' };
      }
    } catch (e) {
      warn('setMoney failed:', e);
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
        log('saveSystem() invoked');
      }
    } catch(e) {
      warn('saveSystem failed:', e);
    }
  }

  /**
   * Apply da UI: prende il valore dal campo input e lo applica.
   */
  function applyFromInput(inputElement) {
    if (!inputElement) return { ok: false, error: 'Input element not found' };
    const val = parseInt(inputElement.value, 10);
    if (isNaN(val)) return { ok: false, error: 'Invalid value' };
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
        log('Champion resolved:', champId, '(source:', source + ')');
      }
      return champId;
    }

    // Caduta finale: default per gender (identico al gioco)
    const fallback = gd.gender === 'FEMALE' ? 'diana' : 'apollo';
    const key = fallback + '|gender-default';
    if (key !== lastChampLogKey) {
      lastChampLogKey = key;
      log('Champion resolved (gender default):', fallback, '(source: gender-default)');
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
      warn('activeSkillTree unavailable (no active run?)');
      return false;
    }
    ast.skillPoints = Math.max(0, Math.floor(amount));
    log('activeSkillTree.skillPoints set to', ast.skillPoints);
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
    if (!gd) return { ok: false, error: 'gameData unavailable' };

    const champId = resolveActiveChampionId();
    if (!champId) return { ok: false, error: 'No active champion in run' };

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
        log('Skill', skillId, 'removed from lockedSkills');
      }
    }

    // 2. Push in unlocked<category>
    const unlockedKey = UNLOCK_MAP[unlockableCategory];
    if (unlockedKey) {
      champData[unlockedKey] = champData[unlockedKey] || [];
      if (champData[unlockedKey].indexOf(skillId) === -1) {
        champData[unlockedKey].push(skillId);
        log('Skill', skillId, 'added to', unlockedKey);
      }
    }

    // 3. Trigger save
    try {
      if (typeof gd.saveSystem === 'function') {
        gd.saveSystem();
        log('saveSystem() invoked after unlock');
      }
    } catch(e) {
      warn('saveSystem failed:', e);
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


// --- src/essence-editor.js ---
/* PokeVoid-Unlocked — Type Essence editor (canonical 23-type id map; runtime enum used for verification only). */
(function () {
    'use strict';
    // Canonical map: all 23 native type ids (enum S, bundle v3.1.8).
    // Source of truth for key→id resolution. NEVER derived from list order or BFS.
    var TYPE_IDS = {
        UNKNOWN: -1,
        NORMAL: 0,
        FIGHTING: 1,
        FLYING: 2,
        POISON: 3,
        GROUND: 4,
        ROCK: 5,
        BUG: 6,
        GHOST: 7,
        STEEL: 8,
        FIRE: 9,
        WATER: 10,
        GRASS: 11,
        ELECTRIC: 12,
        PSYCHIC: 13,
        ICE: 14,
        DRAGON: 15,
        DARK: 16,
        FAIRY: 17,
        STELLAR: 18,
        ALL: 19,
        SMITTY: 20,
        GLITCH: 21,
        GEN_ONE: 22
    };
    // Native enum order (UNKNOWN → GEN_ONE). The combobox must use this order
    // so the selected value always maps to the correct native id.
    var TYPE_ORDER = Object.keys(TYPE_IDS);
    var MAX_CHILD_SCAN = 40;
    var MAX_CHILD_DEPTH = 3;
    var gameData = null;
    var typeEnum = null;
    var enumMismatch = false;
    var ready = false;

    function log(msg) { if (window.__pvu && typeof window.__pvu.log === 'function') window.__pvu.log('[essence-editor] ' + msg); }

    function findGameData() {
        var b = window.__pvu && window.__pvu.bridge;
        if (b && typeof b.findGameData === 'function') return b.findGameData();
        return null;
    }

    function isApiAvailable(gd) {
        return !!(gd && typeof gd.getEssenceCount === 'function' && typeof gd.addEssence === 'function' && typeof gd.tryConsumeEssence === 'function');
    }

    // BFS to depth <= MAX_CHILD_DEPTH, capped at MAX_CHILD_SCAN scanned properties overall.
    // Returns the first object with 'SMITTY' key (the type enum dictionary).
    function findTypeEnum(gd) {
        if (!gd) return null;
        var queue = [gd];
        var depth = 0;
        var scanned = 0;
        while (queue.length > 0 && depth < MAX_CHILD_DEPTH) {
            var next = [];
            for (var i = 0; i < queue.length; i += 1) {
                var o = queue[i];
                try {
                    if (o && typeof o === 'object' && 'SMITTY' in o && ('GEN_ONE' in o || 'STELLAR' in o)) return o;
                    for (var key in o) {
                        var v = o[key];
                        if (v && typeof v === 'object') next.push(v);
                        scanned += 1;
                        if (scanned >= MAX_CHILD_SCAN) break;
                    }
                } catch (e) {
                    // getter che lancia: skip questo oggetto, continua la scansione.
                }
            }
            queue = next;
            depth += 1;
        }
        return null;
    }

    // L'enum è considerato valido se contiene almeno un valore numerico per una chiave canonica.
    function isTypeEnumValid(e) {
        if (!e) return false;
        for (var i = 0; i < TYPE_ORDER.length; i += 1) {
            if (typeof e[TYPE_ORDER[i]] === 'number') return true;
        }
        return false;
    }

    // Confronta l'enum runtime con la mappa canonica. Ritorna l'elenco delle chiavi
    // discordanti (stringa leggibile per il log); array vuoto = coerente.
    function verifyEnum(e) {
        var mismatches = [];
        var i, k;
        for (i = 0; i < TYPE_ORDER.length; i += 1) {
            k = TYPE_ORDER[i];
            if (typeof e[k] !== 'number' || e[k] !== TYPE_IDS[k]) {
                mismatches.push(k + '=' + e[k] + ' (canonico ' + TYPE_IDS[k] + ')');
            }
        }
        return mismatches;
    }

    // ids sempre dalla mappa canonica: nessun fallback id=indice, nessuna dipendenza dal BFS.
    function resolveTypeIds() {
        var ids = {};
        var i;
        for (i = 0; i < TYPE_ORDER.length; i += 1) {
            ids[TYPE_ORDER[i]] = TYPE_IDS[TYPE_ORDER[i]];
        }
        return ids;
    }

    function getCount(id) {
        if (!gameData || typeof gameData.getEssenceCount !== 'function' || typeof id !== 'number') return 0;
        try {
            var n = Number(gameData.getEssenceCount(id));
            return isFinite(n) ? n : 0;
        } catch (e) { return 0; }
    }

    function applyEssence(key, rawTarget) {
        if (!ready) return { ok: false, reason: 'editor not ready (Type Essence API not found)' };
        var rawStr = String(rawTarget).trim();
        if (rawStr === '') return { ok: false, reason: 'empty value: enter a number' };
        if (!/^\d+$/.test(rawStr)) return { ok: false, reason: 'invalid value (digits only): ' + rawTarget };
        var ids = resolveTypeIds();
        if (!ids || typeof ids[key] !== 'number') return { ok: false, reason: 'type not available in current build: ' + key };
        var target = Math.min(Math.floor(Number(rawStr)), Number.MAX_SAFE_INTEGER);
        var id = ids[key];
        if (id < 0) return { ok: false, reason: 'type ' + key + ' (id ' + id + ') not writable' };
        var current = getCount(id);
        var delta = target - current;
        if (delta === 0) return { ok: true, current: current, key: key, target: target };
        if (delta > 0) {
            try { gameData.addEssence(id, delta); } catch (e) { return { ok: false, reason: 'addEssence failed: ' + e.message }; }
        } else {
            try {
                if (gameData.tryConsumeEssence(id, -delta) !== true) return { ok: false, reason: 'tryConsumeEssence refused' };
            } catch (e) { return { ok: false, reason: 'tryConsumeEssence failed: ' + e.message }; }
        }
        return { ok: true, key: key, target: target, current: current };
    }

    function getState() {
        var counts = {};
        var total = 0;
        var ids = resolveTypeIds();
        var i, k;
        if (ids) {
            for (i = 0; i < TYPE_ORDER.length; i += 1) {
                k = TYPE_ORDER[i];
                counts[k] = (typeof ids[k] === 'number') ? getCount(ids[k]) : null;
                if (typeof counts[k] === 'number') total += counts[k];
            }
        }
        return {
            ready: ready,
            enumFound: !!typeEnum,
            enumMismatch: enumMismatch,
            counts: counts,
            total: total
        };
    }

    // Re-callable: lazy init on first "Essenze" tab render.
    function init() {
        gameData = findGameData();
        ready = isApiAvailable(gameData);
        typeEnum = ready ? findTypeEnum(gameData) : null;
        if (typeEnum && !isTypeEnumValid(typeEnum)) typeEnum = null;
        enumMismatch = false;
        if (!ready) {
            log('Type Essence API not found — editor disabled (honest status)');
            return;
        }
        if (typeEnum) {
            var mm = verifyEnum(typeEnum);
            enumMismatch = mm.length > 0;
            if (enumMismatch) {
                log('WARNING: runtime enum does not match canonical map: ' + mm.join(', ') + ' — canonical ids used (v3.1.8)');
            } else {
                log('Type enum verified: 23/23 matches with canonical map');
            }
        } else {
            log('Type enum not found: hardcoded canonical map used (23 types) — no id=index fallback');
        }
    }

    function destroy() { gameData = null; typeEnum = null; ready = false; enumMismatch = false; }

    window.__pvu = window.__pvu || {};
    window.__pvu.essenceEditor = {
        init: init,
        destroy: destroy,
        getState: getState,
        applyEssence: applyEssence,
        TYPE_ORDER: TYPE_ORDER.slice(),
        TYPE_IDS: resolveTypeIds(),
        isReady: function () { return ready; }
    };
})();

// --- src/voucher-editor.js ---
const PvuVoucherEditor = (() => {
  const LOG_PREFIX = '[PvuVoucherEditor]';
  const TYPES = [0, 1, 2, 3];
  const LABELS = ['REGULAR', 'PLUS', 'PREMIUM', 'GOLDEN'];

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
    getVoucherCounts: getVoucherCounts,
    setVoucherCount: setVoucherCount,
    setAllVoucherCounts: setAllVoucherCounts,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.voucherEditor = PvuVoucherEditor;


// --- src/ui/styles.js ---
// styles.js — design tokens and UI stylesheet (v1.6.0)
/* global window, document */
'use strict';

window.__pvu = window.__pvu || {};

const PvuStyles = (function () {
  function inject() {
    if (document.getElementById('pvu-style')) return;
    const style = document.createElement('style');
    style.id = 'pvu-style';
    style.textContent = `
      :root {
        --pvu-bg: #0e1014;
        --pvu-surface: #171a21;
        --pvu-border: #2a2f3a;
        --pvu-text: #e6e9ef;
        --pvu-secondary: #9aa4b2;
        --pvu-accent: #4fa3ff;
        --pvu-success: #3ddc97;
        --pvu-warning: #ffb454;
        --pvu-danger: #ff5c5c;
        --pvu-radius-lg: 8px;
        --pvu-radius-md: 6px;
        --pvu-radius-sm: 4px;
        --pvu-space-1: 4px;
        --pvu-space-2: 8px;
        --pvu-space-3: 12px;
        --pvu-space-4: 16px;
        --pvu-space-5: 24px;
        --pvu-font-xs: 11px;
        --pvu-font-sm: 13px;
        --pvu-font-md: 15px;
        --pvu-font-lg: 17px;
        --pvu-transition: 0.18s;
      }

      #pvu-container {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 380px;
        pointer-events: none;
        z-index: 99998;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        color: var(--pvu-text);
      }

      #pvu-fab {
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--pvu-surface);
        border: 2px solid var(--pvu-accent);
        color: var(--pvu-accent);
        cursor: pointer;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform var(--pvu-transition), background var(--pvu-transition), color var(--pvu-transition);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
      }
      #pvu-fab:hover {
        transform: scale(1.08);
        background: rgba(79, 163, 255, 0.16);
      }

      #pvu-panel {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 380px;
        background: rgba(23, 26, 33, 0.95);
        -webkit-backdrop-filter: blur(10px);
        backdrop-filter: blur(10px);
        border-left: 1px solid var(--pvu-border);
        box-shadow: -8px 0 32px rgba(0, 0, 0, 0.45);
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        box-sizing: border-box;
        overflow: hidden;
      }

      .pvu-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--pvu-space-2);
        padding: var(--pvu-space-3) var(--pvu-space-4);
        border-bottom: 1px solid var(--pvu-border);
        background: var(--pvu-surface);
      }
      .pvu-header-title {
        font-size: var(--pvu-font-md);
        font-weight: 800;
        letter-spacing: 0.5px;
        color: var(--pvu-accent);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .pvu-close {
        width: 24px;
        height: 24px;
        border: none;
        border-radius: var(--pvu-radius-md);
        background: transparent;
        color: var(--pvu-secondary);
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color var(--pvu-transition), background var(--pvu-transition);
        flex-shrink: 0;
      }
      .pvu-close:hover {
        color: var(--pvu-text);
        background: var(--pvu-border);
      }

      .pvu-tabs {
        display: flex;
        gap: var(--pvu-space-1);
        padding: var(--pvu-space-2) var(--pvu-space-3) 0;
        background: var(--pvu-bg);
        border-bottom: 1px solid var(--pvu-border);
        flex-shrink: 0;
      }
      .pvu-tab {
        padding: var(--pvu-space-2) var(--pvu-space-3);
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: var(--pvu-secondary);
        font-size: var(--pvu-font-sm);
        font-weight: 600;
        cursor: pointer;
        transition: color var(--pvu-transition), border-color var(--pvu-transition), background var(--pvu-transition);
        border-radius: var(--pvu-radius-md) var(--pvu-radius-md) 0 0;
      }
      .pvu-tab:hover {
        color: var(--pvu-text);
      }
      .pvu-tab.active {
        color: var(--pvu-accent);
        border-bottom-color: var(--pvu-accent);
        background: rgba(79, 163, 255, 0.08);
      }

      .pvu-tab-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--pvu-space-4);
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--pvu-space-3);
      }
      .pvu-tab-content::-webkit-scrollbar {
        width: 8px;
      }
      .pvu-tab-content::-webkit-scrollbar-thumb {
        background: var(--pvu-border);
        border-radius: var(--pvu-radius-sm);
      }

      .pvu-screen {
        display: flex;
        flex-direction: column;
        gap: var(--pvu-space-3);
        font-size: var(--pvu-font-sm);
      }

      .pvu-section-title {
        font-size: var(--pvu-font-md);
        font-weight: 800;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--pvu-accent);
        margin: 0;
      }

      .pvu-toggle-row {
        display: flex;
        align-items: center;
        gap: var(--pvu-space-2);
        padding: var(--pvu-space-2);
        border: 1px solid var(--pvu-border);
        border-radius: var(--pvu-radius-md);
        background: var(--pvu-surface);
      }
      .pvu-toggle-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        cursor: pointer;
        flex: 1;
      }
      .pvu-toggle-name {
        font-size: var(--pvu-font-sm);
        font-weight: 600;
        color: var(--pvu-text);
      }
      .pvu-toggle-desc {
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        line-height: 1.35;
      }
      .pvu-toggle-row input[type='checkbox'] {
        accent-color: var(--pvu-accent);
        width: 15px;
        height: 15px;
        cursor: pointer;
      }

      .pvu-input {
        width: 100%;
        box-sizing: border-box;
        padding: var(--pvu-space-2) var(--pvu-space-3);
        border: 1px solid var(--pvu-border);
        border-radius: var(--pvu-radius-md);
        background: var(--pvu-bg);
        color: var(--pvu-text);
        font-size: var(--pvu-font-sm);
        transition: border-color var(--pvu-transition);
      }
      .pvu-input:focus {
        outline: none;
        border-color: var(--pvu-accent);
      }
      .pvu-input::placeholder {
        color: var(--pvu-secondary);
      }

      .pvu-btn {
        padding: var(--pvu-space-2) var(--pvu-space-4);
        border: 1px solid var(--pvu-accent);
        border-radius: var(--pvu-radius-md);
        background: rgba(79, 163, 255, 0.12);
        color: var(--pvu-accent);
        font-size: var(--pvu-font-sm);
        font-weight: 700;
        cursor: pointer;
        transition: background var(--pvu-transition), color var(--pvu-transition);
      }
      .pvu-btn:hover {
        background: var(--pvu-accent);
        color: #0e1014;
      }
      .pvu-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .pvu-status-box {
        padding: var(--pvu-space-2) var(--pvu-space-3);
        border-radius: var(--pvu-radius-md);
        background: var(--pvu-surface);
        border: 1px solid var(--pvu-border);
        font-size: var(--pvu-font-xs);
        font-family: Consolas, Menlo, monospace;
        line-height: 1.45;
        color: var(--pvu-text);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .pvu-status-box.ok {
        border-color: rgba(61, 220, 151, 0.5);
        color: var(--pvu-success);
      }
      .pvu-status-box.warn {
        border-color: rgba(255, 180, 84, 0.5);
        color: var(--pvu-warning);
      }
      .pvu-status-box.err {
        border-color: rgba(255, 92, 92, 0.5);
        color: var(--pvu-danger);
      }

      .pvu-list-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--pvu-space-2);
        padding: var(--pvu-space-2);
        border: 1px solid var(--pvu-border);
        border-radius: var(--pvu-radius-md);
        background: var(--pvu-surface);
        font-size: var(--pvu-font-sm);
      }

      .pvu-info {
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        line-height: 1.45;
      }

      .pvu-strip {
        display: flex;
        gap: var(--pvu-space-2);
        padding: var(--pvu-space-2) var(--pvu-space-4);
        border-bottom: 1px solid var(--pvu-border);
        background: var(--pvu-bg);
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      .pvu-chip {
        padding: 2px var(--pvu-space-2);
        border-radius: 999px;
        border: 1px solid var(--pvu-border);
        background: var(--pvu-surface);
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        white-space: nowrap;
      }
      .pvu-chip.ok {
        color: var(--pvu-success);
        border-color: rgba(61, 220, 151, 0.45);
      }
      .pvu-chip.warn {
        color: var(--pvu-warning);
        border-color: rgba(255, 180, 84, 0.45);
      }

      .pvu-footer {
        padding: var(--pvu-space-2) var(--pvu-space-4);
        border-top: 1px solid var(--pvu-border);
        background: var(--pvu-surface);
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--pvu-space-2);
        flex-shrink: 0;
      }
      .pvu-footer-hint {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pvu-footer .pvu-btn {
        padding: 2px var(--pvu-space-2);
        font-size: var(--pvu-font-xs);
      }

      .pvu-modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        pointer-events: auto;
      }
      .pvu-modal-card {
        width: min(90vw, 360px);
        max-height: 80vh;
        overflow-y: auto;
        background: var(--pvu-surface);
        border: 1px solid var(--pvu-border);
        border-radius: var(--pvu-radius-lg);
        padding: var(--pvu-space-4);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
        display: flex;
        flex-direction: column;
        gap: var(--pvu-space-3);
      }
      .pvu-modal-card .pvu-close {
        align-self: flex-end;
      }
      .pvu-modal-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--pvu-space-2);
        font-size: var(--pvu-font-sm);
      }
      .pvu-modal-row-label {
        color: var(--pvu-secondary);
      }
      .pvu-modal-row-value {
        color: var(--pvu-text);
        font-weight: 600;
      }
      .pvu-features {
        margin: 0;
        padding-left: var(--pvu-space-4);
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        line-height: 1.6;
      }

      @media (max-width: 560px) {
        #pvu-container,
        #pvu-panel {
          left: 0;
          right: 0;
          width: auto;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        #pvu-panel,
        #pvu-fab,
        .pvu-tab,
        .pvu-btn,
        .pvu-close {
          transition: none;
        }
      }

      /* ----- pre-v1.6.0 selector parity (tokenized) ----- */
      #pvu-container.pvu-hidden {
        transform: translateX(100%);
      }
      #pvu-fab:active {
        transform: scale(0.95);
      }
      .pvu-tab.pvu-tab-active {
        color: var(--pvu-accent);
        border-bottom-color: var(--pvu-accent);
        background: rgba(79, 163, 255, 0.08);
      }
      .pvu-section {
        margin: 0 0 var(--pvu-space-4);
      }
      .pvu-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--pvu-space-2) 0;
        border-bottom: 1px solid var(--pvu-border);
      }
      .pvu-switch {
        width: 40px;
        height: 22px;
        background: var(--pvu-border);
        border-radius: 11px;
        cursor: pointer;
        position: relative;
        transition: background var(--pvu-transition);
        flex-shrink: 0;
      }
      .pvu-switch.on {
        background: var(--pvu-accent);
      }
      .pvu-switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        background: var(--pvu-text);
        border-radius: 50%;
        transition: transform var(--pvu-transition);
      }
      .pvu-switch.on::after {
        transform: translateX(18px);
      }
      .pvu-input-row {
        display: flex;
        gap: var(--pvu-space-2);
        align-items: center;
        margin-bottom: var(--pvu-space-2);
      }
      .pvu-btn:active {
        transform: scale(0.97);
      }
      .pvu-btn.pvu-btn-sm {
        padding: var(--pvu-space-1) 10px;
        font-size: var(--pvu-font-sm);
      }
      .pvu-btn.pvu-btn-outline {
        background: transparent;
        border: 1px solid var(--pvu-accent);
        color: var(--pvu-accent);
      }
      .pvu-btn.pvu-btn-outline:hover {
        background: rgba(79, 163, 255, 0.12);
      }
      .pvu-slider-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: var(--pvu-space-2);
      }
      .pvu-slider {
        flex: 1;
        -webkit-appearance: none;
        appearance: none;
        height: 4px;
        background: var(--pvu-border);
        border-radius: 2px;
        outline: none;
      }
      .pvu-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        background: var(--pvu-accent);
        border-radius: 50%;
        cursor: pointer;
      }
      .pvu-slider-val {
        min-width: 30px;
        text-align: center;
        font-size: var(--pvu-font-sm);
        color: var(--pvu-accent);
      }
      .pvu-status {
        font-size: var(--pvu-font-sm);
        color: var(--pvu-secondary);
        margin-top: var(--pvu-space-1);
      }
      .pvu-status.ok {
        color: var(--pvu-success);
      }
      .pvu-status.warn {
        color: var(--pvu-warning);
      }
      .pvu-status.err {
        color: var(--pvu-danger);
      }
      .pvu-skill-item {
        padding: var(--pvu-space-2);
        background: var(--pvu-bg);
        border-radius: var(--pvu-radius-sm);
        margin-bottom: 6px;
        border-left: 3px solid var(--pvu-accent);
      }
      .pvu-skill-name {
        font-size: var(--pvu-font-sm);
        color: var(--pvu-text);
        margin-bottom: var(--pvu-space-1);
      }
      .pvu-skill-meta {
        font-size: var(--pvu-font-sm);
        color: var(--pvu-secondary);
      }
      .pvu-warning {
        background: rgba(255, 180, 84, 0.15);
        border: 1px solid var(--pvu-warning);
        border-radius: var(--pvu-radius-sm);
        padding: var(--pvu-space-2) var(--pvu-space-3);
        margin-bottom: var(--pvu-space-3);
        font-size: var(--pvu-font-sm);
        color: var(--pvu-warning);
      }
      .pvu-champ-select {
        background: var(--pvu-bg);
        border: 1px solid var(--pvu-border);
        color: var(--pvu-text);
        padding: 6px 10px;
        border-radius: var(--pvu-radius-sm);
        font-size: var(--pvu-font-sm);
        width: 100%;
        margin-bottom: var(--pvu-space-2);
      }
      .pvu-champ-select option {
        background: var(--pvu-surface);
        color: var(--pvu-text);
      }
      .pvu-ver {
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        text-align: right;
        margin-top: var(--pvu-space-2);
      }
      .pvu-tab-content::-webkit-scrollbar-track {
        background: transparent;
      }
    `;
    document.head.appendChild(style);
    console.log('[PvuStyles] CSS injected');
  }

  return {
    inject: inject
  };
})();

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
    btnEl.textContent = 'PV';
    btnEl.style.fontSize = '13px';
    btnEl.style.fontWeight = '800';
    btnEl.style.color = '#4fa3ff';
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
      log('Button created');
    } else {
      // document-start: aspetta body
      const observer = new MutationObserver(function() {
        if (document.body) {
          document.body.appendChild(btnEl);
          observer.disconnect();
          log('Button created (after body)');
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
    log('Button destroyed');
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


// --- src/ui/hotkey.js ---
// hotkey.js — rebindable panel toggle hotkey (v1.6.0)
/* global window, document, localStorage */
'use strict';

window.__pvu = window.__pvu || {};

const PvuHotkey = (function () {
  const DEFAULT_COMBO = { ctrl: true, alt: false, shift: true, meta: false, key: 'p' };
  const STORAGE_KEY = 'data_pvu_hotkey';
  const CAPTURE_MS = 5000;
  const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta'];

  let combo = null;
  let onToggle = null;
  let capturing = false;
  let captureCb = null;
  let captureTimer = null;
  let keyHandler = null;

  function resolveStore() {
    const pvu = window.__pvu || {};
    if (pvu.storage && typeof pvu.storage.get === 'function' && typeof pvu.storage.set === 'function') {
      return {
        get: function (k) { try { return pvu.storage.get(k); } catch (e) { return null; } },
        set: function (k, v) { try { pvu.storage.set(k, v); return true; } catch (e) { return false; } }
      };
    }
    return {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    };
  }

  function loadCombo() {
    const raw = resolveStore().get(STORAGE_KEY);
    if (!raw) return DEFAULT_COMBO;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object' && typeof parsed.key === 'string' && parsed.key.length === 1) {
        return {
          ctrl: !!parsed.ctrl,
          alt: !!parsed.alt,
          shift: !!parsed.shift,
          meta: !!parsed.meta,
          key: parsed.key
        };
      }
    } catch (e) { /* fall through to default */ }
    return DEFAULT_COMBO;
  }

  function persist(c) {
    return resolveStore().set(STORAGE_KEY, JSON.stringify(c));
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return true;
    return !!el.isContentEditable;
  }

  function handleKeyDown(e) {
    if (capturing) {
      e.preventDefault();
      e.stopPropagation();
      handleCaptureKey(e);
      return;
    }
    if (!onToggle || !combo) return;
    if (isEditableTarget(e.target)) return;
    const k = e.key ? e.key.toLowerCase() : '';
    if (combo.key.toLowerCase() !== k) return;
    if (!!combo.ctrl !== e.ctrlKey) return;
    if (!!combo.alt !== e.altKey) return;
    if (!!combo.shift !== e.shiftKey) return;
    if (!!combo.meta !== e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  }

  function handleCaptureKey(e) {
    if (MODIFIER_KEYS.indexOf(e.key) !== -1) return;
    if (e.key && e.key.length !== 1) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl && !e.altKey) return;
    if (e.key === 'Escape') {
      stopCapture();
      if (captureCb) { captureCb(null, combo); captureCb = null; }
      return;
    }
    const newCombo = {
      ctrl: !!e.ctrlKey,
      alt: !!e.altKey,
      shift: !!e.shiftKey,
      meta: !!e.metaKey,
      key: e.key.toLowerCase()
    };
    stopCapture();
    persist(newCombo);
    const old = combo;
    combo = newCombo;
    console.log('[PvuHotkey] Combo reassigned: ' + getComboLabel(newCombo));
    if (captureCb) { captureCb(newCombo, old); captureCb = null; }
  }

  function startCapture(cb) {
    capturing = true;
    captureCb = cb;
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = setTimeout(function () {
      capturing = false;
      if (captureCb) { captureCb(null, combo); captureCb = null; }
    }, CAPTURE_MS);
  }

  function stopCapture() {
    capturing = false;
    if (captureTimer) { clearTimeout(captureTimer); captureTimer = null; }
  }

  function getCombo() {
    return combo;
  }

  function getComboLabel(c) {
    const cur = c || combo;
    if (!cur) return '';
    const parts = [];
    if (cur.ctrl) parts.push('Ctrl');
    if (cur.alt) parts.push('Alt');
    if (cur.shift) parts.push('Shift');
    if (cur.meta) parts.push('Meta');
    if (cur.key) parts.push(cur.key.toUpperCase());
    return parts.join('+');
  }

  function init(toggleFn) {
    onToggle = toggleFn;
    combo = loadCombo();
    keyHandler = function (e) { handleKeyDown(e); };
    document.addEventListener('keydown', keyHandler, true);
    console.log('[PvuHotkey] Hotkey ready: ' + getComboLabel());
  }

  function destroy() {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler, true);
      keyHandler = null;
    }
    onToggle = null;
    stopCapture();
  }

  return {
    init: init,
    destroy: destroy,
    startCapture: startCapture,
    getCombo: getCombo,
    getComboLabel: getComboLabel
  };
})();

window.__pvu.hotkey = PvuHotkey;

// --- src/ui/roll-screen.js ---
// PARTE 2: rimossi toggle morti (freeReroll, poolQuality)
// Luck Lock: influisce SOLO sulle offerte del roll (getModifierTypeOptions su), non su party luck/battle
const PvuRollScreen = (() => {
  const t = window.__pvu.i18n.t.bind(window.__pvu.i18n);
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
    rerollTitle.textContent = t('roll.title');
    rerollSection.appendChild(rerollTitle);

    // Cost Override
    const costOverrideResult = createToggle(t('roll.noCost'), t('roll.noCostDesc'), false, function(val) {
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
    luckTitle.textContent = t('roll.luckLock');
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
    const luckLockResult = createToggle('Lock luck', t('roll.luckLockDesc'), false, function(val) {
      window.__pvu.rollController.toggleLuckLock(val);
    });
    luckSection.appendChild(luckLockResult.row);
    toggleRefs.luckLock = luckLockResult.switchEl;

    // Luck info
    const luckInfo = document.createElement('div');
    luckInfo.className = 'pvu-status';
    luckInfo.textContent = t('roll.luckInfo');
    luckSection.appendChild(luckInfo);

    containerEl.appendChild(luckSection);

    // === Item Count Section ===
    const itemSection = document.createElement('div');
    itemSection.className = 'pvu-section';

    const itemTitle = document.createElement('div');
    itemTitle.className = 'pvu-section-title';
    itemTitle.textContent = t('roll.itemCount');
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
    itemInfo.textContent = t('roll.itemInfo');
    itemSection.appendChild(itemInfo);

    containerEl.appendChild(itemSection);

    // === Status ===
    const statusSection = document.createElement('div');
    statusSection.className = 'pvu-section';

    const statusTitle = document.createElement('div');
    statusTitle.className = 'pvu-section-title';
    statusTitle.textContent = t('roll.hookStatus');
    statusSection.appendChild(statusTitle);

    const statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.id = 'pvu-roll-status';
    statusEl.textContent = t('roll.waiting');
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
      const hookStatus = state.hooksApplied ? t('roll.hooksActive') : t('roll.waitingHooks');
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
  const t = window.__pvu.i18n.t.bind(window.__pvu.i18n);
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
    spTitle.textContent = t('skill.title');
    spSection.appendChild(spTitle);

    // Active champion display (readonly — shows the run's active champion)
    const champActiveLabel = document.createElement('div');
    champActiveLabel.className = 'pvu-toggle-label';
    champActiveLabel.textContent = t('skill.activeChampion');
    spSection.appendChild(champActiveLabel);

    const champActiveDisplay = document.createElement('div');
    champActiveDisplay.className = 'pvu-status ok';
    champActiveDisplay.id = 'pvu-champ-active';
    champActiveDisplay.textContent = t('skill.detecting');
    spSection.appendChild(champActiveDisplay);

    // Champion selector (for manual override)
    const champLabel = document.createElement('div');
    champLabel.className = 'pvu-toggle-label';
    champLabel.textContent = t('skill.selectChampion');
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
    versionWarning.textContent = t('skill.versionWarning');
    spSection.appendChild(versionWarning);

    // Status
    const statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.id = 'pvu-skill-status';
    statusEl.textContent = t('skill.waiting');
    spSection.appendChild(statusEl);

    containerEl.appendChild(spSection);

    // Locked Skills Section
    const lockedSection = document.createElement('div');
    lockedSection.className = 'pvu-section';

    const lockedTitle = document.createElement('div');
    lockedTitle.className = 'pvu-section-title';
    lockedTitle.textContent = t('skill.lockedTitle');
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
      champActiveDisplay.textContent = activeChampId || t('skill.noActiveRun');
    }

    // Aggiorna champion selector (populated from championData keys)
    const champSelect = containerEl.querySelector('#pvu-champ-select');
    if (champSelect) {
      const currentChamp = editor.getSelectedChampionId();
      const gameData = bridge.findGameData();
      if (gameData && gameData.championData) {
        const champs = Object.keys(gameData.championData);
        if (champSelect.options.length !== champs.length + 1) {
          champSelect.innerHTML = '<option value="">-- ' + t('skill.selectPlaceholder') + ' --</option>';
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
        versionWarning.textContent = t('skill.versionWarning') + ' (was ' + ver.oldVersion + ', now ' + ver.newVersion + ')';
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
        info.textContent = t('skill.noneLocked');
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
          metaEl.textContent = t('skill.category') + skill.category + ' | Lv: ' + skill.requiredLevel;
          item.appendChild(metaEl);

          const unlockBtn = document.createElement('button');
          unlockBtn.className = 'pvu-btn pvu-btn-sm pvu-btn-outline';
          unlockBtn.textContent = t('skill.unlock');
          unlockBtn.addEventListener('click', function() {
            const result = editor.unlockSkill(skill.skillId, skill.category);
            if (result.ok) {
              item.style.borderColor = '#4caf50';
              refreshUI();
            } else {
              item.style.borderColor = '#f44336';
              setTimeout(function() { item.style.borderColor = '#ff5c5c'; }, 1500);
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
      statusEl.textContent = t('skill.statusLocked') + sp + ' | Champion: ' + (champId || 'none') + ' | ' + t('skill.locked') + locked.length;
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
  const tr = window.__pvu.i18n.t.bind(window.__pvu.i18n);
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
    title.textContent = tr('voucher.title');
    section.appendChild(title);

    const info = document.createElement('div');
    info.className = 'pvu-info';
    info.textContent = tr('voucher.info');
    section.appendChild(info);

    const editor = window.__pvu.voucherEditor;
    const labels = editor.LABELS;
    const rows = [];

    for (let t = 0; t < labels.length; t++) {
      (function(typeIdx) {
        const row = document.createElement('div');
        row.className = 'pvu-input-row';

        const label = document.createElement('span');
        label.style.minWidth = '110px';
        label.style.display = 'inline-block';
        label.textContent = labels[typeIdx];
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
      showStatus(result.ok ? tr('voucher.updated') : (result.error || tr('voucher.error')), result.ok);
    });
    allRow.appendChild(applyAllBtn);
    section.appendChild(allRow);

    // Status
    statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.textContent = tr('voucher.waiting');
    section.appendChild(statusEl);

    containerEl.appendChild(section);
    parentEl.appendChild(containerEl);

    refreshUI();
  }

  function applyVoucher(typeIdx, inputEl) {
    const val = parseInt(inputEl.value, 10);
    const editor = window.__pvu.voucherEditor;
    const result = editor.setVoucherCount(typeIdx, val);
    showStatus(result.ok ? editor.LABELS[typeIdx] + ' = ' + Math.max(0, val || 0) : (result.error || tr('voucher.error')), result.ok);
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
      showStatus('gameData unavailable', false);
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


// --- src/ui/essence-screen.js ---
/* PokeVoid-Unlocked — Essenze tab (precompiled input, debounced live apply, no buttons). */
(function () {
    'use strict';
    const t = window.__pvu.i18n.t.bind(window.__pvu.i18n);
    var DEBOUNCE_MS = 350;
    var container = null;
    var selectEl = null;
    var inputEl = null;
    var statusEl = null;
    var refreshTimer = null;
    var debounceTimer = null;
    var currentKey = null;

    function log(msg) { if (window.__pvu && typeof window.__pvu.log === 'function') window.__pvu.log('[essence-screen] ' + msg); }

    function editor() { return window.__pvu && window.__pvu.essenceEditor; }

    function render(parentEl) {
        if (container) destroy();
        var ed = editor();
        // lazy init on every render (init is idempotent; gameData cache refreshed each call)
        if (ed && typeof ed.init === 'function') ed.init();

        container = document.createElement('div');
        container.id = 'pvu-essence-screen';
        var title = document.createElement('h3');
        title.textContent = t('essence.title');
        container.appendChild(title);

        if (!ed || !ed.isReady()) {
            var warn = document.createElement('div');
            warn.className = 'pvu-warning';
            warn.textContent = t('essence.apiMissing');
            container.appendChild(warn);
            parentEl.appendChild(container);
            return;
        }

        // Combobox: ordine nativo dell'enum (23 opzioni, id garantiti dalla mappa canonica).
        selectEl = document.createElement('select');
        selectEl.className = 'pvu-champ-select';
        var order = (ed.TYPE_ORDER || []).filter(function (k) { return k !== 'UNKNOWN'; });
        var i;
        for (i = 0; i < order.length; i += 1) {
            var opt = document.createElement('option');
            opt.value = order[i];
            opt.textContent = order[i];
            selectEl.appendChild(opt);
        }
        selectEl.addEventListener('change', function () {
            clearPendingApply();
            currentKey = selectEl.value;
            refreshInput();
            setStatus('', '');
        });
        container.appendChild(selectEl);

        // Singolo input precompilato col valore corrente; apply live debounced (nessun bottone).
        inputEl = document.createElement('input');
        inputEl.type = 'number';
        inputEl.min = '0';
        inputEl.step = '1';
        inputEl.className = 'pvu-input';
        inputEl.style.cssText = 'display:block;margin:8px 0;';
        inputEl.addEventListener('input', function () {
            clearPendingApply();
            debounceTimer = setTimeout(applyPending, DEBOUNCE_MS);
        });
        container.appendChild(inputEl);

        statusEl = document.createElement('div');
        statusEl.className = 'pvu-status';
        container.appendChild(statusEl);

        currentKey = selectEl.value;
        refreshInput();
        parentEl.appendChild(container);
        refreshTimer = setInterval(refreshUI, 2000);
    }

    function clearPendingApply() {
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    }

    function applyPending() {
        debounceTimer = null;
        if (!currentKey || !inputEl) return;
        var raw = String(inputEl.value).trim();
        if (raw === '') return; // vuoto = no-op (mai azzerare per errore)
        var ed = editor();
        if (!ed) return;
        var res = ed.applyEssence(currentKey, raw);
        if (res.ok) {
            setStatus(res.key + ' = ' + res.target, 'ok');
        } else {
            setStatus(t('essence.error') + res.reason, 'err');
        }
    }

    function refreshInput() {
        var ed = editor();
        var st = ed && ed.getState ? ed.getState() : null;
        if (!st || !st.counts || !currentKey || !inputEl) return;
        var v = st.counts[currentKey];
        if (typeof v === 'number') inputEl.value = String(v);
    }

    function refreshUI() {
        if (!container || !document.getElementById('pvu-essence-screen')) return;
        if (document.activeElement === inputEl || document.activeElement === selectEl) return;
        refreshInput();
    }

    function setStatus(msg, cls) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.className = 'pvu-status' + (cls ? ' ' + cls : '');
    }

    function destroy() {
        clearPendingApply();
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        if (container && container.parentNode) container.parentNode.removeChild(container);
        container = null; selectEl = null; inputEl = null; statusEl = null; currentKey = null;
    }

    window.__pvu = window.__pvu || {};
    window.__pvu.essenceScreen = { render: render, destroy: destroy };
})();

// --- src/ui/battle-screen.js ---
// Segue il pattern di roll-screen.js: createToggle, setSwitchState, refreshUI 2s
const PvuBattleScreen = (() => {
  const t = window.__pvu.i18n.t.bind(window.__pvu.i18n);
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
    encounterTitle.textContent = t('battle.shinyTitle');
    encounterSection.appendChild(encounterTitle);

    var encounterState = window.__pvu.encounterOverride?.getState?.() || {};
    var shinyResult = createToggle(
      t('battle.shinyName'),
      t('battle.shinyDesc'),
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
    shinyStatus.textContent = t('battle.waiting');
    encounterSection.appendChild(shinyStatus);

    containerEl.appendChild(encounterSection);

    // === CATTURA — Cattura Tutto ===
    const captureSection = document.createElement('div');
    captureSection.className = 'pvu-section';

    const captureTitle = document.createElement('div');
    captureTitle.className = 'pvu-section-title';
    captureTitle.textContent = t('battle.catchTitle');
    captureSection.appendChild(captureTitle);

    var captureState = window.__pvu.captureOverride?.getState?.() || {};
    var captureResult = createToggle(
      t('battle.catchName'),
      t('battle.catchDesc'),
      !!captureState.enabled,
      function(val) {
        window.__pvu.captureOverride?.toggleCapture?.(val);
      }
    );
    captureSection.appendChild(captureResult.row);
    toggleRefs.capture = captureResult.switchEl;

    var forceSpecialResult = createToggle(
      t('battle.specialsName'),
      t('battle.specialsDesc'),
      !!captureState.forceSpecial,
      function(val) {
        window.__pvu.captureOverride?.toggleForceSpecial?.(val);
      }
    );
    captureSection.appendChild(forceSpecialResult.row);
    toggleRefs.forceSpecial = forceSpecialResult.switchEl;

    // Status row cattura
    var captureStatus = document.createElement('div');
    captureStatus.className = 'pvu-status';
    captureStatus.id = 'pvu-battle-capture-status';
    captureStatus.textContent = t('battle.waiting');
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
      var encHooks = encounterState.hooksApplied ? t('roll.hooksActive') : t('roll.waitingHooks');
      var encDetail = encounterState.hooksApplied
        ? ' — Pokemon: ' + (encounterState.hookStats?.pokemonPatched || 0)
        : '';
      shinyStatusEl.textContent = encHooks + encDetail;
      shinyStatusEl.className = 'pvu-status ' + (encounterState.hooksApplied ? 'ok' : 'warn');
    }

    // --- Capture toggle + status ---
    setSwitchState(toggleRefs.capture, !!captureState.enabled);
    if (toggleRefs.forceSpecial) setSwitchState(toggleRefs.forceSpecial, !!captureState.forceSpecial);

    var captureStatusEl = containerEl.querySelector('#pvu-battle-capture-status');
    if (captureStatusEl && captureState.enabled) {
      var levelText = '—';
      if (captureState.level === 2) {
        if (!captureState.hooksApplied) {
          levelText = t('battle.wrapperNotActive');
        } else {
          // Ladder tri-state onesto: wrapper → id confermato → override armato
          var rungs = [t('battle.wrapperActive')];
          if (captureState.ballCommandId !== null) rungs.push(t('battle.idConfirmed'));
          if (captureState.rollOverrideReady === true) rungs.push(t('battle.overrideArmed'));
          levelText = rungs.join(' / ');
          if (captureState.rollOverrideReady === false) {
            levelText = rungs[0] + ' ' + t('battle.overrideNotActive');
          }
        }
      } else if (captureState.level === 1) {
        levelText = t('battle.l1Fallback');
      }
      var forced = captureState.injectedCount || 0;
      var realized = captureState.capturedCount || 0;
      var errors = captureState.errorCount || 0;
      var txt =
        t('battle.level') + levelText +
        ' | ' + t('battle.forcedCatches') + forced +
        ' | ' + t('battle.realizedCatches') + realized;
      txt += ' | ' + t('battle.specialCases') + (captureState.forceSpecial ? 'ON' : 'OFF');
      if (errors > 0) txt += ' | ' + t('battle.errors') + errors;
      captureStatusEl.textContent = txt;
      captureStatusEl.className = 'pvu-status ' +
        (errors >= 3 ? 'err' : errors > 0 ? 'warn' : 'ok');
    } else if (captureStatusEl) {
      captureStatusEl.textContent = t('battle.disabled');
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
  const t = window.__pvu.i18n.t.bind(window.__pvu.i18n);
  const LOG_PREFIX = '[PvuPanel]';
  let containerEl = null;
  let panelEl = null;
  let isOpen = false;
  let activeTab = 'roll';
  // PARTE 4: interval money creato a ogni renderMoneyTab senza clear = leak di timer
  // a ogni cambio tab. Un solo timer alla volta, pulito su re-render e destroy.
  let moneyTimer = null;
  let stripTimer = null;
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
    title.textContent = t('panel.title');
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pvu-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', toggle);
    header.appendChild(closeBtn);
    panelEl.appendChild(header);
    panelEl.appendChild(buildStrip());

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'pvu-tabs';

    const tabMoney = createTab(t('tab.money'), 'money');
    const tabRoll = createTab(t('tab.roll'), 'roll');
    const tabSkill = createTab(t('tab.skill'), 'skill');
    const tabVoucher = createTab(t('tab.voucher'), 'voucher');
    const tabBattle = createTab(t('tab.battle'), 'battle');
    const tabEssence = createTab(t('tab.essence'), 'essence');

    tabs.appendChild(tabMoney);
    tabs.appendChild(tabRoll);
    tabs.appendChild(tabSkill);
    tabs.appendChild(tabVoucher);
    tabs.appendChild(tabBattle);
    tabs.appendChild(tabEssence);
    panelEl.appendChild(tabs);

    // Tab content area
    const tabContent = document.createElement('div');
    tabContent.className = 'pvu-tab-content';
    tabContent.id = 'pvu-tab-content';
    panelEl.appendChild(tabContent);
    panelEl.appendChild(buildFooter());
    updateFooterHint();

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

    refreshStrip();
    stripTimer = setInterval(refreshStrip, 2000);

    log('Panel created');
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

  function buildStrip() {
    const strip = document.createElement('div');
    strip.className = 'pvu-strip';
    strip.id = 'pvu-strip';
    strip.appendChild(makeChip('pvu-strip-version', 'v' + window.__pvu.config.VERSION, ''));
    strip.appendChild(makeChip('pvu-strip-game', '', ''));
    strip.appendChild(makeChip('pvu-strip-overrides', '', ''));
    return strip;
  }

  function makeChip(id, label, state) {
    const chip = document.createElement('span');
    chip.className = 'pvu-chip' + (state ? ' ' + state : '');
    chip.id = id;
    chip.textContent = label;
    return chip;
  }

  function refreshStrip() {
    const gameChip = document.getElementById('pvu-strip-game');
    const ovrChip = document.getElementById('pvu-strip-overrides');
    if (!gameChip || !ovrChip) return;
    const hasBridge = !!(window.gameInfo && window.gameInfo.game);
    if (hasBridge) {
      gameChip.textContent = t('strip.gameRunning');
      gameChip.className = 'pvu-chip ok';
    } else {
      gameChip.textContent = t('strip.gameWaiting');
      gameChip.className = 'pvu-chip warn';
    }
    let count = 0;
    try {
      if (window.__pvu.encounterOverride && typeof window.__pvu.encounterOverride.getState === 'function') {
        const s = window.__pvu.encounterOverride.getState();
        if (s && s.shiny) count++;
      }
      if (window.__pvu.rollController && typeof window.__pvu.rollController.getState === 'function') {
        const s = window.__pvu.rollController.getState();
        if (s && (s.costOverride || s.luckLock || (s.itemCountExtra > 0))) count++;
      }
      if (window.__pvu.captureOverride && typeof window.__pvu.captureOverride.getState === 'function') {
        const s = window.__pvu.captureOverride.getState();
        if (s && (s.enabled || s.forceSpecial)) count++;
      }
    } catch (e) {
      /* strip read failures are cosmetic; ignore */
    }
    ovrChip.textContent = t('strip.overrides') + ': ' + count;
    ovrChip.className = count > 0 ? 'pvu-chip ok' : 'pvu-chip';
  }

  function buildFooter() {
    const footer = document.createElement('div');
    footer.className = 'pvu-footer';
    const hint = document.createElement('span');
    hint.className = 'pvu-footer-hint';
    hint.id = 'pvu-footer-hint';
    const aboutBtn = document.createElement('button');
    aboutBtn.className = 'pvu-btn';
    aboutBtn.textContent = t('about.title');
    aboutBtn.addEventListener('click', openAbout);
    footer.appendChild(hint);
    footer.appendChild(aboutBtn);
    return footer;
  }

  function updateFooterHint() {
    const hint = document.getElementById('pvu-footer-hint');
    if (!hint) return;
    const combo = window.__pvu.hotkey && typeof window.__pvu.hotkey.getComboLabel === 'function'
      ? window.__pvu.hotkey.getComboLabel()
      : 'Ctrl+Shift+P';
    hint.textContent = combo + ' ' + t('about.hintToggle') + '.';
  }

  function openAbout() {
    const backdrop = document.createElement('div');
    backdrop.className = 'pvu-modal-backdrop';
    const card = document.createElement('div');
    card.className = 'pvu-modal-card';
    const title = document.createElement('div');
    title.className = 'pvu-header-title';
    title.textContent = t('about.title') + ' — ' + t('panel.title');
    const close = document.createElement('button');
    close.className = 'pvu-close';
    close.textContent = '×';
    close.addEventListener('click', closeAbout);
    const rows = document.createElement('div');
    rows.style.display = 'flex';
    rows.style.flexDirection = 'column';
    rows.style.gap = '12px';
    const verRow = document.createElement('div');
    verRow.className = 'pvu-modal-row';
    const verLabel = document.createElement('span');
    verLabel.className = 'pvu-modal-row-label';
    verLabel.textContent = t('about.version');
    const verValue = document.createElement('span');
    verValue.className = 'pvu-modal-row-value';
    verValue.textContent = 'v' + window.__pvu.config.VERSION;
    verRow.appendChild(verLabel);
    verRow.appendChild(verValue);
    const scRow = document.createElement('div');
    scRow.className = 'pvu-modal-row';
    const scLabel = document.createElement('span');
    scLabel.className = 'pvu-modal-row-label';
    scLabel.textContent = t('about.shortcut');
    const scValue = document.createElement('span');
    scValue.className = 'pvu-modal-row-value';
    scValue.id = 'pvu-about-combo';
    scValue.textContent = window.__pvu.hotkey && typeof window.__pvu.hotkey.getComboLabel === 'function'
      ? window.__pvu.hotkey.getComboLabel()
      : 'Ctrl+Shift+P';
    const rebind = document.createElement('button');
    rebind.className = 'pvu-btn';
    rebind.textContent = t('about.rebind');
    rebind.addEventListener('click', function () {
      rebind.textContent = t('about.pressKey') + '...';
      if (window.__pvu.hotkey && typeof window.__pvu.hotkey.startCapture === 'function') {
        // API reale: startCapture(cb) con cb(newCombo, oldCombo); null su cancel/timeout.
        window.__pvu.hotkey.startCapture(function (newCombo) {
          rebind.textContent = t('about.rebind');
          if (!newCombo) return;
          const label = typeof window.__pvu.hotkey.getComboLabel === 'function'
            ? window.__pvu.hotkey.getComboLabel(newCombo)
            : 'Ctrl+Shift+P';
          updateComboLabel(label);
          updateFooterHint();
        });
      }
    });
    scRow.appendChild(scLabel);
    scRow.appendChild(scValue);
    scRow.appendChild(rebind);
    const featLabel = document.createElement('div');
    featLabel.className = 'pvu-modal-row-label';
    featLabel.textContent = t('about.features');
    const list = document.createElement('ul');
    list.className = 'pvu-features';
    [
      'Money override (permament, save-backed)',
      'Roll controller: no-cost, luck lock, item count',
      'Skill points: unlock skills of the active champion',
      'Voucher editor (types / values of each owned voucher)',
      'Battle: always-shiny, catch-any with special-case opt-in',
      'Type essence editor (per-type values)',
      'Toggle panel: ' + (window.__pvu.hotkey && typeof window.__pvu.hotkey.getComboLabel === 'function' ? window.__pvu.hotkey.getComboLabel() : 'Ctrl+Shift+P')
    ].forEach(function (text) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    card.appendChild(title);
    card.appendChild(close);
    card.appendChild(rows);
    rows.appendChild(verRow);
    rows.appendChild(scRow);
    rows.appendChild(featLabel);
    rows.appendChild(list);
    backdrop.appendChild(card);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeAbout();
    });
    document.getElementById('pvu-container').appendChild(backdrop);
  }

  function closeAbout() {
    const existing = document.querySelector('.pvu-modal-backdrop');
    if (existing) existing.remove();
  }

  function updateComboLabel(newLabel) {
    const el = document.getElementById('pvu-about-combo');
    if (el) el.textContent = newLabel || 'Ctrl+Shift+P';
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
      case 'essence':
        window.__pvu.essenceScreen.render(content);
        activeScreen = window.__pvu.essenceScreen;
        break;
    }
  }

  function renderMoneyTab(parentEl) {
    const section = document.createElement('div');
    section.className = 'pvu-section';

    const title = document.createElement('div');
    title.className = 'pvu-section-title';
    title.textContent = t('money.title');
    section.appendChild(title);

    // Money input
    const row = document.createElement('div');
    row.className = 'pvu-input-row';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'pvu-input';
    input.id = 'pvu-money-input';
    input.placeholder = t('money.placeholder');
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
          statusEl.textContent = t('money.updated') + (result.sceneMoney || input.value);
          statusEl.className = 'pvu-status ok';
          input.style.borderColor = '#4caf50';
          setTimeout(function() { input.style.borderColor = ''; }, 1000);
        } else {
          statusEl.textContent = (result.error || t('money.error'));
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
    statusEl.textContent = t('money.waiting');
    section.appendChild(statusEl);

    // Info
    const info = document.createElement('div');
    info.className = 'pvu-info';
    info.textContent = t('money.info');
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
    statusEl.textContent = t('money.current') + money.toLocaleString();
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
    log('Panel', isOpen ? 'opened' : 'closed');
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
    if (stripTimer) { clearInterval(stripTimer); stripTimer = null; }
    const stripEl = document.getElementById('pvu-strip');
    if (stripEl) stripEl.remove();
    closeAbout();
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
    openAbout: openAbout,
    closeAbout: closeAbout,
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

  log('Starting PokeVoid-Unlocked v' + (pvu.config ? pvu.config.VERSION : '?') );

  // 0. Sanitizza salvataggi esistenti (prima che il gioco carichi i dati — anti-BigInt)
  //   Fix v1.2.1: permaMoney serializzato come BigInt/stringa "123n" causava
  //   [LOAD ERROR] initSystem failed: Cannot convert a BigInt value to a number al riavvio.
  if (pvu.storage && typeof pvu.storage.sanitizeSavedData === 'function') {
    try {
      pvu.storage.sanitizeSavedData();
    } catch (e) {
      warn('Save sanitization failed:', e);
    }
  }

  // 1. Inietta stili CSS
  if (pvu.styles) pvu.styles.inject();

  // 2. Crea floating button (prima di tutto, anche se il gioco non è partito)
  let panelCreated = false;

  function togglePanel() {
    if (!panelCreated) {
      createPanelAndUI();
    } else {
      pvu.panel.toggle();
    }
  }

  if (pvu.floatingBtn) {
    pvu.floatingBtn.create(togglePanel);
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
        log('Timeout: battle scene not found after 30s');
      }
      return;
    }

    // Battle scene trovato — applica hooks
    log('Battle scene found, applying hooks...');

    if (pvu.rollController) {
      const applied = pvu.rollController.applyHooks();
      if (applied) {
        log('Roll hooks applied successfully');
      } else {
        // FIX v1.4 (T2): qui un warn immediato era un falso positivo sistematico —
        // applyHooks() registra solo gli interceptor, hooksApplied diventa TRUE
        // solo alla prima push/unshift di una phase su. Il vero segnale di
        // successo è il log 'Hooks applicati con successo (getRerollCost patched)'
        // in roll-controller.js. Ora: info immediata + UN SOLO warn ritardato
        // (60s) che scatta solo se gli hooks non risultano ancora applicati.
        log('Roll hooks waiting for a phase (push/unshift) — informative, not an error');
        setTimeout(function() {
          try {
            const st = pvu.rollController.getState();
            if (!st.hooksApplied) {
              warn('Roll hooks NOT applied after 60s (no patched phase) — check compatibility with the game version');
            }
          } catch (e) {
            warn('Roll hooks 60s check failed:', e);
          }
        }, 60000);
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
    log('All hooks applied');
  }, 1000);

  function createPanelAndUI() {
    if (panelCreated) return;
    panelCreated = true;

    log('Creating UI...');

    if (pvu.panel) {
      pvu.panel.create();
    }

    log('UI created');
  }

  // Hotkey: toggle panel (rebindable, default Ctrl+Shift+P)
  if (pvu.hotkey) {
    pvu.hotkey.init(togglePanel);
  }

  log('Bootstrap complete — waiting for the game...');

})();


})();
