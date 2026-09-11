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
   * Recursive: normalizza ogni `permaMoney` corrotto dentro un oggetto save.
   * Il gioco salva permaMoney come number; un BigInt (o la stringa "123n" prodotta
   * dalla serializzazione usercamp) rompe al load (`[... initSystem failed:
   * Cannot convert a BigInt value to a number`).
   * @param {object} obj - nodo corrente (oggetto o array)
   * @returns {boolean} true se qualcosa è stato modificato
   */
  function sanitizePermaMoney(obj) {
    let changed = false;
    if (obj === null || typeof obj !== 'object') return false;

    // Primo livello: proprietà "permaMoney" (propria del nodo).
    if (Object.prototype.hasOwnProperty.call(obj, 'permaMoney')) {
      const v = obj.permaMoney;
      if (typeof v === 'string') {
        const m = /^(\d+)n?$/.exec(v.trim());
        if (m) {
          obj.permaMoney = Number(m[1]);
          changed = true;
        }
      } else if (typeof v === 'bigint') {
        obj.permaMoney = Number(v);
        changed = true;
      }
    }

    // Livello successivo: array e oggetti annidati (walk ricorsiva).
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (obj[i] !== null && typeof obj[i] === 'object') {
          if (sanitizePermaMoney(obj[i])) changed = true;
        }
      }
    } else {
      for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const v = obj[key];
        if (v !== null && typeof v === 'object') {
          if (sanitizePermaMoney(v)) changed = true;
        }
      }
    }
    return changed;
  }

  /**
   * Sanitizzazione allo start: scansiona TUTTI i save `data_*` nel localStorage e
   * corregge ogni permaMoney corrotto (stringa "123n" / BigInt) → number.
   *
   * - Solo chiavi con prefisso `data_` (i save del gioco), esclusi i nostri backup
   *   (`data_pvu_backup_*`) e i backup legacy (`data_backup*`).
   * - NON tocca `settings`, `sessionData*`, `runHistoryData_*` → verificabili il gioco.
   * - Idempotente: nessun write se non c'è nulla da correggere. Pattern createBackup
   *   + validatePostWrite su ogni chiave modificata (rollback su mismatch).
   * @returns {{ ok: boolean, fixed: number, error?: string }}
   */
  function sanitizeSavedData() {
    try {
      let fixed = 0;
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (!k.startsWith('data_')) continue;
        if (k.startsWith('data_pvu_') || k.startsWith('data_backup')) continue;
        keys.push(k);
      }

      for (let ki = 0; ki < keys.length; ki++) {
        const key = keys[ki];
        const raw = localStorage.getItem(key);
        if (!raw) continue;

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          // Save non-JSON: lascialo stare (il gioco lo gestirà).
          continue;
        }
        if (parsed === null || typeof parsed !== 'object') continue;

        if (sanitizePermaMoney(parsed)) {
          const jsonStr = JSON.stringify(parsed);

          // Usa protocollo standard: backup → write → validate
          const username = key.substring(5);
          const backup = createBackup(username);
          if (!backup.ok) {
            warn('Backup fallito durante sanitize, chiave saltata:', key, backup.error);
            continue;
          }

          try {
            localStorage.setItem(key, jsonStr);
            const validation = validatePostWrite(username, jsonStr, backup.key);
            if (!validation.ok) {
              error('Validazione sanitize fallita per', key, '— rollback applicato');
              continue;
            }
            fixed++;
            log('Sanitizzato', key, '(permaMoney corretto)' + (backup.key ? ' | backup: ' + backup.key : ''));
          } catch (e) {
            error('Write sanitize fallito per', key, e);
            // rollback manuale se validatePostWrite non ha potuto agire
            try {
              const bk = localStorage.getItem(backup.key);
              if (bk) localStorage.setItem(key, bk);
            } catch (e2) { /* ignore */ }
          }
        }
      }

      if (fixed > 0) {
        log('Sanitizzazione completata:', fixed, 'chiavi corrette');
      }
      return { ok: true, fixed: fixed };
    } catch (e) {
      error('sanitizeSavedData fallito:', e);
      return { ok: false, fixed: 0, error: e.message || String(e) };
    }
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

  // --- Settings utente (toggle shiny / capture) ---
  // Chiave localStorage separata dai save di gioco: mai toccata da sanitizeSavedData
  // (che scansiona solo prefissi data_, ed esclude data_pvu_/data_backup).
  const SETTINGS_KEY = '__pvu_settings';

  // Default settings. `v` = versione schema (forward-compat: il merge in
  // getSettings aggiunge i campi mancanti ai save scritti con schemi vecchi).
  const DEFAULT_SETTINGS = { v: 1, shiny: false, capture: false };

  /**
   * Legge settings con fallback ai default.
   * - JSON corrotto o assente → default (mai crash).
   * - Merge con default per campi mancanti (forward-compat).
   * @returns {{ v: number, shiny: boolean, capture: boolean }}
   */
  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      // Merge con default per campi mancanti (forward-compat)
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Scrive settings (read-modify-write per preservare campi futuri).
   * - Patch parziale: ogni chiave passata viene mergiata sullo stato corrente.
   * - `v` forzato allo schema corrente (mai retrocesso da patch malevole).
   * - Silenzioso su errore (localStorage pieno/privato): il gioco non deve
   *   crashare per colpa dei nostri toggle.
   * @param {object} patch - Campi da aggiornare (es. { shiny: true })
   */
  function setSettings(patch) {
    try {
      const current = getSettings();
      const merged = { ...current, ...patch, v: DEFAULT_SETTINGS.v };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    } catch (e) {
      // silenzioso
    }
  }

  return {
    createBackup: createBackup,
    validatePostWrite: validatePostWrite,
    writeSave: writeSave,
    readSave: readSave,
    serializeBigInt: serializeBigInt,
    sanitizeSavedData: sanitizeSavedData,
    getUsername: getUsername,
    getSettings: getSettings,
    setSettings: setSettings,
    log: log,
    warn: warn,
    error: error,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.storage = PvuStorage;
