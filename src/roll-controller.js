// src/roll-controller.js — 3 toggle onesti + itemcount slider
// FIX BUG 2: getRerollCost is on SelectModifierPhase (su), NOT on the scene.
// Strategy: intercept phases as they enter the scene via pushPhase/unshiftPhase,
// then patch the phase instance directly.
const PvuRollController = (() => {
  const LOG_PREFIX = '[PvuRollController]';

  // Stato toggle
  const state = {
    freeReroll: false,
    costOverride: false,
    poolQuality: false,
    itemCountExtra: 2,
    active: false,
    hooksApplied: false,
    patchedPhaseCount: 0,   // quante phase sono state patchate
    lastPatchedPhase: null, // tipo dell'ultima phase patchata
  };

  // Hook refs per unpatch
  const unpatchFns = [];

  // Original functions for delegation (set when patching)
  const originals = {
    getRerollCost: null,
    getPlayerModifierTypeOptions: null,
    getRaritiesForRewardType: null,
    updateMoneyText: null,
  };

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * Patch una phase instance con i nostri hook.
   * Chiamata dal phase observer interceptor quando una fase viene pushata/unshiftata.
   * @param {object} phaseObj - L'istanza della fase
   */
  function patchPhase(phaseObj) {
    if (!phaseObj) return;
    const helpers = window.__pvu.helpers;
    if (!helpers) return;

    let patched = false;

    // --- getRerollCost: è un method di SelectModifierPhase (su) ---
    if (typeof phaseObj.getRerollCost === 'function' && !phaseObj._pvu_rerollHooked) {
      originals.getRerollCost = phaseObj.getRerollCost.bind(phaseObj);
      const orig = phaseObj.getRerollCost;
      phaseObj.getRerollCost = function() {
        const args = Array.from(arguments);
        try {
          // Cost Override: WAIVE_ROLL_FEE_OVERRIDE nativo
          if (state.costOverride) {
            log('Cost Override attivo → ritorno {rerollCost:0, permaRerollCost:0}');
            return { rerollCost: 0, permaRerollCost: 0 };
          }
          // Free Reroll: costo 0 una volta, poi auto-off
          if (state.freeReroll) {
            log('Free Reroll attivo → ritorno {rerollCost:0, permaRerollCost:0}');
            state.freeReroll = false;
            emitStateChange();
            return { rerollCost: 0, permaRerollCost: 0 };
          }
          // Chiamata normale
          return orig.apply(phaseObj, args);
        } catch (e) {
          warn('hook getRerollCost error:', e);
          return orig.apply(phaseObj, args);
        }
      };
      phaseObj._pvu_rerollHooked = true;
      patched = true;
      log('getRerollCost patched su phase instance');
    }

    // --- getModifierTypeOptions / getPlayerModifierTypeOptions ---
    // Nel bundle: getPlayerModifierTypeOptions è una function Wd chiamata come Wd.call(scene, count)
    // La scene ha un metodo che delega. Cerchiamo un metodo sul scene che chiama Wd.
    // Alternativa: hook direttamente sulla battle scene il metodo che genera le opzioni.
    // Cerchiamo sulla scene prototype (dalla battle scene) il metodo che può essere getModifierTypeOptions.

    const bridge = window.__pvu.bridge;
    const scene = bridge ? bridge.getBattleScene() : null;
    if (scene) {
      // Hook getModifierTypeOptions sulla scene prototype (se presente)
      if (!state._sceneOptionsHooked) {
        const sceneProto = Object.getPrototypeOf(scene);
        if (sceneProto) {
          // Cerca il metodo che genera le opzioni del modifier
          // Nel bundle: la scene chiama Wd(getModifierTypeOptions) che è il metodo che produce le opzioni
          // Il metodo è sulla SelectModifierPhase.prototype / scene.prototype
          const candidates = ['getModifierTypeOptions', 'getNewModifierTypeOption', 'getPlayerModifierTypeOptions'];
          for (let ci = 0; ci < candidates.length; ci++) {
            const cand = candidates[ci];
            if (typeof sceneProto[cand] === 'function' && !state['_hooked_' + cand]) {
              originals.getPlayerModifierTypeOptions = sceneProto[cand].bind(scene);
              const r = helpers.hookPrototype(sceneProto, cand, function(original, args) {
                if (state.itemCountExtra > 0 && args.length > 0 && typeof args[0] === 'number') {
                  const origCount = args[0];
                  args[0] = origCount + state.itemCountExtra;
                  log('Itemcount: ' + origCount + ' → ' + args[0] + ' (extra: +' + state.itemCountExtra + ')');
                }
                return original.apply(this, args);
              });
              unpatchFns.push(r.unpatch);
              state['_hooked_' + cand] = true;
              state._sceneOptionsHooked = true;
              patched = true;
              log(cand + ' hooked su scene prototype');
              break;
            }
          }
        }

        // FALLBACK: se non troviamo il metodo per nome, cerchiamo per ARITY + comportamento
        if (!state._sceneOptionsHooked && scene) {
          // Cerca un metodo che: accetta 1 arg numerico e ritorna array di oggetti
          // Questo è il pattern di getModifierTypeOptions / getPlayerModifierTypeOptions
          const sceneProto = Object.getPrototypeOf(scene);
          if (sceneProto) {
            const methodNames = Object.getOwnPropertyNames(sceneProto);
            for (let mi = 0; mi < methodNames.length; mi++) {
              const mname = methodNames[mi];
              if (mname === 'constructor' || mname.indexOf('_pvu') === 0) continue;
              if (state['_arityChecked_' + mname]) continue;

              try {
                const fn = sceneProto[mname];
                if (typeof fn !== 'function') continue;
                // Test arity: should accept at least 1 parameter
                if (fn.length < 1 || fn.length > 3) continue;

                // Check if return looks like it could be options (heuristic via toString)
                const src = fn.toString();
                // getModifierTypeOptions usually contains "WeightedModifierType" or "getRaritiesForRewardType"
                if (src.indexOf('RaritiesForReward') !== -1 ||
                    src.indexOf('ModifierType') !== -1 ||
                    src.indexOf('WeightedModifier') !== -1) {
                  originals.getPlayerModifierTypeOptions = fn.bind(scene);
                  const r = helpers.hookPrototype(sceneProto, mname, function(original, args) {
                    if (state.itemCountExtra > 0 && args.length > 0 && typeof args[0] === 'number') {
                      args[0] = args[0] + state.itemCountExtra;
                      log('Itemcount via arity-matched ' + mname + ': +' + state.itemCountExtra);
                    }
                    return original.apply(this, args);
                  });
                  unpatchFns.push(r.unpatch);
                  state._sceneOptionsHooked = true;
                  patched = true;
                  log(mname + ' hooked via arity+source-match (Itemcount)');
                  break;
                }
              } catch(e) { /* skip */ }
              state['_arityChecked_' + mname] = true;
            }
          }
        }
      }
    }

    // --- getRaritiesForRewardType ---
    // È una funzione standalone bne, chiamata dal context del gioco.
    // La troviamo cercando tra i prototype methods della scene o della phase.
    if (!state._raritiesHooked) {
      const sceneProto = scene ? Object.getPrototypeOf(scene) : null;
      const candidates2 = ['getRaritiesForRewardType', 'getRaritiesForReward'];
      if (sceneProto) {
        for (let ri = 0; ri < candidates2.length; ri++) {
          const rcand = candidates2[ri];
          if (typeof sceneProto[rcand] === 'function') {
            originals.getRaritiesForRewardType = sceneProto[rcand].bind(scene);
            const r = helpers.hookPrototype(sceneProto, rcand, function(original, args) {
              if (state.poolQuality) {
                const result = original.apply(this, args);
                if (Array.isArray(result)) {
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
            state._raritiesHooked = true;
            patched = true;
            log(rcand + ' hooked');
            break;
          }
        }
      }

      // Fallback: cerca per arity+source
      if (!state._raritiesHooked && sceneProto) {
        const methodNames = Object.getOwnPropertyNames(sceneProto);
        for (let mi = 0; mi < methodNames.length; mi++) {
          const mname = methodNames[mi];
          if (mname === 'constructor' || mname.indexOf('_pvu') === 0 || state['_raritiesArity_' + mname]) continue;
          try {
            const fn = sceneProto[mname];
            if (typeof fn !== 'function' || fn.length > 2) continue;
            const src = fn.toString();
            if (src.indexOf('RARITIES') !== -1 || src.indexOf('rarity') !== -1 || src.indexOf('ROGUE') !== -1) {
              originals.getRaritiesForRewardType = fn.bind(scene);
              const r = helpers.hookPrototype(sceneProto, mname, function(original, args) {
                if (state.poolQuality) {
                  const result = original.apply(this, args);
                  if (Array.isArray(result)) {
                    if (result.indexOf(0) === -1 && result.indexOf(1) === -1 && result.indexOf(2) === -1) {
                      result.unshift(2);
                      log('Pool quality: forzato Legendary via arity-matched ' + mname);
                    }
                  }
                  return result;
                }
                return original.apply(this, args);
              });
              unpatchFns.push(r.unpatch);
              state._raritiesHooked = true;
              patched = true;
              log(mname + ' hooked via arity+source-match (Rarities)');
              break;
            }
          } catch(e) { /* skip */ }
          state['_raritiesArity_' + mname] = true;
        }
      }
    }

    if (patched) {
      state.patchedPhaseCount++;
      state.lastPatchedPhase = phaseObj.constructor ? phaseObj.constructor.name : 'unknown';
    }
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
   * Register phase interceptors con il phase observer.
   * Chiamato da init().
   */
  function registerPhaseInterceptors() {
    const observer = window.__pvu.phaseObserver;
    if (!observer) {
      warn('phaseObserver non disponibile');
      return;
    }

    // Patch phase instances quando vengono pushate o unshiftate
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

    // Consideriamo "applied" se almeno getRerollCost è stato patchato
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

    // Registra interceptor per le fasi future
    registerPhaseInterceptors();

    // Prova anche a patchare la phase corrente se esiste già nella coda
    // (nel caso il bottone roll venga premuto prima che il nostro hook catturi la fase)
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

      // Cerca phases attive nella coda della scena
      const sceneManager = game.scene;
      const scenes = sceneManager.scenes;
      if (!scenes) return;

      for (const key in scenes) {
        const s = scenes[key];
        if (!s || !s.scene || !s.scene._phases) continue;
        const phases = s.scene._phases;
        for (let i = 0; i < phases.length; i++) {
          const p = phases[i];
          if (p && typeof p.getRerollCost === 'function' && !p._pvu_rerollHooked) {
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

  function toggleFreeReroll() {
    state.freeReroll = true;
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
    originals.getPlayerModifierTypeOptions = null;
    originals.getRaritiesForRewardType = null;
    originals.updateMoneyText = null;
    state.hooksApplied = false;
    state.active = false;
    state.patchedPhaseCount = 0;
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
