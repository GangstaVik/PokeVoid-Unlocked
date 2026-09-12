/* PokeVoid-Unlocked — Type Essence editor (canonical 23-type id map; runtime enum used for verification only). */
(function () {
    'use strict';
    // Canonical map: all 23 native type ids (enum S, bundle v3.1.8).
    // Source of truth for key→id resolution. NEVER derived from list order or BFS.
    var TYPE_IDS = {
        UNKNOWN: -1,
        NORMAL: 0,
        FIGHTING: 1,
        FLYING: 2,
        POISON: 3,
        GROUND: 4,
        ROCK: 5,
        BUG: 6,
        GHOST: 7,
        STEEL: 8,
        FIRE: 9,
        WATER: 10,
        GRASS: 11,
        ELECTRIC: 12,
        PSYCHIC: 13,
        ICE: 14,
        DRAGON: 15,
        DARK: 16,
        FAIRY: 17,
        STELLAR: 18,
        ALL: 19,
        SMITTY: 20,
        GLITCH: 21,
        GEN_ONE: 22
    };
    // Native enum order (UNKNOWN → GEN_ONE). The combobox must use this order
    // so the selected value always maps to the correct native id.
    var TYPE_ORDER = Object.keys(TYPE_IDS);
    var MAX_CHILD_SCAN = 40;
    var MAX_CHILD_DEPTH = 3;
    var gameData = null;
    var typeEnum = null;
    var enumMismatch = false;
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
                    if (o && typeof o === 'object' && 'SMITTY' in o && ('GEN_ONE' in o || 'STELLAR' in o)) return o;
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

    // L'enum è considerato valido se contiene almeno un valore numerico per una chiave canonica.
    function isTypeEnumValid(e) {
        if (!e) return false;
        for (var i = 0; i < TYPE_ORDER.length; i += 1) {
            if (typeof e[TYPE_ORDER[i]] === 'number') return true;
        }
        return false;
    }

    // Confronta l'enum runtime con la mappa canonica. Ritorna l'elenco delle chiavi
    // discordanti (stringa leggibile per il log); array vuoto = coerente.
    function verifyEnum(e) {
        var mismatches = [];
        var i, k;
        for (i = 0; i < TYPE_ORDER.length; i += 1) {
            k = TYPE_ORDER[i];
            if (typeof e[k] !== 'number' || e[k] !== TYPE_IDS[k]) {
                mismatches.push(k + '=' + e[k] + ' (canonico ' + TYPE_IDS[k] + ')');
            }
        }
        return mismatches;
    }

    // ids sempre dalla mappa canonica: nessun fallback id=indice, nessuna dipendenza dal BFS.
    function resolveTypeIds() {
        var ids = {};
        var i;
        for (i = 0; i < TYPE_ORDER.length; i += 1) {
            ids[TYPE_ORDER[i]] = TYPE_IDS[TYPE_ORDER[i]];
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
        if (id < 0) return { ok: false, reason: 'tipo ' + key + ' (id ' + id + ') non scrivibile' };
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
            for (i = 0; i < TYPE_ORDER.length; i += 1) {
                k = TYPE_ORDER[i];
                counts[k] = (typeof ids[k] === 'number') ? getCount(ids[k]) : null;
                if (typeof counts[k] === 'number') total += counts[k];
            }
        }
        return {
            ready: ready,
            enumFound: !!typeEnum,
            enumMismatch: enumMismatch,
            counts: counts,
            total: total
        };
    }

    // Re-callable: lazy init on first "Essenze" tab render.
    function init() {
        gameData = findGameData();
        ready = isApiAvailable(gameData);
        typeEnum = ready ? findTypeEnum(gameData) : null;
        if (typeEnum && !isTypeEnumValid(typeEnum)) typeEnum = null;
        enumMismatch = false;
        if (!ready) {
            log('API Type Essence non trovata — editor disattivato (status onesto)');
            return;
        }
        if (typeEnum) {
            var mm = verifyEnum(typeEnum);
            enumMismatch = mm.length > 0;
            if (enumMismatch) {
                log('AVVISO: enum runtime non coincide con la mappa canonica: ' + mm.join(', ') + ' — usati gli id canonici (v3.1.8)');
            } else {
                log('Enum tipi verificato: 23/23 corrispondenze con la mappa canonica');
            }
        } else {
            log('Enum tipi non trovato: usata la mappa canonica hardcoded (23 tipi) — nessun fallback id=indice');
        }
    }

    function destroy() { gameData = null; typeEnum = null; ready = false; enumMismatch = false; }

    window.__pvu = window.__pvu || {};
    window.__pvu.essenceEditor = {
        init: init,
        destroy: destroy,
        getState: getState,
        applyEssence: applyEssence,
        TYPE_ORDER: TYPE_ORDER.slice(),
        TYPE_IDS: resolveTypeIds(),
        isReady: function () { return ready; }
    };
})();