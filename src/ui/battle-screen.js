// src/ui/battle-screen.js — UI Battle: toggle Sempre Shiny + Cattura Tutto (tab Battle)
// Segue il pattern di roll-screen.js: createToggle, setSwitchState, refreshUI 2s
const PvuBattleScreen = (() => {
  const LOG_PREFIX = '[PvuBattleScreen]';
  let containerEl = null;
  let refreshTimer = null;

  // Riferimenti DOM ai toggle switch per sync nello refreshUI
  const toggleRefs = {};

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function render(parentEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'pvu-battle-screen';

    // === INCONTRI — Sempre Shiny ===
    const encounterSection = document.createElement('div');
    encounterSection.className = 'pvu-section';

    const encounterTitle = document.createElement('div');
    encounterTitle.className = 'pvu-section-title';
    encounterTitle.textContent = 'SEMPRE SHINY';
    encounterSection.appendChild(encounterTitle);

    var encounterState = window.__pvu.encounterOverride?.getState?.() || {};
    var shinyResult = createToggle(
      'Sempre Shiny',
      'Ogni Pokemon incontrato nasce shiny (wild, boss, rival, legendary)',
      !!encounterState.shiny,
      function(val) {
        window.__pvu.encounterOverride?.toggleShiny?.(val);
      }
    );
    encounterSection.appendChild(shinyResult.row);
    toggleRefs.shiny = shinyResult.switchEl;

    // Stato hooks encounter
    var shinyStatus = document.createElement('div');
    shinyStatus.className = 'pvu-status';
    shinyStatus.id = 'pvu-battle-shiny-status';
    shinyStatus.textContent = 'In attesa...';
    encounterSection.appendChild(shinyStatus);

    containerEl.appendChild(encounterSection);

    // === CATTURA — Cattura Tutto ===
    const captureSection = document.createElement('div');
    captureSection.className = 'pvu-section';

    const captureTitle = document.createElement('div');
    captureTitle.className = 'pvu-section-title';
    captureTitle.textContent = 'CATTURA TUTTO';
    captureSection.appendChild(captureTitle);

    var captureState = window.__pvu.captureOverride?.getState?.() || {};
    var captureResult = createToggle(
      'Cattura Tutto',
      'Quando il toggle Cattura è attivo: la prima Pokéball su un bersaglio singolo (non rivale/non scripted) cattura sempre.',
      !!captureState.enabled,
      function(val) {
        window.__pvu.captureOverride?.toggleCapture?.(val);
      }
    );
    captureSection.appendChild(captureResult.row);
    toggleRefs.capture = captureResult.switchEl;

    // Status row cattura
    var captureStatus = document.createElement('div');
    captureStatus.className = 'pvu-status';
    captureStatus.id = 'pvu-battle-capture-status';
    captureStatus.textContent = 'In attesa...';
    captureSection.appendChild(captureStatus);

    containerEl.appendChild(captureSection);

    // Version badge
    var verEl = document.createElement('div');
    verEl.className = 'pvu-ver';
    verEl.textContent = 'PokeVoid-Unlocked v' + (window.__pvu.config ? window.__pvu.config.VERSION : '1.0.0');
    containerEl.appendChild(verEl);

    parentEl.appendChild(containerEl);

    // Auto-refresh stato (2s, come roll-screen)
    refreshTimer = setInterval(refreshUI, 2000);
    refreshUI();
  }

  /**
   * Crea un toggle switch con label e descrizione.
   * Restituisce { row, switchEl } — stesso pattern di roll-screen.js.
   */
  function createToggle(label, description, initial, onChange) {
    const row = document.createElement('div');
    row.className = 'pvu-toggle';

    const left = document.createElement('div');
    const labelEl = document.createElement('div');
    labelEl.className = 'pvu-toggle-label';
    labelEl.textContent = label;
    left.appendChild(labelEl);

    if (description) {
      const descEl = document.createElement('div');
      descEl.className = 'pvu-toggle-desc';
      descEl.textContent = description;
      left.appendChild(descEl);
    }

    const switchEl = document.createElement('div');
    switchEl.className = 'pvu-switch' + (initial ? ' on' : '');

    switchEl.addEventListener('click', function() {
      const isOn = switchEl.classList.toggle('on');
      if (typeof onChange === 'function') {
        onChange(isOn);
      }
    });

    row.appendChild(left);
    row.appendChild(switchEl);
    return { row: row, switchEl: switchEl };
  }

  /**
   * Aggiorna tutti gli switch e i testi di stato dallo stato reale dei moduli.
   * Chiamata ogni 2s dal refreshTimer e al primo render.
   */
  function refreshUI() {
    if (!containerEl) return;

    var encounterState = window.__pvu.encounterOverride?.getState?.() || {};
    var captureState = window.__pvu.captureOverride?.getState?.() || {};

    // --- Shiny toggle + status ---
    setSwitchState(toggleRefs.shiny, !!encounterState.shiny);

    var shinyStatusEl = containerEl.querySelector('#pvu-battle-shiny-status');
    if (shinyStatusEl) {
      var encHooks = encounterState.hooksApplied ? '✓ Hooks attivi' : '⏳ In attesa hooks...';
      var encDetail = encounterState.hooksApplied
        ? ' — Pokemon: ' + (encounterState.hookStats?.pokemonPatched || 0)
        : '';
      shinyStatusEl.textContent = encHooks + encDetail;
      shinyStatusEl.className = 'pvu-status ' + (encounterState.hooksApplied ? 'ok' : 'warn');
    }

    // --- Capture toggle + status ---
    setSwitchState(toggleRefs.capture, !!captureState.enabled);

    var captureStatusEl = containerEl.querySelector('#pvu-battle-capture-status');
    if (captureStatusEl && captureState.enabled) {
      var levelText = '—';
      if (captureState.level === 2) {
        if (!captureState.hooksApplied) {
          levelText = 'wrapper NON attivo (in attesa battle)';
        } else {
          // Ladder tri-state onesto: wrapper → id confermato → override armato
          var rungs = ['wrapper attivo'];
          if (captureState.ballCommandId !== null) rungs.push('id confermato');
          if (captureState.rollOverrideReady === true) rungs.push('override armato');
          levelText = rungs.join(' / ');
          if (captureState.rollOverrideReady === false) {
            levelText = rungs[0] + ' — override probabilità NON attivo';
          }
        }
      } else if (captureState.level === 1) {
        levelText = 'L1 (fallback) ⚠️';
      }
      var badge = (captureState.level === 2 && captureState.rollOverrideReady === true) ? ' ✅' : '';
      var forced = captureState.injectedCount || 0;
      var realized = captureState.capturedCount || 0;
      var errors = captureState.errorCount || 0;
      var txt =
        'Livello: ' + levelText + badge +
        ' | Catture forzate: ' + forced +
        ' | Catture realizzate: ' + realized;
      if (errors > 0) txt += ' | Errori: ' + errors;
      captureStatusEl.textContent = txt;
      captureStatusEl.className = 'pvu-status ' +
        (errors >= 3 ? 'err' : errors > 0 ? 'warn' : 'ok');
    } else if (captureStatusEl) {
      captureStatusEl.textContent = 'Cattura Tutto disattivata';
      captureStatusEl.className = 'pvu-status';
    }
  }

  /**
   * Sync stato visuale di uno switch con un booleano (senza triggerare l'onChange).
   */
  function setSwitchState(switchEl, isOn) {
    if (!switchEl) return;
    if (isOn && !switchEl.classList.contains('on')) {
      switchEl.classList.add('on');
    } else if (!isOn && switchEl.classList.contains('on')) {
      switchEl.classList.remove('on');
    }
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    Object.keys(toggleRefs).forEach(function(k) { toggleRefs[k] = null; });
    if (containerEl && containerEl.parentNode) containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
  }

  return {
    render: render,
    refreshUI: refreshUI,
    destroy: destroy,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.battleScreen = PvuBattleScreen;
