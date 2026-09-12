// src/ui/roll-screen.js — UI Roll Controller (tab Roll)
// PARTE 2: rimossi toggle morti (freeReroll, poolQuality)
// Luck Lock: influisce SOLO sulle offerte del roll (getModifierTypeOptions su), non su party luck/battle
const PvuRollScreen = (() => {
  const t = window.__pvu.i18n.t.bind(window.__pvu.i18n);
  const LOG_PREFIX = '[PvuRollScreen]';
  let containerEl = null;
  let refreshTimer = null;

  // Track toggle switch DOM elements by state key for sync
  const toggleRefs = {};

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function render(parentEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'pvu-roll-screen';

    // === Reroll Section ===
    const rerollSection = document.createElement('div');
    rerollSection.className = 'pvu-section';

    const rerollTitle = document.createElement('div');
    rerollTitle.className = 'pvu-section-title';
    rerollTitle.textContent = t('roll.title');
    rerollSection.appendChild(rerollTitle);

    // Cost Override
    const costOverrideResult = createToggle(t('roll.noCost'), t('roll.noCostDesc'), false, function(val) {
      window.__pvu.rollController.toggleCostOverride(val);
    });
    rerollSection.appendChild(costOverrideResult.row);
    toggleRefs.costOverride = costOverrideResult.switchEl;

    containerEl.appendChild(rerollSection);

    // === BUG 3: Luck Lock Section ===
    const luckSection = document.createElement('div');
    luckSection.className = 'pvu-section';

    const luckTitle = document.createElement('div');
    luckTitle.className = 'pvu-section-title';
    luckTitle.textContent = t('roll.luckLock');
    luckSection.appendChild(luckTitle);

    // Luck slider
    const luckSliderRow = document.createElement('div');
    luckSliderRow.className = 'pvu-slider-row';

    const luckSlider = document.createElement('input');
    luckSlider.type = 'range';
    luckSlider.className = 'pvu-slider';
    luckSlider.min = '1';
    luckSlider.max = '7';
    luckSlider.value = '5';
    luckSlider.id = 'pvu-luck-slider';

    const luckValLabel = document.createElement('span');
    luckValLabel.className = 'pvu-slider-val';
    luckValLabel.textContent = '5';
    luckValLabel.id = 'pvu-luck-val';

    luckSlider.addEventListener('input', function() {
      const v = parseInt(luckSlider.value, 10);
      luckValLabel.textContent = v;
      window.__pvu.rollController.setLuckValue(v);
    });

    luckSliderRow.appendChild(luckSlider);
    luckSliderRow.appendChild(luckValLabel);
    luckSection.appendChild(luckSliderRow);

    // Luck Lock toggle
    const luckLockResult = createToggle('Lock luck', t('roll.luckLockDesc'), false, function(val) {
      window.__pvu.rollController.toggleLuckLock(val);
    });
    luckSection.appendChild(luckLockResult.row);
    toggleRefs.luckLock = luckLockResult.switchEl;

    // Luck info
    const luckInfo = document.createElement('div');
    luckInfo.className = 'pvu-status';
    luckInfo.textContent = t('roll.luckInfo');
    luckSection.appendChild(luckInfo);

    containerEl.appendChild(luckSection);

    // === Item Count Section ===
    const itemSection = document.createElement('div');
    itemSection.className = 'pvu-section';

    const itemTitle = document.createElement('div');
    itemTitle.className = 'pvu-section-title';
    itemTitle.textContent = t('roll.itemCount');
    itemSection.appendChild(itemTitle);

    const sliderRow = document.createElement('div');
    sliderRow.className = 'pvu-slider-row';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'pvu-slider';
    slider.min = '0';
    slider.max = '4';
    slider.value = '2';
    slider.id = 'pvu-item-slider';

    const valLabel = document.createElement('span');
    valLabel.className = 'pvu-slider-val';
    valLabel.textContent = '+2';
    valLabel.id = 'pvu-item-val';

    slider.addEventListener('input', function() {
      const v = parseInt(slider.value, 10);
      valLabel.textContent = '+' + v;
      window.__pvu.rollController.setItemCountExtra(v);
    });

    sliderRow.appendChild(slider);
    sliderRow.appendChild(valLabel);
    itemSection.appendChild(sliderRow);

    const itemInfo = document.createElement('div');
    itemInfo.className = 'pvu-status';
    itemInfo.textContent = t('roll.itemInfo');
    itemSection.appendChild(itemInfo);

    containerEl.appendChild(itemSection);

    // === Status ===
    const statusSection = document.createElement('div');
    statusSection.className = 'pvu-section';

    const statusTitle = document.createElement('div');
    statusTitle.className = 'pvu-section-title';
    statusTitle.textContent = t('roll.hookStatus');
    statusSection.appendChild(statusTitle);

    const statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.id = 'pvu-roll-status';
    statusEl.textContent = t('roll.waiting');
    statusSection.appendChild(statusEl);

    containerEl.appendChild(statusSection);

    // Version badge
    const verEl = document.createElement('div');
    verEl.className = 'pvu-ver';
    verEl.textContent = 'PokeVoid-Unlocked v' + (window.__pvu.config ? window.__pvu.config.VERSION : '1.0.0');
    containerEl.appendChild(verEl);

    parentEl.appendChild(containerEl);

    // Auto-refresh stato
    refreshTimer = setInterval(refreshUI, 2000);
    refreshUI();
  }

  /**
   * Create a toggle row. Returns { row, switchEl } so caller can reference the switch DOM.
   * BUG 1 FIX: caller now receives switchEl for sync in refreshUI.
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
   * BUG 1 FIX: sync all toggle switches and sliders from controller state.
   * Called on every refresh interval and after user actions.
   */
  function refreshUI() {
    if (!containerEl) return;
    const state = window.__pvu.rollController.getState();

    // Sync toggle switches from controller state
    if (toggleRefs.costOverride) {
      setSwitchState(toggleRefs.costOverride, state.costOverride);
    }
    if (toggleRefs.luckLock) {
      setSwitchState(toggleRefs.luckLock, state.luckLock);
    }

    // Sync status text
    const statusEl = containerEl.querySelector('#pvu-roll-status');
    if (statusEl) {
      const hookStatus = state.hooksApplied ? t('roll.hooksActive') : t('roll.waitingHooks');
      const costStatus = state.costOverride ? ' | Cost Override: ON' : '';
      const luckStatus = state.luckLock ? ' | Luck Lock: ' + state.luckValue : '';
      const patchInfo = state.patchedPhaseCount > 0 ? ' | Phase patchate: ' + state.patchedPhaseCount : '';
      statusEl.textContent = hookStatus + costStatus + luckStatus + patchInfo;
      statusEl.className = 'pvu-status ' + (state.hooksApplied ? 'ok' : 'warn');
    }

    // Sync item count slider
    const slider = containerEl.querySelector('#pvu-item-slider');
    const valLabel = containerEl.querySelector('#pvu-item-val');
    if (slider && valLabel) {
      if (document.activeElement !== slider) {
        slider.value = state.itemCountExtra;
        valLabel.textContent = '+' + state.itemCountExtra;
      }
    }

    // BUG 3: Sync luck slider
    const luckSlider = containerEl.querySelector('#pvu-luck-slider');
    const luckValLabel = containerEl.querySelector('#pvu-luck-val');
    if (luckSlider && luckValLabel) {
      if (document.activeElement !== luckSlider) {
        luckSlider.value = state.luckValue;
        luckValLabel.textContent = state.luckValue;
      }
    }
  }

  /**
   * Sync a switch element's visual state from a boolean.
   * Does NOT trigger the click handler — only updates DOM class.
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
window.__pvu.rollScreen = PvuRollScreen;
