// src/ui/voucher-screen.js — UI Voucher Editor (tab Voucher)
const PvuVoucherScreen = (() => {
  const LOG_PREFIX = '[PvuVoucherScreen]';
  let containerEl = null;
  let statusEl = null;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function render(parentEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'pvu-voucher-screen';

    const section = document.createElement('div');
    section.className = 'pvu-section';

    const title = document.createElement('div');
    title.className = 'pvu-section-title';
    title.textContent = '🎟️ Voucher Editor';
    section.appendChild(title);

    const info = document.createElement('div');
    info.className = 'pvu-info';
    info.textContent = 'Modifica i voucher. Il gioco salva automaticamente.';
    section.appendChild(info);

    const editor = window.__pvu.voucherEditor;
    const labels = editor.LABELS;
    const emojis = editor.VOUCHER_EMOJI;
    const rows = [];

    for (let t = 0; t < labels.length; t++) {
      (function(typeIdx) {
        const row = document.createElement('div');
        row.className = 'pvu-input-row';

        const label = document.createElement('span');
        label.style.minWidth = '110px';
        label.style.display = 'inline-block';
        label.textContent = emojis[typeIdx] + ' ' + labels[typeIdx];
        row.appendChild(label);

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'pvu-input';
        input.style.width = '90px';
        input.min = '0';
        input.value = '0';
        row.appendChild(input);

        // Quick buttons +1, +10, +100
        const deltas = [1, 10, 100];
        for (let d = 0; d < deltas.length; d++) {
          (function(delta) {
            const btn = document.createElement('button');
            btn.className = 'pvu-btn pvu-btn-sm';
            btn.textContent = '+' + delta;
            btn.addEventListener('click', function() {
              const cur = Math.max(0, parseInt(input.value, 10) || 0);
              input.value = cur + delta;
              applyVoucher(typeIdx, input);
            });
            row.appendChild(btn);
          })(deltas[d]);
        }

        // Apply button per tipo
        const applyBtn = document.createElement('button');
        applyBtn.className = 'pvu-btn';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', function() {
          applyVoucher(typeIdx, input);
        });
        row.appendChild(applyBtn);

        section.appendChild(row);

        rows.push({ type: typeIdx, inputEl: input });
      })(t);
    }

    // Apply All button
    const allRow = document.createElement('div');
    allRow.className = 'pvu-input-row';
    allRow.style.marginTop = '8px';

    const applyAllBtn = document.createElement('button');
    applyAllBtn.className = 'pvu-btn';
    applyAllBtn.textContent = 'Apply All';
    applyAllBtn.addEventListener('click', function() {
      const counts = {};
      for (let i = 0; i < rows.length; i++) {
        counts[labels[rows[i].type]] = Math.max(0, parseInt(rows[i].inputEl.value, 10) || 0);
      }
      const result = editor.setAllVoucherCounts(counts);
      showStatus(result.ok ? '✓ Tutti i voucher aggiornati' : '✗ ' + (result.error || 'Errore'), result.ok);
    });
    allRow.appendChild(applyAllBtn);
    section.appendChild(allRow);

    // Status
    statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.textContent = 'In attesa...';
    section.appendChild(statusEl);

    containerEl.appendChild(section);
    parentEl.appendChild(containerEl);

    refreshUI();
  }

  function applyVoucher(typeIdx, inputEl) {
    const val = parseInt(inputEl.value, 10);
    const editor = window.__pvu.voucherEditor;
    const result = editor.setVoucherCount(typeIdx, val);
    showStatus(result.ok ? '✓ ' + editor.LABELS[typeIdx] + ' = ' + Math.max(0, val || 0) : '✗ ' + (result.error || 'Errore'), result.ok);
  }

  function showStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = ok ? 'pvu-status ok' : 'pvu-status err';
  }

  function refreshUI() {
    if (!containerEl) return;
    if (!document.body.contains(containerEl)) return;

    const editor = window.__pvu.voucherEditor;
    const counts = editor.getVoucherCounts();
    if (!counts) {
      showStatus('gameData non disponibile', false);
      return;
    }

    const labels = editor.LABELS;
    for (let i = 0; i < containerEl.querySelectorAll('.pvu-input').length; i++) {
      const input = containerEl.querySelectorAll('.pvu-input')[i];
      if (i < labels.length && input && document.activeElement !== input) {
        input.value = counts[labels[i]] || 0;
      }
    }
  }

  function destroy() {
    if (containerEl && containerEl.parentNode) containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
    statusEl = null;
  }

  return {
    render: render,
    refreshUI: refreshUI,
    destroy: destroy,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.voucherScreen = PvuVoucherScreen;
