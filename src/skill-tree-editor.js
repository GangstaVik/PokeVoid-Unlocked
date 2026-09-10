// src/skill-tree-editor.js — Editor skill points + unlock bypass
const PvuSkillTreeEditor = (() => {
  const LOG_PREFIX = '[PvuSkillTreeEditor]';
  const UNLOCK_MAP = {
    megaStones: 'unlockedMegaStones',
    xms: 'unlockedXMs',
    smittyAbilities: 'unlockedSmittyAbilities',
    legendaryPokemon: 'unlockedLegendaryPokemon',
    signaturePokemon: 'unlockedSignaturePokemon',
    glitchForms: 'unlockedGlitchForms',
  };

  function log() {
    console.log.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [LOG_PREFIX].concat(Array.from(arguments)));
  }

  /**
   * Leggi skillPoints correnti.
   */
  function getSkillPoints() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return 0;
    return Number(gd.skillPoints || 0);
  }

  /**
   * Imposta skillPoints.
   */
  function setSkillPoints(amount) {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) {
      warn('gameData non disponibile');
      return false;
    }
    gd.skillPoints = Math.max(0, Math.floor(amount));
    log('skillPoints impostato a', gd.skillPoints);
    return true;
  }

  /**
   * Get champion ID corrente.
   */
  function getSelectedChampionId() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return null;
    return gd.selectedChampionId || null;
  }

  /**
   * Get locked skills del champion corrente.
   */
  function getLockedSkills() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return [];
    const champId = gd.selectedChampionId;
    if (!champId) return [];
    const champData = gd.championData && gd.championData[champId];
    if (!champData) return [];
    return champData.lockedSkills || [];
  }

  /**
   * Get champion skill version corrente.
   */
  function getChampionSkillVersion() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return null;
    const champId = gd.selectedChampionId;
    if (!champId) return null;
    const champData = gd.championData && gd.championData[champId];
    if (!champData) return null;
    return champData.championSkillVersion || gd.championSkillVersion || null;
  }

  /**
   * Sblocca una skill: bypass prerequisiti, spesa 0, push in unlocked<>.
   * @param {string} skillId - L'ID della skill da sbloccare
   * @param {string} unlockableCategory - La categoria (megaStones, xms, etc.)
   * @returns {{ ok: boolean, error?: string }}
   */
  function unlockSkill(skillId, unlockableCategory) {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return { ok: false, error: 'gameData non disponibile' };

    const champId = gd.selectedChampionId;
    if (!champId) return { ok: false, error: 'Nessun champion selezionato' };

    let champData = gd.championData && gd.championData[champId];
    if (!champData) {
      // Crea struttura se non esiste
      gd.championData = gd.championData || {};
      gd.championData[champId] = { lockedSkills: [] };
      champData = gd.championData[champId];
    }

    // 1. Rimuovi da lockedSkills
    if (champData.lockedSkills) {
      const idx = champData.lockedSkills.findIndex(function(s) {
        return s.skillId === skillId || s.id === skillId || s === skillId;
      });
      if (idx !== -1) {
        champData.lockedSkills.splice(idx, 1);
        log('Skill', skillId, 'rimossa da lockedSkills');
      }
    }

    // 2. Push in unlocked<category>
    const unlockedKey = UNLOCK_MAP[unlockableCategory];
    if (unlockedKey) {
      champData[unlockedKey] = champData[unlockedKey] || [];
      if (champData[unlockedKey].indexOf(skillId) === -1) {
        champData[unlockedKey].push(skillId);
        log('Skill', skillId, 'aggiunta a', unlockedKey);
      }
    }

    // 3. Trigger save
    try {
      if (typeof gd.saveSystem === 'function') {
        gd.saveSystem();
        log('saveSystem() invocato dopo unlock');
      }
    } catch(e) {
      warn('saveSystem fallito:', e);
    }

    return { ok: true };
  }

  /**
   * Check se la champion skill version è cambiata rispetto all'ultima volta
   * che abbiamo fatto unlock (warning).
   */
  function checkVersionWarning() {
    const currentVer = getChampionSkillVersion();
    const savedVer = null;
    try {
      const saved = localStorage.getItem('__pvu_unlockedVersion');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.version !== currentVer) {
          return { changed: true, oldVersion: parsed.version, newVersion: currentVer };
        }
      }
    } catch(e) {}
    return { changed: false };
  }

  /**
   * Salva la versione corrente dopo unlock.
   */
  function saveVersion() {
    const ver = getChampionSkillVersion();
    if (ver) {
      try {
        localStorage.setItem('__pvu_unlockedVersion', JSON.stringify({ version: ver, ts: Date.now() }));
      } catch(e) {}
    }
  }

  /**
   * Get lista di tutti gli unlockables possibili (dai lockedSkills).
   */
  function getUnlockablesList() {
    const locked = getLockedSkills();
    const result = [];
    for (let i = 0; i < locked.length; i++) {
      const skill = locked[i];
      if (!skill) continue;
      const skillId = skill.skillId || skill.id || ('skill_' + i);
      const category = skill.category || skill.type || guessCategory(skill);
      const requiredLevel = skill.unlockLevel || skill.level || 0;
      const requiredEssence = skill.requiredEssenceWeights || skill.essenceWeights || null;
      result.push({
        skillId: skillId,
        category: category,
        requiredLevel: requiredLevel,
        requiredEssence: requiredEssence,
        raw: skill,
      });
    }
    return result;
  }

  function guessCategory(skill) {
    const s = JSON.stringify(skill).toLowerCase();
    if (s.indexOf('mega') !== -1) return 'megaStones';
    if (s.indexOf('xm') !== -1 || s.indexOf('key_m') !== -1) return 'xms';
    if (s.indexOf('smitty') !== -1 || s.indexOf('ability') !== -1) return 'smittyAbilities';
    if (s.indexOf('legendary') !== -1 || s.indexOf('legend') !== -1) return 'legendaryPokemon';
    if (s.indexOf('signature') !== -1 || s.indexOf('sig') !== -1) return 'signaturePokemon';
    if (s.indexOf('glitch') !== -1) return 'glitchForms';
    return 'megaStones'; // default
  }

  return {
    getSkillPoints: getSkillPoints,
    setSkillPoints: setSkillPoints,
    getSelectedChampionId: getSelectedChampionId,
    getLockedSkills: getLockedSkills,
    getChampionSkillVersion: getChampionSkillVersion,
    unlockSkill: unlockSkill,
    checkVersionWarning: checkVersionWarning,
    saveVersion: saveVersion,
    getUnlockablesList: getUnlockablesList,
  };
})();

window.__pvu = window.__pvu || {};
window.__pvu.skillTreeEditor = PvuSkillTreeEditor;
