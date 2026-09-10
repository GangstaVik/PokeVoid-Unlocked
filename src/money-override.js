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
      amount = Math.max(0, Math.min(Math.floor(amount), MAX));
      const bridge = window.__pvu.bridge;
      const scene = bridge.getBattleScene();

      if (!scene) {
        return { ok: false, error: 'Battle scene non disponibile' };
      }

      // scene.money (run corrente)
      scene.money = amount;
      log('scene.money impostato a', amount);

      // gameData.permaMoney (persistente)
      const gameData = bridge.findGameData();
      if (gameData) {
        gameData.permaMoney = BigInt(amount);
        log('permaMoney impostato a', amount);

        // Refresh UI — cerca updateMoneyText o updateGameInfo
        try {
          if (typeof scene.updateMoneyText === 'function') {
            scene.updateMoneyText();
          }
        } catch(e) {
          warn('updateMoneyText non disponibile:', e);
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
        warn('gameData non disponibile — money solo in run');
        return { ok: true, sceneMoney: amount, error: 'gameData non trovato, solo run money aggiornato' };
      }
    } catch (e) {
      warn('setMoney fallito:', e);
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
      if (gameData && gameData.permaMoney !== undefined) return Number(gameData.permaMoney);
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
        log('saveSystem() invocato');
      }
    } catch(e) {
      warn('saveSystem fallito:', e);
    }
  }

  /**
   * Apply da UI: prende il valore dal campo input e lo applica.
   */
  function applyFromInput(inputElement) {
    if (!inputElement) return { ok: false, error: 'Input element not found' };
    const val = parseInt(inputElement.value, 10);
    if (isNaN(val)) return { ok: false, error: 'Valore non valido' };
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
