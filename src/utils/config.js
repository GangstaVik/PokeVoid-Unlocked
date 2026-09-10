// src/utils/config.js — Costanti e compat map
const PvuConfig = {
  VERSION: '1.0.0',
  PREFIX: 'data_pvu_',
  BUILD_VERSION_FALLBACK: 'v3.1.8',
  MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,

  // compat map: bundle version → known offsets/patterns
  COMPAT: {
    'v3.1.8': {
      classes: {
        SelectModifierPhase: { search: 'SelectModifierPhase' },
      },
      functions: {
        getRerollCost: {
          aob: 'getRerollCost(t,n){if(o.WAIVE_ROLL_FEE_OVERRIDE',
          stringSearch: 'getRerollCost',
        },
        getPlayerModifierTypeOptions: {
          aob: 'u(Wd,"getPlayerModifierTypeOptions")',
          stringSearch: 'getPlayerModifierTypeOptions',
        },
        getRaritiesForRewardType: {
          stringSearch: 'getRaritiesForRewardType',
        },
        updateMoneyText: {
          stringSearch: 'updateMoneyText',
        },
        updateGameInfo: {
          aob: 'window.gameInfo=t}initFinalBossPhaseTwo(t)',
          stringSearch: 'updateGameInfo',
        },
        unshiftPhase: {
          stringSearch: 'unshiftPhase',
        },
        pushPhase: {
          stringSearch: 'pushPhase',
        },
        WAIVE_ROLL_FEE_OVERRIDE: {
          aob: 'WAIVE_ROLL_FEE_OVERRIDE',
          stringSearch: 'WAIVE_ROLL_FEE_OVERRIDE',
        },
      },
    },
  },

  // mapping fase → features abilitate
  PHASE_FEATURES: {
    battle: ['money'],
    modifierSelect: ['money', 'roll'],
    shop: ['money'],
    skillTree: ['money', 'skill'],
    menu: ['money', 'skill'],
    title: [],
    loading: [],
  },

  // mapping nome unlockable → chiave in unlocked<>
  UNLOCK_MAP: {
    megaStones: 'unlockedMegaStones',
    xms: 'unlockedXMs',
    smittyAbilities: 'unlockedSmittyAbilities',
    legendaryPokemon: 'unlockedLegendaryPokemon',
    signaturePokemon: 'unlockedSignaturePokemon',
    glitchForms: 'unlockedGlitchForms',
  },
};

// esporta come globale
window.__pvu = window.__pvu || {};
window.__pvu.config = PvuConfig;
