// src/skill-tree-editor.js — Editor skill points + unlock bypass
// BUG 2 FIX: read/write activeSkillTree.skillPoints (per-run SP), not gd.skillPoints (global)
// FIX: use resolveActiveChampionId fallback chain for champion detection
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
   * Get the activeSkillTree object from gameData.
   * This is the per-run skill tree instance containing skillPoints, tokens, unlockedBranches, etc.
   */
  function getActiveSkillTree() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return null;
    return gd.activeSkillTree || null;
  }

  // PARTE 5: log diagnostico throttlato — logga SOLO quando cambia (champId|source).
  // skill-screen chiama refreshUI ogni 3s → senza throttle spammeremmo la console.
  let lastChampLogKey = null;

  /**
   * Resolve the active champion ID using the game's own fallback chain:
   * selectedChampionId → activeSkillTree.championId → gender-based default
   * This matches bundle: resolveActiveChampionId() @15090868
   *
   * PARTE 5: label della sorgente + log diagnostico throttlato.
   * Il null qui NON è un risultato legittimo se gameData esiste (la catena cade
   * sempre sul gender-default) → un eventuale "champion non trovato" in UI è
   * un problema di timing del bridge (gameData non ancora visibile), non di logica.
   */
  function resolveActiveChampionId() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return null;

    let champId = null;
    let source = 'none';

    if (gd.selectedChampionId) {
      champId = gd.selectedChampionId;
      source = 'selectedChampionId';
    } else if (gd.activeSkillTree && gd.activeSkillTree.championId) {
      champId = gd.activeSkillTree.championId;
      source = 'activeSkillTree.championId';
    }

    if (champId === 'apollo_diana') {
      champId = gd.gender === 'FEMALE' ? 'diana' : 'apollo';
      source = source + '→apollo_diana:gender';
    }
    if (champId) {
      const key = champId + '|' + source;
      if (key !== lastChampLogKey) {
        lastChampLogKey = key;
        log('Champion risolto:', champId, '(source:', source + ')');
      }
      return champId;
    }

    // Caduta finale: default per gender (identico al gioco)
    const fallback = gd.gender === 'FEMALE' ? 'diana' : 'apollo';
    const key = fallback + '|gender-default';
    if (key !== lastChampLogKey) {
      lastChampLogKey = key;
      log('Champion risolto (gender default):', fallback, '(source: gender-default)');
    }
    return fallback;
  }

  /**
   * Leggi skillPoints correnti dal per-run activeSkillTree.
   * Bundle path: gameData.activeSkillTree.skillPoints (not gameData.skillPoints!)
   */
  function getSkillPoints() {
    const ast = getActiveSkillTree();
    if (!ast) return 0;
    return Number(ast.skillPoints || 0);
  }

  /**
   * Imposta skillPoints sul per-run activeSkillTree.
   */
  function setSkillPoints(amount) {
    const ast = getActiveSkillTree();
    if (!ast) {
      warn('activeSkillTree non disponibile (nessuna run attiva?)');
      return false;
    }
    ast.skillPoints = Math.max(0, Math.floor(amount));
    log('activeSkillTree.skillPoints impostato a', ast.skillPoints);
    return true;
  }

  /**
   * Get champion ID corrente — uses resolveActiveChampionId fallback.
   */
  function getSelectedChampionId() {
    return resolveActiveChampionId();
  }

  /**
   * BUG 5 FIX: normalizza lockedSkills in un array.
   * Il gioco può salvarlo come array, Map, o oggetto { [skillId]: {...} }.
   */
  function toSkillArray(locked) {
    if (!locked) return [];
    if (Array.isArray(locked)) return locked;
    if (typeof locked === 'string') return [{ skillId: locked }];
    if (typeof locked === 'object') {
      // Map-like
      if (typeof locked.values === 'function' && typeof locked.size === 'number') {
        return Array.from(locked.values());
      }
      // Object-like: { [skillId]: data }
      return Object.keys(locked).map(function(k) {
        const v = locked[k];
        if (v && typeof v === 'object') {
          return Object.assign({ skillId: k }, v);
        }
        return { skillId: k };
      });
    }
    return [];
  }

  /**
   * Get locked skills del champion corrente.
   * Reads from championData[championId].lockedSkills.
   */
  function getLockedSkills() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return [];
    const champId = resolveActiveChampionId();
    if (!champId) return [];
    const champData = gd.championData && gd.championData[champId];
    if (!champData) return [];
    return toSkillArray(champData.lockedSkills);
  }

  /**
   * Get champion skill version corrente.
   */
  function getChampionSkillVersion() {
    const gd = window.__pvu.bridge.findGameData();
    if (!gd) return null;
    const champId = resolveActiveChampionId();
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

    const champId = resolveActiveChampionId();
    if (!champId) return { ok: false, error: 'Nessun champion attivo nella run' };

    let champData = gd.championData && gd.championData[champId];
    if (!champData) {
      // Crea struttura se non esiste
      gd.championData = gd.championData || {};
      gd.championData[champId] = { lockedSkills: [] };
      champData = gd.championData[champId];
    }

    // 1. Rimuovi da lockedSkills (supporta array, Map, oggetto)
    if (champData.lockedSkills) {
      const lockedArr = toSkillArray(champData.lockedSkills);
      const idx = lockedArr.findIndex(function(s) {
        return s.skillId === skillId || s.id === skillId || s === skillId;
      });
      if (idx !== -1) {
        lockedArr.splice(idx, 1);
        champData.lockedSkills = lockedArr; // riscrivi normalizzato
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
