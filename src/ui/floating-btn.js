// src/ui/floating-btn.js — Bottone flottante (z-index 99999, bottom-right)
const PvuFloatingBtn = (() => {
  const LOG_PREFIX = '[PvuFloatingBtn]';
  let btnEl = null;
  let panelEl = null;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function create(onClick) {
    if (btnEl) return btnEl;

    btnEl = document.createElement('button');
    btnEl.id = 'pvu-fab';
    btnEl.textContent = '⚡';
    btnEl.title = 'PokeVoid-Unlocked';
    btnEl.setAttribute('aria-label', 'PokeVoid-Unlocked');

    btnEl.addEventListener('click', function(e) {
      e.stopPropagation();
      if (typeof onClick === 'function') {
        onClick();
      }
    });

    // Inserisci nel body appena disponibile
    if (document.body) {
      document.body.appendChild(btnEl);
      log('Bottone creato');
    } else {
      // document-start: aspetta body
      const observer = new MutationObserver(function() {
        if (document.body) {
          document.body.appendChild(btnEl);
          observer.disconnect();
          log('Bottone creato (after body)');
        }
      });
      observer.observe(document.documentElement || document, { childList: true, subtree: true });
    }

    return btnEl;
  }

  function show() {
    if (btnEl) btnEl.style.display = 'flex';
  }

  function hide() {
    if (btnEl) btnEl.style.display = 'none';
  }

  function destroy() {
    if (btnEl && btnEl.parentNode) btnEl.parentNode.removeChild(btnEl);
    btnEl = null;
    log('destroy');
  }

  return {
    create: create,
    show: show,
    hide: hide,
    destroy: destroy,
    getElement: function() { return btnEl; },
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.floatingBtn = PvuFloatingBtn;
