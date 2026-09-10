// src/phase-observer.js — Hook unshiftPhase/pushPhase + poll gameInfo
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
