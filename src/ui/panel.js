// src/ui/panel.js — Pannello principale con tab Money / Roll / Skill / Voucher / Battle
const PvuPanel = (() => {
  const t = window.__pvu.i18n.t.bind(window.__pvu.i18n);
  const LOG_PREFIX = '[PvuPanel]';
  let containerEl = null;
  let panelEl = null;
  let isOpen = false;
  let activeTab = 'roll';
  // PARTE 4: interval money creato a ogni renderMoneyTab senza clear = leak di timer
  // a ogni cambio tab. Un solo timer alla volta, pulito su re-render e destroy.
  let moneyTimer = null;
  let stripTimer = null;
  let activeScreen = null;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  // BUG 4 FIX: formatta importi grandi come 1K/10K/100K/1000K (max 1 decimale, senza .0)
  function formatMoney(n) {
    if (n < 1000) return String(n);
    const k = n / 1000;
    const rounded = Math.round(k * 10) / 10;
    return (rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(1)) + 'K';
  }

  function create() {
    if (containerEl) return containerEl;

    // Container (pointer-events: none)
    containerEl = document.createElement('div');
    containerEl.id = 'pvu-container';
    containerEl.className = 'pvu-hidden';

    // Panel (pointer-events: auto)
    panelEl = document.createElement('div');
    panelEl.id = 'pvu-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'pvu-header';
    const title = document.createElement('span');
    title.textContent = t('panel.title');
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pvu-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', toggle);
    header.appendChild(closeBtn);
    panelEl.appendChild(header);
    panelEl.appendChild(buildStrip());

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'pvu-tabs';

    const tabMoney = createTab(t('tab.money'), 'money');
    const tabRoll = createTab(t('tab.roll'), 'roll');
    const tabSkill = createTab(t('tab.skill'), 'skill');
    const tabVoucher = createTab(t('tab.voucher'), 'voucher');
    const tabBattle = createTab(t('tab.battle'), 'battle');
    const tabEssence = createTab(t('tab.essence'), 'essence');

    tabs.appendChild(tabMoney);
    tabs.appendChild(tabRoll);
    tabs.appendChild(tabSkill);
    tabs.appendChild(tabVoucher);
    tabs.appendChild(tabBattle);
    tabs.appendChild(tabEssence);
    panelEl.appendChild(tabs);

    // Tab content area
    const tabContent = document.createElement('div');
    tabContent.className = 'pvu-tab-content';
    tabContent.id = 'pvu-tab-content';
    panelEl.appendChild(tabContent);
    panelEl.appendChild(buildFooter());
    updateFooterHint();

    containerEl.appendChild(panelEl);

    // Inserisci nel body
    if (document.body) {
      document.body.appendChild(containerEl);
    } else {
      const observer = new MutationObserver(function() {
        if (document.body) {
          document.body.appendChild(containerEl);
          observer.disconnect();
        }
      });
      observer.observe(document.documentElement || document, { childList: true, subtree: true });
    }

    // Render tab iniziale
    renderTabContent(activeTab);

    refreshStrip();
    stripTimer = setInterval(refreshStrip, 2000);

    log('Panel created');
    return containerEl;
  }

  function createTab(label, tabId) {
    const tab = document.createElement('button');
    tab.className = 'pvu-tab' + (tabId === activeTab ? ' pvu-tab-active' : '');
    tab.textContent = label;
    tab.dataset.tab = tabId;
    tab.addEventListener('click', function() {
      switchTab(tabId);
    });
    return tab;
  }

  function buildStrip() {
    const strip = document.createElement('div');
    strip.className = 'pvu-strip';
    strip.id = 'pvu-strip';
    strip.appendChild(makeChip('pvu-strip-version', 'v' + window.__pvu.config.VERSION, ''));
    strip.appendChild(makeChip('pvu-strip-game', '', ''));
    strip.appendChild(makeChip('pvu-strip-overrides', '', ''));
    return strip;
  }

  function makeChip(id, label, state) {
    const chip = document.createElement('span');
    chip.className = 'pvu-chip' + (state ? ' ' + state : '');
    chip.id = id;
    chip.textContent = label;
    return chip;
  }

  function refreshStrip() {
    const gameChip = document.getElementById('pvu-strip-game');
    const ovrChip = document.getElementById('pvu-strip-overrides');
    if (!gameChip || !ovrChip) return;
    const hasBridge = !!(window.gameInfo && window.gameInfo.game);
    if (hasBridge) {
      gameChip.textContent = t('strip.gameRunning');
      gameChip.className = 'pvu-chip ok';
    } else {
      gameChip.textContent = t('strip.gameWaiting');
      gameChip.className = 'pvu-chip warn';
    }
    let count = 0;
    try {
      if (window.__pvu.encounterOverride && typeof window.__pvu.encounterOverride.getState === 'function') {
        const s = window.__pvu.encounterOverride.getState();
        if (s && s.shiny) count++;
      }
      if (window.__pvu.rollController && typeof window.__pvu.rollController.getState === 'function') {
        const s = window.__pvu.rollController.getState();
        if (s && (s.costOverride || s.luckLock || (s.itemCountExtra > 0))) count++;
      }
      if (window.__pvu.captureOverride && typeof window.__pvu.captureOverride.getState === 'function') {
        const s = window.__pvu.captureOverride.getState();
        if (s && (s.enabled || s.forceSpecial)) count++;
      }
    } catch (e) {
      /* strip read failures are cosmetic; ignore */
    }
    ovrChip.textContent = t('strip.overrides') + ': ' + count;
    ovrChip.className = count > 0 ? 'pvu-chip ok' : 'pvu-chip';
  }

  function buildFooter() {
    const footer = document.createElement('div');
    footer.className = 'pvu-footer';
    const hint = document.createElement('span');
    hint.className = 'pvu-footer-hint';
    hint.id = 'pvu-footer-hint';
    const aboutBtn = document.createElement('button');
    aboutBtn.className = 'pvu-btn';
    aboutBtn.textContent = t('about.title');
    aboutBtn.addEventListener('click', openAbout);
    footer.appendChild(hint);
    footer.appendChild(aboutBtn);
    return footer;
  }

  function updateFooterHint() {
    const hint = document.getElementById('pvu-footer-hint');
    if (!hint) return;
    const combo = window.__pvu.hotkey && typeof window.__pvu.hotkey.getComboLabel === 'function'
      ? window.__pvu.hotkey.getComboLabel()
      : 'Ctrl+Shift+P';
    hint.textContent = combo + ' ' + t('about.hintToggle') + '.';
  }

  function openAbout() {
    const backdrop = document.createElement('div');
    backdrop.className = 'pvu-modal-backdrop';
    const card = document.createElement('div');
    card.className = 'pvu-modal-card';
    const title = document.createElement('div');
    title.className = 'pvu-header-title';
    title.textContent = t('about.title') + ' — ' + t('panel.title');
    const close = document.createElement('button');
    close.className = 'pvu-close';
    close.textContent = '×';
    close.addEventListener('click', closeAbout);
    const rows = document.createElement('div');
    rows.style.display = 'flex';
    rows.style.flexDirection = 'column';
    rows.style.gap = '12px';
    const verRow = document.createElement('div');
    verRow.className = 'pvu-modal-row';
    const verLabel = document.createElement('span');
    verLabel.className = 'pvu-modal-row-label';
    verLabel.textContent = t('about.version');
    const verValue = document.createElement('span');
    verValue.className = 'pvu-modal-row-value';
    verValue.textContent = 'v' + window.__pvu.config.VERSION;
    verRow.appendChild(verLabel);
    verRow.appendChild(verValue);
    const scRow = document.createElement('div');
    scRow.className = 'pvu-modal-row';
    const scLabel = document.createElement('span');
    scLabel.className = 'pvu-modal-row-label';
    scLabel.textContent = t('about.shortcut');
    const scValue = document.createElement('span');
    scValue.className = 'pvu-modal-row-value';
    scValue.id = 'pvu-about-combo';
    scValue.textContent = window.__pvu.hotkey && typeof window.__pvu.hotkey.getComboLabel === 'function'
      ? window.__pvu.hotkey.getComboLabel()
      : 'Ctrl+Shift+P';
    const rebind = document.createElement('button');
    rebind.className = 'pvu-btn';
    rebind.textContent = t('about.rebind');
    rebind.addEventListener('click', function () {
      rebind.textContent = t('about.pressKey') + '...';
      if (window.__pvu.hotkey && typeof window.__pvu.hotkey.startCapture === 'function') {
        // API reale: startCapture(cb) con cb(newCombo, oldCombo); null su cancel/timeout.
        window.__pvu.hotkey.startCapture(function (newCombo) {
          rebind.textContent = t('about.rebind');
          if (!newCombo) return;
          const label = typeof window.__pvu.hotkey.getComboLabel === 'function'
            ? window.__pvu.hotkey.getComboLabel(newCombo)
            : 'Ctrl+Shift+P';
          updateComboLabel(label);
          updateFooterHint();
        });
      }
    });
    scRow.appendChild(scLabel);
    scRow.appendChild(scValue);
    scRow.appendChild(rebind);
    const featLabel = document.createElement('div');
    featLabel.className = 'pvu-modal-row-label';
    featLabel.textContent = t('about.features');
    const list = document.createElement('ul');
    list.className = 'pvu-features';
    [
      'Money override (permament, save-backed)',
      'Roll controller: no-cost, luck lock, item count',
      'Skill points: unlock skills of the active champion',
      'Voucher editor (types / values of each owned voucher)',
      'Battle: always-shiny, catch-any with special-case opt-in',
      'Type essence editor (per-type values)',
      'Toggle panel: ' + (window.__pvu.hotkey && typeof window.__pvu.hotkey.getComboLabel === 'function' ? window.__pvu.hotkey.getComboLabel() : 'Ctrl+Shift+P')
    ].forEach(function (text) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    card.appendChild(title);
    card.appendChild(close);
    card.appendChild(rows);
    rows.appendChild(verRow);
    rows.appendChild(scRow);
    rows.appendChild(featLabel);
    rows.appendChild(list);
    backdrop.appendChild(card);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeAbout();
    });
    document.getElementById('pvu-container').appendChild(backdrop);
  }

  function closeAbout() {
    const existing = document.querySelector('.pvu-modal-backdrop');
    if (existing) existing.remove();
  }

  function updateComboLabel(newLabel) {
    const el = document.getElementById('pvu-about-combo');
    if (el) el.textContent = newLabel || 'Ctrl+Shift+P';
  }

  function switchTab(tabId) {
    activeTab = tabId;

    // Aggiorna tab buttons
    const tabs = containerEl.querySelectorAll('.pvu-tab');
    for (let i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('pvu-tab-active', tabs[i].dataset.tab === tabId);
    }

    renderTabContent(tabId);
  }

  function renderTabContent(tabId) {
    const content = document.getElementById('pvu-tab-content');
    if (!content) return;

    // Distruggi la schermata precedente (evita leak di listener/timer su cambio tab)
    if (activeScreen && activeScreen.destroy) {
      try { activeScreen.destroy(); } catch (e) { /* ignore */ }
    }
    activeScreen = null;

    // Pulisci contenuto
    content.innerHTML = '';

    switch (tabId) {
      case 'money':
        renderMoneyTab(content);
        break;
      case 'roll':
        window.__pvu.rollScreen.render(content);
        activeScreen = window.__pvu.rollScreen;
        break;
      case 'skill':
        window.__pvu.skillScreen.render(content);
        activeScreen = window.__pvu.skillScreen;
        break;
      case 'voucher':
        window.__pvu.voucherScreen.render(content);
        activeScreen = window.__pvu.voucherScreen;
        break;
      case 'battle':
        window.__pvu.battleScreen.render(content);
        activeScreen = window.__pvu.battleScreen;
        break;
      case 'essence':
        window.__pvu.essenceScreen.render(content);
        activeScreen = window.__pvu.essenceScreen;
        break;
    }
  }

  function renderMoneyTab(parentEl) {
    const section = document.createElement('div');
    section.className = 'pvu-section';

    const title = document.createElement('div');
    title.className = 'pvu-section-title';
    title.textContent = t('money.title');
    section.appendChild(title);

    // Money input
    const row = document.createElement('div');
    row.className = 'pvu-input-row';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'pvu-input';
    input.id = 'pvu-money-input';
    input.placeholder = t('money.placeholder');
    input.min = '0';
    input.max = String(Number.MAX_SAFE_INTEGER);
    input.value = '0';

    // Aggiorna valore corrente
    try {
      const currentMoney = window.__pvu.moneyOverride.getMoney();
      input.value = currentMoney;
    } catch(e) {}

    const applyBtn = document.createElement('button');
    applyBtn.className = 'pvu-btn';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', function() {
      const result = window.__pvu.moneyOverride.applyFromInput(input);
      const statusEl = parentEl.querySelector('#pvu-money-status');
      if (statusEl) {
        if (result.ok) {
          statusEl.textContent = t('money.updated') + (result.sceneMoney || input.value);
          statusEl.className = 'pvu-status ok';
          input.style.borderColor = '#4caf50';
          setTimeout(function() { input.style.borderColor = ''; }, 1000);
        } else {
          statusEl.textContent = (result.error || t('money.error'));
          statusEl.className = 'pvu-status err';
        }
      }
    });

    row.appendChild(input);
    row.appendChild(applyBtn);
    section.appendChild(row);

    // Quick buttons
    const quickRow = document.createElement('div');
    quickRow.className = 'pvu-input-row';
    const presets = [1000, 10000, 99999, 999999];
    for (let i = 0; i < presets.length; i++) {
      const btn = document.createElement('button');
      btn.className = 'pvu-btn pvu-btn-sm';
      // BUG 4 FIX: 99999/1000 = 99.999 → formatta pulito (max 1 decimale, senza .0)
      btn.textContent = formatMoney(presets[i]);
      btn.addEventListener('click', function() {
        input.value = presets[i];
        applyBtn.click();
      });
      quickRow.appendChild(btn);
    }
    section.appendChild(quickRow);

    // Status
    const statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.id = 'pvu-money-status';
    statusEl.textContent = t('money.waiting');
    section.appendChild(statusEl);

    // Info
    const info = document.createElement('div');
    info.className = 'pvu-info';
    info.textContent = t('money.info');
    section.appendChild(info);

    parentEl.appendChild(section);

    // Aggiorna stato
    updateMoneyStatus(statusEl, input);
    // PARTE 4: nessun leak — clear del timer precedente prima di crearne uno nuovo
    if (moneyTimer) clearInterval(moneyTimer);
    moneyTimer = setInterval(function() { updateMoneyStatus(statusEl, input); }, 2000);
  }

  function updateMoneyStatus(statusEl, input) {
    if (!statusEl) return;
    const money = window.__pvu.moneyOverride.getMoney();
    statusEl.textContent = t('money.current') + money.toLocaleString();
    statusEl.className = 'pvu-status ok';
    if (document.activeElement !== input) {
      input.value = money;
    }
  }

  function toggle() {
    isOpen = !isOpen;
    if (containerEl) {
      containerEl.classList.toggle('pvu-hidden', !isOpen);
    }
    log('Panel', isOpen ? 'opened' : 'closed');
  }

  function open() {
    isOpen = true;
    if (containerEl) containerEl.classList.remove('pvu-hidden');
  }

  function close() {
    isOpen = false;
    if (containerEl) containerEl.classList.add('pvu-hidden');
  }

  function destroy() {
    if (moneyTimer) clearInterval(moneyTimer);
    moneyTimer = null;
    if (stripTimer) { clearInterval(stripTimer); stripTimer = null; }
    const stripEl = document.getElementById('pvu-strip');
    if (stripEl) stripEl.remove();
    closeAbout();
    if (containerEl && containerEl.parentNode) containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
    panelEl = null;
    isOpen = false;
    log('destroy');
  }

  return {
    create: create,
    toggle: toggle,
    open: open,
    close: close,
    destroy: destroy,
    openAbout: openAbout,
    closeAbout: closeAbout,
    isOpen: function() { return isOpen; },
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.panel = PvuPanel;