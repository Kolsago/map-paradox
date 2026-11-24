/**
 * WhyMapped — Map Paradox
 * Mode 4: Anomaly Atlas (3D Explorer)
 */

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'borders', label: 'Borders' },
  { id: 'scale', label: 'Scale' },
  { id: 'extremes', label: 'Extremes' },
  { id: 'time', label: 'Time' },
  { id: 'ocean', label: 'Ocean' },
];

const AUTOPILOT_INTERVAL_MS = 7000;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCoord(lon, lat) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lon).toFixed(2)}°${lonDir}`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function createExplorerMode() {
  let panelEl = null;
  let ctx = null;
  let mounted = false;

  let activeCategory = 'all';
  let searchQuery = '';
  let filtered = [];
  let selectedId = null;

  let autopilotActive = false;
  let autopilotTimer = null;
  let arcRaf = null;
  let unsubClick = null;

  function getAnomalies() {
    return Array.isArray(ctx?.data?.ANOMALIES) ? ctx.data.ANOMALIES : [];
  }

  function computeFiltered() {
    const q = searchQuery.trim().toLowerCase();
    const all = getAnomalies();
    filtered = all.filter((item) => {
      if (activeCategory !== 'all' && String(item.category || '').toLowerCase() !== activeCategory) {
        return false;
      }
      if (!q) return true;
      const hay = `${item.title || ''} ${item.subtitle || ''} ${item.summary || ''} ${item.deepFact || ''} ${item.statBadge || ''} ${item.category || ''}`.toLowerCase();
      return hay.includes(q);
    });

    if (filtered.length > 0 && !filtered.some((a) => a.id === selectedId)) {
      selectedId = filtered[0].id;
    } else if (filtered.length === 0) {
      selectedId = null;
    }
  }

  function getSelected() {
    return filtered.find((a) => a.id === selectedId) || null;
  }

  function cancelArcAnimation() {
    if (arcRaf !== null) {
      cancelAnimationFrame(arcRaf);
      arcRaf = null;
    }
  }

  function stopAutopilot(silent = false) {
    if (autopilotTimer !== null) {
      clearInterval(autopilotTimer);
      autopilotTimer = null;
    }
    const wasActive = autopilotActive;
    autopilotActive = false;
    if (wasActive && !silent && mounted) {
      updateAutopilotButton();
    }
  }

  function startAutopilot() {
    stopAutopilot(true);
    if (filtered.length < 2) {
      ctx?.notify?.('Need at least 2 anomalies to run Autopilot Tour', 'info');
      return;
    }
    autopilotActive = true;
    ctx?.sound?.playClick?.();
    ctx?.notify?.('Autopilot Tour started — cycling every 7 seconds', 'info');
    updateAutopilotButton();

    autopilotTimer = setInterval(() => {
      if (!mounted || filtered.length === 0) {
        stopAutopilot(true);
        return;
      }
      stepAnomaly(1, { fromAutopilot: true });
    }, AUTOPILOT_INTERVAL_MS);
  }

  function updateAutopilotButton() {
    const btn = panelEl?.querySelector('[data-action="autopilot"]');
    if (!btn) return;
    btn.className = autopilotActive ? 'btn-primary btn-sm' : 'btn-ghost btn-sm';
    btn.textContent = autopilotActive ? '⏸ Stop Tour' : '▶ Autopilot';
    btn.setAttribute('aria-pressed', autopilotActive ? 'true' : 'false');
  }

  function buildBaseLayers(anomaly, arcProgress = 1) {
    const pins = [];

    // Subtle hotspot dots for other filtered anomalies so the globe feels alive
    for (const item of filtered) {
      if (item.id === anomaly.id) continue;
      pins.push({
        lon: item.lon,
        lat: item.lat,
        label: '',
        color: 'rgba(255, 224, 102, 0.55)',
        pulse: false,
      });
    }

    // Active anomaly glowing pin
    pins.push({
      lon: anomaly.lon,
      lat: anomaly.lat,
      label: anomaly.title,
      color: '#F7931E',
      pulse: true,
    });

    const arcs = [];
    if (Array.isArray(anomaly.arcTo) && anomaly.arcTo.length === 2) {
      pins.push({
        lon: anomaly.arcTo[0],
        lat: anomaly.arcTo[1],
        label: '',
        color: '#FFE066',
        pulse: false,
      });
      arcs.push({
        from: [anomaly.lon, anomaly.lat],
        to: [anomaly.arcTo[0], anomaly.arcTo[1]],
        color: '#F7931E',
        dashed: false,
        label: anomaly.arcLabel || '',
        progress: arcProgress,
      });
    }

    const parallels = [];
    if (typeof anomaly.parallel === 'number' && Number.isFinite(anomaly.parallel)) {
      const dir = anomaly.parallel >= 0 ? 'N' : 'S';
      parallels.push({
        lat: anomaly.parallel,
        color: '#FFE066',
        label: `${Math.abs(anomaly.parallel).toFixed(1)}°${dir}`,
      });
    }

    const meridians = [];
    if (typeof anomaly.meridian === 'number' && Number.isFinite(anomaly.meridian)) {
      const dir = anomaly.meridian >= 0 ? 'E' : 'W';
      meridians.push({
        lon: anomaly.meridian,
        color: '#FFE066',
        label: `${Math.abs(anomaly.meridian).toFixed(1)}°${dir}`,
      });
    }

    const highlights = [];
    if (Array.isArray(anomaly.highlightIds)) {
      for (const hid of anomaly.highlightIds) {
        highlights.push({
          id: hid,
          fill: 'rgba(247, 147, 30, 0.34)',
          stroke: '#FFE066',
          pulse: true,
        });
      }
    }

    return { pins, arcs, parallels, meridians, highlights };
  }

  function focusAnomalyOnGlobe(anomaly) {
    if (!ctx?.globe) return;
    cancelArcAnimation();

    if (!anomaly) {
      ctx.globe.clearLayers?.();
      return;
    }

    ctx.globe.setAutoSpin?.(false);
    const zoom = Number.isFinite(anomaly.zoom) ? anomaly.zoom : 2.3;
    ctx.globe.flyTo?.(anomaly.lon, anomaly.lat, zoom, 850);

    if (Array.isArray(anomaly.arcTo) && anomaly.arcTo.length === 2) {
      const duration = 720;
      const start = performance.now();
      const tick = (now) => {
        if (!mounted) return;
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        ctx.globe.setLayers?.(buildBaseLayers(anomaly, eased));
        if (t < 1) {
          arcRaf = requestAnimationFrame(tick);
        } else {
          arcRaf = null;
        }
      };
      arcRaf = requestAnimationFrame(tick);
    } else {
      ctx.globe.setLayers?.(buildBaseLayers(anomaly, 1));
    }
  }

  function selectAnomaly(id, { playSound = true, fromAutopilot = false } = {}) {
    if (!fromAutopilot && autopilotActive) {
      stopAutopilot(true);
    }
    const found = filtered.find((a) => a.id === id);
    if (!found) return;
    selectedId = found.id;
    if (playSound) ctx?.sound?.playClick?.();
    focusAnomalyOnGlobe(found);
    renderDossierAndListSelection();
  }

  function stepAnomaly(delta, opts = {}) {
    if (filtered.length === 0) return;
    const idx = filtered.findIndex((a) => a.id === selectedId);
    const nextIdx = idx < 0
      ? 0
      : (idx + delta + filtered.length) % filtered.length;
    selectAnomaly(filtered[nextIdx].id, {
      playSound: !opts.fromAutopilot,
      fromAutopilot: !!opts.fromAutopilot,
    });
  }

  function renderDossierHTML(anomaly) {
    if (!anomaly) {
      return `
        <div class="empty-state">
          <p>No geographic anomalies match your current filter.</p>
          <button type="button" class="btn-secondary btn-sm" data-action="reset-filters">Reset Filters</button>
        </div>
      `;
    }

    const idx = filtered.findIndex((a) => a.id === anomaly.id);
    const positionLabel = `${idx + 1} / ${filtered.length}`;

    return `
      <div class="dossier-card panel-card highlight stack-sm">
        <div class="row-between row-wrap">
          <div class="row" style="gap: 6px;">
            <span class="badge badge-orange">${esc(capitalize(anomaly.category || 'anomaly'))}</span>
            ${anomaly.statBadge ? `<span class="badge badge-gold">${esc(anomaly.statBadge)}</span>` : ''}
          </div>
          <span class="mono muted" style="font-size: 0.78rem;">${esc(positionLabel)}</span>
        </div>

        <div>
          <h3 class="panel-title" style="font-size: 1.08rem; margin: 0;">${esc(anomaly.title)}</h3>
          ${anomaly.subtitle ? `<p class="panel-subtitle" style="margin: 2px 0 0;">${esc(anomaly.subtitle)}</p>` : ''}
        </div>

        <div class="row-between muted mono" style="font-size: 0.76rem;">
          <span>📍 ${esc(formatCoord(anomaly.lon, anomaly.lat))}</span>
          ${anomaly.arcLabel ? `<span style="color: #FFE066;">↗ ${esc(anomaly.arcLabel)}</span>` : ''}
        </div>

        <p style="margin: 0; font-size: 0.88rem; line-height: 1.5;">${esc(anomaly.summary)}</p>

        ${anomaly.deepFact ? `
          <div class="why-box">
            <div class="why-title">The Why — Deep Cartographic Fact</div>
            <div class="why-text">${esc(anomaly.deepFact)}</div>
            ${anomaly.source ? `<div class="why-source">Source: ${esc(anomaly.source)}</div>` : ''}
          </div>
        ` : (anomaly.source ? `<div class="why-source muted" style="font-size: 0.75rem;">Source: ${esc(anomaly.source)}</div>` : '')}

        <div class="row-between row-wrap" style="gap: 8px; padding-top: 4px;">
          <div class="row" style="gap: 6px;">
            <button type="button" class="btn-secondary btn-sm" data-action="prev" title="Previous anomaly">← Prev</button>
            <button type="button" class="btn-secondary btn-sm" data-action="next" title="Next anomaly (Space)">Next →</button>
          </div>
          <div class="row row-wrap" style="gap: 6px;">
            ${anomaly.shortUrl ? `<a class="btn-short-cta" href="${esc(anomaly.shortUrl)}" target="_blank" rel="noopener noreferrer">▶ Watch 60fps Short ↗</a>` : ''}
            <button type="button" class="${autopilotActive ? 'btn-primary' : 'btn-ghost'} btn-sm" data-action="autopilot" aria-pressed="${autopilotActive ? 'true' : 'false'}">
              ${autopilotActive ? '⏸ Stop Tour' : '▶ Autopilot'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderListHTML() {
    if (filtered.length === 0) return '';
    return filtered.map((item, idx) => {
      const isActive = item.id === selectedId;
      const numLabel = String(idx + 1).padStart(2, '0');
      return `
        <button type="button" class="dossier-item${isActive ? ' active' : ''}" data-anomaly-id="${esc(item.id)}">
          <div class="dossier-item-row" style="width: 100%;">
            <span class="dossier-idx mono">${numLabel}</span>
            <div class="stack-sm" style="gap: 2px; flex: 1; min-width: 0;">
              <div class="row-between" style="gap: 8px; width: 100%;">
                <strong style="text-align: left; font-size: 0.85rem;">${esc(item.title)}</strong>
                ${item.statBadge ? `<span class="badge badge-muted" style="flex-shrink: 0;">${esc(item.statBadge)}</span>` : ''}
              </div>
              <div class="row-between muted" style="gap: 8px; width: 100%; font-size: 0.75rem;">
                <span style="text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(item.subtitle || capitalize(item.category))}</span>
                <span class="mono" style="flex-shrink: 0;">${esc(capitalize(item.category))}</span>
              </div>
            </div>
          </div>
        </button>
      `;
    }).join('');
  }

  function renderDossierAndListSelection() {
    if (!panelEl) return;
    const dossierHost = panelEl.querySelector('[data-slot="dossier"]');
    const countEl = panelEl.querySelector('[data-slot="count"]');
    const listHost = panelEl.querySelector('[data-slot="list"]');
    const selected = getSelected();

    if (dossierHost) {
      dossierHost.innerHTML = renderDossierHTML(selected);
    }
    if (countEl) {
      const total = getAnomalies().length;
      countEl.textContent = filtered.length === total
        ? `${total} Curated Anomalies`
        : `${filtered.length} of ${total} Anomalies`;
    }
    if (listHost) {
      listHost.innerHTML = renderListHTML();
      const activeItem = listHost.querySelector('.dossier-item.active');
      if (activeItem && typeof activeItem.scrollIntoView === 'function') {
        activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function renderShell() {
    if (!panelEl) return;
    const chipsHTML = CATEGORIES.map((cat) => `
      <button type="button" class="chip${activeCategory === cat.id ? ' active' : ''}" data-category="${cat.id}">
        ${esc(cat.label)}
      </button>
    `).join('');

    panelEl.innerHTML = `
      <div class="stack">
        <div class="panel-header">
          <div class="row-between">
            <div>
              <h2 class="panel-title">Anomaly Atlas</h2>
              <p class="panel-subtitle">Earth's strangest borders, time zones &amp; cartographic paradoxes</p>
            </div>
            <span class="badge badge-gold mono" data-slot="count"></span>
          </div>
        </div>

        <div class="stack-sm">
          <div class="search-wrap">
            <input
              id="explorer-search"
              name="explorer-search"
              type="search"
              class="search-input"
              placeholder="Search borders, islands, oceans, paradoxes..."
              value="${esc(searchQuery)}"
              data-role="search"
              aria-label="Search geographic anomalies"
            />
          </div>
          <div class="chip-row" data-role="categories">
            ${chipsHTML}
          </div>
        </div>

        <div data-slot="dossier"></div>

        <div class="panel-section stack-sm">
          <div class="section-label">Field Dossiers</div>
          <div class="dossier-list" data-slot="list"></div>
        </div>
      </div>
    `;

    renderDossierAndListSelection();
  }

  function handlePanelClick(e) {
    const catBtn = e.target.closest('[data-category]');
    if (catBtn) {
      const nextCat = catBtn.getAttribute('data-category');
      if (nextCat && nextCat !== activeCategory) {
        activeCategory = nextCat;
        ctx?.sound?.playClick?.();
        panelEl.querySelectorAll('[data-category]').forEach((el) => {
          el.classList.toggle('active', el.getAttribute('data-category') === activeCategory);
        });
        computeFiltered();
        renderDossierAndListSelection();
        focusAnomalyOnGlobe(getSelected());
      }
      return;
    }

    const itemBtn = e.target.closest('[data-anomaly-id]');
    if (itemBtn) {
      selectAnomaly(itemBtn.getAttribute('data-anomaly-id'));
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.getAttribute('data-action');
    if (action === 'prev') {
      stepAnomaly(-1);
    } else if (action === 'next') {
      stepAnomaly(1);
    } else if (action === 'autopilot') {
      if (autopilotActive) {
        ctx?.sound?.playClick?.();
        stopAutopilot(false);
      } else {
        startAutopilot();
      }
    } else if (action === 'reset-filters') {
      activeCategory = 'all';
      searchQuery = '';
      const searchEl = panelEl.querySelector('[data-role="search"]');
      if (searchEl) searchEl.value = '';
      panelEl.querySelectorAll('[data-category]').forEach((el) => {
        el.classList.toggle('active', el.getAttribute('data-category') === 'all');
      });
      computeFiltered();
      renderDossierAndListSelection();
      focusAnomalyOnGlobe(getSelected());
    }
  }

  function handlePanelInput(e) {
    if (!e.target.matches('[data-role="search"]')) return;
    searchQuery = e.target.value || '';
    const prevSelected = selectedId;
    computeFiltered();
    renderDossierAndListSelection();
    if (selectedId !== prevSelected) {
      focusAnomalyOnGlobe(getSelected());
    }
  }

  function handleGlobeClick(point) {
    if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return;
    if (!ctx?.geo?.haversineKm || filtered.length === 0) return;

    // Select closest filtered anomaly within 950 km of clicked point
    let best = null;
    let bestDist = Infinity;
    for (const item of filtered) {
      const d = ctx.geo.haversineKm(point.lon, point.lat, item.lon, item.lat);
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    }
    if (best && bestDist <= 950) {
      selectAnomaly(best.id);
    }
  }

  return {
    mount(el, context) {
      panelEl = el;
      ctx = context;
      mounted = true;

      activeCategory = 'all';
      searchQuery = '';
      computeFiltered();

      ctx.globe?.setProjection?.('globe');
      ctx.globe?.setAutoSpin?.(false);
      ctx.globe?.clearLayers?.();
      ctx.setGlobeHint?.('Drag to explore • Click golden hotspots or pick a dossier • Space for Next');

      renderShell();
      panelEl.addEventListener('click', handlePanelClick);
      panelEl.addEventListener('input', handlePanelInput);

      const maybeUnsub = ctx.globe?.onClick?.(handleGlobeClick);
      unsubClick = typeof maybeUnsub === 'function' ? maybeUnsub : null;

      focusAnomalyOnGlobe(getSelected());
    },

    unmount() {
      mounted = false;
      stopAutopilot(true);
      cancelArcAnimation();
      if (panelEl) {
        panelEl.removeEventListener('click', handlePanelClick);
        panelEl.removeEventListener('input', handlePanelInput);
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
      if (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        stepAnomaly(1);
        return true;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepAnomaly(-1);
        return true;
      }
      return false;
    },
  };
}
