// src/utils/helpers.js — AOB lookup, string search, debounce
const PvuHelpers = (() => {
  const LOG_PREFIX = '[PvuHelpers]';

  /**
   * Cerca un AOB (hex string) nel bundle.
   * L'utente fornisce hex bytes (es: "73 75 3D 63 6C 61 73 73") → convertiti a stringa → indexOf nel bundle.
   * @param {string} hexPattern - Pattern hex separato da spazi
   * @param {string} bundleSource - Contenuto del bundle (opzionale, cercato in window se non fornito)
   * @returns {boolean}
   */
  function aobScan(hexPattern, bundleSource) {
    try {
      const bytes = hexPattern.trim().split(/\s+/).map(h => String.fromCharCode(parseInt(h, 16)));
      const needle = bytes.join('');
      const source = bundleSource || window.__pvu._bundleSource || '';
      if (!source) return false;
      const idx = source.indexOf(needle);
      if (idx === -1) return false;
      window.__pvu._aobHits = window.__pvu._aobHits || {};
      window.__pvu._aobHits[hexPattern.substring(0, 40)] = idx;
      return true;
    } catch (e) {
      console.warn(LOG_PREFIX, 'AOB parse error:', e);
      return false;
    }
  }

  /**
   * Cerca un pattern testuale nel bundle tramite eval indiretto (scrittura script → exec).
   * NOTA: il bundle è un'unica linea → busca direttamente la stringa.
   * @param {string} pattern - Stringa da cercare (es: "getRerollCost")
   * @param {string} contextRange - Byte di contesto attorno al match (default 80)
   * @returns {{ found: boolean, context?: string }}
   */
  function findStringInBundle(pattern, contextRange) {
    contextRange = contextRange || 80;
    try {
      const source = window.__pvu._bundleSource || '';
      if (!source) return { found: false };
      const idx = source.indexOf(pattern);
      if (idx === -1) return { found: false };
      const start = Math.max(0, idx - 30);
      const end = Math.min(source.length, idx + pattern.length + contextRange);
      const context = source.substring(start, end);
      return { found: true, context: context };
    } catch (e) {
      console.warn(LOG_PREFIX, 'string search error:', e);
      return { found: false };
    }
  }

  /**
   * Trova il riferimento a una funzioneprototype cercando il pattern keepNames: u(Ref, "name")
   * @param {string} functionName - Nome della funzione (es: "getRerollCost")
   * @returns {{ ref?: any, found: boolean }}
   */
  function findFunctionRef(functionName) {
    try {
      const result = findStringInBundle('"' + functionName + '"');
      if (!result.found) return { found: false };
      // Cerca il pattern u(Ref, "name") — il ref è il parametro prima della stringa
      const pattern = functionName + '"';
      const source = window.__pvu._bundleSource || '';
      // Cerca "functionName"" (con virgolette) nel contesto della keepNames call
      // Pattern: u(VARIABLE, "functionName") — il nome è dopo u(...,
      // Usiamo exec su regex per estrarre il riferimento
      const regex = new RegExp('u\\((\\w+),"\\' + functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\)', 'g');
      const match = regex.exec(source);
      if (match) {
        // match[1] è il nome della variabile locale — non è direttamente accessibile
        // Serve hooking tramite il prototype
        return { found: true, varName: match[1] };
      }
      return { found: result.found };
    } catch (e) {
      console.warn(LOG_PREFIX, 'findFunctionRef error:', e);
      return { found: false };
    }
  }

  /**
   * Hook una funzione su un prototype, wrappando la funzione esistente.
   * @param {Function} Proto - Il prototype target
   * @param {string} methodName - Nome metodo
   * @param {Function} interceptor - (original, ...args) => result — puoi modificare args o return
   * @returns {{ unpatch: Function }} per rimuovere l'hook
   */
  function hookPrototype(Proto, methodName, interceptor) {
    if (!Proto || !Proto[methodName]) {
      console.warn(LOG_PREFIX, 'hookPrototype: target not found', methodName);
      return { unpatch: function() {} };
    }
    // PARTE 4: anti-riwrap — se già wrappato da noi, non rimpiazzare di nuovo
    if (Proto[methodName][Symbol.for('pvuPatched')]) {
      return { unpatch: function() {} };
    }
    const original = Proto[methodName];
    const wrapped = function() {
      const args = Array.from(arguments);
      try {
        return interceptor.call(this, original, args);
      } catch (e) {
        console.error(LOG_PREFIX, 'hook error on', methodName, e);
        return original.apply(this, arguments);
      }
    };
    wrapped[Symbol.for('pvuPatched')] = true;
    Proto[methodName] = wrapped;
    return {
      unpatch: function() {
        Proto[methodName] = original;
      }
    };
  }

  /**
   * Hook un setter su window per un property name.
   * @param {string} prop
   * @param {Function} interceptor - (originalSetter, value) => void
   */
  function hookWindowSetter(prop, interceptor) {
    let _value = window[prop];
    let _desc = Object.getOwnPropertyDescriptor(window, prop);
    if (!_desc) {
      // crea descriptor vazio
      _desc = { configurable: true, enumerable: true };
    }
    const originalSet = _desc.set;
    const originalGet = _desc.get || function() { return _value; };

    Object.defineProperty(window, prop, {
      configurable: true,
      enumerable: true,
      get: originalGet,
      set: function(val) {
        try {
          interceptor(originalSet ? originalSet.bind(this) : function(v) { _value = v; }, val);
        } catch (e) {
          console.error(LOG_PREFIX, 'hookWindowSetter error on', prop, e);
          if (originalSet) originalSet.call(this, val);
          else _value = val;
        }
      },
    });
  }

  /**
   * Debounce semplice
   */
  function debounce(fn, ms) {
    let timer = null;
    return function() {
      const ctx = this;
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
    };
  }

  /**
   * Clamp number a [min, max]
   */
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  return {
    aobScan: aobScan,
    findStringInBundle: findStringInBundle,
    findFunctionRef: findFunctionRef,
    hookPrototype: hookPrototype,
    hookWindowSetter: hookWindowSetter,
    debounce: debounce,
    clamp: clamp,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.helpers = PvuHelpers;
