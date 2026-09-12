// src/ui/battle-screen.js — UI Battle: toggle Sempre Shiny + Cattura Tutto (tab Battle)
// Segue il pattern di roll-screen.js: createToggle, setSwitchState, refreshUI 2s
const PvuBattleScreen = (() => {
  const t = window.__pvu.i18n.t.bind(window.__pvu.i18n);
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
    encounterTitle.textContent = t('battle.shinyTitle');
    encounterSection.appendChild(encounterTitle);

    var encounterState = window.__pvu.encounterOverride?.getState?.() || {};
    var shinyResult = createToggle(
      t('battle.shinyName'),
      t('battle.shinyDesc'),
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
    shinyStatus.textContent = t('battle.waiting');
    encounterSection.appendChild(shinyStatus);

    containerEl.appendChild(encounterSection);

    // === CATTURA — Cattura Tutto ===
    const captureSection = document.createElement('div');
    captureSection.className = 'pvu-section';

    const captureTitle = document.createElement('div');
    captureTitle.className = 'pvu-section-title';
    captureTitle.textContent = t('battle.catchTitle');
    captureSection.appendChild(captureTitle);

    var captureState = window.__pvu.captureOverride?.getState?.() || {};
    var captureResult = createToggle(
      t('battle.catchName'),
      t('battle.catchDesc'),
      !!captureState.enabled,
      function(val) {
        window.__pvu.captureOverride?.toggleCapture?.(val);
      }
    );
    captureSection.appendChild(captureResult.row);
    toggleRefs.capture = captureResult.switchEl;

    var forceSpecialResult = createToggle(
      t('battle.specialsName'),
      t('battle.specialsDesc'),
      !!captureState.forceSpecial,
      function(val) {
        window.__pvu.captureOverride?.toggleForceSpecial?.(val);
      }
    );
    captureSection.appendChild(forceSpecialResult.row);
    toggleRefs.forceSpecial = forceSpecialResult.switchEl;

    // Status row cattura
    var captureStatus = document.createElement('div');
    captureStatus.className = 'pvu-status';
    captureStatus.id = 'pvu-battle-capture-status';
    captureStatus.textContent = t('battle.waiting');
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
      var encHooks = encounterState.hooksApplied ? t('roll.hooksActive') : t('roll.waitingHooks');
      var encDetail = encounterState.hooksApplied
        ? ' — Pokemon: ' + (encounterState.hookStats?.pokemonPatched || 0)
        : '';
      shinyStatusEl.textContent = encHooks + encDetail;
      shinyStatusEl.className = 'pvu-status ' + (encounterState.hooksApplied ? 'ok' : 'warn');
    }

    // --- Capture toggle + status ---
    setSwitchState(toggleRefs.capture, !!captureState.enabled);
    if (toggleRefs.forceSpecial) setSwitchState(toggleRefs.forceSpecial, !!captureState.forceSpecial);

    var captureStatusEl = containerEl.querySelector('#pvu-battle-capture-status');
    if (captureStatusEl && captureState.enabled) {
      var levelText = '—';
      if (captureState.level === 2) {
        if (!captureState.hooksApplied) {
          levelText = t('battle.wrapperNotActive');
        } else {
          // Ladder tri-state onesto: wrapper → id confermato → override armato
          var rungs = [t('battle.wrapperActive')];
          if (captureState.ballCommandId !== null) rungs.push(t('battle.idConfirmed'));
          if (captureState.rollOverrideReady === true) rungs.push(t('battle.overrideArmed'));
          levelText = rungs.join(' / ');
          if (captureState.rollOverrideReady === false) {
            levelText = rungs[0] + ' ' + t('battle.overrideNotActive');
          }
        }
      } else if (captureState.level === 1) {
        levelText = t('battle.l1Fallback');
      }
      var forced = captureState.injectedCount || 0;
      var realized = captureState.capturedCount || 0;
      var errors = captureState.errorCount || 0;
      var txt =
        t('battle.level') + levelText +
        ' | ' + t('battle.forcedCatches') + forced +
        ' | ' + t('battle.realizedCatches') + realized;
      txt += ' | ' + t('battle.specialCases') + (captureState.forceSpecial ? 'ON' : 'OFF');
      if (errors > 0) txt += ' | ' + t('battle.errors') + errors;
      captureStatusEl.textContent = txt;
      captureStatusEl.className = 'pvu-status ' +
        (errors >= 3 ? 'err' : errors > 0 ? 'warn' : 'ok');
    } else if (captureStatusEl) {
      captureStatusEl.textContent = t('battle.disabled');
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
