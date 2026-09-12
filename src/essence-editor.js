/* PokeVoid-Unlocked — Type Essence editor (API discovery at runtime, no hardcoded enum ids). */
(function () {
    'use strict';
    var TYPE_LIST = ['NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON', 'GROUND', 'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY', 'SMITTY', 'GLITCH', 'GEN_ONE'];
    var MAX_CHILD_SCAN = 40;
    var MAX_CHILD_DEPTH = 3;
    var gameData = null;
    var typeEnum = null;
    var usingFallback = false;
    var ready = false;

    function log(msg) { if (window.__pvu && typeof window.__pvu.log === 'function') window.__pvu.log('[essence-editor] ' + msg); }

    function findGameData() {
        var b = window.__pvu && window.__pvu.bridge;
        if (b && typeof b.findGameData === 'function') return b.findGameData();
        return null;
    }

    function isApiAvailable(gd) {
        return !!(gd && typeof gd.getEssenceCount === 'function' && typeof gd.addEssence === 'function' && typeof gd.tryConsumeEssence === 'function');
    }

    // BFS to depth <= MAX_CHILD_DEPTH, capped at MAX_CHILD_SCAN scanned properties overall.
    // Returns the first object with 'SMITTY' key (the type enum dictionary).
    function findTypeEnum(gd) {
        if (!gd) return null;
        var queue = [gd];
        var depth = 0;
        var scanned = 0;
        while (queue.length > 0 && depth < MAX_CHILD_DEPTH) {
            var next = [];
            for (var i = 0; i < queue.length; i += 1) {
                var o = queue[i];
                try {
                    if (o && typeof o === 'object' && 'SMITTY' in o) return o;
                    for (var key in o) {
                        var v = o[key];
                        if (v && typeof v === 'object') next.push(v);
                        scanned += 1;
                        if (scanned >= MAX_CHILD_SCAN) break;
                    }
                } catch (e) {
                    // getter che lancia: skip questo oggetto, continua la scansione.
                }
            }
            queue = next;
            depth += 1;
        }
        return null;
    }

    // B4: un oggetto con chiave 'SMITTY' ma nessun valore numerico risolvibile
    // non è un enum valido → enumFound resterebbe bugiardo. Fallback in tal caso.
    function isTypeEnumValid(e) {
        if (!e) return false;
        for (var i = 0; i < TYPE_LIST.length; i += 1) {
            if (typeof e[TYPE_LIST[i]] === 'number') return true;
        }
        return false;
    }

    // Safety net (SF10): if enum not found after 3-level scan, fall back to
    // hardcoded 21-key list with id = index in TYPE_LIST.
    // Acceptable for v1.5 cut; marked usingFallback and visible in UI.
    function fallbackIds() {
        var m = {};
        for (var i = 0; i < TYPE_LIST.length; i += 1) m[TYPE_LIST[i]] = i;
        usingFallback = true;
        return m;
    }

    function resolveTypeIds() {
        var src = typeEnum || fallbackIds();
        var ids = {};
        var i;
        for (i = 0; i < TYPE_LIST.length; i += 1) {
            ids[TYPE_LIST[i]] = src[TYPE_LIST[i]];
        }
        return ids;
    }

    function getCount(id) {
        if (!gameData || typeof gameData.getEssenceCount !== 'function' || typeof id !== 'number') return 0;
        try {
            var n = Number(gameData.getEssenceCount(id));
            return isFinite(n) ? n : 0;
        } catch (e) { return 0; }
    }

    function applyEssence(key, rawTarget) {
        if (!ready) return { ok: false, reason: 'editor non pronto (API Type Essence non trovata)' };
        var rawStr = String(rawTarget).trim();
        if (rawStr === '') return { ok: false, reason: 'valore vuoto: inserisci un numero' };
        if (!/^\d+$/.test(rawStr)) return { ok: false, reason: 'valore non valido (solo cifre): ' + rawTarget };
        var ids = resolveTypeIds();
        if (!ids || typeof ids[key] !== 'number') return { ok: false, reason: 'tipo non disponibile nel build corrente: ' + key };
        var target = Math.min(Math.floor(Number(rawStr)), Number.MAX_SAFE_INTEGER);
        var id = ids[key];
        var current = getCount(id);
        var delta = target - current;
        if (delta === 0) return { ok: true, current: current, key: key, target: target };
        if (delta > 0) {
            try { gameData.addEssence(id, delta); } catch (e) { return { ok: false, reason: 'addEssence fallita: ' + e.message }; }
        } else {
            try {
                if (gameData.tryConsumeEssence(id, -delta) !== true) return { ok: false, reason: 'tryConsumeEssence rifiutata' };
            } catch (e) { return { ok: false, reason: 'tryConsumeEssence fallita: ' + e.message }; }
        }
        return { ok: true, key: key, target: target, current: current };
    }

    function getState() {
        var counts = {};
        var total = 0;
        var ids = resolveTypeIds();
        var i, k;
        if (ids) {
            for (i = 0; i < TYPE_LIST.length; i += 1) {
                k = TYPE_LIST[i];
                counts[k] = (typeof ids[k] === 'number') ? getCount(ids[k]) : null;
                if (typeof counts[k] === 'number') total += counts[k];
            }
        }
        return {
            ready: ready,
            enumFound: !!typeEnum,
            usingFallback: usingFallback,
            counts: counts,
            total: total
        };
    }

    // Re-callable (B3): lazy init on first "Essenze" tab render.
    // findGameData() returns null before battle scene loads, so document-start
    // init would freeze ready=false forever (no polling needed).
    function init() {
        gameData = findGameData();
        ready = isApiAvailable(gameData);
        typeEnum = ready ? findTypeEnum(gameData) : null;
        if (typeEnum && !isTypeEnumValid(typeEnum)) typeEnum = null;
        usingFallback = false;
        if (!ready) {
            log('API Type Essence non trovata — editor disattivato (status onesto)');
            return;
        }
        log('Enum tipi: ' + (typeEnum ? 'trovato' : 'NON trovato (fallback 21 chiavi, id=indice)') + ' | 21 tipi risolti: ' + (resolveTypeIds() ? 'si' : 'no'));
    }

    function destroy() { gameData = null; typeEnum = null; ready = false; usingFallback = false; }

    window.__pvu = window.__pvu || {};
    window.__pvu.essenceEditor = {
        init: init,
        destroy: destroy,
        getState: getState,
        applyEssence: applyEssence,
        TYPE_LIST: TYPE_LIST.slice(),
        isReady: function () { return ready; }
    };
})();