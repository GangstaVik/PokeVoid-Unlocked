// src/money-override.js — Campo numerico + Apply per money
const PvuMoneyOverride = (() => {
  const LOG_PREFIX = '[PvuMoneyOverride]';
  const MAX = Number.MAX_SAFE_INTEGER;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * Imposta money nella run corrente + permaMoney persistente.
   * @param {number} amount - Nuovo importo
   * @returns {{ ok: boolean, error?: string, sceneMoney?: number, permaMoney?: number }}
   */
  function setMoney(amount) {
    try {
      // FIX v1.2.1 (corruzione BigInt): normalizza l'input.
      // Il gioco tratta permaMoney come number — mai bigint o stringa "123n".
      // BigInt(amount) qui causava freeze Ω in-sessione ((permaMoney||0)+d → BigInt+number)
      // e [LOAD ERROR] initSystem failed: Cannot convert a BigInt value to a number al riavvio.
      if (typeof amount === 'bigint' || typeof amount === 'string') {
        amount = Number(amount);
      }
      if (!Number.isFinite(amount)) {
        amount = 0;
      }
      amount = Math.max(0, Math.min(Math.floor(amount), MAX));
      const bridge = window.__pvu.bridge;
      const scene = bridge.getBattleScene();

      if (!scene) {
        return { ok: false, error: 'Battle scene unavailable' };
      }

      // scene.money (run corrente)
      scene.money = amount;
      log('scene.money set to', amount);

      // gameData.permaMoney (persistente)
      const gameData = bridge.findGameData();
      if (gameData) {
        // Difensivo: se permaMoney è già bigint/stringa "123n" (save corrotto in memoria),
        // normalizzalo prima che il gioco lo usi (Math.round/NaN-freeze).
        if (typeof gameData.permaMoney === 'bigint') {
          warn('permaMoney was BigInt (' + String(gameData.permaMoney) + ') → normalized to Number');
          gameData.permaMoney = Number(gameData.permaMoney);
        } else if (typeof gameData.permaMoney === 'string') {
          const m = /^(\d+)n?$/.exec(gameData.permaMoney.trim());
          if (m) {
            warn('permaMoney was string ("' + gameData.permaMoney + '") → normalized to Number');
            gameData.permaMoney = Number(m[1]);
          }
        }

        // FIX v1.2.1: era BigInt(amount) — corrompeva permaMoney (freeze Ω + load error).
        // Il gioco tratta permaMoney come number: assegniamo sempre Number.
        gameData.permaMoney = Number(amount);
        log('permaMoney set to', gameData.permaMoney);

        // Refresh UI — cerca updateMoneyText o updateGameInfo
        try {
          if (typeof scene.updateMoneyText === 'function') {
            scene.updateMoneyText();
          }
        } catch(e) {
          warn('updateMoneyText unavailable:', e);
        }

        try {
          if (typeof scene.updateGameInfo === 'function') {
            scene.updateGameInfo();
          }
        } catch(e) {
          // updateGameInfo potrebbe non essere disponibile fuori dalla fase giusta
        }

        // Trigger save
        triggerSave(gameData);

        return { ok: true, sceneMoney: amount, permaMoney: amount };
      } else {
        warn('gameData unavailable — money run-only');
        return { ok: true, sceneMoney: amount, error: 'gameData not found, run money updated only' };
      }
    } catch (e) {
      warn('setMoney failed:', e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * Leggi il money corrente.
   */
  function getMoney() {
    try {
      const bridge = window.__pvu.bridge;
      const scene = bridge.getBattleScene();
      if (scene && scene.money !== undefined) return Number(scene.money);

      const gameData = bridge.findGameData();
      if (gameData && gameData.permaMoney !== undefined) {
        // FIX v1.2.1: Number("123n") = NaN — gestisci stringa bigint-serializzata.
        const v = gameData.permaMoney;
        if (typeof v === 'bigint') return Number(v);
        if (typeof v === 'string') {
          const m = /^(\d+)n?$/.exec(v.trim());
          return m ? Number(m[1]) : Number(v);
        }
        return Number(v);
      }
    } catch(e) {}
    return 0;
  }

  /**
   * Trigger save tramite gameData.
   */
  function triggerSave(gameData) {
    try {
      if (gameData && typeof gameData.saveSystem === 'function') {
        gameData.saveSystem();
        log('saveSystem() invoked');
      }
    } catch(e) {
      warn('saveSystem failed:', e);
    }
  }

  /**
   * Apply da UI: prende il valore dal campo input e lo applica.
   */
  function applyFromInput(inputElement) {
    if (!inputElement) return { ok: false, error: 'Input element not found' };
    const val = parseInt(inputElement.value, 10);
    if (isNaN(val)) return { ok: false, error: 'Invalid value' };
    return setMoney(val);
  }

  return {
    setMoney: setMoney,
    getMoney: getMoney,
    applyFromInput: applyFromInput,
    triggerSave: triggerSave,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.moneyOverride = PvuMoneyOverride;
