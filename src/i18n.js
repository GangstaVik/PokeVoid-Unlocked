// i18n.js — UI dictionary and translation helper (v1.6.0)
/* global window */
'use strict';

window.__pvu = window.__pvu || {};

const PvuI18n = (function () {
  const DICT = {
    en: {
      // Panel / tabs
      'panel.title': 'PokeVoid-Unlocked',
      'tab.money': 'Money',
      'tab.roll': 'Roll',
      'tab.skill': 'Skill',
      'tab.voucher': 'Voucher',
      'tab.battle': 'Battle',
      'tab.essence': 'Essence',
      // Money tab
      'money.title': 'MONEY OVERRIDE',
      'money.placeholder': 'New amount',
      'money.waiting': 'Waiting...',
      'money.info': 'Edits scene.money (run) + permaMoney (persistent). The save is written automatically.',
      'money.current': 'Current money: $',
      'money.updated': 'Money updated to ',
      'money.error': 'Error',
      // Roll tab
      'roll.title': 'ROLL CONTROLLER',
      'roll.noCost': 'No Cost',
      'roll.noCostDesc': 'WAIVE_ROLL_FEE_OVERRIDE — all rerolls free',
      'roll.luckLock': 'LUCK LOCK',
      'roll.luckLockDesc': 'Locks the luck value (1-7) for roll offers',
      'roll.luckInfo': '1-7 (5 = default). Affects the quality of roll offers; does not touch battle party luck and does not affect shop/ball-lock.',
      'roll.itemCount': 'ITEM COUNT',
      'roll.itemInfo': 'Adds options to roll offers (e.g. +2 = 5 options with the 3 base ones).',
      'roll.hookStatus': 'HOOK STATUS',
      'roll.waiting': 'Waiting...',
      'roll.hooksActive': 'Hooks active',
      'roll.waitingHooks': 'Waiting for hooks...',
      // Skill tab
      'skill.title': 'SKILL POINTS',
      'skill.activeChampion': 'Active champion:',
      'skill.detecting': 'Detecting...',
      'skill.selectChampion': 'Select Champion (override):',
      'skill.versionWarning': 'Champion skill version changed! Previous unlocks may no longer be valid.',
      'skill.waiting': 'Waiting...',
      'skill.lockedTitle': 'LOCKED SKILLS',
      'skill.noneLocked': 'No locked skills (or no active champion in the run)',
      'skill.selectPlaceholder': 'Select Champion',
      'skill.unlock': 'Unlock',
      'skill.category': 'Cat: ',
      'skill.locked': 'Locked: ',
      'skill.statusLocked': 'SP: ',
      'skill.noActiveRun': 'No active run',
      // Battle tab
      'battle.shinyTitle': 'ALWAYS SHINY',
      'battle.shinyName': 'Always Shiny',
      'battle.shinyDesc': 'Every Pokemon encountered is born shiny (wild, boss, rival, legendary)',
      'battle.waiting': 'Waiting...',
      'battle.catchTitle': 'CATCH ANY',
      'battle.catchName': 'Catch Any',
      'battle.catchDesc': 'When the Catch toggle is active: the first Pokéball on a single target (non-rival/non-scripted) always catches.',
      'battle.specialsName': 'Catch special cases',
      'battle.specialsDesc': 'Allows forced capture also on scripted, final, special and boss-major encounters (risk: quest progression). Default OFF.',
      'battle.l1Fallback': 'L1 (fallback)',
      'battle.wrapperNotActive': 'wrapper NOT active (waiting for battle)',
      'battle.wrapperActive': 'wrapper active',
      'battle.idConfirmed': 'id confirmed',
      'battle.overrideArmed': 'override armed',
      'battle.overrideNotActive': '— probability override NOT active',
      'battle.level': 'Level: ',
      'battle.forcedCatches': 'Forced catches: ',
      'battle.realizedCatches': 'Realized catches: ',
      'battle.specialCases': 'Special cases: ',
      'battle.errors': 'Errors: ',
      'battle.disabled': 'Catch Any disabled',
      // Voucher tab
      'voucher.title': 'Voucher Editor',
      'voucher.info': 'Edits vouchers. The game saves automatically.',
      'voucher.updated': 'All vouchers updated',
      'voucher.waiting': 'Waiting...',
      'voucher.error': 'Error',
      'voucher.invalidType': 'Invalid voucher type',
      'voucher.invalidValue': 'Invalid value',
      'voucher.noGameData': 'Game data unavailable',
      // Essence tab
      'essence.title': 'TYPE ESSENCE',
      'essence.apiMissing': 'Type Essence API not found in this build: editor disabled.',
      'essence.error': 'Error: ',
      // Status strip
      'strip.gameWaiting': 'Waiting for game...',
      'strip.gameRunning': 'Game running',
      'strip.overrides': 'Overrides',
      // About modal
      'about.title': 'About',
      'about.shortcut': 'Shortcut',
      'about.rebind': 'Rebind',
      'about.version': 'Version',
      'about.features': 'Features',
      'about.pressKey': 'Press new shortcut...',
      'about.hintToggle': 'toggles the panel'
    }
  };

  function t(key) {
    return DICT.en[key] || key;
  }

  return {
    t: t,
    DICT: DICT
  };
})();

window.__pvu.i18n = PvuI18n;