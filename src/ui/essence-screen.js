/* PokeVoid-Unlocked — Essenze tab (precompiled input, debounced live apply, no buttons). */
(function () {
    'use strict';
    var DEBOUNCE_MS = 350;
    var container = null;
    var selectEl = null;
    var inputEl = null;
    var statusEl = null;
    var refreshTimer = null;
    var debounceTimer = null;
    var currentKey = null;

    function log(msg) { if (window.__pvu && typeof window.__pvu.log === 'function') window.__pvu.log('[essence-screen] ' + msg); }

    function editor() { return window.__pvu && window.__pvu.essenceEditor; }

    function render(parentEl) {
        if (container) destroy();
        var ed = editor();
        // lazy init on first render (no document-start init)
        if (ed && !ed.isReady() && typeof ed.init === 'function') ed.init();

        container = document.createElement('div');
        container.id = 'pvu-essence-screen';
        var title = document.createElement('h3');
        title.textContent = 'TYPE ESSENCE';
        container.appendChild(title);

        if (!ed || !ed.isReady()) {
            var warn = document.createElement('div');
            warn.className = 'pvu-warning';
            warn.textContent = 'API Type Essence non trovata in questo build: editor disattivato.';
            container.appendChild(warn);
            parentEl.appendChild(container);
            return;
        }

        // Combobox: ordine nativo dell'enum (23 opzioni, id garantiti dalla mappa canonica).
        selectEl = document.createElement('select');
        selectEl.className = 'pvu-champ-select';
        var order = ed.TYPE_ORDER || [];
        var i;
        for (i = 0; i < order.length; i += 1) {
            var opt = document.createElement('option');
            opt.value = order[i];
            opt.textContent = order[i];
            selectEl.appendChild(opt);
        }
        selectEl.addEventListener('change', function () {
            clearPendingApply();
            currentKey = selectEl.value;
            refreshInput();
            setStatus('', '');
        });
        container.appendChild(selectEl);

        // Singolo input precompilato col valore corrente; apply live debounced (nessun bottone).
        inputEl = document.createElement('input');
        inputEl.type = 'number';
        inputEl.min = '0';
        inputEl.step = '1';
        inputEl.className = 'pvu-input';
        inputEl.style.cssText = 'display:block;margin:8px 0;';
        inputEl.addEventListener('input', function () {
            clearPendingApply();
            debounceTimer = setTimeout(applyPending, DEBOUNCE_MS);
        });
        container.appendChild(inputEl);

        statusEl = document.createElement('div');
        statusEl.className = 'pvu-status';
        container.appendChild(statusEl);

        currentKey = selectEl.value;
        refreshInput();
        parentEl.appendChild(container);
        refreshTimer = setInterval(refreshUI, 2000);
    }

    function clearPendingApply() {
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    }

    function applyPending() {
        debounceTimer = null;
        if (!currentKey || !inputEl) return;
        var raw = String(inputEl.value).trim();
        if (raw === '') return; // vuoto = no-op (mai azzerare per errore)
        var ed = editor();
        if (!ed) return;
        var res = ed.applyEssence(currentKey, raw);
        if (res.ok) {
            setStatus('\u2713 ' + res.key + ' = ' + res.target, 'ok');
        } else {
            setStatus('Errore: ' + res.reason, 'err');
        }
    }

    function refreshInput() {
        var ed = editor();
        var st = ed && ed.getState ? ed.getState() : null;
        if (!st || !st.counts || !currentKey || !inputEl) return;
        var v = st.counts[currentKey];
        if (typeof v === 'number') inputEl.value = String(v);
    }

    function refreshUI() {
        if (!container || !document.getElementById('pvu-essence-screen')) return;
        if (document.activeElement === inputEl || document.activeElement === selectEl) return;
        refreshInput();
    }

    function setStatus(msg, cls) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.className = 'pvu-status' + (cls ? ' ' + cls : '');
    }

    function destroy() {
        clearPendingApply();
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        if (container && container.parentNode) container.parentNode.removeChild(container);
        container = null; selectEl = null; inputEl = null; statusEl = null; currentKey = null;
    }

    window.__pvu = window.__pvu || {};
    window.__pvu.essenceScreen = { render: render, destroy: destroy };
})();