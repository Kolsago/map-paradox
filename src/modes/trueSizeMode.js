/**
 * WhyMapped — Map Paradox
 * Mode 2: True-Size Lab (Mercator Illusion vs 3D Spherical Scale)
 */

const OVERLAY_PALETTES = [
  { fill: 'rgba(247, 147, 30, 0.44)', stroke: '#F7931E', solid: '#F7931E' },
  { fill: 'rgba(255, 224, 102, 0.38)', stroke: '#FFE066', solid: '#FFE066' },
  { fill: 'rgba(56, 189, 248, 0.38)', stroke: '#38BDF8', solid: '#38BDF8' },
  { fill: 'rgba(52, 211, 153, 0.38)', stroke: '#34D399', solid: '#34D399' },
];

const MAX_OVERLAYS = 4;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeLon(lon) {
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  return x === -180 ? 180 : x;
}

function wrapDeg(deg) {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180 && deg > 0) d = 180;
  return Math.round(d);
}

function formatLat(lat) {
  const dir = lat >= 0 ? 'N' : 'S';
  return `${Math.abs(lat).toFixed(1)}°${dir}`;
}

function formatArea(km2) {
  if (!Number.isFinite(km2) || km2 <= 0) return '—';
  if (km2 >= 1_000_000) return `${(km2 / 1_000_000).toFixed(2)}M km²`;
  return `${Math.round(km2).toLocaleString('en-US')} km²`;
}

