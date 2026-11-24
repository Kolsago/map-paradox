/**
 * WhyMapped — Map Paradox
 * Main Application Orchestrator
 * "Every Map Has a Why."
 */

import { WORLD_COUNTRIES } from './data/world.js';
import * as geo from './engine/geo.js';
import { GlobeEngine } from './engine/globe.js';
import { soundEngine } from './engine/audio.js';
import * as data from './data/paradoxes.js';
import * as dailySeed from './data/dailySeed.js';
import * as shareCard from './ui/shareCard.js';

import { createDailyMode } from './modes/dailyMode.js';
import { createTrueSizeMode } from './modes/trueSizeMode.js';
import { createAntipodeMode } from './modes/antipodeMode.js';
import { createExplorerMode } from './modes/explorerMode.js';

const MODE_REGISTRY = {
  daily: {
    id: 'daily',
    label: 'Daily Paradox',
    factory: createDailyMode,
    defaultHint: 'Drag to spin • Scroll to zoom • Click to place pinpoint guesses',
  },
  truesize: {
    id: 'truesize',
    label: 'True-Size Lab',
    factory: createTrueSizeMode,
    defaultHint: 'Drag country overlays across latitudes • Press R to rotate',
  },
  antipode: {
    id: 'antipode',
    label: 'Antipode Drill',
    factory: createAntipodeMode,
    defaultHint: 'Click anywhere on Earth to drill straight through the core',
  },
  explorer: {
    id: 'explorer',
    label: 'Anomaly Atlas',
    factory: createExplorerMode,
    defaultHint: 'Drag to explore • Click golden hotspots or browse dossiers',
  },
};

const MODE_ORDER = ['daily', 'truesize', 'antipode', 'explorer'];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function parseModeFromHash() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '').trim().toLowerCase();
  return MODE_REGISTRY[raw] ? raw : 'daily';
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
}

function formatCompactArea(areaKm2) {
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) return '';
  if (areaKm2 >= 1_000_000) return `${(areaKm2 / 1_000_000).toFixed(2)}M km²`;
  if (areaKm2 >= 10_000) return `${Math.round(areaKm2 / 1_000)}K km²`;
  return `${Math.round(areaKm2).toLocaleString()} km²`;
}

