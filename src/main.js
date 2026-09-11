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
