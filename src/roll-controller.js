// src/roll-controller.js — 3 toggle onesti + itemcount slider
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
