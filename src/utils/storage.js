// src/utils/storage.js — Backup, validazione, scrittura save
const PvuStorage = (() => {
  const LOG_PREFIX = '[PvuStorage]';

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function error() {
    console.error.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * Crea backup dello save corrente prima di ogni modifica.
   * @returns {{ ok: boolean, key?: string, error?: string }}
   */
  function createBackup(username) {
    try {
      const key = 'data_' + username;
      const data = localStorage.getItem(key);
      if (!data) {
        warn('Nessun save da backupare per utente:', username);
        return { ok: true }; // nothing to backup
      }
      const ts = Date.now();
      const backupKey = 'data_pvu_backup_' + ts + '_' + username;
      localStorage.setItem(backupKey, data);
      log('Backup creato:', backupKey, '(' + data.length + ' bytes)');
      return { ok: true, key: backupKey };
    } catch (e) {
      error('Backup fallito:', e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * Validazione post-write: rilegge il save, confronta col valore scritto.
   * Se mismatch → rollback al backup + notifica.
   * @param {string} username
   * @param {string} expectedValue - Il valore che abbiamo scritto
   * @param {string} backupKey - La key del backup (da rollbackare in caso di errore)
   * @returns {{ ok: boolean, mismatch?: boolean, error?: string }}
   */
  function validatePostWrite(username, expectedValue, backupKey) {
    try {
      const key = 'data_' + username;
      const actual = localStorage.getItem(key);
      if (actual !== expectedValue) {
        warn('MISMATCH post-write! Prendo rollback da backup:', backupKey);
        if (backupKey) {
          const backupData = localStorage.getItem(backupKey);
          if (backupData) {
            localStorage.setItem(key, backupData);
            log('Rollback completato da:', backupKey);
          } else {
            error('Backup non trovato:', backupKey);
          }
        }
        return { ok: false, mismatch: true };
      }
      log('Validazione post-write OK');
      return { ok: true };
    } catch (e) {
      error('Validazione fallita:', e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * Scrivi save con protocollo completo: backup → write → validate → log.
   * @param {string} username
   * @param {object} saveObject - L'oggetto save da serializzare
   * @returns {{ ok: boolean, error?: string }}
   */
  function writeSave(username, saveObject) {
    try {
      // 1. backup
      const backup = createBackup(username);
      if (!backup.ok) {
        return { ok: false, error: 'Backup failed: ' + backup.error };
      }

      // 2. serializza (bigint → string)
      const serialized = serializeBigInt(saveObject);
      const jsonStr = JSON.stringify(serialized);

      // 3. scrivi
      const key = 'data_' + username;
      localStorage.setItem(key, jsonStr);
      log('Save scritto:', key, '(' + jsonStr.length + ' bytes)');

      // 4. valida
      const validation = validatePostWrite(username, jsonStr, backup.key);
      if (!validation.ok) {
        return { ok: false, error: 'Validation failed: mismatch=' + validation.mismatch };
      }

      return { ok: true };
    } catch (e) {
      error('writeSave fallito:', e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * Leggi il save corrente.
   * @param {string} username
   * @returns {object|null}
   */
  function readSave(username) {
    try {
      const key = 'data_' + username;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      error('readSave fallito:', e);
      return null;
    }
  }

  /**
   * Serializza oggetto convertendo bigint → string (come il gioco).
   */
  function serializeBigInt(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (Array.isArray(obj)) return obj.map(serializeBigInt);
    if (typeof obj === 'object') {
      const result = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = serializeBigInt(obj[key]);
        }
      }
      return result;
    }
    return obj;
  }

  /**
   * Get username corrente dal localStorage o fallback a 'guest'.
   */
  function getUsername() {
    try {
      // Il gioco salva il campo "username" nel localStorage
      const userInfo = localStorage.getItem('userInfo');
      if (userInfo) {
        const parsed = JSON.parse(userInfo);
        if (parsed && parsed.username) return parsed.username;
      }
      // fallback: cerca chiavi "data_*" per dedurre lo username
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('data_') && !k.startsWith('data_pvu_backup') && !k.startsWith('data_backup')) {
          return k.substring(5); // "data_" + username
        }
      }
    } catch (e) { /* ignore */ }
    return 'guest';
  }

  return {
    createBackup: createBackup,
    validatePostWrite: validatePostWrite,
    writeSave: writeSave,
    readSave: readSave,
    serializeBigInt: serializeBigInt,
    getUsername: getUsername,
    log: log,
    warn: warn,
    error: error,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.storage = PvuStorage;
