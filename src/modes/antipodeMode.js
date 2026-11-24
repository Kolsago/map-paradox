/**
 * WhyMapped — Map Paradox
 * Mode 3: Antipode Drill (X-Ray Core Tunnel + Synchronized Twin Mini-Globe)
 */

import { GlobeEngine } from '../engine/globe.js';

const EARTH_DIAMETER_KM = 12742;
const DRILL_DURATION_MS = 900;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeLon(lon) {
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  return x === -180 ? 180 : x;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function formatCoord(lon, lat) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lon).toFixed(2)}°${lonDir}`;
}

export function createAntipodeMode() {
  let panelEl = null;
  let ctx = null;
  let mounted = false;

  let miniGlobe = null;
  let miniResizeObserver = null;
  let drillRaf = null;
  let unsubClick = null;

  let activePresetGroup = 'land-to-land';
  let activePresetName = null;
  let lastDrill = null;
  let randomHitCounter = 0;

  function getPresets() {
    return Array.isArray(ctx?.data?.ANTIPODE_PRESETS) ? ctx.data.ANTIPODE_PRESETS : [];
  }

  function cancelDrillAnimation() {
    if (drillRaf !== null) {
      cancelAnimationFrame(drillRaf);
      drillRaf = null;
    }
  }

  function buildMainLayers(drillState, progress) {
    const highlights = [];
    if (drillState.entryCountry) {
      highlights.push({
        id: drillState.entryCountry.id,
        fill: 'rgba(247, 147, 30, 0.30)',
        stroke: '#F7931E',
        pulse: false,
      });
    }
    if (drillState.exitCountry && drillState.exitCountry.id !== drillState.entryCountry?.id) {
      highlights.push({
        id: drillState.exitCountry.id,
        fill: 'rgba(52, 211, 153, 0.30)',
        stroke: '#34D399',
        pulse: true,
      });
    }

    const exitColor = drillState.isExitLand ? '#34D399' : '#38BDF8';
    return {
      highlights,
      pins: [
        {
          lon: drillState.entry.lon,
          lat: drillState.entry.lat,
          label: drillState.entryShortLabel,
          color: '#F7931E',
          pulse: true,
        },
        {
          lon: drillState.exit.lon,
          lat: drillState.exit.lat,
          label: drillState.exitShortLabel,
          color: exitColor,
          pulse: false,
        },
      ],
      tunnel: {
        entry: [drillState.entry.lon, drillState.entry.lat],
        exit: [drillState.exit.lon, drillState.exit.lat],
        progress,
      },
    };
  }

  function updateMiniGlobe(drillState) {
    if (!miniGlobe) return;
    const exitColor = drillState.isExitLand ? '#34D399' : '#38BDF8';
    const highlights = drillState.exitCountry
      ? [{
          id: drillState.exitCountry.id,
          fill: 'rgba(52, 211, 153, 0.34)',
          stroke: '#34D399',
          pulse: true,
        }]
      : [];

    miniGlobe.flyTo?.(drillState.exit.lon, drillState.exit.lat, 1.55, 650);
    miniGlobe.setLayers?.({
      highlights,
      pins: [
        {
          lon: drillState.exit.lon,
          lat: drillState.exit.lat,
          label: drillState.exitShortLabel,
          color: exitColor,
          pulse: true,
        },
      ],
    });
  }

  function drillAt(lon, lat, { preset = null, flyCamera = false, silent = false } = {}) {
    if (!ctx?.geo || !ctx?.globe) return;
    cancelDrillAnimation();

    const cleanLon = normalizeLon(lon);
    const cleanLat = clamp(lat, -89.5, 89.5);
    const exit = ctx.geo.antipode(cleanLon, cleanLat);

    const entryCountry = ctx.geo.findCountryAtPoint?.(cleanLon, cleanLat, ctx.countries) || null;
    const exitCountry = ctx.geo.findCountryAtPoint?.(exit.lon, exit.lat, ctx.countries) || null;
    const nearest = ctx.geo.nearestCountry?.(exit.lon, exit.lat, ctx.countries) || null;

    // Curated presets may lie on coastal peninsulas slightly finer than 110m polygons
    const isEntryLand = Boolean(entryCountry) || Boolean(preset);
    const isExitLand = Boolean(exitCountry) || Boolean(preset?.isLandToLand);
    const isLandToLand = Boolean((entryCountry && exitCountry) || preset?.isLandToLand);

    const entryName = preset
      ? `${preset.name}${preset.country ? `, ${preset.country}` : ''}`
      : entryCountry
        ? entryCountry.name
        : 'Open Ocean';

    const exitName = preset?.antipodeName
      ? preset.antipodeName
      : exitCountry
        ? exitCountry.name
        : 'Open Ocean';

    const drillState = {
      entry: { lon: cleanLon, lat: cleanLat },
      exit,
      entryCountry,
      exitCountry,
      nearest,
      isEntryLand,
      isExitLand,
      isLandToLand,
      entryName,
      exitName,
      entryShortLabel: preset ? preset.name : (entryCountry?.name || 'Entry'),
      exitShortLabel: preset?.antipodeName
        ? preset.antipodeName.split(',')[0]
        : (exitCountry?.name || 'Ocean Exit'),
      note: preset?.note || null,
    };

    lastDrill = drillState;
    activePresetName = preset?.name || null;

    if (!silent) {
      ctx.sound?.playDrill?.();
    }

    ctx.globe.setAutoSpin?.(false);
    if (flyCamera) {
      // Slight oblique framing so the 3D glowing chord through Earth's core pops immediately
      const viewLon = normalizeLon(cleanLon + 24);
      const viewLat = clamp(cleanLat * 0.78, -58, 58);
      ctx.globe.flyTo?.(viewLon, viewLat, 1.32, 780);
    }

    updateMiniGlobe(drillState);
    renderTelemetry();
    updatePresetChipsActive();

    const start = performance.now();
    const animateTunnel = (now) => {
      if (!mounted) return;
      const t = Math.min(1, (now - start) / DRILL_DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      ctx.globe.setLayers?.(buildMainLayers(drillState, eased));
      if (t < 1) {
        drillRaf = requestAnimationFrame(animateTunnel);
      } else {
        drillRaf = null;
      }
    };
    drillRaf = requestAnimationFrame(animateTunnel);
  }

  function triggerRandomLandToLand() {
    const landPresets = getPresets().filter((p) => p.isLandToLand || p.group === 'land-to-land');
    randomHitCounter += 1;

    // Alternate between dynamic global sphere sampling and verified iconic land-to-land pairs
    // so every click feels fresh AND guarantees instant land-to-land accuracy!
    const trySample = randomHitCounter % 2 === 1 && ctx?.geo?.findCountryAtPoint && Array.isArray(ctx.countries);
    if (trySample) {
      for (let i = 0; i < 450; i++) {
        // Uniform random point on sphere avoiding Antarctica (lat > -56)
        const lon = Math.random() * 360 - 180;
        const u = Math.random() * 1.82 - 0.82; // biased away from deep Antarctica
        const lat = (Math.asin(clamp(u, -0.82, 0.99)) * 180) / Math.PI;
        if (lat < -56 || lat > 75) continue;

        const entryC = ctx.geo.findCountryAtPoint(lon, lat, ctx.countries);
        if (!entryC) continue;
        const anti = ctx.geo.antipode(lon, lat);
        const exitC = ctx.geo.findCountryAtPoint(anti.lon, anti.lat, ctx.countries);
        if (exitC && exitC.name !== 'Antarctica' && entryC.name !== 'Antarctica') {
          drillAt(lon, lat, { flyCamera: true });
          ctx?.notify?.(`Rare Land-to-Land Hit: ${entryC.name} ↔ ${exitC.name}!`, 'success');
          return;
        }
      }
    }

    if (landPresets.length > 0) {
      const candidates = landPresets.filter((p) => p.name !== activePresetName);
      const pool = candidates.length > 0 ? candidates : landPresets;
      const picked = pool[Math.floor(Math.random() * pool.length)];
      activePresetGroup = 'land-to-land';
      renderPresetSection();
      drillAt(picked.lon, picked.lat, { preset: picked, flyCamera: true });
      ctx?.notify?.(`Land-to-Land Hit: ${picked.name} ↔ ${picked.antipodeName}`, 'success');
      return;
    }

    // Ultimate fallback: Madrid -> Weber, NZ
    drillAt(-3.7038, 40.4168, { flyCamera: true });
  }

  function renderTelemetry() {
    const slot = panelEl?.querySelector('[data-slot="telemetry"]');
    if (!slot || !lastDrill) return;

    const d = lastDrill;
    let verdictClass = 'verdict-ocean';
    let verdictText = '🌊 OCEAN SPLASH — Exit lands in open ocean';
    if (d.isLandToLand) {
      verdictClass = 'verdict-land';
      verdictText = '🎉 RARE LAND-TO-LAND HIT (Only 4.4% of Earth!)';
    } else if (d.isExitLand) {
      verdictClass = 'verdict-land';
      verdictText = '🏝️ OCEAN-TO-LAND EXIT — Drilled up onto dry land!';
    } else if (!d.isEntryLand && !d.isExitLand) {
      verdictClass = 'verdict-ocean';
      verdictText = '🌊 OCEAN-TO-OCEAN — Pure pelagic core tunnel';
    }

    const nearestLabel = d.isExitLand
      ? `${d.exitCountry?.name || d.exitShortLabel}`
      : d.nearest?.country
        ? `${d.nearest.country.name}`
        : '—';

    const nearestSub = d.isExitLand
      ? 'Direct land impact (0 km)'
      : d.nearest && Number.isFinite(d.nearest.distanceKm)
        ? `${Math.round(d.nearest.distanceKm).toLocaleString('en-US')} km away`
        : 'Calculating...';

    slot.innerHTML = `
      <div class="verdict-banner ${verdictClass}">
        ${esc(verdictText)}
      </div>

      <div class="stat-grid">
        <div class="stat-box accent-orange">
          <div class="stat-label">Entry Surface</div>
          <div class="stat-value" style="font-size: 0.92rem;">${esc(d.entryName)}</div>
          <div class="stat-sub mono">${esc(formatCoord(d.entry.lon, d.entry.lat))}</div>
        </div>
        <div class="stat-box ${d.isExitLand ? 'accent-green' : 'accent-cyan'}">
          <div class="stat-label">Antipode Exit</div>
          <div class="stat-value" style="font-size: 0.92rem;">${esc(d.exitName)}</div>
          <div class="stat-sub mono">${esc(formatCoord(d.exit.lon, d.exit.lat))}</div>
        </div>
        <div class="stat-box accent-gold">
          <div class="stat-label">Core Tunnel Depth</div>
          <div class="stat-value mono">${EARTH_DIAMETER_KM.toLocaleString('en-US')} km</div>
          <div class="stat-sub">Straight through inner core</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Nearest Landmass</div>
          <div class="stat-value" style="font-size: 0.92rem;">${esc(nearestLabel)}</div>
          <div class="stat-sub mono">${esc(nearestSub)}</div>
        </div>
      </div>

      ${d.note ? `
        <div class="why-box">
          <div class="why-title">Antipode Fact</div>
          <div class="why-text">${esc(d.note)}</div>
        </div>
      ` : ''}
    `;

    const exitBadge = panelEl?.querySelector('[data-slot="mini-exit-label"]');
    if (exitBadge) {
      exitBadge.textContent = d.exitName;
    }
    const exitCoordEl = panelEl?.querySelector('[data-slot="mini-exit-coord"]');
    if (exitCoordEl) {
      exitCoordEl.textContent = formatCoord(d.exit.lon, d.exit.lat);
    }
  }

  function renderPresetSection() {
    const slot = panelEl?.querySelector('[data-slot="presets"]');
    if (!slot) return;

    const presets = getPresets().filter((p) => {
      if (activePresetGroup === 'land-to-land') {
        return p.group === 'land-to-land' || (!p.group && p.isLandToLand);
      }
      return p.group === 'major-cities' || (!p.group && !p.isLandToLand);
    });

    if (presets.length === 0) {
      slot.innerHTML = `<div class="muted" style="font-size: 0.82rem;">Click anywhere on the 3D globe to drill!</div>`;
      return;
    }

    slot.innerHTML = presets.map((p) => `
      <button
        type="button"
        class="chip${activePresetName === p.name ? ' active' : ''}"
        data-preset-name="${esc(p.name)}"
        title="${esc(`${p.name} → ${p.antipodeName}`)}"
      >
        ${p.isLandToLand ? '🎯 ' : '🌊 '}${esc(p.name)}
      </button>
    `).join('');

    panelEl.querySelectorAll('[data-preset-group]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-preset-group') === activePresetGroup);
    });
  }

  function updatePresetChipsActive() {
    if (!panelEl) return;
    panelEl.querySelectorAll('[data-preset-name]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-preset-name') === activePresetName);
    });
  }

  function renderShell() {
    if (!panelEl) return;
    panelEl.innerHTML = `
      <div class="stack">
        <div class="panel-header">
          <div class="row-between">
            <div>
              <h2 class="panel-title">Antipode Drill</h2>
              <p class="panel-subtitle">Dig straight through Earth's molten core — only 4.4% hits land on both ends</p>
            </div>
            <span class="badge badge-orange">X-RAY</span>
          </div>
        </div>

        <div class="row" style="gap: 8px;">
          <button type="button" class="btn-primary btn-full" data-action="random-land">
            🎲 Random Land-to-Land Hit
          </button>
          <button type="button" class="btn-secondary btn-sm" data-action="flip-exit" title="Fly main globe to exit point" style="flex-shrink: 0;">
            ↻ Exit
          </button>
        </div>

        <div class="panel-card stack-sm">
          <div class="row-between">
            <span class="section-label" style="margin: 0;">Synchronized Twin Exit View</span>
            <span class="mono muted" style="font-size: 0.74rem;" data-slot="mini-exit-coord"></span>
          </div>
          <div class="radar-scope">
            <span class="radar-cardinal radar-n" aria-hidden="true">N</span>
            <span class="radar-cardinal radar-e" aria-hidden="true">E</span>
            <span class="radar-cardinal radar-s" aria-hidden="true">S</span>
            <span class="radar-cardinal radar-w" aria-hidden="true">W</span>
            <div class="mini-globe-wrap" data-role="mini-wrap">
              <canvas data-role="mini-globe" aria-label="Antipode exit mini-globe"></canvas>
            </div>
          </div>
          <div class="radar-telemetry-strip mono">
            <span>ENTRY</span>
            <span aria-hidden="true">→</span>
            <strong>12,742 KM CORE</strong>
            <span aria-hidden="true">→</span>
            <span>EXIT</span>
          </div>
          <div class="row-between">
            <span class="muted" style="font-size: 0.76rem;">Opposite Side of Earth</span>
            <strong style="font-size: 0.84rem; color: #FFE066;" data-slot="mini-exit-label">—</strong>
          </div>
        </div>

        <div class="stack-sm" data-slot="telemetry"></div>

        <div class="panel-section stack-sm">
          <div class="row-between">
            <span class="section-label" style="margin: 0;">Curated Drill Sites</span>
          </div>
          <div class="segmented">
            <button type="button" class="seg-btn active" data-preset-group="land-to-land">Land-to-Land</button>
            <button type="button" class="seg-btn" data-preset-group="major-cities">Major Cities</button>
          </div>
          <div class="chip-row" data-slot="presets"></div>
        </div>
      </div>
    `;

    renderPresetSection();
  }

  function mountMiniGlobe() {
    const miniCanvas = panelEl?.querySelector('[data-role="mini-globe"]');
    const miniWrap = panelEl?.querySelector('[data-role="mini-wrap"]');
    if (!miniCanvas) return;

    miniGlobe = new GlobeEngine(miniCanvas, ctx.countries, {
      interactive: false,
      mini: true,
      initialProjection: 'globe',
    });

    if (miniWrap && typeof ResizeObserver !== 'undefined') {
      miniResizeObserver = new ResizeObserver(() => {
        miniGlobe?.resize?.();
      });
      miniResizeObserver.observe(miniWrap);
    }
    miniGlobe.resize?.();
  }

  function handlePanelClick(e) {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const action = actionBtn.getAttribute('data-action');
      if (action === 'random-land') {
        triggerRandomLandToLand();
      } else if (action === 'flip-exit' && lastDrill) {
        ctx?.sound?.playClick?.();
        ctx?.globe?.flyTo?.(lastDrill.exit.lon, lastDrill.exit.lat, 1.85, 850);
      }
      return;
    }

    const groupBtn = e.target.closest('[data-preset-group]');
    if (groupBtn) {
      const group = groupBtn.getAttribute('data-preset-group');
      if (group && group !== activePresetGroup) {
        activePresetGroup = group;
        ctx?.sound?.playClick?.();
        renderPresetSection();
      }
      return;
    }

    const presetBtn = e.target.closest('[data-preset-name]');
    if (presetBtn) {
      const name = presetBtn.getAttribute('data-preset-name');
      const preset = getPresets().find((p) => p.name === name);
      if (preset) {
        drillAt(preset.lon, preset.lat, { preset, flyCamera: true });
      }
    }
  }

  function handleGlobeClick(point) {
    if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return;
    drillAt(point.lon, point.lat, { preset: null, flyCamera: false });
  }

  return {
    mount(el, context) {
      panelEl = el;
      ctx = context;
      mounted = true;
      activePresetGroup = 'land-to-land';
      activePresetName = null;
      lastDrill = null;

      ctx.globe?.setProjection?.('globe');
      ctx.globe?.setAutoSpin?.(false);
      ctx.globe?.clearLayers?.();
      ctx.setGlobeHint?.('Click ANYWHERE on Earth to drill straight through the core • Space for Random Land Hit');

      renderShell();
      mountMiniGlobe();

      panelEl.addEventListener('click', handlePanelClick);
      const maybeUnsub = ctx.globe?.onClick?.(handleGlobeClick);
      unsubClick = typeof maybeUnsub === 'function' ? maybeUnsub : null;

      // Kick off with the first iconic Land-to-Land preset (silent so no unprompted audio)
      const landPresets = getPresets().filter((p) => p.isLandToLand || p.group === 'land-to-land');
      const initial = landPresets[0] || getPresets()[0];
      if (initial) {
        drillAt(initial.lon, initial.lat, { preset: initial, flyCamera: true, silent: true });
      } else {
        drillAt(-3.7038, 40.4168, { flyCamera: true, silent: true });
      }
    },

    unmount() {
      mounted = false;
      cancelDrillAnimation();

      if (miniResizeObserver) {
        miniResizeObserver.disconnect();
        miniResizeObserver = null;
      }
      if (miniGlobe) {
        miniGlobe.destroy?.();
        miniGlobe = null;
      }
      if (panelEl) {
        panelEl.removeEventListener('click', handlePanelClick);
      }
      if (unsubClick) {
        unsubClick();
        unsubClick = null;
      } else {
        ctx?.globe?.onClick?.(null);
      }
      ctx?.globe?.clearLayers?.();
      panelEl = null;
      ctx = null;
    },

    onKeyDown(e) {
      if (!mounted) return false;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        triggerRandomLandToLand();
        return true;
      }
      return false;
    },
  };
}
