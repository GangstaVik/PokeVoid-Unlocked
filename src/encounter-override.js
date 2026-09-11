// src/encounter-override.js — Always Shiny: hook su Pokemon.prototype.trySetShiny
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
          log('Pokemon prototype scoperto:', state.pokemonClass);
          return proto;
        }
      }
    } catch (e) {
      warn('discoverPokemonProto fallito:', e);
    }
    return null;
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
    if (typeof poke.generateVariant === 'function') {
      try { poke.generateVariant(); } catch (e) { /* la variant è cosmetic */ }
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
        log('Pokemon prototype non ancora disponibile (retry)');
        return false;
      }

      const helpers = window.__pvu.helpers;
      if (!helpers || typeof helpers.hookPrototype !== 'function') {
        warn('helpers non disponibile, impossibile hookare');
        return false;
      }

      // Guardia dedicata: se già wrappato da noi, skip (mai doppio wrap)
      if (proto.trySetShiny && proto.trySetShiny[ENCOUNTER_PATCHED]) {
        originalTrySetShiny = proto.trySetShiny.__pvuOriginal || proto.trySetShiny;
        state.hooksApplied = true;
        state.active = true;
        log('trySetShiny già hookato, skip');
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
      log('trySetShiny hookato su Pokemon.prototype (class: ' + state.pokemonClass + ')');
      return true;
    } catch (e) {
      warn('hookTrySetShiny fallito:', e);
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
        warn('Timeout: Pokemon prototype non trovato dopo 30s');
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
      warn('loadPersistedState fallito:', e);
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
      log('Always Shiny attivo da settings precedente');
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
          log('trySetShiny ripristinato');
        }
      }
    } catch (e) {
      warn('destroy fallito:', e);
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