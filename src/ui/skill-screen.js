// src/ui/skill-screen.js — UI Skill Points Editor (tab Skill)
const PvuSkillScreen = (() => {
  const LOG_PREFIX = '[PvuSkillScreen]';
  let containerEl = null;
  let refreshTimer = null;

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  function render(parentEl) {
    containerEl = document.createElement('div');
    containerEl.id = 'pvu-skill-screen';

    // Skill Points Section
    const spSection = document.createElement('div');
    spSection.className = 'pvu-section';

    const spTitle = document.createElement('div');
    spTitle.className = 'pvu-section-title';
    spTitle.textContent = 'SKILL POINTS';
    spSection.appendChild(spTitle);

    // Champion selector
    const champLabel = document.createElement('div');
    champLabel.className = 'pvu-toggle-label';
    champLabel.textContent = 'Champion:';
    spSection.appendChild(champLabel);

    const champSelect = document.createElement('select');
    champSelect.className = 'pvu-champ-select';
    champSelect.id = 'pvu-champ-select';
    champSelect.addEventListener('change', function() { refreshUI(); });
    spSection.appendChild(champSelect);

    // Skill points input
    const spRow = document.createElement('div');
    spRow.className = 'pvu-input-row';

    const spInput = document.createElement('input');
    spInput.type = 'number';
    spInput.className = 'pvu-input';
    spInput.id = 'pvu-sp-input';
    spInput.placeholder = 'Skill Points';
    spInput.min = '0';
    spInput.value = '0';

    const spApplyBtn = document.createElement('button');
    spApplyBtn.className = 'pvu-btn';
    spApplyBtn.textContent = 'Apply';
    spApplyBtn.addEventListener('click', function() {
      const val = parseInt(spInput.value, 10);
      if (isNaN(val)) return;
      const result = window.__pvu.skillTreeEditor.setSkillPoints(val);
      if (result) {
        spInput.style.borderColor = '#4caf50';
        setTimeout(function() { spInput.style.borderColor = ''; }, 1000);
      }
    });

    spRow.appendChild(spInput);
    spRow.appendChild(spApplyBtn);
    spSection.appendChild(spRow);

    // Version warning
    const versionWarning = document.createElement('div');
    versionWarning.className = 'pvu-warning';
    versionWarning.style.display = 'none';
    versionWarning.id = 'pvu-version-warning';
    versionWarning.textContent = '⚠️ Champion skill version cambiata! Unlock precedenti potrebbero non essere validi.';
    spSection.appendChild(versionWarning);

    // Status
    const statusEl = document.createElement('div');
    statusEl.className = 'pvu-status';
    statusEl.id = 'pvu-skill-status';
    statusEl.textContent = 'In attesa...';
    spSection.appendChild(statusEl);

    containerEl.appendChild(spSection);

    // Locked Skills Section
    const lockedSection = document.createElement('div');
    lockedSection.className = 'pvu-section';

    const lockedTitle = document.createElement('div');
    lockedTitle.className = 'pvu-section-title';
    lockedTitle.textContent = 'SKILL BLOCCATE';
    lockedSection.appendChild(lockedTitle);

    const lockedList = document.createElement('div');
    lockedList.id = 'pvu-locked-list';
    lockedSection.appendChild(lockedList);

    containerEl.appendChild(lockedSection);

    // Version badge
    const verEl = document.createElement('div');
    verEl.className = 'pvu-ver';
    verEl.textContent = 'PokeVoid-Unlocked v' + (window.__pvu.config ? window.__pvu.config.VERSION : '1.0.0');
    containerEl.appendChild(verEl);

    parentEl.appendChild(containerEl);

    refreshTimer = setInterval(refreshUI, 3000);
    refreshUI();
  }

  function refreshUI() {
    if (!containerEl) return;
    const editor = window.__pvu.skillTreeEditor;
    const bridge = window.__pvu.bridge;

    // Aggiorna skill points
    const spInput = containerEl.querySelector('#pvu-sp-input');
    if (spInput) {
      const sp = editor.getSkillPoints();
      if (document.activeElement !== spInput) {
        spInput.value = sp;
      }
    }

    // Aggiorna champion selector
    const champSelect = containerEl.querySelector('#pvu-champ-select');
    if (champSelect) {
      const currentChamp = editor.getSelectedChampionId();
      const gameData = bridge.findGameData();
      if (gameData && gameData.championData) {
        const champs = Object.keys(gameData.championData);
        if (champSelect.options.length !== champs.length + 1) {
          champSelect.innerHTML = '<option value="">-- Seleziona Champion --</option>';
          for (let i = 0; i < champs.length; i++) {
            const opt = document.createElement('option');
            opt.value = champs[i];
            opt.textContent = champs[i];
            champSelect.appendChild(opt);
          }
        }
        if (currentChamp) champSelect.value = currentChamp;
      }
    }

    // Version warning
    const versionWarning = containerEl.querySelector('#pvu-version-warning');
    if (versionWarning) {
      const ver = editor.checkVersionWarning();
      versionWarning.style.display = ver.changed ? 'block' : 'none';
      if (ver.changed) {
        versionWarning.textContent = '⚠️ Champion skill version cambiata! (era ' + ver.oldVersion + ', ora ' + ver.newVersion + ')';
      }
    }

    // Locked skills list
    const lockedList = containerEl.querySelector('#pvu-locked-list');
    if (lockedList) {
      const unlockables = editor.getUnlockablesList();
      lockedList.innerHTML = '';
      if (unlockables.length === 0) {
        const info = document.createElement('div');
        info.className = 'pvu-info';
        info.textContent = 'Nessuna skill bloccata (o nessun champion selezionato)';
        lockedList.appendChild(info);
      } else {
        for (let i = 0; i < unlockables.length; i++) {
          const skill = unlockables[i];
          const item = document.createElement('div');
          item.className = 'pvu-skill-item';

          const nameEl = document.createElement('div');
          nameEl.className = 'pvu-skill-name';
          nameEl.textContent = skill.skillId;
          item.appendChild(nameEl);

          const metaEl = document.createElement('div');
          metaEl.className = 'pvu-skill-meta';
          metaEl.textContent = 'Cat: ' + skill.category + ' | Lv: ' + skill.requiredLevel;
          item.appendChild(metaEl);

          const unlockBtn = document.createElement('button');
          unlockBtn.className = 'pvu-btn pvu-btn-sm pvu-btn-outline';
          unlockBtn.textContent = 'Sblocca';
          unlockBtn.addEventListener('click', function() {
            const result = editor.unlockSkill(skill.skillId, skill.category);
            if (result.ok) {
              item.style.borderColor = '#4caf50';
              setTimeout(function() { refreshUI(); }, 500);
            } else {
              item.style.borderColor = '#f44336';
              setTimeout(function() { item.style.borderColor = '#e94560'; }, 1500);
            }
          });
          item.appendChild(unlockBtn);

          lockedList.appendChild(item);
        }
      }
    }

    // Status
    const statusEl = containerEl.querySelector('#pvu-skill-status');
    if (statusEl) {
      const sp = editor.getSkillPoints();
      const champId = editor.getSelectedChampionId();
      // BUG 5 FIX: garanzia array, mai undefined
      const locked = (editor.getLockedSkills && editor.getLockedSkills()) || [];
      statusEl.textContent = 'SP: ' + sp + ' | Champion: ' + (champId || 'nessuno') + ' | Bloccate: ' + locked.length;
      statusEl.className = 'pvu-status ok';
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
window.__pvu.skillScreen = PvuSkillScreen;
