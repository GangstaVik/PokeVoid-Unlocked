// src/utils/config.js — Costanti e compat map
const PvuConfig = {
  VERSION: '1.0.1',
  PREFIX: 'data_pvu_',
  BUILD_VERSION_FALLBACK: 'v3.1.8',
  MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,

  // compat map: bundle version → known offsets/patterns (verified against pokevoid-bundle.js)
  COMPAT: {
    'v3.1.8': {
      classes: {
        SelectModifierPhase: {
          search: 'SelectModifierPhase',
          minifiedName: 'su',       // class su extends Gi{constructor...
          offset: 17211390,          // byte offset of 'class su '
        },
      },
      functions: {
        getRerollCost: {
          // NOTE: this method is ON SelectModifierPhase (su), NOT on the scene
          aob: 'getRerollCost(t,n){if(ot.WAIVE_ROLL_FEE_OVERRIDE)return{rerollCost:0,permaRerollCost:0}',
          offset: 17223262,
          occurrences: 38,
          instanceHook: true,  // patch on phase instance, not class prototype
        },
        getPlayerModifierTypeOptions: {
          // standalone function Wd, referenced via keepNames: u(Wd,"getPlayerModifierTypeOptions")
          aob: 'u(Wd,"getPlayerModifierTypeOptions")',
          offset: 18558724,
          occurrences: 2,
          instanceHook: false, // this is called as a function with this=scene, so hook scene prototype
        },
        getRaritiesForRewardType: {
          // standalone function bne, referenced via keepNames: u(bne,"getRaritiesForRewardType")
          aob: 'u(bne,"getRaritiesForRewardType")',
          offset: 16259791,
          occurrences: 1,
          instanceHook: false, // called as method on scene or standalone
        },
        updateMoneyText: {
          // method on battle scene — scene.updateMoneyText()
          aob: 'updateMoneyText(t=!0){if(this.money===void 0)return',
          offset: 21902723,
          occurrences: 16,
          instanceHook: false,
        },
        updateGameInfo: {
          // method on battle scene — this.updateGameInfo()
          aob: 'updateGameInfo(){var n,s;const t={playTime',
          offset: 21940845,
          occurrences: 8,
          instanceHook: false,
        },
        unshiftPhase: {
          stringSearch: 'unshiftPhase',
        },
        pushPhase: {
          stringSearch: 'pushPhase',
        },
        WAIVE_ROLL_FEE_OVERRIDE: {
          aob: 'WAIVE_ROLL_FEE_OVERRIDE=!1,this.WAIVE_SHOP_FEES_OVERRIDE',
          offset: 1601620,
          occurrences: 16,
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
