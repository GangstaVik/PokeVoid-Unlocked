// src/ui/roll-screen.js — UI Roll Controller (tab Roll)
const PvuRollScreen = (() => {
  const LOG_PREFIX = '[PvuRollScreen]';
  let containerEl = null;
  let refreshTimer = null;

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
    rerollTitle.textContent = 'ROLL CONTROLLER';
    rerollSection.appendChild(rerollTitle);

    // Free Reroll (oneshot)
    const freeRerollRow = createToggle('Reroll gratuito', 'Prossimo reroll sarà gratuito (una volta)', false, function(val) {
      window.__pvu.rollController.toggleFreeReroll();
      refreshUI();
    });
    rerollSection.appendChild(freeRerollRow);

    // Pool Quality
    const poolQualityRow = createToggle('Qualità pool', 'Forza Legendary/Master nel pool', false, function(val) {
      window.__pvu.rollController.togglePoolQuality(val);
    });
    rerollSection.appendChild(poolQualityRow);

    // Cost Override
    const costOverrideRow = createToggle('Nessun costo', 'WAIVE_ROLL_FEE_OVERRIDE — tutti i reroll gratis', false, function(val) {
      window.__pvu.rollController.toggleCostOverride(val);
    });
    rerollSection.appendChild(costOverrideRow);

    containerEl.appendChild(rerollSection);

    // === Item Count Section ===
    const itemSection = document.createElement('div');
    itemSection.className = 'pvu-section';

    const itemTitle = document.createElement('div');
    itemTitle.className = 'pvu-section-title';
    itemTitle.textContent = 'ITEM COUNT';
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
    itemInfo.textContent = '3 base + bonus → es: +2 = 5 opzioni (default)';
    itemSection.appendChild(itemInfo);

    containerEl.appendChild(itemSection);

    // === Status ===
    const statusSection = document.createElement('div');
    statusSection.className = 'pvu-section';

    const statusTitle = document.createElement('div');
    statusTitle.className = 'pvu-section-title';
    statusTitle.textContent = 'STATO HOOK';
    statusSection.appendChild(statusTitle);

    const statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.id = 'pvu-roll-status';
    statusEl.textContent = 'In attesa...';
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
    row._pvuSwitch = switchEl;
    return row;
  }

  function refreshUI() {
    if (!containerEl) return;
    const state = window.__pvu.rollController.getState();
    const statusEl = containerEl.querySelector('#pvu-roll-status');
    if (statusEl) {
      const hookStatus = state.hooksApplied ? '✓ Hooks attivi' : '⏳ In attesa hooks...';
      const freeRerollStatus = state.freeReroll ? ' | Free Reroll: ON' : '';
      const costStatus = state.costOverride ? ' | Cost Override: ON' : '';
      const poolStatus = state.poolQuality ? ' | Pool Quality: ON' : '';
      statusEl.textContent = hookStatus + freeRerollStatus + costStatus + poolStatus;
      statusEl.className = 'pvu-status ' + (state.hooksApplied ? 'ok' : 'warn');
    }

    // Aggiorna slider
    const slider = containerEl.querySelector('#pvu-item-slider');
    const valLabel = containerEl.querySelector('#pvu-item-val');
    if (slider && valLabel) {
      slider.value = state.itemCountExtra;
      valLabel.textContent = '+' + state.itemCountExtra;
    }
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
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
