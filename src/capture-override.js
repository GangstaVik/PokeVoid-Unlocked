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
// Strategia L2 (v1.4 Task 0): wrapper generico su CommandPhase.prototype.handleCommand.
//   1. Chiamo il gate nativo → lo nativo giudica se accetta o blocca.
//   2. Se accetta (return true + turnCommands assegnato) → passo through.
//   3. Se blocca + toggle ON + comando BALL + NON escluso → force inject.
//      NOTE v1.4:
//      - level2Verified NON è più nel gate (rimosso): l'inject gira al primo
//        tentativo; level2Verified resta solo come dato di report (confermato
//        SOLO su successo nativo di comando BALL = fallback 1, mai FIGHT/etc.).
//      - Esclusioni deterministiche fail-closed: rival (battleType===TRAINER &&
//        gameMode.checkIfRival(scene)), biome END, wave pre-final, multi-target
//        (nemici attivi != 1), boss-major (isBoss() && bossSegmentIndex>=1;
//        segmento non determinabile ⇒ escluso).
//      - L1 backstop live: pokeballCounts=99 re-armato ad OGNI CommandPhase push.
//
// Override probabilità (nuovo, v1.4): il roll di cattura usa t.randSeedInt(65536)
// chiamato sul POKEMON bersaglio (3 draw nel tween onRepeat di
// AttemptCapturePhase.start). A tentativo ARMATO sovrascriviamo randSeedInt
// dell'istanza pokemon con () => -1 → -1 < m per ogni m>=0 (m=0 incluso)
// ⇒ cattura garantita. Token-arm: armato nel force-inject (pokemon + turno),
// consumato allo start della AttemptCapturePhase (match per identità pokemon),
// restore del randSeedInt in failCatch/catch/end; i token pendenti vengono
// invalidati all'inizio del turno successivo (TurnInitPhase/TurnStartPhase).
// Limite noto: !species.isObtainable() && c!==-2 → failCatch prima del roll
// (non sovrascrivibile senza reimplementare start()).
//
// NOTA: bundle v3.1.8 con mangling OFF → nomi di classe preservati
// (TurnInitPhase/TurnStartPhase/AttemptCapturePhase); wrapper trasparente.
const PvuCaptureOverride = (() => {
  const LOG_PREFIX = '[PvuCaptureOverride]';
  const CAPTURE_PATCHED = Symbol.for('pvuCapturePatched');

  // ro.BALL = 1 verificato nel bundle v3.1.8.
  // Fallback usato prima che il wrapper abbia osservato un successo nativo.
  const BALL_CMD_ID_FALLBACK = 1;

  const state = {
    enabled: false,
    level: 0,                // 0 = off, 1 = L1 (grant balls), 2 = L2 (wrapper)
    level2Verified: false,   // v1.4: report only — BALL confermato su successo nativo
    commandProto: null,      // prototype di CommandPhase (scoperto a runtime)
    ballCommandId: null,     // ID del comando BALL nel Command enum (scoperto)
    injectedCount: 0,        // catture forzate con successo
    blockedCount: 0,         // tentativi bloccati (debug)
    errorCount: 0,           // errori del wrapper (auto-degrade >= 3)
    hooksApplied: false,     // wrapper installato su CommandPhase.prototype
    l1Applied: false,        // L1 applicato almeno una volta
    _discoveryRegistered: false, // discovery interceptor registrato
    // V1.4: override probabilità di cattura (token-arm)
    capturedCount: 0,        // catture realizzate (catch con override armato)
    rollOverrideReady: null, // tri-state: null=non determinato, true=wrappabile, false=NON attivo
    rollOverrideArmed: false,// transitorio: randSeedInt patched in questo istante
    captureTokens: [],       // [{ pokemon, turn, pokeballType, fieldIndex }] armati in force-inject (D3)
    _attemptRegistered: false,
    _turnBoundaryRegistered: false,
    _l1BackstopRegistered: false,
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

  // ─── V1.4: OVERRIDE PROBABILITÀ DI CATTURA (TOKEN-ARM) ────────────────
  // Enum bundle v3.1.8: Ua.BattleType.WILD=0, TRAINER=1; k.BiomeId.END=50.

  const BATTLE_TYPE_TRAINER = 1;
  const BIOME_END = 50;

  function removeTokenAt(idx) {
    if (idx >= 0 && idx < state.captureTokens.length) {
      state.captureTokens.splice(idx, 1);
    }
  }

  function clearCaptureTokens(reason) {
    if (!state.captureTokens.length) return;
    if (reason) log('Token cattura invalidati (' + reason + ')');
    state.captureTokens = [];
  }

  /**
   * Esclusioni deterministiche (fail-closed) per il force-inject.
   * Replica i gate deterministici del nativo (bundle v3.1.8, case ro.BALL):
   * rival, multi-target, biome END, wave pre-final,
   * leggendario/OP-form pre-wave-1000 e boss-major.
   * Non replicati: bypass casuale 1/10000 (Le(1e4,1)<=1) e il jolly
   * activeSkillTree.legendaryEncounterChanceBySpecies.
   * Ogni controllo che solleva eccezione ⇒ escluso (fail-closed): mai
   * force-catch su un eventuale rival/scripted/boss (C1+C2).
   * @returns {boolean} true = escludi (NON iniettare)
   */
  function isExcluded(scene) {
    try {
      var battle = scene.currentBattle;
      if (!battle) return true;

      // 1. rival/scripted: battleType===TRAINER && gameMode.checkIfRival(scene)
      //    C1 (fail-closed): checkIfRival che solleva ⇒ escluso (mai
      //    force-catch su un eventuale rival/scripted).
      var gMode = scene.gameMode;
      if (battle.battleType === BATTLE_TYPE_TRAINER && gMode &&
          typeof gMode.checkIfRival === 'function') {
        var rival = false;
        try {
          rival = gMode.checkIfRival(scene) === true;
        } catch (e) {
          return true;
        }
        if (rival) { log('Esclusione: rival (scripted)'); return true; }
      }

      // 2. multi-target: deve esserci esattamente 1 nemico attivo
      var enemies = (scene.getEnemyField ? (scene.getEnemyField() || []) : [])
        .filter(function (p) {
          return p && typeof p.isActive === 'function' && p.isActive(true);
        });
      if (enemies.length > 1) {
        log('Esclusione: multi-target (' + enemies.length + ' nemici attivi)');
        return true;
      }
      if (enemies.length < 1) {
        log('Esclusione: nessun nemico attivo');
        return true;
      }

      // 3. biome END
      var arena = scene.arena;
      if (arena && typeof arena.biomeType === 'number' && arena.biomeType === BIOME_END) {
        log('Esclusione: biome END');
        return true;
      }

      // 4. wave pre-final (C1: isWavePreFinal che solleva ⇒ escluso)
      if (gMode && typeof gMode.isWavePreFinal === 'function') {
        var preFinal = false;
        try {
          preFinal = gMode.isWavePreFinal(scene) === true;
        } catch (e) {
          return true;
        }
        if (preFinal) { log('Esclusione: wave pre-final'); return true; }
      }

      // 5. leggendario / OP-form pre-wave-1000 (gate nativo v3.1.8, COL
      //    16903330: T = currentBattle.waveIndex<=1000; branch leggendario =
      //    enemyField.some(active && species.isLegendSubOrMystical() && T);
      //    branch OP-form = enemyField.some(active && isOPForm()) && T).
      //    C2 (fail-closed): throw ⇒ escluso.
      try {
        var waveIdx = battle.waveIndex;
        if (typeof waveIdx === 'number' && waveIdx <= 1000) {
          var preThousand = enemies.some(function (p) {
            if (!p || !p.species) return false;
            if (typeof p.isOPForm === 'function' && p.isOPForm()) return true;
            if (typeof p.species.isLegendSubOrMystical === 'function' &&
                p.species.isLegendSubOrMystical()) return true;
            return false;
          });
          if (preThousand) {
            log('Esclusione: leggendario/OP-form pre-wave-1000 (wave=' + waveIdx + ')');
            return true;
          }
        }
      } catch (e) {
        return true;
      }

      // 6. boss-major segment >= 1 (fail-closed: segmento ignoto ⇒ escluso)
      var target = enemies[0];
      if (target && typeof target.isBoss === 'function' && target.isBoss()) {
        var seg = target.bossSegmentIndex;
        if (typeof seg !== 'number' || seg >= 1) {
          log('Esclusione: boss-major (segmentIndex=' + seg + ')');
          return true;
        }
      }

      return false;
    } catch (e) {
      warn('isExcluded fallito, fail-closed:', e);
      return true;
    }
  }

  /**
   * Arma l'override probabilità: sostituisce pokemon.randSeedInt con una
   * versione scoped che forza -1 SOLO per il draw di cattura (v===65536, il
   * t.randSeedInt(65536) del tween onRepeat di AttemptCapturePhase.start).
   * -1 < m per ogni m>=0 (m=0 incluso: -1 < 0 true), quindi il primo draw
   * passa sempre; ogni altro draw (range != 65536) passa al nativo. FIX 4.
   * Restore in disarmCapture. @returns {boolean} true se patchato
   */
  function armCapture(self, pokemon) {
    if (!pokemon || typeof pokemon.randSeedInt !== 'function') return false;
    if (!pokemon.__pvuRandPatched) {
      pokemon.__pvuOrigRandSeedInt = pokemon.randSeedInt;
      // FIX 4: scope del patch al solo draw di cattura (65536); ogni altro
      // draw passa al nativo. Niente più patch wholesale () => -1.
      pokemon.randSeedInt = function (v) {
        return v === 65536 ? -1 : pokemon.__pvuOrigRandSeedInt.apply(this, arguments);
      };
      pokemon.__pvuRandPatched = true;
    }
    self.__pvuPokemon = pokemon;
    self.__pvuArmed = true;
    state.rollOverrideArmed = true;
    return true;
  }

  /**
   * Disarma (idempotente): ripristina il randSeedInt originale sul pokemon.
   */
  function disarmCapture(self) {
    if (!self) return;
    var pokemon = self.__pvuPokemon;
    if (pokemon && pokemon.__pvuRandPatched && pokemon.__pvuOrigRandSeedInt) {
      pokemon.randSeedInt = pokemon.__pvuOrigRandSeedInt;
      delete pokemon.__pvuOrigRandSeedInt;
      delete pokemon.__pvuRandPatched;
    }
    self.__pvuPokemon = null;
    self.__pvuArmed = false;
    state.rollOverrideArmed = false;
  }

  /**
   * Cerca il token per la AttemptCapturePhase corrente.
   * Match primario: identità dell'oggetto pokemon (phase.getPokemon() ===
   * token.pokemon). Fallback (getPokemon non disponibile): pokeballType uguale
   * e stesso turno. D3: in entrambe le vie il fieldIndex della phase
   * (PokemonPhase: battlerIndex=ENEMY+slot → fieldIndex=slot 0/1) deve
   * combaciare col fieldIndex del token (fi del CommandPhase mittente): un
   * lancio dello stesso turno da un partner su campo diverso NON consuma.
   * Token stantio (turno cambiato) ⇒ rimosso.
   */
  function findTokenForPhase(phaseObj) {
    if (!state.captureTokens.length) return null;
    var pokemon = null;
    try {
      if (phaseObj && typeof phaseObj.getPokemon === 'function') {
        pokemon = phaseObj.getPokemon();
      }
    } catch (e) { /* phase non ancora iniziata */ }

    var battle = phaseObj && phaseObj.scene ? phaseObj.scene.currentBattle : null;
    var phaseFi = (phaseObj && typeof phaseObj.fieldIndex === 'number')
      ? phaseObj.fieldIndex : null;
    for (var i = state.captureTokens.length - 1; i >= 0; i--) {
      var tk = state.captureTokens[i];
      if (battle && typeof battle.turn === 'number' && typeof tk.turn === 'number' &&
          battle.turn !== tk.turn) {
        removeTokenAt(i); // stantio → token morto
        continue;
      }
      if (pokemon) {
        if (tk.pokemon === pokemon &&
            (phaseFi === null || tk.fieldIndex === phaseFi)) {
          tk.pokemon = pokemon;
          return tk;
        }
      } else if (tk.pokeballType !== undefined && tk.pokeballType === phaseObj.pokeballType) {
        if (phaseFi !== null && tk.fieldIndex === phaseFi) {
          return tk;
        }
      }
    }
    return null;
  }

  /**
   * Wrappa le funzioni per-istanza della AttemptCapturePhase:
   *  - start: trova il token → armCapture (patch randSeedInt PRIMA di orig)
   *  - catch: conta capturedCount se armato + restore (try/finally-semantics)
   *  - failCatch: restore
   *  - end: restore (idempotente)
   * Idempotente per istanza (__pvuCaptureWired).
   */
  function wireAttemptPhase(phaseObj) {
    if (!phaseObj || phaseObj.__pvuCaptureWired) return;
    if (typeof phaseObj.start !== 'function' ||
        typeof phaseObj.catch !== 'function' ||
        typeof phaseObj.failCatch !== 'function') {
      if (state.rollOverrideReady === null) {
        state.rollOverrideReady = false;
        warn('AttemptCapturePhase senza metodi wrappabili: override probabilità NON attivo');
      }
      return;
    }
    if (state.rollOverrideReady === null) {
      state.rollOverrideReady = true;
    }

    var origStart = phaseObj.start;
    phaseObj.start = function () {
      var self = this;
      try {
        var token = findTokenForPhase(self);
        if (token && token.pokemon) {
          if (armCapture(self, token.pokemon)) {
            removeTokenAt(state.captureTokens.indexOf(token));
            log('Override probabilità armato: cattura #' + state.injectedCount + ' (randSeedInt → -1)');
          }
        }
      } catch (e) {
        warn('start wrapper error:', e);
      }
      return origStart.apply(self, arguments);
    };

    var origCatch = phaseObj.catch;
    phaseObj.catch = function () {
      var self = this;
      try {
        if (self.__pvuArmed) {
          state.capturedCount++;
          log('Cattura realizzata (#' + state.capturedCount + ')');
        }
        disarmCapture(self);
      } catch (e) {
        warn('catch wrapper error:', e);
      }
      return origCatch.apply(self, arguments);
    };

    var origFail = phaseObj.failCatch;
    phaseObj.failCatch = function () {
      var self = this;
      try { disarmCapture(self); } catch (e) {}
      return origFail.apply(self, arguments);
    };

    if (typeof phaseObj.end === 'function') {
      var origEnd = phaseObj.end;
      phaseObj.end = function () {
        var self = this;
        try { disarmCapture(self); } catch (e) {}
        return origEnd.apply(self, arguments);
      };
    }

    phaseObj.__pvuCaptureWired = true;
    log('AttemptCapturePhase wrappata (override probabilità attivo)');
  }

  /**
   * Interceptor tentativi di cattura (push + unshift): aggancia la
   * AttemptCapturePhase appena creata.
   */
  function attemptInterceptor(phaseObj) {
    if (!state.enabled) return;
    if (!phaseObj || typeof phaseObj !== 'object' || !phaseObj.constructor) return;
    try {
      var name = phaseObj.constructor.name || '';
      if (name.indexOf('AttemptCapturePhase') === 0) {
        wireAttemptPhase(phaseObj);
      }
    } catch (e) {
      warn('attempt interceptor error:', e);
    }
  }

  /**
   * Interceptor confine di turno (push + unshift): invalida i token pendenti
   * quando inizia un nuovo turno (TurnInitPhase/TurnStartPhase).
   */
  function turnBoundaryInterceptor(phaseObj) {
    if (!state.captureTokens.length) return;
    if (!phaseObj || typeof phaseObj !== 'object' || !phaseObj.constructor) return;
    try {
      var name = phaseObj.constructor.name || '';
      if (name === 'TurnInitPhase' || name === 'TurnStartPhase') {
        clearCaptureTokens(name);
      }
    } catch (e) { /* ignore */ }
  }

  /**
   * L1 backstop live: ri-arma 99 pokeballs ad ogni CommandPhase push
   * (non solo al boot) — risolve il gate count=0 anche se scade in corsa.
   */
  function l1BackstopInterceptor(phaseObj) {
    if (!state.enabled) return;
    if (!phaseObj || typeof phaseObj !== 'object') return;
    try {
      if (typeof phaseObj.handleCommand !== 'function' ||
          typeof phaseObj.fieldIndex !== 'number') return;
      var scene = phaseObj.scene;
      if (!scene) {
        var bridge = window.__pvu.bridge;
        if (bridge && typeof bridge.getBattleScene === 'function') {
          scene = bridge.getBattleScene();
        }
      }
      applyLevel1(scene);
    } catch (e) { /* ignore */ }
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
      // FIX F: null-guard su turnCommands — senza turnCommands non c'è
      // nessun ramo successo da replicare; fail-safe silenzioso (niente
      // errorCount++, niente warn: non è un errore del wrapper).
      if (!turnCommands || !Array.isArray(turnCommands)) return false;

      var enemies = (scene.getEnemyField() || []).filter(function(p) {
        return p && typeof p.isActive === 'function' && p.isActive(true);
      });
      // V1.4: override solo bersaglio singolo (ridondante con isExcluded,
      // difesa in profondità contro race condition multi-target)
      if (enemies.length !== 1) {
        log('forceInject: nemici attivi =', enemies.length, '→ inject solo bersaglio singolo, skip');
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

      // V1.4: token-arm per l'override probabilità di cattura.
      // D3: il token porta il fieldIndex del CommandPhase mittente (fi):
      // il consumo (findTokenForPhase) richiede match di campo.
      var target = enemies[0];
      state.captureTokens.push({
        pokemon: target,
        turn: (scene.currentBattle && typeof scene.currentBattle.turn === 'number')
          ? scene.currentBattle.turn : 0,
        pokeballType: n,
        fieldIndex: fi
      });

      // V1.4: pre-grant economico per snatch trainer (la cattura forza la
      // deduzione di getRequiredMoneyForPokeBuy; rival esclusi qui perché
      // esclusi da isExcluded prima del force-inject)
      var battle = scene.currentBattle;
      if (battle && battle.battleType === BATTLE_TYPE_TRAINER) {
        var cost = (typeof scene.getRequiredMoneyForPokeBuy === 'function')
          ? scene.getRequiredMoneyForPokeBuy() : 0;
        var moneyOverride = window.__pvu.moneyOverride;
        if (typeof scene.money === 'number' && scene.money < cost &&
            moneyOverride && typeof moneyOverride.setMoney === 'function') {
          moneyOverride.setMoney(cost);
          log('Money pre-granted per trainer snatch:', cost);
        }
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

      // 2. Successo nativo → impara ballCommandId SOLO per comando BALL
      //    (fallback 1), mai per FIGHT/etc. — evita apprendimento avvelenato.
      if (result === true && turnCommands && turnCommandsAlreadyAssigned(turnCommands, fi)) {
        var tcCmd = turnCommands[fi].command;
        if (tcCmd === BALL_CMD_ID_FALLBACK && t === BALL_CMD_ID_FALLBACK) {
          if (state.ballCommandId === null) {
            state.ballCommandId = tcCmd;
            state.level2Verified = true; // report only (v1.4, NON è nel gate)
            log('ID BALL confermato nativamente: ballCommandId =', state.ballCommandId);
          }
        }
        return true;
      }

      // 3. Nativo è tornato true ma turnCommands non assegnato → anomal, passa
      if (result === true) return true;

      // 4. Bloccato → valuta force inject (level2Verified NON è più nel gate)
      var cmd = getBallCommandId();
      if (cmd === null || t !== cmd) return result;

      // Esclusioni deterministiche (rival/END/pre-final/multi-target/boss-major)
      if (isExcluded(scene)) {
        state.blockedCount++;
        log('Azione BALL bloccata dal nativo e DECLINATA per esclusione (#', state.blockedCount, ')');
        return result;
      }

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

    // V1.4: interceptor tentativi cattura (AttemptCapturePhase, push+unshift)
    if (!state._attemptRegistered && phaseObserver &&
        typeof phaseObserver.onPhasePush === 'function') {
      phaseObserver.onPhasePush(attemptInterceptor);
      phaseObserver.onPhaseUnshift(attemptInterceptor);
      state._attemptRegistered = true;
      log('Attempt-capture interceptor registrato');
    }

    // V1.4: interceptor confine di turno (invalida token pendenti)
    if (!state._turnBoundaryRegistered && phaseObserver &&
        typeof phaseObserver.onPhasePush === 'function') {
      phaseObserver.onPhasePush(turnBoundaryInterceptor);
      phaseObserver.onPhaseUnshift(turnBoundaryInterceptor);
      state._turnBoundaryRegistered = true;
      log('Turn-boundary interceptor registrato');
    }

    // V1.4: L1 backstop live (99 balls a ogni CommandPhase push)
    if (!state._l1BackstopRegistered && phaseObserver &&
        typeof phaseObserver.onPhasePush === 'function') {
      phaseObserver.onPhasePush(l1BackstopInterceptor);
      phaseObserver.onPhaseUnshift(l1BackstopInterceptor);
      state._l1BackstopRegistered = true;
      log('L1 backstop interceptor registrato');
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
      // V1.4
      capturedCount: state.capturedCount,
      rollOverrideReady: state.rollOverrideReady,
      rollOverrideArmed: state.rollOverrideArmed,
      rollOverrideWired: state._attemptRegistered,
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
    clearCaptureTokens('destroy');
    originalHandleCommand = null;
    state.hooksApplied = false;
    state.commandProto = null;
    state.level2Verified = false;
    state.ballCommandId = null;
    state.capturedCount = 0;
    state.rollOverrideReady = null;
    state.rollOverrideArmed = false;
    state._attemptRegistered = false;
    state._turnBoundaryRegistered = false;
    state._l1BackstopRegistered = false;
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
