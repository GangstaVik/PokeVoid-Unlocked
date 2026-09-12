// src/main.js — Bootstrap: hook Phaser.Game, init moduli, monta UI
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
