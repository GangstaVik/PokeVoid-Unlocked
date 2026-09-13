// src/game-bridge.js — Accesso 3 livelli al gioco + cache + class resolution
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
