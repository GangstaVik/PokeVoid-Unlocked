// src/ui/panel.js — Pannello principale con tab Money / Roll / Skill / Voucher / Battle
const PvuPanel = (() => {
  const LOG_PREFIX = '[PvuPanel]';
  let containerEl = null;
  let panelEl = null;
  let isOpen = false;
  let activeTab = 'roll';
  // PARTE 4: interval money creato a ogni renderMoneyTab senza clear = leak di timer
  // a ogni cambio tab. Un solo timer alla volta, pulito su re-render e destroy.
  let moneyTimer = null;
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
    title.textContent = '⚡ PokeVoid-Unlocked';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pvu-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', toggle);
    header.appendChild(closeBtn);
    panelEl.appendChild(header);

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'pvu-tabs';

    const tabMoney = createTab('💰 Money', 'money');
    const tabRoll = createTab('🎲 Roll', 'roll');
    const tabSkill = createTab('🌳 Skill', 'skill');
    const tabVoucher = createTab('🎟️ Voucher', 'voucher');
    const tabBattle = createTab('🎯 Battle', 'battle');
    const tabEssence = createTab('✨ Essenze', 'essence');

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

    log('Panel creato');
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
    title.textContent = 'MONEY OVERRIDE';
    section.appendChild(title);

    // Money input
    const row = document.createElement('div');
    row.className = 'pvu-input-row';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'pvu-input';
    input.id = 'pvu-money-input';
    input.placeholder = 'Nuovo importo';
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
          statusEl.textContent = '✓ Money aggiornato a ' + (result.sceneMoney || input.value);
          statusEl.className = 'pvu-status ok';
          input.style.borderColor = '#4caf50';
          setTimeout(function() { input.style.borderColor = ''; }, 1000);
        } else {
          statusEl.textContent = '✗ ' + (result.error || 'Errore');
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
    statusEl.textContent = 'In attesa...';
    section.appendChild(statusEl);

    // Info
    const info = document.createElement('div');
    info.className = 'pvu-info';
    info.textContent = 'Modifica scene.money (run) + permaMoney (persistente). Il save viene salvato automaticamente.';
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
    statusEl.textContent = 'Money corrente: $' + money.toLocaleString();
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
    log('Panel', isOpen ? 'aperto' : 'chiuso');
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
    isOpen: function() { return isOpen; },
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.panel = PvuPanel;