export function createTrueSizeMode() {
  let panelEl = null;
  let ctx = null;
  let mounted = false;

  let projection = 'mercator';
  let overlays = [];
  let selectedOverlayId = null;
  let activePresetId = null;
  let activeFact = null;
  let compareCountryId = null;
  let hoveredCountry = null;

  let searchQuery = '';
  let searchOpen = false;
  let nextUid = 1;

  let unsubDrag = null;
  let unsubHover = null;

  function findCountry(queryOrId) {
    if (!queryOrId || !Array.isArray(ctx?.countries)) return null;
    const raw = String(queryOrId).trim();
    const low = raw.toLowerCase();
    return (
      ctx.countries.find((c) => c.id === raw) ||
      ctx.countries.find((c) => c.iso && c.iso.toLowerCase() === low) ||
      ctx.countries.find((c) => c.name && c.name.toLowerCase() === low) ||
      ctx.countries.find((c) => c.name && c.name.toLowerCase().includes(low)) ||
      null
    );
  }

  function getSelectedOverlay() {
    return overlays.find((o) => o.id === selectedOverlayId) || overlays[0] || null;
  }

  function getPresets() {
    return Array.isArray(ctx?.data?.TRUESIZE_PRESETS) ? ctx.data.TRUESIZE_PRESETS : [];
  }

  function nextAvailablePalette() {
    const used = new Set(overlays.map((o) => o.palette.solid));
    return OVERLAY_PALETTES.find((p) => !used.has(p.solid)) || OVERLAY_PALETTES[overlays.length % OVERLAY_PALETTES.length];
  }

  function recomputeOverlayGeometry(item) {
    if (!ctx?.geo?.reprojectPolygonsTrueSize || !item?.country) return;
    item.reprojected = ctx.geo.reprojectPolygonsTrueSize(
      item.country.polygons,
      item.country.centroid,
      item.targetLon,
      item.targetLat,
      item.rotationDeg
    );
  }

  function pushGlobeLayers() {
    if (!ctx?.globe) return;
    const highlights = [];
    if (compareCountryId) {
      highlights.push({
        id: compareCountryId,
        fill: 'rgba(56, 189, 248, 0.20)',
        stroke: '#38BDF8',
        pulse: false,
      });
    }

    const globeOverlays = overlays.map((item) => {
      const isSelected = item.id === selectedOverlayId;
      return {
        id: item.id,
        name: item.country.name,
        polygons: item.reprojected || item.country.polygons,
        fill: item.palette.fill,
        stroke: isSelected ? '#FBF6EE' : item.palette.stroke,
        centroid: [item.targetLon, item.targetLat],
        draggable: true,
      };
    });

    ctx.globe.setLayers?.({
      highlights,
      overlays: globeOverlays,
    });
  }

  function addCountryOverlay(country, { targetLon, targetLat, rotationDeg = 0, replaceAll = false, compareId = null, fly = true } = {}) {
    if (!country) return null;

    if (replaceAll) {
      overlays = [];
      selectedOverlayId = null;
    }

    if (overlays.length >= MAX_OVERLAYS) {
      ctx?.notify?.(`Maximum ${MAX_OVERLAYS} simultaneous country overlays reached — remove one first.`, 'warn');
      return null;
    }

    // If same country already exists and not replacing, just select it
    const existing = overlays.find((o) => o.country.id === country.id);
    if (existing) {
      selectedOverlayId = existing.id;
      if (Number.isFinite(targetLon) && Number.isFinite(targetLat)) {
        existing.targetLon = normalizeLon(targetLon);
        existing.targetLat = clamp(targetLat, -78, 78);
        existing.rotationDeg = wrapDeg(rotationDeg);
        recomputeOverlayGeometry(existing);
      }
      compareCountryId = compareId || compareCountryId;
      pushGlobeLayers();
      renderDynamicSections();
      return existing;
    }

    const [homeLon, homeLat] = Array.isArray(country.centroid) ? country.centroid : [0, 0];
    const startLon = Number.isFinite(targetLon) ? normalizeLon(targetLon) : normalizeLon(homeLon);
    const startLat = Number.isFinite(targetLat) ? clamp(targetLat, -78, 78) : clamp(homeLat, -78, 78);

    const item = {
      id: `ov_${nextUid++}`,
      country,
      targetLon: startLon,
      targetLat: startLat,
      rotationDeg: wrapDeg(rotationDeg),
      palette: nextAvailablePalette(),
      reprojected: null,
    };

    recomputeOverlayGeometry(item);
    overlays.push(item);
    selectedOverlayId = item.id;
    compareCountryId = compareId;

    pushGlobeLayers();
    if (fly) {
      const zoom = projection === 'mercator' ? 1.45 : 1.55;
      ctx?.globe?.flyTo?.(item.targetLon, item.targetLat, zoom, 750);
    }
    renderDynamicSections();
    return item;
  }

  function applyPreset(preset, { silent = false } = {}) {
    if (!preset) return;
    const country = findCountry(preset.countryId);
    if (!country) {
      ctx?.notify?.(`Could not locate country for preset "${preset.title}"`, 'warn');
      return;
    }

    activePresetId = preset.id;
    activeFact = preset.fact || preset.tagline || null;
    if (!silent) ctx?.sound?.playClick?.();

    const compareCountry = preset.targetCompareId ? findCountry(preset.targetCompareId) : null;
    addCountryOverlay(country, {
      targetLon: preset.targetLon,
      targetLat: preset.targetLat,
      rotationDeg: preset.rotationDeg || 0,
      replaceAll: true,
      compareId: compareCountry ? compareCountry.id : null,
      fly: true,
    });
    updatePresetChips();
  }

  function switchProjection(nextProj) {
    if (nextProj !== 'mercator' && nextProj !== 'globe') return;
    if (projection === nextProj) return;
    projection = nextProj;
    ctx?.sound?.playClick?.();
    ctx?.globe?.setProjection?.(projection);
    ctx?.globe?.setAutoSpin?.(false);

    const sel = getSelectedOverlay();
    if (sel) {
      ctx?.globe?.flyTo?.(sel.targetLon, sel.targetLat, projection === 'mercator' ? 1.45 : 1.55, 650);
    }

    panelEl?.querySelectorAll('[data-projection]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-projection') === projection);
    });
    updateDistortionMeter();
    ctx?.setGlobeHint?.(
      projection === 'mercator'
        ? 'Drag glowing countries toward the Equator to see their TRUE scale • Press R to rotate'
        : '3D True Globe — zero Mercator distortion! Drag overlays across Earth • Press R to rotate'
    );
  }

  function rotateSelected(newDeg) {
    const sel = getSelectedOverlay();
    if (!sel) return;
    sel.rotationDeg = wrapDeg(newDeg);
    recomputeOverlayGeometry(sel);
    pushGlobeLayers();
    updateRotationControls();
  }

  function updateRotationControls() {
    const sel = getSelectedOverlay();
    const slider = panelEl?.querySelector('[data-role="rotation-slider"]');
    const readout = panelEl?.querySelector('[data-slot="rotation-deg"]');
    if (slider) {
      slider.value = sel ? String(sel.rotationDeg) : '0';
      slider.disabled = !sel;
    }
    if (readout) {
      readout.textContent = sel ? `${sel.rotationDeg > 0 ? '+' : ''}${sel.rotationDeg}°` : '0°';
    }
  }

  function updateDistortionMeter() {
    const slot = panelEl?.querySelector('[data-slot="meter"]');
    if (!slot) return;

    const sel = getSelectedOverlay();
    if (!sel) {
      slot.innerHTML = `
        <div class="empty-state" style="padding: 12px;">
          Pick a viral preset below or search any of 177 countries to reveal Mercator's distortion!
        </div>
      `;
      return;
    }

    const homeLat = Array.isArray(sel.country.centroid) ? sel.country.centroid[1] : 0;
    const curLat = sel.targetLat;

    const curFactor = ctx?.geo?.mercatorDistortionFactor
      ? ctx.geo.mercatorDistortionFactor(curLat)
      : 1 / Math.max(0.05, Math.cos((curLat * Math.PI) / 180) ** 2);
    const homeFactor = ctx?.geo?.mercatorDistortionFactor
      ? ctx.geo.mercatorDistortionFactor(homeLat)
      : 1 / Math.max(0.05, Math.cos((homeLat * Math.PI) / 180) ** 2);

    const pct = clamp(((Math.min(curFactor, 15) - 1) / 14) * 100, 4, 100);
    const fillMod = curFactor >= 5 ? 'extreme' : curFactor >= 2.2 ? 'warn' : '';

    // Determine live comparison country underneath dragged overlay (or hovered / preset target)
    let under = ctx?.geo?.findCountryAtPoint?.(sel.targetLon, sel.targetLat, ctx.countries) || null;
    if (under && under.id === sel.country.id) {
      under = null;
    }
    if (!under && hoveredCountry && hoveredCountry.id !== sel.country.id) {
      under = hoveredCountry;
    }
    if (!under && compareCountryId) {
      const cmp = findCountry(compareCountryId);
      if (cmp && cmp.id !== sel.country.id) under = cmp;
    }

    let compareText = 'Drag over another country to compare real areas';
    if (under && sel.country.areaKm2 > 0 && under.areaKm2 > 0) {
      const ratio = sel.country.areaKm2 / under.areaKm2;
      const ratioStr = ratio >= 1
        ? `${ratio.toFixed(2)}× larger than ${under.name}`
        : `${(1 / ratio).toFixed(2)}× smaller than ${under.name}`;
      compareText = `vs ${under.name} (${formatArea(under.areaKm2)}): ${sel.country.name} is ${ratioStr}`;
    }

    // Relative visual scale shift from home latitude to dragged latitude
    const visualShift = curFactor / Math.max(1, homeFactor);
    let shiftLine = '';
    if (projection === 'globe') {
      shiftLine = `3D Globe shows true spherical area (Mercator inflates this latitude ×${curFactor.toFixed(2)}).`;
    } else if (visualShift < 0.85) {
      shiftLine = `Looks ${(1 / visualShift).toFixed(1)}× smaller here than at its home latitude (${formatLat(homeLat)})!`;
    } else if (visualShift > 1.18) {
      shiftLine = `Inflated ${visualShift.toFixed(1)}× larger here than at its home latitude (${formatLat(homeLat)})!`;
    } else {
      shiftLine = `Near home latitude (${formatLat(homeLat)}) — drag toward 0° Equator to shrink the lie!`;
    }

    slot.innerHTML = `
      <div class="panel-card highlight stack-sm">
        <div class="row-between">
          <div class="row" style="gap: 8px;">
            <span class="swatch" style="background: ${sel.palette.solid}; width: 12px; height: 12px; border-radius: 50%; display: inline-block;"></span>
            <strong style="font-size: 0.96rem;">${esc(sel.country.name)}</strong>
          </div>
          <span class="badge ${curFactor >= 4 ? 'badge-orange' : curFactor >= 2 ? 'badge-gold' : 'badge-green'} mono">
            ×${curFactor.toFixed(2)} AREA
          </span>
        </div>

        <div class="stack-sm" style="gap: 4px;">
          <div class="row-between" style="font-size: 0.76rem;">
            <span class="muted">Mercator Area Exaggeration</span>
            <span class="mono" style="color: #FFE066;">${projection === 'globe' ? 'True 1.00× (3D)' : `×${curFactor.toFixed(2)} at ${formatLat(curLat)}`}</span>
          </div>
          <div class="meter-bar">
            <div class="meter-fill ${fillMod}" style="width: ${projection === 'globe' ? 6 : pct.toFixed(1)}%;"></div>
          </div>
          <div class="muted" style="font-size: 0.76rem; line-height: 1.35;">${esc(shiftLine)}</div>
        </div>

        <div class="stat-grid">
          <div class="stat-box accent-gold">
            <div class="stat-label">True Land Area</div>
            <div class="stat-value mono" style="font-size: 0.94rem;">${esc(formatArea(sel.country.areaKm2))}</div>
            <div class="stat-sub">Home: ${esc(formatLat(homeLat))}</div>
          </div>
          <div class="stat-box accent-orange">
            <div class="stat-label">Current Position</div>
            <div class="stat-value mono" style="font-size: 0.94rem;">${esc(formatLat(curLat))}</div>
            <div class="stat-sub mono">${Math.abs(sel.targetLon).toFixed(1)}°${sel.targetLon >= 0 ? 'E' : 'W'} • ${sel.rotationDeg}°</div>
          </div>
        </div>

        <div class="stat-box accent-cyan" style="padding: 8px 10px;">
          <div class="stat-label">Live Scale Comparison</div>
          <div style="font-size: 0.8rem; line-height: 1.38;">${esc(compareText)}</div>
        </div>
      </div>
    `;
  }

  function renderActiveOverlaysList() {
    const slot = panelEl?.querySelector('[data-slot="overlays"]');
    if (!slot) return;

    if (overlays.length === 0) {
      slot.innerHTML = `<div class="muted" style="font-size: 0.8rem;">No active overlays (0 / ${MAX_OVERLAYS})</div>`;
      return;
    }

    slot.innerHTML = overlays.map((item) => {
      const isSelected = item.id === selectedOverlayId;
      return `
        <div class="overlay-item${isSelected ? ' active' : ''}" data-select-overlay="${esc(item.id)}" style="cursor: pointer;">
          <span class="swatch" style="background: ${item.palette.solid};"></span>
          <div class="overlay-meta">
            <strong>${esc(item.country.name)}</strong>
            <span class="muted mono" style="font-size: 0.74rem;">${esc(formatArea(item.country.areaKm2))} • ${esc(formatLat(item.targetLat))}</span>
          </div>
          <button type="button" class="btn-icon" data-remove-overlay="${esc(item.id)}" title="Remove ${esc(item.country.name)}" aria-label="Remove ${esc(item.country.name)}">×</button>
        </div>
      `;
    }).join('');
  }

  function renderFactBox() {
    const slot = panelEl?.querySelector('[data-slot="fact"]');
    if (!slot) return;
    if (!activeFact) {
      slot.innerHTML = '';
      return;
    }
    slot.innerHTML = `
      <div class="why-box">
        <div class="why-title">Scale Paradox</div>
        <div class="why-text">${esc(activeFact)}</div>
      </div>
    `;
  }

  function updatePresetChips() {
    if (!panelEl) return;
    panelEl.querySelectorAll('[data-preset-id]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-preset-id') === activePresetId);
    });
  }

  function renderSearchDropdown() {
    const resultsEl = panelEl?.querySelector('[data-slot="search-results"]');
    if (!resultsEl) return;

    const q = searchQuery.trim().toLowerCase();
    if (!searchOpen && !q) {
      resultsEl.innerHTML = '';
      resultsEl.style.display = 'none';
      return;
    }

    const all = Array.isArray(ctx?.countries) ? ctx.countries : [];
    const matches = all
      .filter((c) => {
        if (!q) return true;
        return (
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.iso && c.iso.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (!q) return (b.areaKm2 || 0) - (a.areaKm2 || 0);
        const aStarts = a.name?.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name?.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return (b.areaKm2 || 0) - (a.areaKm2 || 0);
      })
      .slice(0, 14);

    if (matches.length === 0) {
      resultsEl.style.display = 'flex';
      resultsEl.innerHTML = `<div class="muted" style="padding: 10px 12px; font-size: 0.8rem;">No countries match "${esc(searchQuery)}"</div>`;
      return;
    }

    const activeIds = new Set(overlays.map((o) => o.country.id));
    resultsEl.style.display = 'flex';
    resultsEl.innerHTML = matches.map((c) => {
      const added = activeIds.has(c.id);
      return `
        <button type="button" class="search-item" data-add-country="${esc(c.id)}">
          <span>${esc(c.name)} ${added ? '<span class="badge badge-gold">Active</span>' : ''}</span>
          <span class="mono muted" style="font-size: 0.74rem;">${esc(formatArea(c.areaKm2))}</span>
        </button>
      `;
    }).join('');
  }

  function renderDynamicSections() {
    updateDistortionMeter();
    renderActiveOverlaysList();
    updateRotationControls();
    renderFactBox();
    renderSearchDropdown();
  }

  function renderShell() {
    if (!panelEl) return;
    const presets = getPresets();
    const presetsHTML = presets.map((p) => `
      <button type="button" class="chip${activePresetId === p.id ? ' active' : ''}" data-preset-id="${esc(p.id)}" title="${esc(p.tagline || p.title)}">
        ${esc(p.title)}
      </button>
    `).join('');

    panelEl.innerHTML = `
      <div class="stack">
        <div class="panel-header">
          <div class="row-between">
            <div>
              <h2 class="panel-title">True-Size Lab</h2>
              <p class="panel-subtitle">Drag countries across latitudes to expose Mercator's area distortion</p>
            </div>
            <span class="badge badge-gold">MAX ${MAX_OVERLAYS}</span>
          </div>
        </div>

        <div class="segmented" role="tablist" aria-label="Map Projection">
          <button type="button" class="seg-btn${projection === 'mercator' ? ' active' : ''}" data-projection="mercator">
            2D Mercator (See the Lie)
          </button>
          <button type="button" class="seg-btn${projection === 'globe' ? ' active' : ''}" data-projection="globe">
            3D True Globe
          </button>
        </div>

        <div data-slot="meter"></div>

        <div class="panel-card stack-sm">
          <div class="row-between">
            <span class="section-label" style="margin: 0;">Rotate Overlay (Key: R)</span>
            <span class="mono" style="font-size: 0.82rem; color: #FFE066;" data-slot="rotation-deg">0°</span>
          </div>
          <div class="range-wrap">
            <input type="range" class="slider" min="-180" max="180" step="1" value="0" data-role="rotation-slider" aria-label="Overlay rotation angle" />
          </div>
          <div class="row-between" style="gap: 6px;">
            <div class="row" style="gap: 6px;">
              <button type="button" class="btn-ghost btn-sm" data-action="rot-left">-45°</button>
              <button type="button" class="btn-ghost btn-sm" data-action="rot-zero">0°</button>
              <button type="button" class="btn-ghost btn-sm" data-action="rot-right">+45°</button>
            </div>
            <div class="row" style="gap: 6px;">
              <button type="button" class="btn-secondary btn-sm" data-action="reset">Reset</button>
              <button type="button" class="btn-ghost btn-sm" data-action="clear">Clear</button>
            </div>
          </div>
        </div>

        <div data-slot="fact"></div>

        <div class="panel-section stack-sm">
          <div class="section-label">Add Any Country (177 Nations)</div>
          <div class="search-wrap">
            <input
              type="search"
              class="search-input"
              placeholder="Search countries (e.g. Greenland, Japan, Brazil)..."
              value="${esc(searchQuery)}"
              data-role="country-search"
              autocomplete="off"
              aria-label="Search country to add as true-size overlay"
            />
            <div class="search-results" data-slot="search-results" style="display: none;"></div>
          </div>
          <div class="overlay-list" data-slot="overlays"></div>
        </div>

        <div class="panel-section stack-sm">
          <div class="section-label">Viral Scale Comparisons</div>
          <div class="chip-row" data-role="presets">
            ${presetsHTML}
          </div>
        </div>
      </div>
    `;

    renderDynamicSections();
  }

  function handlePanelClick(e) {
    const projBtn = e.target.closest('[data-projection]');
    if (projBtn) {
      switchProjection(projBtn.getAttribute('data-projection'));
      return;
    }

    const presetBtn = e.target.closest('[data-preset-id]');
    if (presetBtn) {
      const pid = presetBtn.getAttribute('data-preset-id');
      const preset = getPresets().find((p) => p.id === pid);
      if (preset) applyPreset(preset);
      return;
    }

    const addBtn = e.target.closest('[data-add-country]');
    if (addBtn) {
      const cid = addBtn.getAttribute('data-add-country');
      const country = findCountry(cid);
      if (country) {
        ctx?.sound?.playClick?.();
        activePresetId = null;
        activeFact = null;
        searchQuery = '';
        searchOpen = false;
        const input = panelEl.querySelector('[data-role="country-search"]');
        if (input) input.value = '';

        // Place new country near current map center / equator for instant contrast
        const rot = ctx.globe?.getRotation?.();
        const dropLon = Array.isArray(rot) ? rot[0] : (rot?.lon ?? 15);
        const dropLat = Array.isArray(rot) ? clamp(rot[1], -50, 50) : clamp(rot?.lat ?? 10, -50, 50);

        addCountryOverlay(country, {
          targetLon: dropLon,
          targetLat: dropLat,
          rotationDeg: 0,
          replaceAll: false,
          compareId: compareCountryId,
          fly: false,
        });
        updatePresetChips();
      }
      return;
    }

    const removeBtn = e.target.closest('[data-remove-overlay]');
    if (removeBtn) {
      e.stopPropagation();
      const oid = removeBtn.getAttribute('data-remove-overlay');
      overlays = overlays.filter((o) => o.id !== oid);
      if (selectedOverlayId === oid) {
        selectedOverlayId = overlays[0]?.id || null;
      }
      if (overlays.length === 0) {
        activePresetId = null;
        activeFact = null;
        compareCountryId = null;
      }
      ctx?.sound?.playClick?.();
      pushGlobeLayers();
      renderDynamicSections();
      updatePresetChips();
      return;
    }

    const selectRow = e.target.closest('[data-select-overlay]');
    if (selectRow) {
      const oid = selectRow.getAttribute('data-select-overlay');
      if (oid && oid !== selectedOverlayId) {
        selectedOverlayId = oid;
        ctx?.sound?.playClick?.();
        pushGlobeLayers();
        renderDynamicSections();
      }
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const action = actionBtn.getAttribute('data-action');
      const sel = getSelectedOverlay();
      if (action === 'rot-left' && sel) {
        ctx?.sound?.playClick?.();
        rotateSelected(sel.rotationDeg - 45);
      } else if (action === 'rot-zero' && sel) {
        ctx?.sound?.playClick?.();
        rotateSelected(0);
      } else if (action === 'rot-right' && sel) {
        ctx?.sound?.playClick?.();
        rotateSelected(sel.rotationDeg + 45);
      } else if (action === 'reset' && sel) {
        ctx?.sound?.playClick?.();
        const [hlon, hlat] = Array.isArray(sel.country.centroid) ? sel.country.centroid : [0, 0];
        sel.targetLon = normalizeLon(hlon);
        sel.targetLat = clamp(hlat, -78, 78);
        sel.rotationDeg = 0;
        recomputeOverlayGeometry(sel);
        pushGlobeLayers();
        ctx?.globe?.flyTo?.(sel.targetLon, sel.targetLat, projection === 'mercator' ? 1.45 : 1.55, 700);
        renderDynamicSections();
      } else if (action === 'clear') {
        ctx?.sound?.playClick?.();
        overlays = [];
        selectedOverlayId = null;
        activePresetId = null;
        activeFact = null;
        compareCountryId = null;
        pushGlobeLayers();
        renderDynamicSections();
        updatePresetChips();
      }
      return;
    }

    // Close search dropdown if clicking outside search-wrap
    if (!e.target.closest('.search-wrap') && searchOpen) {
      searchOpen = false;
      renderSearchDropdown();
    }
  }

  function handlePanelInput(e) {
    if (e.target.matches('[data-role="rotation-slider"]')) {
      rotateSelected(Number(e.target.value));
      return;
    }
    if (e.target.matches('[data-role="country-search"]')) {
      searchQuery = e.target.value || '';
      searchOpen = true;
      renderSearchDropdown();
    }
  }

  function handlePanelFocusIn(e) {
    if (e.target.matches('[data-role="country-search"]')) {
      searchOpen = true;
      renderSearchDropdown();
    }
  }

  function handleOverlayDrag(ev) {
    if (!ev || !ev.id) return;
    const item = overlays.find((o) => o.id === ev.id);
    if (!item) return;

    const maxLat = projection === 'mercator' ? 78 : 85;
    item.targetLon = normalizeLon(ev.lon);
    item.targetLat = clamp(ev.lat, -maxLat, maxLat);
    if (selectedOverlayId !== item.id) {
      selectedOverlayId = item.id;
      renderActiveOverlaysList();
      updateRotationControls();
    }
    recomputeOverlayGeometry(item);
    pushGlobeLayers();
    updateDistortionMeter();
  }

  function handleGlobeHover(ev) {
    if (!ev || !Number.isFinite(ev.lon) || !Number.isFinite(ev.lat)) {
      if (hoveredCountry !== null) {
        hoveredCountry = null;
      }
      return;
    }
    const found = ev.country || ctx?.geo?.findCountryAtPoint?.(ev.lon, ev.lat, ctx.countries) || null;
    if (found?.id !== hoveredCountry?.id) {
      hoveredCountry = found;
      if (overlays.length > 0) {
        updateDistortionMeter();
      }
    }
  }

  return {
    mount(el, context) {
      panelEl = el;
      ctx = context;
      mounted = true;

      projection = 'mercator';
      overlays = [];
      selectedOverlayId = null;
      activePresetId = null;
      activeFact = null;
      compareCountryId = null;
      hoveredCountry = null;
      searchQuery = '';
      searchOpen = false;

      ctx.globe?.setProjection?.('mercator');
      ctx.globe?.setAutoSpin?.(false);
      ctx.globe?.clearLayers?.();
      ctx.setGlobeHint?.('Drag glowing countries toward the Equator to see their TRUE scale • Press R to rotate');

      renderShell();
      panelEl.addEventListener('click', handlePanelClick);
      panelEl.addEventListener('input', handlePanelInput);
      panelEl.addEventListener('focusin', handlePanelFocusIn);

      const maybeUnsubDrag = ctx.globe?.onOverlayDrag?.(handleOverlayDrag);
      unsubDrag = typeof maybeUnsubDrag === 'function' ? maybeUnsubDrag : null;

      const maybeUnsubHover = ctx.globe?.onHover?.(handleGlobeHover);
      unsubHover = typeof maybeUnsubHover === 'function' ? maybeUnsubHover : null;

      // Immediately load the first iconic preset (e.g. Greenland on Africa) for an instant "WHOA!" moment
      const firstPreset = getPresets()[0];
      if (firstPreset) {
        applyPreset(firstPreset, { silent: true });
      }
    },

    unmount() {
      mounted = false;
      if (panelEl) {
        panelEl.removeEventListener('click', handlePanelClick);
        panelEl.removeEventListener('input', handlePanelInput);
        panelEl.removeEventListener('focusin', handlePanelFocusIn);
      }
      if (unsubDrag) {
        unsubDrag();
        unsubDrag = null;
      } else {
        ctx?.globe?.onOverlayDrag?.(null);
      }
      if (unsubHover) {
        unsubHover();
        unsubHover = null;
      } else {
        ctx?.globe?.onHover?.(null);
      }
      ctx?.globe?.clearLayers?.();
      // Restore 3D globe cleanly for other modes
      ctx?.globe?.setProjection?.('globe');
      panelEl = null;
      ctx = null;
    },

    onKeyDown(e) {
      if (!mounted) return false;
      if (e.key === 'r' || e.key === 'R') {
        const sel = getSelectedOverlay();
        if (sel) {
          e.preventDefault();
          ctx?.sound?.playClick?.();
          rotateSelected(sel.rotationDeg + 15);
          return true;
        }
      }
      return false;
    },
  };
}
