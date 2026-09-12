// hotkey.js — rebindable panel toggle hotkey (v1.6.0)
/* global window, document, localStorage */
'use strict';

window.__pvu = window.__pvu || {};

const PvuHotkey = (function () {
  const DEFAULT_COMBO = { ctrl: true, alt: false, shift: true, meta: false, key: 'p' };
  const STORAGE_KEY = 'data_pvu_hotkey';
  const CAPTURE_MS = 5000;
  const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta'];

  let combo = null;
  let onToggle = null;
  let capturing = false;
  let captureCb = null;
  let captureTimer = null;
  let keyHandler = null;

  function resolveStore() {
    const pvu = window.__pvu || {};
    if (pvu.storage && typeof pvu.storage.get === 'function' && typeof pvu.storage.set === 'function') {
      return {
        get: function (k) { try { return pvu.storage.get(k); } catch (e) { return null; } },
        set: function (k, v) { try { pvu.storage.set(k, v); return true; } catch (e) { return false; } }
      };
    }
    return {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    };
  }

  function loadCombo() {
    const raw = resolveStore().get(STORAGE_KEY);
    if (!raw) return DEFAULT_COMBO;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object' && typeof parsed.key === 'string' && parsed.key.length === 1) {
        return {
          ctrl: !!parsed.ctrl,
          alt: !!parsed.alt,
          shift: !!parsed.shift,
          meta: !!parsed.meta,
          key: parsed.key
        };
      }
    } catch (e) { /* fall through to default */ }
    return DEFAULT_COMBO;
  }

  function persist(c) {
    return resolveStore().set(STORAGE_KEY, JSON.stringify(c));
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return true;
    return !!el.isContentEditable;
  }

  function handleKeyDown(e) {
    if (capturing) {
      e.preventDefault();
      e.stopPropagation();
      handleCaptureKey(e);
      return;
    }
    if (!onToggle || !combo) return;
    if (isEditableTarget(e.target)) return;
    const k = e.key ? e.key.toLowerCase() : '';
    if (combo.key.toLowerCase() !== k) return;
    if (!!combo.ctrl !== e.ctrlKey) return;
    if (!!combo.alt !== e.altKey) return;
    if (!!combo.shift !== e.shiftKey) return;
    if (!!combo.meta !== e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  }

  function handleCaptureKey(e) {
    if (MODIFIER_KEYS.indexOf(e.key) !== -1) return;
    if (e.key && e.key.length !== 1) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl && !e.altKey) return;
    if (e.key === 'Escape') {
      stopCapture();
      if (captureCb) { captureCb(null, combo); captureCb = null; }
      return;
    }
    const newCombo = {
      ctrl: !!e.ctrlKey,
      alt: !!e.altKey,
      shift: !!e.shiftKey,
      meta: !!e.metaKey,
      key: e.key.toLowerCase()
    };
    stopCapture();
    persist(newCombo);
    const old = combo;
    combo = newCombo;
    console.log('[PvuHotkey] Combo reassigned: ' + getComboLabel(newCombo));
    if (captureCb) { captureCb(newCombo, old); captureCb = null; }
  }

  function startCapture(cb) {
    capturing = true;
    captureCb = cb;
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = setTimeout(function () {
      capturing = false;
      if (captureCb) { captureCb(null, combo); captureCb = null; }
    }, CAPTURE_MS);
  }

  function stopCapture() {
    capturing = false;
    if (captureTimer) { clearTimeout(captureTimer); captureTimer = null; }
  }

  function getCombo() {
    return combo;
  }

  function getComboLabel(c) {
    const cur = c || combo;
    if (!cur) return '';
    const parts = [];
    if (cur.ctrl) parts.push('Ctrl');
    if (cur.alt) parts.push('Alt');
    if (cur.shift) parts.push('Shift');
    if (cur.meta) parts.push('Meta');
    if (cur.key) parts.push(cur.key.toUpperCase());
    return parts.join('+');
  }

  function init(toggleFn) {
    onToggle = toggleFn;
    combo = loadCombo();
    keyHandler = function (e) { handleKeyDown(e); };
    document.addEventListener('keydown', keyHandler, true);
    console.log('[PvuHotkey] Hotkey ready: ' + getComboLabel());
  }

  function destroy() {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler, true);
      keyHandler = null;
    }
    onToggle = null;
    stopCapture();
  }

  return {
    init: init,
    destroy: destroy,
    startCapture: startCapture,
    getCombo: getCombo,
    getComboLabel: getComboLabel
  };
})();

window.__pvu.hotkey = PvuHotkey;