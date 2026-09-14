// src/voucher-editor.js — Voucher editor module
const PvuVoucherEditor = (() => {
  const LOG_PREFIX = '[PvuVoucherEditor]';
  const TYPES = [0, 1, 2, 3];
  const LABELS = ['REGULAR', 'PLUS', 'PREMIUM', 'GOLDEN'];

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function getGameData() {
    const bridge = window.__pvu.bridge;
    if (bridge) return bridge.findGameData();
    return null;
  }

  function getVoucherCounts() {
    try {
      const gd = getGameData();
      if (!gd) return null;
      if (!gd.voucherCounts || typeof gd.voucherCounts !== 'object') {
        gd.voucherCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
      }
      return {
        REGULAR: gd.voucherCounts[0] || 0,
        PLUS: gd.voucherCounts[1] || 0,
        PREMIUM: gd.voucherCounts[2] || 0,
        GOLDEN: gd.voucherCounts[3] || 0,
      };
    } catch (e) {
      log('getVoucherCounts error:', e);
      return null;
    }
  }

  function setVoucherCount(typeIndex, value) {
    try {
      if (typeIndex < 0 || typeIndex > 3) {
        return { ok: false, code: 'invalid_type' };
      }
      const numVal = Math.max(0, Math.floor(Number(value)));
      if (isNaN(numVal)) {
        return { ok: false, code: 'invalid_value' };
      }
      const gd = getGameData();
      if (!gd) {
        return { ok: false, code: 'no_game_data' };
      }
      if (!gd.voucherCounts || typeof gd.voucherCounts !== 'object') {
        gd.voucherCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
      }
      gd.voucherCounts[typeIndex] = numVal;
      log('setVoucherCount:', LABELS[typeIndex], '=', numVal);
      return { ok: true };
    } catch (e) {
      log('setVoucherCount error:', e);
      return { ok: false, code: 'internal', error: e.message };
    }
  }

  function setAllVoucherCounts(countsObj) {
    try {
      const gd = getGameData();
      if (!gd) {
        return { ok: false, code: 'no_game_data' };
      }
      if (!gd.voucherCounts || typeof gd.voucherCounts !== 'object') {
        gd.voucherCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
      }
      if (countsObj.REGULAR !== undefined) {
        const v = Math.max(0, Math.floor(Number(countsObj.REGULAR)));
        if (!isNaN(v)) gd.voucherCounts[0] = v;
      }
      if (countsObj.PLUS !== undefined) {
        const v = Math.max(0, Math.floor(Number(countsObj.PLUS)));
        if (!isNaN(v)) gd.voucherCounts[1] = v;
      }
      if (countsObj.PREMIUM !== undefined) {
        const v = Math.max(0, Math.floor(Number(countsObj.PREMIUM)));
        if (!isNaN(v)) gd.voucherCounts[2] = v;
      }
      if (countsObj.GOLDEN !== undefined) {
        const v = Math.max(0, Math.floor(Number(countsObj.GOLDEN)));
        if (!isNaN(v)) gd.voucherCounts[3] = v;
      }
      log('setAllVoucherCounts:', JSON.stringify(countsObj));
      return { ok: true };
    } catch (e) {
      log('setAllVoucherCounts error:', e);
      return { ok: false, code: 'internal', error: e.message };
    }
  }

  return {
    TYPES: TYPES,
    LABELS: LABELS,
    getVoucherCounts: getVoucherCounts,
    setVoucherCount: setVoucherCount,
    setAllVoucherCounts: setAllVoucherCounts,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.voucherEditor = PvuVoucherEditor;