function initApp() {
  const appShell = document.querySelector('.app-shell');
  const canvasWrap = document.getElementById('canvas-wrap');
  const canvas = document.getElementById('globe-canvas');
  const panelEl = document.getElementById('mode-panel');
  const panelShell = document.getElementById('mode-panel-shell');
  const hintEl = document.getElementById('globe-hint');
  const coordsEl = document.getElementById('globe-coords');
  const countryPillEl = document.getElementById('globe-country-pill');
  const projPillEl = document.getElementById('globe-proj-pill');
  const zoomReadoutEl = document.getElementById('globe-zoom-readout');
  const toastRoot = document.getElementById('toast-root');
  const drawerModeLabel = document.getElementById('drawer-mode-label');
  const drawerToggleBtn = document.getElementById('btn-drawer-toggle');

  const soundBtn = document.getElementById('btn-sound');
  const shortcutsBtn = document.getElementById('btn-shortcuts');
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const shortcutsCloseBtn = document.getElementById('btn-shortcuts-close');
  const shortcutsOkBtn = document.getElementById('btn-shortcuts-ok');

  const zoomInBtn = document.getElementById('btn-zoom-in');
  const zoomOutBtn = document.getElementById('btn-zoom-out');
  const resetViewBtn = document.getElementById('btn-reset-view');
  const autoSpinBtn = document.getElementById('btn-autospin');
  const tabButtons = Array.from(document.querySelectorAll('.mode-tab[data-mode]'));

  if (!canvas || !panelEl || !canvasWrap) {
    console.error('[WhyMapped] Required shell elements missing.');
    return;
  }

  /* ---------- Sound State (owned by soundEngine) ---------- */
  function syncSoundUi() {
    const muted = Boolean(soundEngine.isMuted?.());
    soundBtn?.classList.toggle('is-muted', muted);
    soundBtn?.setAttribute('aria-pressed', muted ? 'false' : 'true');
    soundBtn?.setAttribute('title', muted ? 'Unmute Sound (M)' : 'Mute Sound (M)');
  }
  syncSoundUi();

  function toggleSound() {
    const nextMuted = !Boolean(soundEngine.isMuted?.());
    soundEngine.setMuted?.(nextMuted);
    syncSoundUi();
    if (!nextMuted) soundEngine.playClick?.();
    notify(nextMuted ? 'Sound effects muted' : 'Sound effects enabled', 'info');
  }

  /* ---------- Toast Notification Stack ---------- */
  function notify(message, type = 'info') {
    if (!toastRoot || !message) return;
    while (toastRoot.children.length >= 3) {
      toastRoot.firstElementChild?.remove();
    }

    const toast = document.createElement('div');
    const safeType = ['info', 'success', 'warn', 'error'].includes(type) ? type : 'info';
    toast.className = `toast toast-${safeType}`;
    toast.textContent = String(message);
    toastRoot.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('toast-out');
      window.setTimeout(() => toast.remove(), 220);
    }, 3100);
  }

  /* ---------- Globe Hint & HUD ---------- */
  function setGlobeHint(text) {
    if (!hintEl) return;
    if (!text) {
      hintEl.hidden = true;
      return;
    }
    hintEl.hidden = false;
    hintEl.textContent = String(text);
  }

  function updateProjectionPill(proj) {
    if (!projPillEl) return;
    const isMerc = proj === 'mercator';
    projPillEl.textContent = isMerc ? '2D MERCATOR' : '3D GLOBE';
    projPillEl.classList.toggle('is-mercator', isMerc);
  }

  function updateCoordsHud(info) {
    if (!coordsEl) return;
    if (!info || !Number.isFinite(info.lon) || !Number.isFinite(info.lat)) {
      if (countryPillEl) countryPillEl.hidden = true;
      return;
    }
    const latDir = info.lat >= 0 ? 'N' : 'S';
    const lonDir = info.lon >= 0 ? 'E' : 'W';
    coordsEl.textContent = `${Math.abs(info.lat).toFixed(2)}° ${latDir} • ${Math.abs(info.lon).toFixed(2)}° ${lonDir}`;

    if (countryPillEl) {
      if (info.country?.name) {
        const areaTxt = formatCompactArea(info.country.areaKm2);
        const dot = document.createElement('span');
        dot.className = 'country-dot';
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createTextNode(areaTxt ? `${info.country.name} • ${areaTxt}` : info.country.name);
        countryPillEl.replaceChildren(dot, label);
        countryPillEl.hidden = false;
      } else {
        countryPillEl.hidden = true;
      }
    }
  }

  /* ---------- Instantiate 3D Globe Engine ---------- */
  const globe = new GlobeEngine(canvas, WORLD_COUNTRIES, {
    interactive: true,
    mini: false,
    initialProjection: 'globe',
  });

  let autoSpinEnabled = false;
  let trackedZoom = 1;
  let modeHoverCb = null;

  function syncAutoSpinUi() {
    autoSpinBtn?.classList.toggle('active', autoSpinEnabled);
    autoSpinBtn?.setAttribute('aria-pressed', autoSpinEnabled ? 'true' : 'false');
  }
  syncAutoSpinUi();

  // Keep HUD pills & toolbar controls automatically synchronized with mode calls
  const rawSetProjection = globe.setProjection?.bind(globe);
  if (rawSetProjection) {
    globe.setProjection = (proj) => {
      const result = rawSetProjection(proj);
      updateProjectionPill(globe.getProjection?.() || proj);
      return result;
    };
  }

  const rawSetAutoSpin = globe.setAutoSpin?.bind(globe);
  if (rawSetAutoSpin) {
    globe.setAutoSpin = (enabled) => {
      autoSpinEnabled = Boolean(enabled);
      syncAutoSpinUi();
      return rawSetAutoSpin(autoSpinEnabled);
    };
  }

  const rawSetZoom = globe.setZoom?.bind(globe);
  if (rawSetZoom) {
    globe.setZoom = (z) => {
      if (Number.isFinite(z)) trackedZoom = clamp(z, 0.75, 6);
      const res = rawSetZoom(z);
      updateZoomHud?.();
      return res;
    };
  }

  const rawFlyTo = globe.flyTo?.bind(globe);
  if (rawFlyTo) {
    globe.flyTo = (lon, lat, zoom = 1, durationMs = 800) => {
      if (Number.isFinite(zoom)) trackedZoom = clamp(zoom, 0.75, 6);
      const res = rawFlyTo(lon, lat, zoom, durationMs);
      updateZoomHud?.();
      return res;
    };
  }

  // Fan out hover telemetry to both top-left HUD and active mode callback
  const rawOnHover = globe.onHover?.bind(globe);
  if (rawOnHover) {
    rawOnHover((info, ...rest) => {
      updateCoordsHud(info);
      if (typeof modeHoverCb === 'function') {
        modeHoverCb(info, ...rest);
      }
    });
    globe.onHover = (cb) => {
      modeHoverCb = typeof cb === 'function' ? cb : null;
      return () => {
        if (modeHoverCb === cb) modeHoverCb = null;
      };
    };
  }

  updateProjectionPill(globe.getProjection?.() || 'globe');

  /* ---------- Responsive ResizeObserver ---------- */
  const handleResize = () => {
    globe.resize?.();
  };

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      handleResize();
    });
    ro.observe(canvasWrap);
  }
  window.addEventListener('resize', handleResize);
  handleResize();

  /* ---------- Quick Globe Camera Controls ---------- */
  function readCurrentZoom() {
    if (typeof globe.getZoom === 'function') {
      const z = globe.getZoom();
      if (Number.isFinite(z)) return z;
    }
    if (typeof globe.zoom === 'number' && Number.isFinite(globe.zoom)) {
      return globe.zoom;
    }
    return trackedZoom;
  }

  function updateZoomHud() {
    if (!zoomReadoutEl) return;
    const z = readCurrentZoom();
    zoomReadoutEl.textContent = `${z.toFixed(1)}×`;
  }

  function stepZoom(multiplier) {
    const next = clamp(readCurrentZoom() * multiplier, 0.75, 6);
    trackedZoom = next;
    globe.setZoom?.(next);
    updateZoomHud();
    soundEngine.playClick?.();
  }

  function resetGlobeView(silent = false) {
    globe.setAutoSpin?.(false);
    if (globe.getProjection?.() === 'mercator') {
      globe.flyTo?.(0, 20, 1, 600);
    } else {
      globe.flyTo?.(12, 22, 1, 680);
    }
    updateZoomHud();
    if (!silent) {
      soundEngine.playClick?.();
      notify('Globe view reset', 'info');
    }
  }

  zoomInBtn?.addEventListener('click', () => stepZoom(1.28));
  zoomOutBtn?.addEventListener('click', () => stepZoom(0.78));
  resetViewBtn?.addEventListener('click', () => resetGlobeView(false));
  canvas.addEventListener('wheel', () => requestAnimationFrame(updateZoomHud), { passive: true });
  canvas.addEventListener('pointerup', () => requestAnimationFrame(updateZoomHud), { passive: true });
  projPillEl?.addEventListener('click', () => {
    const cur = globe.getProjection?.() || 'globe';
    const nextProj = cur === 'mercator' ? 'globe' : 'mercator';
    const modeProjBtn = panelEl.querySelector(`[data-projection="${nextProj}"]`);
    if (modeProjBtn) {
      modeProjBtn.click();
    } else {
      globe.setProjection?.(nextProj);
      soundEngine.playClick?.();
    }
  });
  updateZoomHud();
  autoSpinBtn?.addEventListener('click', () => {
    const next = !autoSpinEnabled;
    if (next && globe.getProjection?.() === 'mercator') {
      notify('Auto-spin applies to 3D Globe view', 'info');
      return;
    }
    globe.setAutoSpin?.(next);
    soundEngine.playClick?.();
  });

  /* ---------- Mobile Collapsible Drawer ---------- */
  let drawerState = 'default'; // 'default' | 'collapsed' | 'expanded'
  function applyDrawerState(nextState) {
    drawerState = nextState;
    panelShell?.classList.remove('drawer-collapsed', 'drawer-expanded');
    const actionLabel = drawerToggleBtn?.querySelector('.drawer-action');
    if (drawerState === 'collapsed') {
      panelShell?.classList.add('drawer-collapsed');
      drawerToggleBtn?.setAttribute('aria-expanded', 'false');
      if (actionLabel) actionLabel.textContent = 'Tap to open';
    } else if (drawerState === 'expanded') {
      panelShell?.classList.add('drawer-expanded');
      drawerToggleBtn?.setAttribute('aria-expanded', 'true');
      if (actionLabel) actionLabel.textContent = 'Tap to reset';
    } else {
      drawerToggleBtn?.setAttribute('aria-expanded', 'true');
      if (actionLabel) actionLabel.textContent = 'Tap to resize';
    }
    window.setTimeout(handleResize, 260);
  }

  drawerToggleBtn?.addEventListener('click', () => {
    const next = drawerState === 'default'
      ? 'collapsed'
      : drawerState === 'collapsed'
        ? 'expanded'
        : 'default';
    applyDrawerState(next);
    soundEngine.playClick?.();
  });

  /* ---------- Shortcuts Modal ---------- */
  function openShortcutsModal() {
    if (!shortcutsModal) return;
    shortcutsModal.hidden = false;
    shortcutsCloseBtn?.focus();
  }

  function closeShortcutsModal() {
    if (!shortcutsModal) return;
    shortcutsModal.hidden = true;
  }

  function toggleShortcutsModal() {
    if (!shortcutsModal) return;
    if (shortcutsModal.hidden) openShortcutsModal();
    else closeShortcutsModal();
  }

  soundBtn?.addEventListener('click', toggleSound);
  shortcutsBtn?.addEventListener('click', () => {
    soundEngine.playClick?.();
    toggleShortcutsModal();
  });
  shortcutsCloseBtn?.addEventListener('click', closeShortcutsModal);
  shortcutsOkBtn?.addEventListener('click', closeShortcutsModal);
  shortcutsModal?.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) closeShortcutsModal();
  });

  /* ---------- Shared Mode Context ---------- */
  const ctx = {
    globe,
    countries: WORLD_COUNTRIES,
    geo,
    sound: soundEngine,
    data,
    dailySeed,
    shareCard,
    notify,
    setGlobeHint,
    getCanvasWrap: () => canvasWrap,
  };

  /* ---------- Mode Mounting & Routing ---------- */
  let activeModeId = null;
  let activeMode = null;

  function updateTabHighlight(modeId) {
    tabButtons.forEach((btn) => {
      const isCurrent = btn.dataset.mode === modeId;
      btn.classList.toggle('active', isCurrent);
      btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
    });
    if (drawerModeLabel && MODE_REGISTRY[modeId]) {
      drawerModeLabel.textContent = MODE_REGISTRY[modeId].label;
    }
  }

  function switchMode(modeId, { updateHash = true, playTone = false } = {}) {
    const targetId = MODE_REGISTRY[modeId] ? modeId : 'daily';
    if (targetId === activeModeId && activeMode) return;

    if (activeMode) {
      try {
        activeMode.unmount?.();
      } catch (err) {
        console.error(`[WhyMapped] Error unmounting ${activeModeId}:`, err);
      }
      activeMode = null;
    }

    // Ensure clean slate on globe & panel between modes
    modeHoverCb = null;
    globe.onClick?.(null);
    globe.onOverlayDrag?.(null);
    globe.clearLayers?.();
    globe.setAutoSpin?.(false);

    panelEl.innerHTML = '';
    panelEl.scrollTop = 0;

    // Expand mobile drawer out of collapsed state when explicitly picking a mode
    if (drawerState === 'collapsed') {
      applyDrawerState('default');
    }

    activeModeId = targetId;
    if (appShell) appShell.dataset.activeMode = targetId;
    if (countryPillEl) countryPillEl.hidden = true;
    const entry = MODE_REGISTRY[targetId];
    updateTabHighlight(targetId);
    updateZoomHud();
    setGlobeHint(entry.defaultHint);

    if (updateHash && window.location.hash !== `#${targetId}`) {
      try {
        history.replaceState(null, '', `#${targetId}`);
      } catch {
        window.location.hash = `#${targetId}`;
      }
    }

    if (playTone) {
      soundEngine.playClick?.();
    }

    try {
      activeMode = entry.factory();
      activeMode.mount(panelEl, ctx);
    } catch (err) {
      console.error(`[WhyMapped] Error mounting ${targetId}:`, err);
      notify(`Could not load ${entry.label}`, 'error');
    }

    requestAnimationFrame(() => {
      handleResize();
    });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchMode(btn.dataset.mode, { updateHash: true, playTone: true });
    });
  });

  window.addEventListener('hashchange', () => {
    const hashMode = parseModeFromHash();
    if (hashMode !== activeModeId) {
      switchMode(hashMode, { updateHash: false, playTone: false });
    }
  });

  /* ---------- Global Keyboard Shortcuts ---------- */
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Escape') {
      if (shortcutsModal && !shortcutsModal.hidden) {
        e.preventDefault();
        closeShortcutsModal();
        return;
      }
      if (isTypingTarget(e.target)) {
        e.target.blur();
      }
      return;
    }

    if (isTypingTarget(e.target)) return;

    if (e.key === '?') {
      e.preventDefault();
      toggleShortcutsModal();
      return;
    }

    if (shortcutsModal && !shortcutsModal.hidden) return;

    if (e.key >= '1' && e.key <= '4') {
      const idx = Number(e.key) - 1;
      const modeId = MODE_ORDER[idx];
      if (modeId) {
        e.preventDefault();
        switchMode(modeId, { updateHash: true, playTone: true });
      }
      return;
    }

    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      toggleSound();
      return;
    }

    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      stepZoom(1.25);
      return;
    }

    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      stepZoom(0.8);
      return;
    }

    // Give active mode first shot at mode-specific keys (Space, R, Arrows, etc.)
    const handled = Boolean(activeMode?.onKeyDown?.(e));
    if (handled) return;

    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      resetGlobeView(false);
    }
  });

  /* ---------- Initial Boot ---------- */
  const initialMode = parseModeFromHash();
  switchMode(initialMode, { updateHash: !window.location.hash, playTone: false });

  /* ---------- Safe Service Worker Registration ---------- */
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.protocol === 'http:')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Silently ignore SW registration errors in sandboxed/non-SW contexts
      });
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
  initApp();
}
