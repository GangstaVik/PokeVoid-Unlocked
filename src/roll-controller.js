// src/roll-controller.js — 2 toggle onesti + itemcount slider + luck lock
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
          log('Native getModifierTypeOptions sorgente catturata:', src.slice(0, 240) + ' ... ' + src.slice(-160));
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
            warn('getModifierTypeOptions probe fallita, nessun clamp applicato:', e);
            poolLength = null;
          }
        }
        let effectiveCount = requestedCount;
        if (state.itemCountExtra > 0 && requestedCount !== undefined) {
          effectiveCount = requestedCount + state.itemCountExtra;
          if (poolLength !== null && poolLength < requestedCount) {
            effectiveCount = Math.min(effectiveCount, poolLength);
            log('Clamp T1: pool saturo (sonda ' + poolLength + ' < nominale ' + requestedCount + ') => ' + effectiveCount + ' opzioni');
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
      log('getModifierTypeOptions patched su phase instance (itemcount + luck pool + clamp T1)');
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