// styles.js — design tokens and UI stylesheet (v1.6.0)
/* global window, document */
'use strict';

window.__pvu = window.__pvu || {};

const PvuStyles = (function () {
  function inject() {
    if (document.getElementById('pvu-style')) return;
    const style = document.createElement('style');
    style.id = 'pvu-style';
    style.textContent = `
      :root {
        --pvu-bg: #0e1014;
        --pvu-surface: #171a21;
        --pvu-border: #2a2f3a;
        --pvu-text: #e6e9ef;
        --pvu-secondary: #9aa4b2;
        --pvu-accent: #4fa3ff;
        --pvu-success: #3ddc97;
        --pvu-warning: #ffb454;
        --pvu-danger: #ff5c5c;
        --pvu-radius-lg: 8px;
        --pvu-radius-md: 6px;
        --pvu-radius-sm: 4px;
        --pvu-space-1: 4px;
        --pvu-space-2: 8px;
        --pvu-space-3: 12px;
        --pvu-space-4: 16px;
        --pvu-space-5: 24px;
        --pvu-font-xs: 11px;
        --pvu-font-sm: 13px;
        --pvu-font-md: 15px;
        --pvu-font-lg: 17px;
        --pvu-transition: 0.18s;
      }

      #pvu-container {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 380px;
        pointer-events: none;
        z-index: 99998;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        color: var(--pvu-text);
      }

      #pvu-fab {
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--pvu-surface);
        border: 2px solid var(--pvu-accent);
        color: var(--pvu-accent);
        cursor: pointer;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform var(--pvu-transition), background var(--pvu-transition), color var(--pvu-transition);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
      }
      #pvu-fab:hover {
        transform: scale(1.08);
        background: rgba(79, 163, 255, 0.16);
      }

      #pvu-panel {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 380px;
        background: rgba(23, 26, 33, 0.95);
        -webkit-backdrop-filter: blur(10px);
        backdrop-filter: blur(10px);
        border-left: 1px solid var(--pvu-border);
        box-shadow: -8px 0 32px rgba(0, 0, 0, 0.45);
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        box-sizing: border-box;
        overflow: hidden;
      }

      .pvu-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--pvu-space-2);
        padding: var(--pvu-space-3) var(--pvu-space-4);
        border-bottom: 1px solid var(--pvu-border);
        background: var(--pvu-surface);
      }
      .pvu-header-title {
        font-size: var(--pvu-font-md);
        font-weight: 800;
        letter-spacing: 0.5px;
        color: var(--pvu-accent);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .pvu-close {
        width: 24px;
        height: 24px;
        border: none;
        border-radius: var(--pvu-radius-md);
        background: transparent;
        color: var(--pvu-secondary);
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color var(--pvu-transition), background var(--pvu-transition);
        flex-shrink: 0;
      }
      .pvu-close:hover {
        color: var(--pvu-text);
        background: var(--pvu-border);
      }

      .pvu-tabs {
        display: flex;
        gap: var(--pvu-space-1);
        padding: var(--pvu-space-2) var(--pvu-space-3) 0;
        background: var(--pvu-bg);
        border-bottom: 1px solid var(--pvu-border);
        flex-shrink: 0;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .pvu-tabs::-webkit-scrollbar {
        display: none;
      }
      .pvu-tab {
        padding: var(--pvu-space-2) var(--pvu-space-3);
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: var(--pvu-secondary);
        font-size: var(--pvu-font-sm);
        font-weight: 600;
        cursor: pointer;
        transition: color var(--pvu-transition), border-color var(--pvu-transition), background var(--pvu-transition);
        border-radius: var(--pvu-radius-md) var(--pvu-radius-md) 0 0;
      }
      .pvu-tab:hover {
        color: var(--pvu-text);
      }
      .pvu-tab.active {
        color: var(--pvu-accent);
        border-bottom-color: var(--pvu-accent);
        background: rgba(79, 163, 255, 0.08);
      }

      .pvu-tab-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--pvu-space-4);
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--pvu-space-3);
      }
      .pvu-tab-content::-webkit-scrollbar {
        width: 8px;
      }
      .pvu-tab-content::-webkit-scrollbar-thumb {
        background: var(--pvu-border);
        border-radius: var(--pvu-radius-sm);
      }

      .pvu-screen {
        display: flex;
        flex-direction: column;
        gap: var(--pvu-space-3);
        font-size: var(--pvu-font-sm);
      }

      .pvu-section-title {
        font-size: var(--pvu-font-md);
        font-weight: 800;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--pvu-accent);
        margin: 0;
      }

      .pvu-toggle-row {
        display: flex;
        align-items: center;
        gap: var(--pvu-space-2);
        padding: var(--pvu-space-2);
        border: 1px solid var(--pvu-border);
        border-radius: var(--pvu-radius-md);
        background: var(--pvu-surface);
      }
      .pvu-toggle-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        cursor: pointer;
        flex: 1;
      }
      .pvu-toggle-name {
        font-size: var(--pvu-font-sm);
        font-weight: 600;
        color: var(--pvu-text);
      }
      .pvu-toggle-desc {
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        line-height: 1.35;
      }
      .pvu-toggle-row input[type='checkbox'] {
        accent-color: var(--pvu-accent);
        width: 15px;
        height: 15px;
        cursor: pointer;
      }

      .pvu-input {
        width: 100%;
        box-sizing: border-box;
        padding: var(--pvu-space-2) var(--pvu-space-3);
        border: 1px solid var(--pvu-border);
        border-radius: var(--pvu-radius-md);
        background: var(--pvu-bg);
        color: var(--pvu-text);
        font-size: var(--pvu-font-sm);
        transition: border-color var(--pvu-transition);
      }
      .pvu-input:focus {
        outline: none;
        border-color: var(--pvu-accent);
      }
      .pvu-input::placeholder {
        color: var(--pvu-secondary);
      }

      .pvu-btn {
        padding: var(--pvu-space-2) var(--pvu-space-4);
        border: 1px solid var(--pvu-accent);
        border-radius: var(--pvu-radius-md);
        background: rgba(79, 163, 255, 0.12);
        color: var(--pvu-accent);
        font-size: var(--pvu-font-sm);
        font-weight: 700;
        cursor: pointer;
        transition: background var(--pvu-transition), color var(--pvu-transition);
      }
      .pvu-btn:hover {
        background: var(--pvu-accent);
        color: #0e1014;
      }
      .pvu-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .pvu-status-box {
        padding: var(--pvu-space-2) var(--pvu-space-3);
        border-radius: var(--pvu-radius-md);
        background: var(--pvu-surface);
        border: 1px solid var(--pvu-border);
        font-size: var(--pvu-font-xs);
        font-family: Consolas, Menlo, monospace;
        line-height: 1.45;
        color: var(--pvu-text);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .pvu-status-box.ok {
        border-color: rgba(61, 220, 151, 0.5);
        color: var(--pvu-success);
      }
      .pvu-status-box.warn {
        border-color: rgba(255, 180, 84, 0.5);
        color: var(--pvu-warning);
      }
      .pvu-status-box.err {
        border-color: rgba(255, 92, 92, 0.5);
        color: var(--pvu-danger);
      }

      .pvu-list-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--pvu-space-2);
        padding: var(--pvu-space-2);
        border: 1px solid var(--pvu-border);
        border-radius: var(--pvu-radius-md);
        background: var(--pvu-surface);
        font-size: var(--pvu-font-sm);
      }

      .pvu-info {
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        line-height: 1.45;
      }

      .pvu-strip {
        display: flex;
        gap: var(--pvu-space-2);
        padding: var(--pvu-space-2) var(--pvu-space-4);
        border-bottom: 1px solid var(--pvu-border);
        background: var(--pvu-bg);
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      .pvu-chip {
        padding: 2px var(--pvu-space-2);
        border-radius: 999px;
        border: 1px solid var(--pvu-border);
        background: var(--pvu-surface);
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        white-space: nowrap;
      }
      .pvu-chip.ok {
        color: var(--pvu-success);
        border-color: rgba(61, 220, 151, 0.45);
      }
      .pvu-chip.warn {
        color: var(--pvu-warning);
        border-color: rgba(255, 180, 84, 0.45);
      }

      .pvu-footer {
        padding: var(--pvu-space-2) var(--pvu-space-4);
        border-top: 1px solid var(--pvu-border);
        background: var(--pvu-surface);
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--pvu-space-2);
        flex-shrink: 0;
      }
      .pvu-footer-hint {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pvu-footer .pvu-btn {
        padding: 2px var(--pvu-space-2);
        font-size: var(--pvu-font-xs);
      }

      .pvu-modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        pointer-events: auto;
      }
      .pvu-modal-card {
        width: min(90vw, 360px);
        max-height: 80vh;
        overflow-y: auto;
        background: var(--pvu-surface);
        border: 1px solid var(--pvu-border);
        border-radius: var(--pvu-radius-lg);
        padding: var(--pvu-space-4);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
        display: flex;
        flex-direction: column;
        gap: var(--pvu-space-3);
      }
      .pvu-modal-card .pvu-close {
        align-self: flex-end;
      }
      .pvu-modal-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--pvu-space-2);
        font-size: var(--pvu-font-sm);
      }
      .pvu-modal-row-label {
        color: var(--pvu-secondary);
      }
      .pvu-modal-row-value {
        color: var(--pvu-text);
        font-weight: 600;
      }
      .pvu-features {
        margin: 0;
        padding-left: var(--pvu-space-4);
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        line-height: 1.6;
      }

      @media (max-width: 560px) {
        #pvu-container,
        #pvu-panel {
          left: 0;
          right: 0;
          width: auto;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        #pvu-panel,
        #pvu-fab,
        .pvu-tab,
        .pvu-btn,
        .pvu-close {
          transition: none;
        }
      }

      /* ----- pre-v1.6.0 selector parity (tokenized) ----- */
      #pvu-container.pvu-hidden {
        transform: translateX(100%);
      }
      #pvu-fab:active {
        transform: scale(0.95);
      }
      .pvu-tab.pvu-tab-active {
        color: var(--pvu-accent);
        border-bottom-color: var(--pvu-accent);
        background: rgba(79, 163, 255, 0.08);
      }
      .pvu-section {
        margin: 0 0 var(--pvu-space-4);
      }
      .pvu-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--pvu-space-2) 0;
        border-bottom: 1px solid var(--pvu-border);
      }
      .pvu-switch {
        width: 40px;
        height: 22px;
        background: var(--pvu-border);
        border-radius: 11px;
        cursor: pointer;
        position: relative;
        transition: background var(--pvu-transition);
        flex-shrink: 0;
      }
      .pvu-switch.on {
        background: var(--pvu-accent);
      }
      .pvu-switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        background: var(--pvu-text);
        border-radius: 50%;
        transition: transform var(--pvu-transition);
      }
      .pvu-switch.on::after {
        transform: translateX(18px);
      }
      .pvu-input-row {
        display: flex;
        gap: var(--pvu-space-2);
        align-items: center;
        margin-bottom: var(--pvu-space-2);
      }
      .pvu-btn:active {
        transform: scale(0.97);
      }
      .pvu-btn.pvu-btn-sm {
        padding: var(--pvu-space-1) 10px;
        font-size: var(--pvu-font-sm);
      }
      .pvu-btn.pvu-btn-outline {
        background: transparent;
        border: 1px solid var(--pvu-accent);
        color: var(--pvu-accent);
      }
      .pvu-btn.pvu-btn-outline:hover {
        background: rgba(79, 163, 255, 0.12);
      }
      .pvu-slider-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: var(--pvu-space-2);
      }
      .pvu-slider {
        flex: 1;
        -webkit-appearance: none;
        appearance: none;
        height: 4px;
        background: var(--pvu-border);
        border-radius: 2px;
        outline: none;
      }
      .pvu-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        background: var(--pvu-accent);
        border-radius: 50%;
        cursor: pointer;
      }
      .pvu-slider-val {
        min-width: 30px;
        text-align: center;
        font-size: var(--pvu-font-sm);
        color: var(--pvu-accent);
      }
      .pvu-status {
        font-size: var(--pvu-font-sm);
        color: var(--pvu-secondary);
        margin-top: var(--pvu-space-1);
      }
      .pvu-status.ok {
        color: var(--pvu-success);
      }
      .pvu-status.warn {
        color: var(--pvu-warning);
      }
      .pvu-status.err {
        color: var(--pvu-danger);
      }
      .pvu-skill-item {
        padding: var(--pvu-space-2);
        background: var(--pvu-bg);
        border-radius: var(--pvu-radius-sm);
        margin-bottom: 6px;
        border-left: 3px solid var(--pvu-accent);
      }
      .pvu-skill-name {
        font-size: var(--pvu-font-sm);
        color: var(--pvu-text);
        margin-bottom: var(--pvu-space-1);
      }
      .pvu-skill-meta {
        font-size: var(--pvu-font-sm);
        color: var(--pvu-secondary);
      }
      .pvu-warning {
        background: rgba(255, 180, 84, 0.15);
        border: 1px solid var(--pvu-warning);
        border-radius: var(--pvu-radius-sm);
        padding: var(--pvu-space-2) var(--pvu-space-3);
        margin-bottom: var(--pvu-space-3);
        font-size: var(--pvu-font-sm);
        color: var(--pvu-warning);
      }
      .pvu-champ-select {
        background: var(--pvu-bg);
        border: 1px solid var(--pvu-border);
        color: var(--pvu-text);
        padding: 6px 10px;
        border-radius: var(--pvu-radius-sm);
        font-size: var(--pvu-font-sm);
        width: 100%;
        margin-bottom: var(--pvu-space-2);
      }
      .pvu-champ-select option {
        background: var(--pvu-surface);
        color: var(--pvu-text);
      }
      .pvu-ver {
        font-size: var(--pvu-font-xs);
        color: var(--pvu-secondary);
        text-align: right;
        margin-top: var(--pvu-space-2);
      }
      .pvu-tab-content::-webkit-scrollbar-track {
        background: transparent;
      }
    `;
    document.head.appendChild(style);
    console.log('[PvuStyles] CSS injected');
  }

  return {
    inject: inject
  };
})();

window.__pvu.styles = PvuStyles;