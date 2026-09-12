/* PokeVoid-Unlocked — Essenze tab (Type Essence editor UI). */
(function () {
    'use strict';
    var container = null;
    var selectEl = null;
    var inputEl = null;
    var currentLabelEl = null;
    var statusEl = null;
    var refreshTimer = null;
    var currentKey = null;

    function log(msg) { if (window.__pvu && typeof window.__pvu.log === 'function') window.__pvu.log('[essence-screen] ' + msg); }

    function editor() { return window.__pvu && window.__pvu.essenceEditor; }

    function render(parentEl) {
        if (container) destroy();
        var ed = editor();
        // B3: lazy init on first render (no document-start init)
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

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;';

        selectEl = document.createElement('select');
        selectEl.className = 'pvu-champ-select';
        var list = ed.TYPE_LIST || [];
        var i;
        for (i = 0; i < list.length; i += 1) {
            var opt = document.createElement('option');
            opt.value = list[i];
            opt.textContent = list[i];
            selectEl.appendChild(opt);
        }
        selectEl.addEventListener('change', function () { currentKey = selectEl.value; if (inputEl) inputEl.value = ''; refreshCurrent(); });
        row.appendChild(selectEl);

        currentLabelEl = document.createElement('span');
        currentLabelEl.className = 'pvu-status';
        row.appendChild(currentLabelEl);

        inputEl = document.createElement('input');
        inputEl.type = 'number';
        inputEl.min = '0';
        inputEl.step = '1';
        inputEl.className = 'pvu-input';
        inputEl.placeholder = 'Valore assoluto (es. 999)';
        row.appendChild(inputEl);

        var applyBtn = document.createElement('button');
        applyBtn.className = 'pvu-btn pvu-btn-sm';
        applyBtn.textContent = 'Applica';
        applyBtn.addEventListener('click', function () {
            if (!currentKey || !inputEl) return;
            // SF9: guard empty input — Number('') === 0 would wipe to zero
            if (inputEl.value === '' || String(inputEl.value).trim() === '') {
                setStatus('Errore: inserisci un valore numerico', 'err');
                return;
            }
            var res = ed.applyEssence(currentKey, inputEl.value);
            if (res.ok) {
                setStatus('OK: ' + res.key + ' \u2192 ' + res.target + ' (era: ' + res.current + ')', 'ok');
                inputEl.value = '';
            } else {
                setStatus('Errore: ' + res.reason, 'err');
            }
            refreshCurrent();
        });
        row.appendChild(applyBtn);

        // SF8: +1/−1 quick buttons
        function quickAdjust(n) {
            var edv = editor();
            var st = edv && edv.getState ? edv.getState() : null;
            if (!st || !st.counts || typeof st.counts[currentKey] !== 'number') {
                setStatus('Errore: valore attuale sconosciuto', 'err');
                return;
            }
            var res = edv.applyEssence(currentKey, String(st.counts[currentKey] + n));
            if (res.ok) {
                setStatus('OK: ' + res.key + ' \u2192 ' + res.target + ' (era: ' + res.current + ')', 'ok');
            } else {
                setStatus('Errore: ' + res.reason, 'err');
            }
            refreshCurrent();
        }

        var plusBtn = document.createElement('button');
        plusBtn.className = 'pvu-btn pvu-btn-sm';
        plusBtn.textContent = '+1';
        plusBtn.addEventListener('click', function () { quickAdjust(1); });
        row.appendChild(plusBtn);

        var minusBtn = document.createElement('button');
        minusBtn.className = 'pvu-btn pvu-btn-sm';
        minusBtn.textContent = '-1';
        minusBtn.addEventListener('click', function () { quickAdjust(-1); });
        row.appendChild(minusBtn);

        container.appendChild(row);

        statusEl = document.createElement('div');
        statusEl.className = 'pvu-status';
        statusEl.textContent = 'Pronto';
        container.appendChild(statusEl);

        currentKey = selectEl.value;
        if (!ed.getState().enumFound) setStatus('Attenzione: enum tipi non trovato — scritture su fallback (id per indice)', 'warn');
        refreshCurrent();
        parentEl.appendChild(container);
        refreshTimer = setInterval(refreshUI, 2000);
    }

    function refreshUI() {
        if (!container || !document.getElementById('pvu-essence-screen')) return;
        if (document.activeElement === inputEl || document.activeElement === selectEl) return;
        if (!inputEl.value) refreshCurrent();
    }

    function refreshCurrent() {
        var ed = editor();
        var st = ed && ed.getState ? ed.getState() : null;
        if (!st || !currentKey || !currentLabelEl) return;
        var v = st.counts && st.counts[currentKey];
        currentLabelEl.textContent = 'Attuale: ' + (typeof v === 'number' ? v : '\u2014') + ' (totale: ' + st.total + ')';
    }

    function setStatus(msg, cls) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.className = 'pvu-status' + (cls ? ' ' + cls : '');
    }

    function destroy() {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        if (container && container.parentNode) container.parentNode.removeChild(container);
        container = null; selectEl = null; inputEl = null; currentLabelEl = null; statusEl = null; currentKey = null;
    }

    window.__pvu = window.__pvu || {};
    window.__pvu.essenceScreen = { render: render, destroy: destroy };
})();
