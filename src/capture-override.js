// src/capture-override.js — Catch Any Pokemon (L2 wrapper + L1 fallback)
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
