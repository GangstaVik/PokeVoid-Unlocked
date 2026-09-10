// ==UserScript==
// @name         PokeVoid-Unlocked
// @namespace    local.pokevoid-unlocked
// @version      1.0.0
// @description  Skill editor, roll controller, money override per PokéVoid
// @author       PokeRogueMOD
// @match        https://pokevoid.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function() {
"use strict";

// --- src/utils/config.js ---
const PvuConfig = {
  VERSION: '1.0.0',
  PREFIX: 'data_pvu_',
  BUILD_VERSION_FALLBACK: 'v3.1.8',
  MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,

  // compat map: bundle version → known offsets/patterns
  COMPAT: {
    'v3.1.8': {
      classes: {
        SelectModifierPhase: { search: 'SelectModifierPhase' },
      },
      functions: {
        getRerollCost: {
          aob: 'getRerollCost(t,n){if(o.WAIVE_ROLL_FEE_OVERRIDE',
          stringSearch: 'getRerollCost',
        },
        getPlayerModifierTypeOptions: {
          aob: 'u(Wd,"getPlayerModifierTypeOptions")',
          stringSearch: 'getPlayerModifierTypeOptions',
        },
        getRaritiesForRewardType: {
          stringSearch: 'getRaritiesForRewardType',
        },
        updateMoneyText: {
          stringSearch: 'updateMoneyText',
        },
        updateGameInfo: {
          aob: 'window.gameInfo=t}initFinalBossPhaseTwo(t)',
          stringSearch: 'updateGameInfo',
        },
        unshiftPhase: {
          stringSearch: 'unshiftPhase',
        },
        pushPhase: {
          stringSearch: 'pushPhase',
        },
        WAIVE_ROLL_FEE_OVERRIDE: {
          aob: 'WAIVE_ROLL_FEE_OVERRIDE',
          stringSearch: 'WAIVE_ROLL_FEE_OVERRIDE',
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

  return {
    createBackup: createBackup,
    validatePostWrite: validatePostWrite,
    writeSave: writeSave,
    readSave: readSave,
    serializeBigInt: serializeBigInt,
    getUsername: getUsername,
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

      const OriginalGame = Phaser.Game;
      let gameCaptured = false;

      Phaser.Game = function() {
        const instance = OriginalGame.apply(this, arguments) || this;
        // Salva l'istanza
        STATE.gameInstance = instance;
        window.__pvu_game = instance;
        gameCaptured = true;
        log('Phaser.Game catturato via constructor hook');
        return instance;
      };

      // Copia prototype
      Phaser.Game.prototype = OriginalGame.prototype;
      Phaser.Game.prototype.constructor = Phaser.Game;

      log('Hook Phaser.Game applicato (attende istanza...)');
      return true;
    } catch (e) {
      warn('hookPhaserGame fallito:', e);
      return false;
    }
  }

  /**
   * Cattura il bundle source per lookups.
   * Cerca tutti gli script tag src che contengono il bundle e fetcha il contenuto.
   */
  function captureBundleSource() {
    try {
      if (window.__pvu._bundleSource) return true;
      const scripts = document.querySelectorAll('script[src]');
      for (const s of scripts) {
        if (s.src && s.src.indexOf('assets/index') !== -1) {
          // Non possiamo fare fetch (non siamo in sway). Ma il bundle potrebbe essere
          // nello stesso scope. Proviamo a cercare nel DOM script inline.
          log('Bundle script trovato:', s.src);
        }
      }
      // Leggi script inline dal DOM
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
   * LIVELLO 1c: Usa Function.prototype.toString() sui prototype methods
   * per trovare e wrappare funzioni del gioco direttamente.
   */
  function hookViaProtoMethods() {
    if (STATE.hooked) return;
    STATE.hooked = true;

    // Wrappa tutti i prototype dei Phaser Object per cercare nomi target
    try {
      const Phaser = window.Phaser;
      if (!Phaser) return;

      // Cerca tra tutti gli oggetti globali per trovare i prototype
      const protoTargets = {};
      const searchNames = ['getRerollCost', 'getPlayerModifierTypeOptions', 'getRaritiesForRewardType',
                           'updateMoneyText', 'updateGameInfo', 'unshiftPhase', 'pushPhase'];

      // Salta cercare nel bundle: cerchiamo direttamente le classi che il gioco espone
      // Nota: con esbuild keepNames, i prototype methods sono normali metodi sugli oggetti
      log('hookViaProtoMethods: ricerca methods non implementata senza bundle source');
    } catch (e) {
      warn('hookViaProtoMethods error:', e);
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
   */
  function getFromCanvasPool() {
    try {
      const pool = window.Phaser && window.Phaser.CanvasPool;
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
   */
  function getGame() {
    if (STATE.gameInstance) return STATE.gameInstance;
    if (window.__pvu_game) {
      STATE.gameInstance = window.__pvu_game;
      return STATE.gameInstance;
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
   * Get gameData dal game instance.
   */
  function getGameData() {
    const scene = getBattleScene();
    if (scene && scene.gameData) return scene.gameData;
    // fallback: cerca in game
    const game = getGame();
    if (game && game.scene && game.scene.scenes) {
      for (const key in game.scene.scenes) {
        const s = game.scene.scenes[key];
        if (s && s.gameData) return s.gameData;
      }
    }
    return null;
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
    const scene = getBattleScene();
    if (scene && scene.scene && scene.scene.settings && scene.scene.settings.key) {
      // il nome utente è nel gameData o nel window.gameInfo
    }
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
        // Il gioco è disponibile — prova a catturare gameData
        const gd = getGameData();
        if (gd) {
          log('gameData trovato via game instance');
          clearInterval(pollInterval);
          return;
        }
      }

      // Prova via CanvasPool
      const scene = getBattleScene();
      if (scene) {
        log('battle scene trovato via CanvasPool');
        clearInterval(pollInterval);
        return;
      }

      // Fallback: poll window.gameInfo
      if (pollGameInfo()) {
        log('gameInfo disponibile');
      }

      if (pollCount > 120) { // 60 secondi
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
   * Get gameData per utente corrente (trova dal scene.settings.key o dal runner).
   * Cerca in tutte le scene attive.
   */
  function findGameData() {
    const game = getGame();
    if (!game) return null;

    // Cerca in tutte le scene attive
    if (game.scene && game.scene.scenes) {
      const scenes = game.scene.scenes;
      for (const key in scenes) {
        const s = scenes[key];
        if (s && s.gameData) return s.gameData;
      }
    }

    // Cerca direttamente sulla battle scene
    const bs = getBattleScene();
    if (bs && bs.gameData) return bs.gameData;

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
  let lastPhase = null;
  let pollTimer = null;
  let unpatchFns = [];

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

  /**
   * Hook unshiftPhase e pushPhase sulla battle scene prototype.
   * Il game le chiama quando cambia fase.
   */
  function hookPhaseMethods() {
    const bridge = window.__pvu.bridge;
    const helpers = window.__pvu.helpers;
    if (!bridge || !helpers) return;

    const scene = bridge.getBattleScene();
    if (!scene) {
      log('battle scene non ancora disponibile per phase hook');
      return false;
    }

    // Cerca il constructor della battle scene per hookare il prototype
    const proto = Object.getPrototypeOf(scene);
    if (!proto) {
      log('proto non trovato');
      return false;
    }

    // Hook unshiftPhase
    if (proto.unshiftPhase) {
      const r1 = helpers.hookPrototype(proto, 'unshiftPhase', function(original, args) {
        const result = original.apply(this, args);
        try { handlePhaseChange(args[0]); } catch(e) { /* ignore */ }
        return result;
      });
      unpatchFns.push(r1.unpatch);
      log('unshiftPhase hooked');
    }

    // Hook pushPhase
    if (proto.pushPhase) {
      const r2 = helpers.hookPrototype(proto, 'pushPhase', function(original, args) {
        const result = original.apply(this, args);
        try { handlePhaseChange(args[0]); } catch(e) { /* ignore */ }
        return result;
      });
      unpatchFns.push(r2.unpatch);
      log('pushPhase hooked');
    }

    // Hook updateMoneyText per sapere quando il money viene aggiornato
    if (proto.updateMoneyText) {
      const r3 = helpers.hookPrototype(proto, 'updateMoneyText', function(original, args) {
        try {
          // Notifica che il money è stato aggiornato
          window.__pvu._lastMoneyUpdate = Date.now();
        } catch(e) {}
        return original.apply(this, args);
      });
      unpatchFns.push(r3.unpatch);
      log('updateMoneyText hooked');
    }

    return true;
  }

  function handlePhaseChange(phaseObj) {
    const bridge = window.__pvu.bridge;
    if (!bridge) return;

    // Determina il nome fase
    let phaseName = 'unknown';
    if (typeof phaseObj === 'string') {
      phaseName = phaseObj;
    } else if (phaseObj && phaseObj.constructor && phaseObj.constructor.name) {
      phaseName = phaseObj.constructor.name;
    } else if (phaseObj && phaseObj.toString) {
      phaseName = phaseObj.toString();
    }

    // Normalizza
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

    // Aspetta che il battle scene sia disponibile
    let hookAttempts = 0;
    const hookInterval = setInterval(function() {
      hookAttempts++;
      const hooked = hookPhaseMethods();
      if (hooked) {
        clearInterval(hookInterval);
        log('Phase hooks applicati');
      }
      if (hookAttempts > 30) {
        clearInterval(hookInterval);
        log('Phase hooks: timeout, uso solo polling');
      }
    }, 1000);

    // Semple poll come fallback
    startPolling();
  }

  function destroy() {
    for (let i = 0; i < unpatchFns.length; i++) {
      try { unpatchFns[i](); } catch(e) {}
    }
    unpatchFns = [];
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    listeners.length = 0;
    log('destroy');
  }

  return {
    init: init,
    destroy: destroy,
    onPhaseChange: onPhaseChange,
    hookPhaseMethods: hookPhaseMethods,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.phaseObserver = PvuPhaseObserver;


// --- src/roll-controller.js ---
const PvuRollController = (() => {
  const LOG_PREFIX = '[PvuRollController]';

  // Stato toggle
  const state = {
    freeReroll: false,         // oneshot: si resetta dopo l'uso
    costOverride: false,       // persistente: WAIVE_ROLL_FEE_OVERRIDE
    poolQuality: false,        // persistente: forza rarità Legendary
    itemCountExtra: 2,         // slider: +0..+4 (default +2)
    active: false,             // modulo attivo
    hooksApplied: false,
  };

  // Hook refs per unpatch
  const unpatchFns = [];

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * Hook getRerollCost per free reroll (oneshot) e cost override (persistente).
   */
  function hookGetRerollCost() {
    const bridge = window.__pvu.bridge;
    const scene = bridge.getBattleScene();
    if (!scene) return false;

    const proto = Object.getPrototypeOf(scene);
    if (!proto || !proto.getRerollCost) {
      log('getRerollCost non trovato su proto — skip');
      return false;
    }

    const helpers = window.__pvu.helpers;
    const r = helpers.hookPrototype(proto, 'getRerollCost', function(original, args) {
      // Cost Override: WAIVE_ROLL_FEE_OVERRIDE nativo
      if (state.costOverride) {
        log('Cost Override attivo → ritorno {0, 0}');
        return { cost: 0, permaCost: 0 };
      }

      // Free Reroll: costo 0 una volta, poi auto-off
      if (state.freeReroll) {
        log('Free Reroll attivo → ritorno {0, 0}');
        state.freeReroll = false;
        emitStateChange();
        return { cost: 0, permaCost: 0 };
      }

      // Chiamata normale
      return original.apply(this, arguments);
    });

    unpatchFns.push(r.unpatch);
    log('getRerollCost hooked');
    return true;
  }

  /**
   * Hook getModifierTypeOptions/getPlayerModifierTypeOptions per itemcount.
   * La funzione riceve il count come primo parametro → lo incrementiamo.
   */
  function hookGetModifierTypeOptions() {
    const bridge = window.__pvu.bridge;
    const scene = bridge.getBattleScene();
    if (!scene) return false;

    const proto = Object.getPrototypeOf(scene);
    const helpers = window.__pvu.helpers;

    // Hook getPlayerMethodTypeOptions se presente (il nome "keepNames" nel bundle)
    if (proto.getPlayerModifierTypeOptions) {
      const r = helpers.hookPrototype(proto, 'getPlayerModifierTypeOptions', function(original, args) {
        if (state.itemCountExtra > 0 && args.length > 0 && typeof args[0] === 'number') {
          const originalCount = args[0];
          args[0] = originalCount + state.itemCountExtra;
          log('Itemcount: ' + originalCount + ' → ' + args[0] + ' (extra: +' + state.itemCountExtra + ')');
        }
        return original.apply(this, args);
      });
      unpatchFns.push(r.unpatch);
      log('getPlayerModifierTypeOptions hooked');
      return true;
    }

    // Fallback: cerca un metodo che contiene "ModifierType" nel nome
    const candidates = ['getModifierTypeOptions', 'getNewModifierTypeOption'];
    for (const cand of candidates) {
      if (proto[cand]) {
        const r = helpers.hookPrototype(proto, cand, function(original, args) {
          if (state.itemCountExtra > 0 && args.length > 0 && typeof args[0] === 'number') {
            args[0] = args[0] + state.itemCountExtra;
            log('Itemcount via ' + cand + ': +' + state.itemCountExtra);
          }
          return original.apply(this, args);
        });
        unpatchFns.push(r.unpatch);
        log(cand + ' hooked');
        return true;
      }
    }

    log('Nessuna funzione ModifierTypeOptions trovata su proto');
    return false;
  }

  /**
   * Hook getRaritiesForRewardType per pool quality.
   * Se poolQuality è attivo, forza il ritorno di rarità alta (Legendary/Master).
   */
  function hookGetRaritiesForRewardType() {
    const bridge = window.__pvu.bridge;
    const scene = bridge.getBattleScene();
    if (!scene) return false;

    const proto = Object.getPrototypeOf(scene);
    const helpers = window.__pvu.helpers;

    if (proto.getRaritiesForRewardType) {
      const r = helpers.hookPrototype(proto, 'getRaritiesForRewardType', function(original, args) {
        if (state.poolQuality) {
          // Forza ritorno di almeno un legendary/master
          const result = original.apply(this, args);
          if (Array.isArray(result)) {
            // Aggiungi o forza Legendary/Master
            // St: ROGUE=0, MASTER=1, LEGENDARY=2, GREAT=3
            // Per garantire legendary: assicura che il risultato contenga tier basso (0-2)
            if (result.indexOf(0) === -1 && result.indexOf(1) === -1 && result.indexOf(2) === -1) {
              result.unshift(2); // Legendary
              log('Pool quality: forzato Legendary nel pool');
            }
          }
          return result;
        }
        return original.apply(this, args);
      });
      unpatchFns.push(r.unpatch);
      log('getRaritiesForRewardType hooked');
      return true;
    }

    log('getRaritiesForRewardType non trovato su proto');
    return false;
  }

  /**
   * Forza WAIVE_ROLL_FEE_OVERRIDE sul gameData se disponibile.
   */
  function setWaiveRollFeeOverride(val) {
    const bridge = window.__pvu.bridge;
    const gameData = bridge.findGameData();
    if (gameData) {
      gameData.WAIVE_ROLL_FEE_OVERRIDE = val;
      log('WAIVE_ROLL_FEE_OVERRIDE =', val);
      return true;
    }
    return false;
  }

  /**
   * Applica tutti gli hook quando la battle scene è disponibile.
   */
  function applyHooks() {
    if (state.hooksApplied) return true;

    const bridge = window.__pvu.bridge;
    const scene = bridge.getBattleScene();
    if (!scene) return false;

    let ok = true;
    if (!hookGetRerollCost()) ok = false;
    if (!hookGetModifierTypeOptions()) ok = false;
    if (!hookGetRaritiesForRewardType()) ok = false;

    state.hooksApplied = ok;
    state.active = true;
    return ok;
  }

  function emitStateChange() {
    try {
      window.__pvu._rollStateChange = Date.now();
    } catch(e) {}
  }

  // === Toggle API ===

  function toggleFreeReroll() {
    state.freeReroll = true; // sempre oneshot
    log('Free Reroll: ON (prossimo reroll sarà gratuito)');
    emitStateChange();
    return true;
  }

  function toggleCostOverride(val) {
    state.costOverride = val !== undefined ? val : !state.costOverride;
    setWaiveRollFeeOverride(state.costOverride);
    log('Cost Override:', state.costOverride ? 'ON' : 'OFF');
    emitStateChange();
    return state.costOverride;
  }

  function togglePoolQuality(val) {
    state.poolQuality = val !== undefined ? val : !state.poolQuality;
    log('Pool Quality:', state.poolQuality ? 'ON' : 'OFF');
    emitStateChange();
    return state.poolQuality;
  }

  function setItemCountExtra(val) {
    state.itemCountExtra = Math.max(0, Math.min(4, parseInt(val, 10) || 0));
    log('Item Count extra:', '+' + state.itemCountExtra);
    emitStateChange();
    return state.itemCountExtra;
  }

  function getState() {
    return {
      freeReroll: state.freeReroll,
      costOverride: state.costOverride,
      poolQuality: state.poolQuality,
      itemCountExtra: state.itemCountExtra,
      active: state.active,
      hooksApplied: state.hooksApplied,
    };
  }

  function destroy() {
    for (let i = 0; i < unpatchFns.length; i++) {
      try { unpatchFns[i](); } catch(e) {}
    }
    unpatchFns.length = 0;
    state.hooksApplied = false;
    state.active = false;
    log('destroy');
  }

  return {
    init: function() { log('init'); },
    destroy: destroy,
    applyHooks: applyHooks,
    getState: getState,
    toggleFreeReroll: toggleFreeReroll,
    toggleCostOverride: toggleCostOverride,
    togglePoolQuality: togglePoolQuality,
    setItemCountExtra: setItemCountExtra,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.rollController = PvuRollController;


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
        gameData.permaMoney = BigInt(amount);
        log('permaMoney impostato a', amount);

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
      if (gameData && gameData.permaMoney !== undefined) return Number(gameData.permaMoney);
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
   * Leggi skillPoints correnti.
   */
  function getSkillPoints() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return 0;
    return Number(gd.skillPoints || 0);
  }

  /**
   * Imposta skillPoints.
   */
  function setSkillPoints(amount) {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) {
      warn('gameData non disponibile');
      return false;
    }
    gd.skillPoints = Math.max(0, Math.floor(amount));
    log('skillPoints impostato a', gd.skillPoints);
    return true;
  }

  /**
   * Get champion ID corrente.
   */
  function getSelectedChampionId() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return null;
    return gd.selectedChampionId || null;
  }

  /**
   * Get locked skills del champion corrente.
   */
  function getLockedSkills() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return [];
    const champId = gd.selectedChampionId;
    if (!champId) return [];
    const champData = gd.championData && gd.championData[champId];
    if (!champData) return [];
    return champData.lockedSkills || [];
  }

  /**
   * Get champion skill version corrente.
   */
  function getChampionSkillVersion() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return null;
    const champId = gd.selectedChampionId;
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

    const champId = gd.selectedChampionId;
    if (!champId) return { ok: false, error: 'Nessun champion selezionato' };

    let champData = gd.championData && gd.championData[champId];
    if (!champData) {
      // Crea struttura se non esiste
      gd.championData = gd.championData || {};
      gd.championData[champId] = { lockedSkills: [] };
      champData = gd.championData[champId];
    }

    // 1. Rimuovi da lockedSkills
    if (champData.lockedSkills) {
      const idx = champData.lockedSkills.findIndex(function(s) {
        return s.skillId === skillId || s.id === skillId || s === skillId;
      });
      if (idx !== -1) {
        champData.lockedSkills.splice(idx, 1);
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
    const savedVer = null;
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
  font-family: 'pkmnems', system-ui, -apple-system, sans-serif;
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
  font-family: 'pkmnems', system-ui, -apple-system, sans-serif;
  color: #eee;
}

/* Header */
#pvu-panel .pvu-header {
  padding: 12px 16px;
  background: #e94560;
  color: #1a1a2e;
  font-family: 'emerald', system-ui, sans-serif;
  font-size: 16px;
  font-weight: bold;
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
  font-size: 12px;
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
  font-family: 'emerald', system-ui, sans-serif;
  font-size: 13px;
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
  font-size: 12px;
  color: #eee;
}
#pvu-panel .pvu-toggle-desc {
  font-size: 10px;
  color: #888;
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
  font-family: 'pkmnems', monospace;
  font-size: 13px;
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
  font-family: 'pkmnems', system-ui;
  font-size: 12px;
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
  font-size: 11px;
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
  font-size: 13px;
  color: #e94560;
  font-family: 'pkmnems', monospace;
}

/* Status badge */
#pvu-panel .pvu-status {
  font-size: 10px;
  color: #888;
  margin-top: 4px;
}
#pvu-panel .pvu-status.ok { color: #4caf50; }
#pvu-panel .pvu-status.warn { color: #ff9800; }
#pvu-panel .pvu-status.err { color: #f44336; }

/* Skill list */
#pvu-panel .pvu-skill-item {
  padding: 8px;
  background: #111;
  border-radius: 4px;
  margin-bottom: 6px;
  border-left: 3px solid #e94560;
}
#pvu-panel .pvu-skill-name {
  font-size: 12px;
  color: #eee;
  margin-bottom: 4px;
}
#pvu-panel .pvu-skill-meta {
  font-size: 10px;
  color: #888;
}

/* Warning box */
#pvu-panel .pvu-warning {
  background: rgba(255, 152, 0, 0.15);
  border: 1px solid #ff9800;
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 11px;
  color: #ff9800;
}

/* Info box */
#pvu-panel .pvu-info {
  background: rgba(33, 150, 243, 0.1);
  border: 1px solid #2196f3;
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 11px;
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
  font-family: 'pkmnems', monospace;
  font-size: 12px;
  width: 100%;
  margin-bottom: 8px;
}
#pvu-panel .pvu-champ-select option {
  background: #1a1a2e;
  color: #eee;
}

/* Version badge */
#pvu-panel .pvu-ver {
  font-size: 9px;
  color: #666;
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
const PvuRollScreen = (() => {
  const LOG_PREFIX = '[PvuRollScreen]';
  let containerEl = null;
  let refreshTimer = null;

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

    // Free Reroll (oneshot)
    const freeRerollRow = createToggle('Reroll gratuito', 'Prossimo reroll sarà gratuito (una volta)', false, function(val) {
      window.__pvu.rollController.toggleFreeReroll();
      refreshUI();
    });
    rerollSection.appendChild(freeRerollRow);

    // Pool Quality
    const poolQualityRow = createToggle('Qualità pool', 'Forza Legendary/Master nel pool', false, function(val) {
      window.__pvu.rollController.togglePoolQuality(val);
    });
    rerollSection.appendChild(poolQualityRow);

    // Cost Override
    const costOverrideRow = createToggle('Nessun costo', 'WAIVE_ROLL_FEE_OVERRIDE — tutti i reroll gratis', false, function(val) {
      window.__pvu.rollController.toggleCostOverride(val);
    });
    rerollSection.appendChild(costOverrideRow);

    containerEl.appendChild(rerollSection);

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
    itemInfo.textContent = '3 base + bonus → es: +2 = 5 opzioni (default)';
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
    row._pvuSwitch = switchEl;
    return row;
  }

  function refreshUI() {
    if (!containerEl) return;
    const state = window.__pvu.rollController.getState();
    const statusEl = containerEl.querySelector('#pvu-roll-status');
    if (statusEl) {
      const hookStatus = state.hooksApplied ? '✓ Hooks attivi' : '⏳ In attesa hooks...';
      const freeRerollStatus = state.freeReroll ? ' | Free Reroll: ON' : '';
      const costStatus = state.costOverride ? ' | Cost Override: ON' : '';
      const poolStatus = state.poolQuality ? ' | Pool Quality: ON' : '';
      statusEl.textContent = hookStatus + freeRerollStatus + costStatus + poolStatus;
      statusEl.className = 'pvu-status ' + (state.hooksApplied ? 'ok' : 'warn');
    }

    // Aggiorna slider
    const slider = containerEl.querySelector('#pvu-item-slider');
    const valLabel = containerEl.querySelector('#pvu-item-val');
    if (slider && valLabel) {
      slider.value = state.itemCountExtra;
      valLabel.textContent = '+' + state.itemCountExtra;
    }
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
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
const PvuSkillScreen = (() => {
  const LOG_PREFIX = '[PvuSkillScreen]';
  let containerEl = null;
  let refreshTimer = null;

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

    // Champion selector
    const champLabel = document.createElement('div');
    champLabel.className = 'pvu-toggle-label';
    champLabel.textContent = 'Champion:';
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

    refreshTimer = setInterval(refreshUI, 3000);
    refreshUI();
  }

  function refreshUI() {
    if (!containerEl) return;
    const editor = window.__pvu.skillTreeEditor;
    const bridge = window.__pvu.bridge;

    // Aggiorna skill points
    const spInput = containerEl.querySelector('#pvu-sp-input');
    if (spInput) {
      const sp = editor.getSkillPoints();
      if (document.activeElement !== spInput) {
        spInput.value = sp;
      }
    }

    // Aggiorna champion selector
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
        info.textContent = 'Nessuna skill bloccata (o nessun champion selezionato)';
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
              setTimeout(function() { refreshUI(); }, 500);
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
      const locked = editor.getLockedSkills();
      statusEl.textContent = 'SP: ' + sp + ' | Champion: ' + (champId || 'nessuno') + ' | Bloccate: ' + locked.length;
      statusEl.className = 'pvu-status ok';
    }
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
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


// --- src/ui/panel.js ---
const PvuPanel = (() => {
  const LOG_PREFIX = '[PvuPanel]';
  let containerEl = null;
  let panelEl = null;
  let isOpen = false;
  let activeTab = 'roll';

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
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

    tabs.appendChild(tabMoney);
    tabs.appendChild(tabRoll);
    tabs.appendChild(tabSkill);
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

    // Pulisci contenuto
    content.innerHTML = '';

    switch (tabId) {
      case 'money':
        renderMoneyTab(content);
        break;
      case 'roll':
        window.__pvu.rollScreen.render(content);
        break;
      case 'skill':
        window.__pvu.skillScreen.render(content);
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
      btn.textContent = presets[i] >= 1000 ? (presets[i] / 1000) + 'K' : presets[i];
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
    setInterval(function() { updateMoneyStatus(statusEl, input); }, 2000);
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
  const pvu = window.__pvu || {};
  window.__pvu = pvu;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  log('Avvio PokeVoid-Unlocked v' + (pvu.config ? pvu.config.VERSION : '?') );

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

  // 6. Attendi che il gioco sia pronto e applica hooks
  let hookAttempts = 0;
  const hookInterval = setInterval(function() {
    hookAttempts++;

    const bridge = pvu.bridge;
    if (!bridge) return;

    // Prova a catturare battle scene
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
        warn('Alcuni roll hooks non applicati');
      }
    }

    // Hook phase methods
    if (pvu.phaseObserver) {
      pvu.phaseObserver.hookPhaseMethods();
    }

    clearInterval(hookInterval);
    log('Tutti gli hooks applicati');
  }, 1000);

  function createPanelAndUI() {
    if (panelCreated) return;
    panelCreated = true;

    log('Creazione UI...');

    // Crea panel
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
