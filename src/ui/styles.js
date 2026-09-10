// src/ui/styles.js — CSS iniettato nel DOM (zero dipendenze)
const PvuStyles = (() => {
  const LOG_PREFIX = '[PvuStyles]';
  let injected = false;

  function inject() {
    if (injected) return;
    injected = true;

    const css = `
/* PokeVoid-Unlocked Styles */
#pvu-container {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 380px;
  pointer-events: none;
  z-index: 99998;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  transition: transform 0.3s ease;
}
#pvu-container.pvu-hidden {
  transform: translateX(100%);
}

/* Floating button */
#pvu-fab {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  background: #1a1a2e;
  border: 2px solid #e94560;
  border-radius: 50%;
  color: #e94560;
  font-size: 18px;
  cursor: pointer;
  z-index: 99999;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, background 0.2s;
  user-select: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
#pvu-fab:hover {
  transform: scale(1.1);
  background: #e94560;
  color: #1a1a2e;
}
#pvu-fab:active {
  transform: scale(0.95);
}

/* Panel */
#pvu-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 380px;
  background: rgba(26, 26, 46, 0.95);
  backdrop-filter: blur(10px);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: #eee;
}

/* Header */
#pvu-panel .pvu-header {
  padding: 12px 16px;
  background: #e94560;
  color: #1a1a2e;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 18px;
  font-weight: 700;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
#pvu-panel .pvu-header .pvu-close {
  cursor: pointer;
  font-size: 20px;
  color: #1a1a2e;
  background: none;
  border: none;
  padding: 0 4px;
}

/* Tabs */
#pvu-panel .pvu-tabs {
  display: flex;
  border-bottom: 1px solid #333;
}
#pvu-panel .pvu-tab {
  flex: 1;
  padding: 10px 8px;
  text-align: center;
  cursor: pointer;
  color: #888;
  font-size: 14px;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  font-family: inherit;
}
#pvu-panel .pvu-tab:hover {
  color: #eee;
}
#pvu-panel .pvu-tab.pvu-tab-active {
  color: #e94560;
  border-bottom-color: #e94560;
}

/* Tab content */
#pvu-panel .pvu-tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

/* Section */
#pvu-panel .pvu-section {
  margin-bottom: 16px;
}
#pvu-panel .pvu-section-title {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 16px;
  color: #e94560;
  margin-bottom: 8px;
  text-transform: uppercase;
}

/* Toggle switch */
#pvu-panel .pvu-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #333;
}
#pvu-panel .pvu-toggle-label {
  font-size: 14px;
  color: #f0f0f0;
}
#pvu-panel .pvu-toggle-desc {
  font-size: 13px;
  color: #aaa;
}
#pvu-panel .pvu-switch {
  width: 40px;
  height: 22px;
  background: #333;
  border-radius: 11px;
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}
#pvu-panel .pvu-switch.on {
  background: #e94560;
}
#pvu-panel .pvu-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: #eee;
  border-radius: 50%;
  transition: transform 0.2s;
}
#pvu-panel .pvu-switch.on::after {
  transform: translateX(18px);
}

/* Input row */
#pvu-panel .pvu-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
#pvu-panel .pvu-input {
  flex: 1;
  background: #111;
  border: 1px solid #444;
  color: #eee;
  padding: 6px 10px;
  border-radius: 4px;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
}
#pvu-panel .pvu-input:focus {
  border-color: #e94560;
  outline: none;
}
#pvu-panel .pvu-btn {
  background: #e94560;
  color: #fff;
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  white-space: nowrap;
}
#pvu-panel .pvu-btn:hover {
  background: #d63851;
}
#pvu-panel .pvu-btn:active {
  transform: scale(0.97);
}
#pvu-panel .pvu-btn.pvu-btn-sm {
  padding: 4px 10px;
  font-size: 13px;
}
#pvu-panel .pvu-btn.pvu-btn-outline {
  background: transparent;
  border: 1px solid #e94560;
  color: #e94560;
}
#pvu-panel .pvu-btn.pvu-btn-outline:hover {
  background: #e9456022;
}

/* Slider */
#pvu-panel .pvu-slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
#pvu-panel .pvu-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: #333;
  border-radius: 2px;
  outline: none;
}
#pvu-panel .pvu-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #e94560;
  border-radius: 50%;
  cursor: pointer;
}
#pvu-panel .pvu-slider-val {
  min-width: 30px;
  text-align: center;
  font-size: 14px;
  color: #e94560;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* Status badge */
#pvu-panel .pvu-status {
  font-size: 13px;
  color: #aaa;
  margin-top: 4px;
}
#pvu-panel .pvu-status.ok { color: #66bb6a; }
#pvu-panel .pvu-status.warn { color: #ffb74d; }
#pvu-panel .pvu-status.err { color: #ef5350; }

/* Skill list */
#pvu-panel .pvu-skill-item {
  padding: 8px;
  background: #111;
  border-radius: 4px;
  margin-bottom: 6px;
  border-left: 3px solid #e94560;
}
#pvu-panel .pvu-skill-name {
  font-size: 14px;
  color: #f0f0f0;
  margin-bottom: 4px;
}
#pvu-panel .pvu-skill-meta {
  font-size: 13px;
  color: #aaa;
}

/* Warning box */
#pvu-panel .pvu-warning {
  background: rgba(255, 152, 0, 0.15);
  border: 1px solid #ff9800;
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #ffb74d;
}

/* Info box */
#pvu-panel .pvu-info {
  background: rgba(33, 150, 243, 0.1);
  border: 1px solid #2196f3;
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #90caf9;
}

/* Scrollbar */
#pvu-panel .pvu-tab-content::-webkit-scrollbar {
  width: 6px;
}
#pvu-panel .pvu-tab-content::-webkit-scrollbar-track {
  background: transparent;
}
#pvu-panel .pvu-tab-content::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 3px;
}

/* Champion selector */
#pvu-panel .pvu-champ-select {
  background: #111;
  border: 1px solid #444;
  color: #eee;
  padding: 6px 10px;
  border-radius: 4px;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  width: 100%;
  margin-bottom: 8px;
}
#pvu-panel .pvu-champ-select option {
  background: #1a1a2e;
  color: #eee;
}

/* Version badge */
#pvu-panel .pvu-ver {
  font-size: 12px;
  color: #888;
  text-align: right;
  margin-top: 8px;
}
`;

    const style = document.createElement('style');
    style.id = 'pvu-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    console.log('[PvuStyles] CSS iniettato');
  }

  return { inject: inject };
})();

window.__pvu = window.__pvu || {};
window.__pvu.styles = PvuStyles;
