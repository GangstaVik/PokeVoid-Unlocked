// src/utils/config.js — Costanti e compat map
const PvuConfig = {
  VERSION: '1.1.0',
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
          // PARTE 2: NON patchabile (funzione standalone, non un metodo di prototype).
          // Il vecchio hook sceneProto era morto — rimosso dal roll-controller.
          aob: 'u(Wd,"getPlayerModifierTypeOptions")',
          offset: 18558724,
          occurrences: 2,
          instanceHook: false,
          deprecated: true,
        },
        getRaritiesForRewardType: {
          // standalone function bne, referenced via keepNames: u(bne,"getRaritiesForRewardType")
          // PARTE 2: NON patchabile (standalone). Rimosso dal roll-controller.
          aob: 'u(bne,"getRaritiesForRewardType")',
          offset: 16259791,
          occurrences: 1,
          instanceHook: false,
          deprecated: true,
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
        getModifierTypeOptionsOnPhase: {
          // method su SelectModifierPhase (su): legge this.scene.lockModifierTiers ? this.modifierTiers : void 0
          // Punto di aggancio REALE per item count + luck pool (istanza phase, NON standalone)
          aob: 'getModifierTypeOptions(t){let n=this.pathNodeFilter',
          offset: 17225564,
          occurrences: 2, // su (roll) + classe diversa (shop, @17411223)
          instanceHook: true,
        },
        getPartyLuckValue: {
          // standalone module fn JFe(a){return Le(7,1)} — NON raggiungibile via BFS graph
          // unico call site: this.arena.randomSpecies(t,n,void 0,JFe(this.party)) @21906050
          aob: 'u(JFe,"getPartyLuckValue")',
          offset: 18570036,
          occurrences: 1,
          instanceHook: false, // il luck entra come 4° argomento di arena.randomSpecies
        },
        randomSpeciesOnArena: {
          // metodo sull'istanza arena: randomSpecies(t,n,s,i) — i = luck (overridabile)
          aob: 'randomSpecies(t,n,s,i){var y;const l=this.scene.debugDuelmonWild',
          offset: 15026398,
          occurrences: 1,
          instanceHook: true,
        },
        tierEnumEe: {
          // Ee: MEH=-1, COMMON=0, GREAT=1, ULTRA=2, ROGUE=3, MASTER=4, LUXURY=5
          aob: 'MEH=-1',
          offset: 1664935,
          occurrences: 1,
        },
        rarityEnumSt: {
          // St: COMMON="common", GREAT="great", ULTRA="ultra", ROGUE="rogue", MASTER="master", LEGENDARY="legendary"
          aob: 'COMMON="common"',
          offset: 14460592,
          occurrences: 1,
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
