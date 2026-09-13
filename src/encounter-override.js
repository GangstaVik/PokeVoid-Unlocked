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

  // Task 3 v1.4.0: specie già segnalate per variant-asset mancanti.
  // → un solo warn deduplicato per specie, mai spam.
  const warnedMissingVariantAssets = new Set();

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
          log('Pokemon prototype discovered:', state.pokemonClass);
          return proto;
        }
      }
    } catch (e) {
      warn('discoverPokemonProto failed:', e);
    }
    return null;
  }

  /**
   * Key sprite che il gioco userebbe per la variante EPIC (tier 2) — l'unica
   * variante che cambia la key texture (suffisso `_3`: in getSpriteId quando
   * `f[i] === 2` e in initShinySparkle come `_${this.variant + 1}`). Le
   * varianti 0/1 riusano la stessa key base + tint (getVariantTint).
   * @param {object} poke
   * @returns {string|null} Key animated attesa, o null se non calcolabile
   */
  function expectedVariantKey(poke) {
    try {
      if (typeof poke.getSpriteKey !== 'function') return null;
      const prev = poke.variant;
      poke.variant = 2; // EPIC — unica tier con key dedicata
      let key = null;
      try {
        key = poke.getSpriteKey(true);
      } finally {
        poke.variant = prev;
      }
      return key;
    } catch (e) {
      return null;
    }
  }

  /**
   * Probe asset per la variante EPIC (Task 3): verifica che i asset della
   * variante esistano PRIMA di chiamare generateVariant. Stessa semantica del
   * guard nativo del gioco (bundle v3.1.8, textures.exists per la sprite key).
   * 1. Sparkle EPIC globale (`shiny_3`) — presente solo se il build ha le
   *    varianti sparkle.
   * 2. Sprite di battaglia EPIC (`pkmn__<id>_3`) — se la key manca nel
   *    texture manager, la variante non può renderizzare.
   * @param {object} poke
   * @returns {boolean} true = asset presenti (o non verificabili → assume OK)
   */
  function variantAssetsExist(poke) {
    try {
      const scene = poke.scene;
      if (!scene || !scene.textures) return true; // non verificabile → assume presente
      if (!scene.textures.exists('shiny_3')) return false; // sparkle EPIC globale assente
      const key = expectedVariantKey(poke);
      if (key && !scene.textures.exists(key)) return false; // sprite EPIC mancante
      return true;
    } catch (e) {
      return true; // fail-safe: mai bloccare la shiny su errori imprevisti
    }
  }

  /**
   * Variant assente (asset non disponibili per questa specie) → skip silenzioso.
   * Variant forzata a 0: il costruttore Pokemon fa `variant === void 0` →
   * non ri-rolla generateVariant, quindi la shiny resta sulla texture base.
   * La sparkle è già stata inizializzata prima (base, variant 0).
   * @param {object} poke
   */
  function skipMissingVariant(poke) {
    poke.variant = 0;
    let name = 'unknown';
    try {
      name = (poke.species && poke.species.name) || poke.name || 'unknown';
    } catch (e) { /* name è solo per il log */ }
    if (!warnedMissingVariantAssets.has(name)) {
      warnedMissingVariantAssets.add(name);
      warn('Shiny variant assets unavailable for', name,
        '— variant skipped, keeping base sparkle and shiny texture');
    }
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
    // Task 3 v1.4.0: probe asset PRIMA di generateVariant. Se la sprite EPIC
    // (o la sparkle EPIC globale) non esiste nel texture manager, la variant
    // viene saltata → sparkle + texture shiny base restano (skip silenzioso,
    // 1 warn deduplicato per specie tramite warnedMissingVariantAssets).
    if (typeof poke.generateVariant === 'function') {
      try {
        if (!variantAssetsExist(poke)) {
          skipMissingVariant(poke);
          return undefined;
        }
        poke.generateVariant();
      } catch (e) { /* la variant è cosmetic */ }
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
        log('Pokemon prototype not yet available (retry)');
        return false;
      }

      const helpers = window.__pvu.helpers;
      if (!helpers || typeof helpers.hookPrototype !== 'function') {
        warn('helpers unavailable, cannot hook');
        return false;
      }

      // Guardia dedicata: se già wrappato da noi, skip (mai doppio wrap)
      if (proto.trySetShiny && proto.trySetShiny[ENCOUNTER_PATCHED]) {
        originalTrySetShiny = proto.trySetShiny.__pvuOriginal || proto.trySetShiny;
        state.hooksApplied = true;
        state.active = true;
        log('trySetShiny already hooked, skipping');
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
      log('trySetShiny hooked on Pokemon.prototype (class: ' + state.pokemonClass + ')');
      return true;
    } catch (e) {
      warn('hookTrySetShiny failed:', e);
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
        warn('Timeout: Pokemon prototype not found after 30s');
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
      warn('loadPersistedState failed:', e);
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
      log('Always Shiny active from previous settings');
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
          log('trySetShiny restored');
        }
      }
    } catch (e) {
      warn('destroy failed:', e);
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