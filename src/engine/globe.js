/* WhyMapped — Map Paradox: 3D Orthographic Globe & 2D Web Mercator Engine
 * Zero-dependency Canvas 2D cartographic renderer ("Cartographic Observatory").
 * Supports:
 *  - 3D orthographic globe with exact limb horizon clipping, inertia, pinch-zoom & auto-spin
 *  - Interactive 2D Web Mercator view (+/-82 deg) with continuous antimeridian tiling
 *  - Declarative layers: highlights, pins, lifted geodesic arcs, parallels, meridians,
 *    draggable True-Size overlays, and Earth-core X-ray antipode drill tunnel
 *  - Full DPR scaling, ResizeObserver-friendly resize(), exportSnapshot(), zero memory leaks
 */

import {
  DEG2RAD,
  RAD2DEG,
  normalizeLon,
  clampLat,
  lonLatToVec3,
  slerpGreatCircle,
  unwrapRing,
  pointInRing,
  findCountryAtPoint,
} from "./geo.js";

const MERC_MAX_LAT = 82;
const MERC_MATH_LIMIT = 85.051129;

const PALETTE = {
  spaceBg: "#071324",
  oceanCore: "#174273",
  oceanMid: "#0E294D",
  oceanDeep: "#081830",
  oceanLimb: "#030B17",
  landFill: "#1B3A5C",
  landStroke: "#345E8C",
  landHover: "#2F6396",
  landHoverStroke: "#8CD0FF",
  coastalHalo: "rgba(72, 175, 255, 0.14)",
  graticule: "rgba(56, 108, 165, 0.22)",
  equator: "rgba(220, 205, 186, 0.30)",
  orange: "#F7931E",
  gold: "#FFE066",
  parchment: "#FBF6EE",
  muted: "#DCCDBA",
  cyanRim: "rgba(96, 180, 255, 0.38)",
  goldRim: "rgba(255, 224, 102, 0.16)",
};

const LAND_TONES = [
  { fill: "#183757", stroke: "#315D8C" },
  { fill: "#1D4064", stroke: "#396A9D" },
  { fill: "#15314F", stroke: "#2B547E" },
  { fill: "#20446B", stroke: "#3E70A4" },
];

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function mercX(lon) {
  return lon / 180;
}

function mercY(lat) {
  const clamped = clampLat(lat, MERC_MATH_LIMIT);
  const rad = clamped * DEG2RAD;
  return Math.log(Math.tan(Math.PI * 0.25 + rad * 0.5)) / Math.PI;
}

function invMercY(my) {
  return (2 * Math.atan(Math.exp(my * Math.PI)) - Math.PI * 0.5) * RAD2DEG;
}

function normalizeLookupKey(str) {
  return String(str)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Precomputes packed 3D unit vectors + bounding cap + unwrapped 2D rings
 * so 60fps rendering requires zero trigonometry on the 11,000+ landmass vertices.
 */
function compileRings(polygons, isPolar = false) {
  const compiled = [];
  for (let p = 0; p < polygons.length; p++) {
    const ring = polygons[p];
    const n = ring.length;
    if (n < 3) continue;

    const vecs = new Float32Array(n * 3);
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n; i++) {
      const [lo, la] = ring[i];
      const v = lonLatToVec3(lo, la);
      vecs[i * 3] = v[0];
      vecs[i * 3 + 1] = v[1];
      vecs[i * 3 + 2] = v[2];
      sx += v[0];
      sy += v[1];
      sz += v[2];
    }

    let len = Math.hypot(sx, sy, sz);
    let cx = 0, cy = 0, cz = -1;
    if (len > 1e-6) {
      cx = sx / len;
      cy = sy / len;
      cz = sz / len;
    } else if (isPolar) {
      cx = 0; cy = 0; cz = -1;
    }

    // Bounding sphere cosine radius for fast back-hemisphere culling
    let minDot = 1;
    for (let i = 0; i < n; i++) {
      const d = vecs[i * 3] * cx + vecs[i * 3 + 1] * cy + vecs[i * 3 + 2] * cz;
      if (d < minDot) minDot = d;
    }
    const maxAngle = Math.acos(Math.max(-1, Math.min(1, minDot)));
    const cullThreshold = -Math.sin(Math.min(Math.PI * 0.5, maxAngle + 0.05));

    const unwrapped = unwrapRing(ring);
    compiled.push({
      vecs,
      count: n,
      cx, cy, cz,
      cullThreshold,
      unwrapped,
      isPolar: isPolar || unwrapped.spansPole,
    });
  }
  return compiled;
}

function buildStars(count) {
  // Deterministic Mulberry32 PRNG so stars never jitter across reloads
  let seed = 0x5748594d;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      u: rand(),
      v: rand(),
      r: 0.45 + rand() * 1.15,
      alpha: 0.14 + rand() * 0.42,
      phase: rand() * Math.PI * 2,
      tint: rand() > 0.82 ? "#FFE066" : (rand() > 0.55 ? "#BFDFFF" : "#FBF6EE"),
    });
  }
  return stars;
}

function buildGraticule3D() {
  const lines = [];
  // Parallels every 30 deg (-60..60) + subtle 15 deg ticks? 30 deg keeps observatory ultra-crisp!
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 4) {
      pts.push(lonLatToVec3(lon, lat));
    }
    lines.push({ pts, isPrimary: lat === 0, isLat: true, value: lat });
  }
  // Meridians every 30 deg
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = [];
    for (let lat = -84; lat <= 84; lat += 4) {
      pts.push(lonLatToVec3(lon, lat));
    }
    lines.push({ pts, isPrimary: lon === 0, isLat: false, value: lon });
  }
  return lines;
}

export class GlobeEngine {
  constructor(canvas, countries = [], options = {}) {
    if (!canvas) throw new Error("GlobeEngine requires a valid HTMLCanvasElement");

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.countries = Array.isArray(countries) ? countries : [];
    this.options = {
      interactive: options.interactive !== false,
      mini: Boolean(options.mini),
      initialProjection: options.initialProjection === "mercator" ? "mercator" : "globe",
    };

    this.projection = this.options.initialProjection;
    this.rotLon = 10;
    this.rotLat = 20;
    this.zoom = 1;
    this.autoSpin = false;

    this.width = 600;
    this.height = 400;
    this.dpr = 1;

    // Physics / animation state
    this._velLon = 0;
    this._velLat = 0;
    this._flyAnim = null;
    this._lastFrameTime = 0;
    this._rafId = null;
    this._destroyed = false;

    // Layer state
    this.layers = {
      highlights: [],
      pins: [],
      arcs: [],
      parallels: [],
      meridians: [],
      overlays: [],
      tunnel: null,
    };
    this._compiledOverlays = new WeakMap();

    // Pointer & interaction state
    this._pointers = new Map();
    this._isDraggingGlobe = false;
    this._dragOverlay = null;
    this._dragStart = null;
    this._lastPointer = null;
    this._maxMovePx = 0;
    this._pinchDist = 0;
    this._pinchZoomStart = 1;
    this._hoveredCountryId = null;

    // Event listeners
    this._clickListeners = new Set();
    this._hoverListeners = new Set();
    this._overlayDragListeners = new Set();

    // Precompile country geometry & lookup maps
    this._countryLookup = new Map();
    this._compiledCountries = this.countries.map((c) => {
      const key = String(c.id || c.name || "");
      let hash = 0;
      for (let k = 0; k < key.length; k++) {
        hash = ((hash * 31) + key.charCodeAt(k)) | 0;
      }
      const compiled = {
        country: c,
        toneIdx: Math.abs(hash) % LAND_TONES.length,
        rings: compileRings(c.polygons || [], Boolean(c.isPolar)),
      };
      if (c.id) this._countryLookup.set(normalizeLookupKey(c.id), c.id);
      if (c.iso) this._countryLookup.set(normalizeLookupKey(c.iso), c.id);
      if (c.name) this._countryLookup.set(normalizeLookupKey(c.name), c.id);
      return compiled;
    });

    this._stars = this.options.mini ? [] : buildStars(120);
    this._graticule3D = buildGraticule3D();

    // Bind pointer/wheel handlers
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onPointerLeave = this._handlePointerLeave.bind(this);
    this._onWheel = this._handleWheel.bind(this);

    if (this.options.interactive) {
      this._attachEvents();
    }

    this.resize();
    this._startLoop();
  }

  // ==================== Public API ====================

  setProjection(mode) {
    const next = mode === "mercator" ? "mercator" : "globe";
    if (this.projection === next) return;
    this.projection = next;
    this._velLon = 0;
    this._velLat = 0;
    this._flyAnim = null;
    if (next === "mercator") {
      this.rotLat = clampLat(this.rotLat, 72);
      this.zoom = Math.max(0.85, Math.min(8, this.zoom));
    } else {
      this.rotLat = clampLat(this.rotLat, 85);
      this.zoom = Math.max(0.65, Math.min(7.5, this.zoom));
    }
  }

  getProjection() {
    return this.projection;
  }

  setRotation(lon, lat) {
    this._flyAnim = null;
    this._velLon = 0;
    this._velLat = 0;
    this.rotLon = normalizeLon(lon);
    this.rotLat = clampLat(lat, this.projection === "mercator" ? 75 : 85);
  }

  getRotation() {
    return { lon: normalizeLon(this.rotLon), lat: this.rotLat };
  }

  setZoom(z) {
    if (!Number.isFinite(z)) return;
    const minZ = this.projection === "mercator" ? 0.8 : 0.65;
    const maxZ = this.projection === "mercator" ? 8.0 : 7.5;
    this.zoom = Math.max(minZ, Math.min(maxZ, z));
  }

  getZoom() {
    return this.zoom;
  }

  setAutoSpin(enabled) {
    this.autoSpin = Boolean(enabled);
  }

  getAutoSpin() {
    return this.autoSpin;
  }

  flyTo(lon, lat, zoom = 1, durationMs = 800) {
    const targetLon = normalizeLon(lon);
    const targetLat = clampLat(lat, this.projection === "mercator" ? 72 : 85);
    const minZ = this.projection === "mercator" ? 0.8 : 0.65;
    const maxZ = this.projection === "mercator" ? 8.0 : 7.5;
    const targetZoom = zoom == null ? this.zoom : Math.max(minZ, Math.min(maxZ, zoom));

    this._velLon = 0;
    this._velLat = 0;

    if (!durationMs || durationMs <= 0) {
      this._flyAnim = null;
      this.rotLon = targetLon;
      this.rotLat = targetLat;
      this.zoom = targetZoom;
      return;
    }

    // Shortest angular delta across +/-180
    let deltaLon = targetLon - normalizeLon(this.rotLon);
    while (deltaLon > 180) deltaLon -= 360;
    while (deltaLon < -180) deltaLon += 360;

    this._flyAnim = {
      startTime: performance.now(),
      duration: durationMs,
      fromLon: normalizeLon(this.rotLon),
      deltaLon,
      fromLat: this.rotLat,
      toLat: targetLat,
      fromZoom: this.zoom,
      toZoom: targetZoom,
    };
  }

  setLayers(spec = {}) {
    this.layers = {
      highlights: Array.isArray(spec.highlights) ? spec.highlights : [],
      pins: Array.isArray(spec.pins) ? spec.pins : [],
      arcs: Array.isArray(spec.arcs) ? spec.arcs : [],
      parallels: Array.isArray(spec.parallels) ? spec.parallels : [],
      meridians: Array.isArray(spec.meridians) ? spec.meridians : [],
      overlays: Array.isArray(spec.overlays) ? spec.overlays : [],
      tunnel: spec.tunnel || null,
    };
  }

  clearLayers() {
    this.layers = {
      highlights: [],
      pins: [],
      arcs: [],
      parallels: [],
      meridians: [],
      overlays: [],
      tunnel: null,
    };
    this._hoveredCountryId = null;
  }

  onClick(cb) {
    if (cb == null) {
      this._clickListeners.clear();
      return () => {};
    }
    this._clickListeners.add(cb);
    return () => this._clickListeners.delete(cb);
  }

  onHover(cb) {
    if (cb == null) {
      this._hoverListeners.clear();
      return () => {};
    }
    this._hoverListeners.add(cb);
    return () => this._hoverListeners.delete(cb);
  }

  onOverlayDrag(cb) {
    if (cb == null) {
      this._overlayDragListeners.clear();
      return () => {};
    }
    this._overlayDragListeners.add(cb);
    return () => this._overlayDragListeners.delete(cb);
  }

  resize() {
    if (this._destroyed) return;
    const rect = this.canvas.getBoundingClientRect();
    const parentRect = this.canvas.parentElement
      ? this.canvas.parentElement.getBoundingClientRect()
      : null;

    const w = Math.max(1, Math.round(rect.width || (parentRect ? parentRect.width : 0) || this.canvas.width || 600));
    const h = Math.max(1, Math.round(rect.height || (parentRect ? parentRect.height : 0) || this.canvas.height || 400));
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;

    this.width = w;
    this.height = h;
    this.dpr = dpr;

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    this._renderFrame(performance.now());
  }

  /**
   * Renders a crisp standalone offscreen snapshot (default 720x720) for Share Cards.
   * Ensures the full circular globe fits cleanly inside the snapshot frame even if zoomed in.
   */
  exportSnapshot(sizePx = 720) {
    const out = document.createElement("canvas");
    out.width = sizePx;
    out.height = sizePx;
    const offCtx = out.getContext("2d");
    const savedProj = this.projection;
    const savedZoom = this.zoom;
    const savedHover = this._hoveredCountryId;
    this.projection = "globe";
    if (this.zoom > 1.05) {
      this.zoom = 1.0;
    }
    this._hoveredCountryId = null;
    try {
      this._renderToContext(offCtx, sizePx, sizePx, 1, performance.now(), {
        transparentBackdrop: true,
        forceNoStars: true,
      });
    } finally {
      this.projection = savedProj;
      this.zoom = savedZoom;
      this._hoveredCountryId = savedHover;
    }
    return out;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._detachEvents();
    this._clickListeners.clear();
    this._hoverListeners.clear();
    this._overlayDragListeners.clear();
    this._pointers.clear();
  }

  // ==================== Projection Geometry Helpers ====================

  _globeMetrics(w, h) {
    const padFactor = this.options.mini ? 0.44 : 0.415;
    const baseR = Math.min(w, h) * padFactor;
    const R = baseR * this.zoom;
    return { cx: w * 0.5, cy: h * 0.5, R, baseR };
  }

  _mercatorMetrics(w, h) {
    // Full globe width fits neatly at zoom=1 with subtle observatory margins
    const maxY = mercY(MERC_MAX_LAT);
    const fitByW = (w * 0.94) / 2;
    const fitByH = (h * 0.90) / (2 * maxY);
    const scale = Math.min(fitByW, fitByH) * this.zoom;
    return {
      cx: w * 0.5,
      cy: h * 0.5,
      scale,
      camX: mercX(this.rotLon),
      camY: mercY(this.rotLat),
      maxY,
    };
  }

  _buildCameraBasis() {
    const lo = this.rotLon * DEG2RAD;
    const la = this.rotLat * DEG2RAD;
    const sLo = Math.sin(lo), cLo = Math.cos(lo);
    const sLa = Math.sin(la), cLa = Math.cos(la);
    // Right (East), Up (North), Forward (View)
    return {
      rx0: -sLo,       rx1: cLo,        rx2: 0,
      uy0: -sLa * cLo, uy1: -sLa * sLo, uy2: cLa,
      fz0: cLa * cLo,  fz1: cLa * sLo,  fz2: sLa,
    };
  }

  _projectGlobeVec(vx, vy, vz, cam, cx, cy, R, altitude = 1) {
    const x = vx * cam.rx0 + vy * cam.rx1 + vz * cam.rx2;
    const y = vx * cam.uy0 + vy * cam.uy1 + vz * cam.uy2;
    const z = vx * cam.fz0 + vy * cam.fz1 + vz * cam.fz2;
    return {
      sx: cx + x * R * altitude,
      sy: cy - y * R * altitude,
      x, y, z,
    };
  }

  _projectGlobeLonLat(lon, lat, cam, cx, cy, R, altitude = 1) {
    const v = lonLatToVec3(lon, lat);
    return this._projectGlobeVec(v[0], v[1], v[2], cam, cx, cy, R, altitude);
  }

  _projectMercLonLat(lon, lat, m, lonShift = 0) {
    const mx = mercX(lon + lonShift) - m.camX;
    const my = mercY(lat) - m.camY;
    return {
      sx: m.cx + mx * m.scale,
      sy: m.cy - my * m.scale,
    };
  }

  screenToLonLat(sx, sy) {
    if (this.projection === "globe") {
      const { cx, cy, R } = this._globeMetrics(this.width, this.height);
      const nx = (sx - cx) / R;
      const ny = (cy - sy) / R;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) return null;
      const nz = Math.sqrt(Math.max(0, 1 - r2));
      const cam = this._buildCameraBasis();
      const gx = nx * cam.rx0 + ny * cam.uy0 + nz * cam.fz0;
      const gy = nx * cam.rx1 + ny * cam.uy1 + nz * cam.fz1;
      const gz = Math.max(-1, Math.min(1, nx * cam.rx2 + ny * cam.uy2 + nz * cam.fz2));
      const lat = Math.asin(gz) * RAD2DEG;
      const lon = normalizeLon(Math.atan2(gy, gx) * RAD2DEG);
      return { lon, lat };
    }

    const m = this._mercatorMetrics(this.width, this.height);
    const mx = (sx - m.cx) / m.scale + m.camX;
    const my = (m.cy - sy) / m.scale + m.camY;
    if (Math.abs(my) > m.maxY) return null;
    const lon = normalizeLon(mx * 180);
    const lat = clampLat(invMercY(my), MERC_MAX_LAT);
    return { lon, lat };
  }

  // ==================== Pointer & Wheel Interaction ====================

  _attachEvents() {
    this.canvas.style.touchAction = "none";
    this.canvas.style.cursor = "grab";
    this.canvas.addEventListener("pointerdown", this._onPointerDown);
    this.canvas.addEventListener("pointermove", this._onPointerMove);
    this.canvas.addEventListener("pointerup", this._onPointerUp);
    this.canvas.addEventListener("pointercancel", this._onPointerUp);
    this.canvas.addEventListener("pointerleave", this._onPointerLeave);
    this.canvas.addEventListener("wheel", this._onWheel, { passive: false });
  }

  _detachEvents() {
    this.canvas.removeEventListener("pointerdown", this._onPointerDown);
    this.canvas.removeEventListener("pointermove", this._onPointerMove);
    this.canvas.removeEventListener("pointerup", this._onPointerUp);
    this.canvas.removeEventListener("pointercancel", this._onPointerUp);
    this.canvas.removeEventListener("pointerleave", this._onPointerLeave);
    this.canvas.removeEventListener("wheel", this._onWheel);
  }

  _canvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _hitTestDraggableOverlay(sx, sy, geoPt) {
    const overlays = this.layers.overlays;
    if (!overlays || !overlays.length || !geoPt) return null;

    const cam = this.projection === "globe" ? this._buildCameraBasis() : null;
    const gm = this.projection === "globe" ? this._globeMetrics(this.width, this.height) : null;
    const mm = this.projection === "mercator" ? this._mercatorMetrics(this.width, this.height) : null;

    // Test top-most overlays first
    for (let i = overlays.length - 1; i >= 0; i--) {
      const ov = overlays[i];
      if (!ov || !ov.draggable) continue;

      // 1. Check centroid handle proximity (great UX for smaller islands/nations)
      if (ov.centroid) {
        if (this.projection === "globe") {
          const p = this._projectGlobeLonLat(ov.centroid[0], ov.centroid[1], cam, gm.cx, gm.cy, gm.R);
          if (p.z > 0 && Math.hypot(sx - p.sx, sy - p.sy) <= 24) {
            return ov;
          }
        } else {
          for (let shift = -360; shift <= 360; shift += 360) {
            const p = this._projectMercLonLat(ov.centroid[0], ov.centroid[1], mm, shift);
            if (Math.hypot(sx - p.sx, sy - p.sy) <= 24) return ov;
          }
        }
      }

      // 2. Exact polygon hit test
      if (ov.polygons && ov.polygons.length) {
        let hits = 0;
        for (let r = 0; r < ov.polygons.length; r++) {
          if (pointInRing(geoPt.lon, geoPt.lat, ov.polygons[r])) hits++;
        }
        if ((hits & 1) === 1) return ov;
      }
    }
    return null;
  }

  _handlePointerDown(e) {
    if (this._destroyed) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const pos = this._canvasPos(e);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without active pointer
    }
    this._pointers.set(e.pointerId, pos);

    // Handle 2-finger pinch start
    if (this._pointers.size === 2) {
      const pts = Array.from(this._pointers.values());
      this._pinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      this._pinchZoomStart = this.zoom;
      this._isDraggingGlobe = false;
      this._dragOverlay = null;
      this._maxMovePx = 999; // Suppress click after pinch
      return;
    }

    this._flyAnim = null;
    this._velLon = 0;
    this._velLat = 0;
    this._dragStart = pos;
    this._lastPointer = pos;
    this._maxMovePx = 0;

    // Check draggable True-Size overlay before starting globe drag
    const geoPt = this.screenToLonLat(pos.x, pos.y);
    const hitOv = this._hitTestDraggableOverlay(pos.x, pos.y, geoPt);
    if (hitOv && geoPt) {
      const cLon = hitOv.centroid ? hitOv.centroid[0] : geoPt.lon;
      const cLat = hitOv.centroid ? hitOv.centroid[1] : geoPt.lat;
      let offLon = cLon - geoPt.lon;
      while (offLon > 180) offLon -= 360;
      while (offLon < -180) offLon += 360;
      this._dragOverlay = {
        id: hitOv.id,
        offsetLon: offLon,
        offsetLat: cLat - geoPt.lat,
      };
      this._isDraggingGlobe = false;
      this.canvas.style.cursor = "grabbing";
      return;
    }

    this._dragOverlay = null;
    this._isDraggingGlobe = true;
    this.canvas.style.cursor = "grabbing";
  }

  _handlePointerMove(e) {
    if (this._destroyed) return;
    const pos = this._canvasPos(e);

    if (this._pointers.has(e.pointerId)) {
      this._pointers.set(e.pointerId, pos);
    }

    // Two-finger pinch zoom
    if (this._pointers.size === 2 && this._pinchDist > 0) {
      const pts = Array.from(this._pointers.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (dist > 0) {
        this.setZoom(this._pinchZoomStart * (dist / this._pinchDist));
      }
      return;
    }

    if (this._dragStart) {
      const move = Math.hypot(pos.x - this._dragStart.x, pos.y - this._dragStart.y);
      if (move > this._maxMovePx) this._maxMovePx = move;
    }

    // Active True-Size overlay drag
    if (this._dragOverlay) {
      const geoPt = this.screenToLonLat(pos.x, pos.y);
      if (geoPt) {
        const latLimit = this.projection === "mercator" ? 78 : 84;
        const targetLon = normalizeLon(geoPt.lon + this._dragOverlay.offsetLon);
        const targetLat = clampLat(geoPt.lat + this._dragOverlay.offsetLat, latLimit);
        const payload = { id: this._dragOverlay.id, lon: targetLon, lat: targetLat };
        for (const cb of this._overlayDragListeners) {
          cb(payload);
        }
      }
      this._lastPointer = pos;
      return;
    }

    // Active globe / Mercator drag
    if (this._isDraggingGlobe && this._lastPointer) {
      const dx = pos.x - this._lastPointer.x;
      const dy = pos.y - this._lastPointer.y;
      this._lastPointer = pos;

      if (this.projection === "globe") {
        const { R } = this._globeMetrics(this.width, this.height);
        const degPerPx = 115 / Math.max(80, R);
        const dLon = -dx * degPerPx;
        const dLat = dy * degPerPx;
        this.rotLon = normalizeLon(this.rotLon + dLon);
        this.rotLat = clampLat(this.rotLat + dLat, 85);
        this._velLon = dLon * 0.72;
        this._velLat = dLat * 0.72;
      } else {
        const m = this._mercatorMetrics(this.width, this.height);
        const dLon = -(dx / m.scale) * 180;
        const nextMercY = m.camY + dy / m.scale;
        this.rotLon = normalizeLon(this.rotLon + dLon);
        this.rotLat = clampLat(invMercY(nextMercY), 75);
        this._velLon = dLon * 0.45;
        this._velLat = 0;
      }
      return;
    }

    // Passive hover feedback
    const geoPt = this.screenToLonLat(pos.x, pos.y);
    if (!geoPt) {
      this._hoveredCountryId = null;
      this.canvas.style.cursor = "default";
      if (this._hoverListeners.size > 0) {
        for (const cb of this._hoverListeners) cb(null);
      }
      return;
    }

    const hoverOv = this._hitTestDraggableOverlay(pos.x, pos.y, geoPt);
    this.canvas.style.cursor = hoverOv ? "move" : "grab";

    const country = findCountryAtPoint(geoPt.lon, geoPt.lat, this.countries);
    this._hoveredCountryId = country ? country.id : null;

    if (this._hoverListeners.size > 0) {
      const payload = {
        lon: geoPt.lon,
        lat: geoPt.lat,
        country,
        overlay: hoverOv,
        screenX: pos.x,
        screenY: pos.y,
      };
      for (const cb of this._hoverListeners) cb(payload);
    }
  }

  _handlePointerUp(e) {
    if (this._destroyed) return;
    const pos = this._canvasPos(e);
    const wasDraggingOverlay = Boolean(this._dragOverlay);
    const wasClick = !wasDraggingOverlay && this._pointers.size <= 1 && this._maxMovePx < 6;

    this._pointers.delete(e.pointerId);
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }

    if (this._pointers.size < 2) {
      this._pinchDist = 0;
    }
    if (this._pointers.size === 0) {
      this._isDraggingGlobe = false;
      this._dragOverlay = null;
      this._dragStart = null;
      this._lastPointer = null;
      this.canvas.style.cursor = "grab";
    }

    if (wasClick && this._clickListeners.size > 0) {
      this._velLon = 0;
      this._velLat = 0;
      const geoPt = this.screenToLonLat(pos.x, pos.y);
      if (geoPt) {
        const country = findCountryAtPoint(geoPt.lon, geoPt.lat, this.countries);
        const payload = {
          lon: geoPt.lon,
          lat: geoPt.lat,
          country,
          screenX: pos.x,
          screenY: pos.y,
        };
        for (const cb of this._clickListeners) cb(payload);
      }
    }
  }

  _handlePointerLeave() {
    if (!this._isDraggingGlobe && !this._dragOverlay) {
      this._hoveredCountryId = null;
      if (this._hoverListeners.size > 0) {
        for (const cb of this._hoverListeners) cb(null);
      }
    }
  }

  _handleWheel(e) {
    if (this._destroyed) return;
    e.preventDefault();
    this._flyAnim = null;
    const factor = Math.exp(-e.deltaY * 0.0014);
    this.setZoom(this.zoom * factor);
  }

  // ==================== Animation Loop ====================

  _startLoop() {
    this._lastFrameTime = performance.now();
    const tick = (now) => {
      if (this._destroyed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - this._lastFrameTime) / 1000));
      this._lastFrameTime = now;

      this._stepPhysics(now, dt);
      this._renderFrame(now);
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stepPhysics(now, dt) {
    if (this._flyAnim) {
      const elapsed = now - this._flyAnim.startTime;
      const rawT = Math.min(1, elapsed / this._flyAnim.duration);
      const t = easeInOutCubic(rawT);
      this.rotLon = normalizeLon(this._flyAnim.fromLon + this._flyAnim.deltaLon * t);
      this.rotLat = this._flyAnim.fromLat + (this._flyAnim.toLat - this._flyAnim.fromLat) * t;
      this.zoom = this._flyAnim.fromZoom + (this._flyAnim.toZoom - this._flyAnim.fromZoom) * t;
      if (rawT >= 1) {
        this._flyAnim = null;
      }
      return;
    }

    if (!this._isDraggingGlobe && !this._dragOverlay) {
      const damping = Math.pow(0.90, dt * 60);
      if (Math.abs(this._velLon) > 0.008 || Math.abs(this._velLat) > 0.008) {
        this.rotLon = normalizeLon(this.rotLon + this._velLon * dt * 60);
        this.rotLat = clampLat(this.rotLat + this._velLat * dt * 60, this.projection === "mercator" ? 75 : 85);
        this._velLon *= damping;
        this._velLat *= damping;
      } else {
        this._velLon = 0;
        this._velLat = 0;
        if (this.autoSpin && this.projection === "globe") {
          this.rotLon = normalizeLon(this.rotLon + 5.8 * dt);
        }
      }
    }
  }

  // ==================== Rendering Pipeline ====================

  _renderFrame(now) {
    this._renderToContext(this.ctx, this.width, this.height, this.dpr, now, {
      transparentBackdrop: false,
      forceNoStars: this.options.mini,
    });
  }

  _renderToContext(ctx, w, h, dpr, now, opts = {}) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Backdrop
    if (opts.transparentBackdrop) {
      ctx.clearRect(0, 0, w, h);
    } else {
      const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.1, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
      bgGrad.addColorStop(0, "#0A1B33");
      bgGrad.addColorStop(1, "#050E1C");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      if (!opts.forceNoStars && this._stars.length) {
        this._drawStars(ctx, w, h, now);
      }
    }

    if (this.projection === "globe") {
      this._renderGlobe(ctx, w, h, now);
    } else {
      this._renderMercator(ctx, w, h, now);
    }

    ctx.restore();
  }

  _drawStars(ctx, w, h, now) {
    const t = now * 0.0012;
    for (let i = 0; i < this._stars.length; i++) {
      const s = this._stars[i];
      const twinkle = 0.68 + 0.32 * Math.sin(t + s.phase);
      ctx.globalAlpha = s.alpha * twinkle;
      ctx.fillStyle = s.tint;
      ctx.beginPath();
      ctx.arc(s.u * w, s.v * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _buildHighlightMap() {
    const map = new Map();
    const list = this.layers.highlights;
    if (!list || !list.length) return map;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (!h || h.id == null) continue;
      const canonicalId = this._countryLookup.get(normalizeLookupKey(h.id)) || String(h.id);
      map.set(canonicalId, h);
    }
    return map;
  }

  _getCompiledOverlayRings(overlay) {
    if (!overlay || !overlay.polygons) return [];
    let cached = this._compiledOverlays.get(overlay.polygons);
    if (!cached) {
      cached = compileRings(overlay.polygons, false);
      this._compiledOverlays.set(overlay.polygons, cached);
    }
    return cached;
  }

  // ==================== 3D ORTHOGRAPHIC GLOBE RENDERER ====================

  _renderGlobe(ctx, w, h, now) {
    this._framePillRects = [];
    const { cx, cy, R } = this._globeMetrics(w, h);
    const cam = this._buildCameraBasis();
    const pulseWave = 0.5 + 0.5 * Math.sin(now * 0.0045);

    // 1. Atmospheric outer halo (rich ice-cyan + warm observatory amber rim)
    const haloGrad = ctx.createRadialGradient(cx, cy, R * 0.93, cx, cy, R * 1.19);
    haloGrad.addColorStop(0, "rgba(56, 189, 248, 0.30)");
    haloGrad.addColorStop(0.45, "rgba(247, 147, 30, 0.08)");
    haloGrad.addColorStop(1, "rgba(7, 19, 36, 0)");
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.19, 0, Math.PI * 2);
    ctx.fill();

    // 2. Sphere ocean body + subtle atmospheric specular gleam
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    const oceanGrad = ctx.createRadialGradient(
      cx - R * 0.32, cy - R * 0.32, R * 0.06,
      cx, cy, R * 1.04
    );
    oceanGrad.addColorStop(0, PALETTE.oceanCore);
    oceanGrad.addColorStop(0.42, PALETTE.oceanMid);
    oceanGrad.addColorStop(0.78, PALETTE.oceanDeep);
    oceanGrad.addColorStop(1, PALETTE.oceanLimb);
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(cx - R - 2, cy - R - 2, R * 2 + 4, R * 2 + 4);

    if (!this.options.mini) {
      const specGrad = ctx.createRadialGradient(
        cx - R * 0.38, cy - R * 0.38, R * 0.02,
        cx - R * 0.32, cy - R * 0.32, R * 0.65
      );
      specGrad.addColorStop(0, "rgba(140, 208, 255, 0.14)");
      specGrad.addColorStop(0.55, "rgba(56, 189, 248, 0.04)");
      specGrad.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx.fillStyle = specGrad;
      ctx.fillRect(cx - R - 2, cy - R - 2, R * 2 + 4, R * 2 + 4);
    }

    // 3. Subtle 3D Graticule
    this._drawGraticuleGlobe(ctx, cam, cx, cy, R);

    // 4. Optional X-ray Earth interior core (when tunnel layer is active!)
    if (this.layers.tunnel) {
      this._drawTunnelCoreBackdrop(ctx, cx, cy, R, pulseWave);
    }

    // 5. Landmasses + Highlights + Hover tint
    const highlightMap = this._buildHighlightMap();
    const tunnelXray = Boolean(this.layers.tunnel);

    for (let i = 0; i < this._compiledCountries.length; i++) {
      const item = this._compiledCountries[i];
      const cid = item.country.id;
      const hl = highlightMap.get(cid);
      const isHovered = this.options.interactive && this._hoveredCountryId === cid && !this.options.mini;
      const tone = LAND_TONES[item.toneIdx] || LAND_TONES[0];

      let fill = tunnelXray ? "rgba(27, 58, 92, 0.72)" : tone.fill;
      let stroke = tunnelXray ? "rgba(52, 94, 140, 0.85)" : tone.stroke;
      let lineWidth = this.options.mini ? 0.65 : 0.85;

      if (isHovered && !hl) {
        fill = PALETTE.landHover;
        stroke = PALETTE.landHoverStroke;
        lineWidth = 1.45;
      }

      if (hl) {
        fill = hl.fill || "rgba(255, 224, 102, 0.36)";
        stroke = hl.stroke || PALETTE.gold;
        lineWidth = this.options.mini ? 1.2 : 1.75;
      }

      this._drawCompiledRingsGlobe(ctx, item.rings, cam, cx, cy, R, {
        fill,
        stroke,
        lineWidth,
        coastalHalo: !this.options.mini && !tunnelXray && !hl,
        glowColor: hl ? stroke : null,
        glowBlur: hl && hl.pulse ? 6 + pulseWave * 10 : (hl ? 7 : 0),
        pulseAlpha: hl && hl.pulse ? 0.8 + 0.2 * pulseWave : 1,
      });
    }

    // 6. Custom Parallels & Meridians
    this._drawParallelsGlobe(ctx, cam, cx, cy, R);
    this._drawMeridiansGlobe(ctx, cam, cx, cy, R);

    // 7. True-Size Overlays (inside sphere clip)
    this._drawOverlaysGlobe(ctx, cam, cx, cy, R, pulseWave);

    // 8. Inner atmospheric rim shadow + soft upper-left specular
    const innerShadow = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
    innerShadow.addColorStop(0, "rgba(4, 10, 22, 0)");
    innerShadow.addColorStop(0.84, "rgba(4, 10, 22, 0.14)");
    innerShadow.addColorStop(1, "rgba(3, 9, 20, 0.48)");
    ctx.fillStyle = innerShadow;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // 9. X-ray Tunnel Laser through Earth's Core (drawn over translucent landmasses!)
    if (this.layers.tunnel) {
      this._drawTunnelBeamGlobe(ctx, cam, cx, cy, R, now);
    }

    ctx.restore(); // End sphere clip

    // 10. Crisp observatory limb rim stroke & orbital compass degree ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = PALETTE.cyanRim;
    ctx.lineWidth = this.options.mini ? 1.2 : 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, R + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = PALETTE.goldRim;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    if (!this.options.mini && R > 90) {
      const compassR = R + 11;
      ctx.beginPath();
      ctx.arc(cx, cy, compassR, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(140, 208, 255, 0.13)";
      ctx.lineWidth = 0.75;
      ctx.stroke();

      const stepDeg = R > 155 ? 5 : 15;
      for (let deg = 0; deg < 360; deg += stepDeg) {
        const rad = (deg * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        const isCardinal = deg % 90 === 0;
        const isMajor = deg % 30 === 0;
        const isMed = deg % 15 === 0;

        const inner = isCardinal ? compassR - 3.5 : (isMajor ? compassR - 2 : compassR);
        const outer = isCardinal ? compassR + 6 : (isMajor ? compassR + 4 : (isMed ? compassR + 2.5 : compassR + 1.4));

        ctx.beginPath();
        ctx.moveTo(cx + cosA * inner, cy + sinA * inner);
        ctx.lineTo(cx + cosA * outer, cy + sinA * outer);
        ctx.strokeStyle = isCardinal
          ? "rgba(247, 147, 30, 0.48)"
          : (isMajor ? "rgba(140, 208, 255, 0.34)" : (isMed ? "rgba(140, 208, 255, 0.16)" : "rgba(140, 208, 255, 0.08)"));
        ctx.lineWidth = isCardinal ? 1.25 : (isMajor ? 0.9 : 0.65);
        ctx.stroke();
      }
    }
    ctx.restore();

    // 11. Geodesic Arcs (lifted slightly above sphere rim so they can arch beyond limb!)
    this._drawArcsGlobe(ctx, cam, cx, cy, R, now);

    // 12. Pins & Labels (drawn last so labels are always razor-sharp and unobstructed)
    this._drawPinsGlobe(ctx, cam, cx, cy, R, now);
    this._drawOverlayLabelsGlobe(ctx, cam, cx, cy, R);
    this._drawParallelMeridianLabelsGlobe(ctx, cam, cx, cy, R);
  }

  _drawGraticuleGlobe(ctx, cam, cx, cy, R) {
    ctx.save();
    for (let i = 0; i < this._graticule3D.length; i++) {
      const line = this._graticule3D[i];
      ctx.beginPath();
      let penDown = false;
      const pts = line.pts;
      for (let k = 0; k < pts.length; k++) {
        const v = pts[k];
        const z = v[0] * cam.fz0 + v[1] * cam.fz1 + v[2] * cam.fz2;
        if (z > 0) {
          const x = v[0] * cam.rx0 + v[1] * cam.rx1 + v[2] * cam.rx2;
          const y = v[0] * cam.uy0 + v[1] * cam.uy1 + v[2] * cam.uy2;
          const sx = cx + x * R;
          const sy = cy - y * R;
          if (!penDown) {
            ctx.moveTo(sx, sy);
            penDown = true;
          } else {
            ctx.lineTo(sx, sy);
          }
        } else {
          penDown = false;
        }
      }
      ctx.strokeStyle = line.isPrimary ? PALETTE.equator : PALETTE.graticule;
      ctx.lineWidth = line.isPrimary ? 1.0 : 0.65;
      if (line.isPrimary && line.isLat) {
        ctx.setLineDash([5, 5]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Exact orthographic horizon-clipped polygon renderer:
   * - Back-hemisphere culling via bounding cap
   * - Exact z=0 intersection insertion for limb-crossing edges
   * - Smooth unit-circle arc traversal along back-hemisphere limb segments
   * - Even-odd fill (supports Lesotho cutout in South Africa cleanly!)
   * - Front-only coastline stroke (no ugly fake strokes along sphere horizon)
   */
  _drawCompiledRingsGlobe(ctx, rings, cam, cx, cy, R, style) {
    let anyRingDrawn = false;
    const strokeSegs = [];

    ctx.save();
    ctx.beginPath();

    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      // Fast back-hemisphere bounding-cap cull
      const centerZ = ring.cx * cam.fz0 + ring.cy * cam.fz1 + ring.cz * cam.fz2;
      if (centerZ < ring.cullThreshold) continue;

      const vecs = ring.vecs;
      const n = ring.count;

      // Project all vertices to camera space & check if any are front-facing
      let anyFront = false;
      const xs = new Float32Array(n);
      const ys = new Float32Array(n);
      const zs = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        const idx = i * 3;
        const vx = vecs[idx], vy = vecs[idx + 1], vz = vecs[idx + 2];
        xs[i] = vx * cam.rx0 + vy * cam.rx1 + vz * cam.rx2;
        ys[i] = vx * cam.uy0 + vy * cam.uy1 + vz * cam.uy2;
        const z = vx * cam.fz0 + vy * cam.fz1 + vz * cam.fz2;
        zs[i] = z;
        if (z > 0) anyFront = true;
      }

      if (!anyFront) continue;
      anyRingDrawn = true;

      // Build clipped 2D fill contour on the projected unit disk
      let started = false;
      let firstLimbAngle = null;
      let prevLimbAngle = null;

      const walkLimbArc = (fromAng, toAng) => {
        let dAng = toAng - fromAng;
        while (dAng > Math.PI) dAng -= Math.PI * 2;
        while (dAng < -Math.PI) dAng += Math.PI * 2;
        const steps = Math.ceil(Math.abs(dAng) / 0.12);
        for (let s = 1; s < steps; s++) {
          const a = fromAng + (dAng * s) / steps;
          ctx.lineTo(cx + Math.cos(a) * R, cy - Math.sin(a) * R);
        }
      };

      const emitPoint = (px, py, isLimb) => {
        if (isLimb) {
          const ang = Math.atan2(py, px);
          if (!started) {
            firstLimbAngle = ang;
          } else if (prevLimbAngle !== null) {
            walkLimbArc(prevLimbAngle, ang);
          }
          prevLimbAngle = ang;
        } else {
          prevLimbAngle = null;
        }

        const sx = cx + px * R;
        const sy = cy - py * R;
        if (!started) {
          ctx.moveTo(sx, sy);
          started = true;
        } else {
          ctx.lineTo(sx, sy);
        }
      };

      let curStrokeRun = null;

      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        const x1 = xs[i], y1 = ys[i], z1 = zs[i];
        const x2 = xs[next], y2 = ys[next], z2 = zs[next];

        if (z1 >= 0) {
          emitPoint(x1, y1, false);
          if (!curStrokeRun) {
            curStrokeRun = [cx + x1 * R, cy - y1 * R];
            strokeSegs.push(curStrokeRun);
          } else {
            curStrokeRun.push(cx + x1 * R, cy - y1 * R);
          }

          if (z2 < 0) {
            // Crossing front -> back: intersect z = 0
            const t = z1 / (z1 - z2);
            let ix = x1 + (x2 - x1) * t;
            let iy = y1 + (y2 - y1) * t;
            const il = Math.hypot(ix, iy) || 1;
            ix /= il; iy /= il;
            emitPoint(ix, iy, true);
            curStrokeRun.push(cx + ix * R, cy - iy * R);
            curStrokeRun = null;
          } else if (next === 0) {
            // Close visible coastline cleanly
            curStrokeRun.push(cx + x2 * R, cy - y2 * R);
          }
        } else {
          // z1 < 0: clamp radially onto unit circle
          const l1 = Math.hypot(x1, y1);
          if (l1 > 1e-6) {
            emitPoint(x1 / l1, y1 / l1, true);
          }
          curStrokeRun = null;

          if (z2 >= 0) {
            // Crossing back -> front: intersect z = 0
            const t = z1 / (z1 - z2);
            let ix = x1 + (x2 - x1) * t;
            let iy = y1 + (y2 - y1) * t;
            const il = Math.hypot(ix, iy) || 1;
            ix /= il; iy /= il;
            emitPoint(ix, iy, true);
            curStrokeRun = [cx + ix * R, cy - iy * R];
            strokeSegs.push(curStrokeRun);
          }
        }
      }

      // If the ring started and ended on the limb, walk the circular horizon arc cleanly back
      if (started) {
        if (firstLimbAngle !== null && prevLimbAngle !== null) {
          walkLimbArc(prevLimbAngle, firstLimbAngle);
        }
        ctx.closePath();
      }
    }

    if (anyRingDrawn) {
      if (style.pulseAlpha != null && style.pulseAlpha !== 1) {
        ctx.globalAlpha = style.pulseAlpha;
      }
      if (style.fill) {
        ctx.fillStyle = style.fill;
        ctx.fill("evenodd");
      }

      if (style.stroke && strokeSegs.length) {
        ctx.beginPath();
        for (let s = 0; s < strokeSegs.length; s++) {
          const run = strokeSegs[s];
          if (run.length < 4) continue;
          ctx.moveTo(run[0], run[1]);
          for (let k = 2; k < run.length; k += 2) {
            ctx.lineTo(run[k], run[k + 1]);
          }
        }
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (style.coastalHalo) {
          ctx.strokeStyle = PALETTE.coastalHalo;
          ctx.lineWidth = 2.8;
          ctx.stroke();
        }
        if (style.glowColor && style.glowBlur > 0) {
          ctx.shadowColor = style.glowColor;
          ctx.shadowBlur = style.glowBlur;
        }
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.lineWidth || 1;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  _drawParallelsGlobe(ctx, cam, cx, cy, R) {
    const list = this.layers.parallels;
    if (!list || !list.length) return;

    ctx.save();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const color = p.color || PALETTE.gold;
      ctx.beginPath();
      let pen = false;
      for (let lon = -180; lon <= 180; lon += 3) {
        const proj = this._projectGlobeLonLat(lon, p.lat, cam, cx, cy, R);
        if (proj.z >= 0) {
          if (!pen) { ctx.moveTo(proj.sx, proj.sy); pen = true; }
          else ctx.lineTo(proj.sx, proj.sy);
        } else {
          pen = false;
        }
      }
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.0;
      ctx.setLineDash([7, 4]);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawMeridiansGlobe(ctx, cam, cx, cy, R) {
    const list = this.layers.meridians;
    if (!list || !list.length) return;

    ctx.save();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const color = m.color || PALETTE.gold;
      ctx.beginPath();
      let pen = false;
      for (let lat = -88; lat <= 88; lat += 3) {
        const proj = this._projectGlobeLonLat(m.lon, lat, cam, cx, cy, R);
        if (proj.z >= 0) {
          if (!pen) { ctx.moveTo(proj.sx, proj.sy); pen = true; }
          else ctx.lineTo(proj.sx, proj.sy);
        } else {
          pen = false;
        }
      }
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.0;
      ctx.setLineDash([7, 4]);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawParallelMeridianLabelsGlobe(ctx, cam, cx, cy, R) {
    if (this.options.mini) return;
    const parallels = this.layers.parallels;
    if (parallels && parallels.length) {
      for (let i = 0; i < parallels.length; i++) {
        const p = parallels[i];
        if (!p.label) continue;
        const proj = this._projectGlobeLonLat(this.rotLon, p.lat, cam, cx, cy, R);
        if (proj.z > 0.1) {
          this._drawLabelPill(ctx, p.label, proj.sx, proj.sy - 14, p.color || PALETTE.gold);
        }
      }
    }
    const meridians = this.layers.meridians;
    if (meridians && meridians.length) {
      for (let i = 0; i < meridians.length; i++) {
        const m = meridians[i];
        if (!m.label) continue;
        const proj = this._projectGlobeLonLat(m.lon, clampLat(this.rotLat, 60), cam, cx, cy, R);
        if (proj.z > 0.1) {
          this._drawLabelPill(ctx, m.label, proj.sx + 10, proj.sy, m.color || PALETTE.gold);
        }
      }
    }
  }

  _drawOverlaysGlobe(ctx, cam, cx, cy, R, pulseWave) {
    const overlays = this.layers.overlays;
    if (!overlays || !overlays.length) return;

    for (let i = 0; i < overlays.length; i++) {
      const ov = overlays[i];
      const rings = this._getCompiledOverlayRings(ov);
      if (!rings.length) continue;

      const fill = ov.fill || "rgba(247, 147, 30, 0.34)";
      const stroke = ov.stroke || PALETTE.orange;
      this._drawCompiledRingsGlobe(ctx, rings, cam, cx, cy, R, {
        fill,
        stroke,
        lineWidth: 2.1,
        glowColor: stroke,
        glowBlur: 8 + pulseWave * 4,
      });
    }
  }

  _drawOverlayLabelsGlobe(ctx, cam, cx, cy, R) {
    if (this.options.mini) return;
    const overlays = this.layers.overlays;
    if (!overlays || !overlays.length) return;

    for (let i = 0; i < overlays.length; i++) {
      const ov = overlays[i];
      if (!ov.centroid) continue;
      const p = this._projectGlobeLonLat(ov.centroid[0], ov.centroid[1], cam, cx, cy, R);
      if (p.z <= 0.05) continue;

      const stroke = ov.stroke || PALETTE.orange;
      if (ov.draggable) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 5, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.parchment;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      if (ov.name) {
        this._drawLabelPill(ctx, ov.name, p.sx, p.sy - 16, stroke);
      }
    }
  }

  _drawArcsGlobe(ctx, cam, cx, cy, R, now) {
    const arcs = this.layers.arcs;
    if (!arcs || !arcs.length) return;

    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      if (!a || !a.from || !a.to) continue;

      const color = a.color || PALETTE.orange;
      const progress = a.progress == null ? 1 : Math.max(0, Math.min(1, a.progress));
      if (progress <= 0) continue;

      const pts = slerpGreatCircle(a.from[0], a.from[1], a.to[0], a.to[1], 64);
      const vStart = lonLatToVec3(a.from[0], a.from[1]);
      const vEnd = lonLatToVec3(a.to[0], a.to[1]);
      const angDist = Math.acos(Math.max(-1, Math.min(1, vStart[0] * vEnd[0] + vStart[1] * vEnd[1] + vStart[2] * vEnd[2])));
      const maxLift = 0.035 + Math.min(0.18, angDist * 0.085);

      const maxIdx = Math.max(1, Math.floor((pts.length - 1) * progress));

      ctx.save();
      ctx.beginPath();
      let pen = false;
      let midProj = null;
      let bestMidDist = Infinity;
      let prevTipProj = null;
      let tipProj = null;
      const midIdx = Math.floor(maxIdx * 0.5);

      for (let k = 0; k <= maxIdx; k++) {
        const t = k / (pts.length - 1);
        const lift = 1 + maxLift * Math.sin(Math.PI * t);
        const proj = this._projectGlobeLonLat(pts[k][0], pts[k][1], cam, cx, cy, R, lift);
        // Elevated arc points stay visible slightly past z=0 horizon if outside sphere silhouette!
        const radDist = Math.hypot(proj.x * lift, proj.y * lift);
        const visible = proj.z >= -0.02 || radDist > 1.005;

        if (visible) {
          if (!pen) { ctx.moveTo(proj.sx, proj.sy); pen = true; }
          else ctx.lineTo(proj.sx, proj.sy);
          const distToMid = Math.abs(k - midIdx);
          if (distToMid < bestMidDist) {
            bestMidDist = distToMid;
            midProj = proj;
          }
          if (k === maxIdx - 1) prevTipProj = proj;
          if (k === maxIdx) tipProj = proj;
        } else {
          pen = false;
        }
      }

      if (a.dashed) {
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -(now * 0.025);
      }
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = color;
      ctx.lineWidth = this.options.mini ? 1.8 : 2.6;
      ctx.lineCap = "round";
      ctx.stroke();

      // Inner bright core stroke
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255, 248, 232, 0.72)";
      ctx.lineWidth = this.options.mini ? 0.7 : 1.0;
      ctx.stroke();

      // Directional arrowhead & glowing tip spark
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      if (!this.options.mini && progress > 0.14 && prevTipProj && tipProj) {
        this._drawArcArrowhead(ctx, prevTipProj, tipProj, color);
      }
      if (progress < 0.99 && tipProj) {
        ctx.beginPath();
        ctx.arc(tipProj.sx, tipProj.sy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.gold;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fill();
      }
      ctx.restore();

      if (a.label && midProj && !this.options.mini && progress > 0.55) {
        this._drawLabelPill(ctx, a.label, midProj.sx, midProj.sy - 14, color);
      }
    }
  }

  _drawTunnelCoreBackdrop(ctx, cx, cy, R, pulseWave) {
    ctx.save();
    // Outer mantle ring
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.54, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(247, 147, 30, 0.14)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Molten inner core glow at sphere center (0, 0, 0)
    const coreR = R * (0.21 + 0.025 * pulseWave);
    const coreGrad = ctx.createRadialGradient(cx, cy, coreR * 0.08, cx, cy, coreR * 2.1);
    coreGrad.addColorStop(0, "rgba(255, 244, 200, 0.72)");
    coreGrad.addColorStop(0.32, "rgba(255, 210, 90, 0.52)");
    coreGrad.addColorStop(0.62, "rgba(247, 147, 30, 0.24)");
    coreGrad.addColorStop(1, "rgba(247, 147, 30, 0)");
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 2.1, 0, Math.PI * 2);
    ctx.fill();

    // Crisp inner core ring
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 0.58, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 224, 102, 0.45)";
    ctx.lineWidth = 1.0;
    ctx.stroke();
    ctx.restore();
  }

  _drawTunnelBeamGlobe(ctx, cam, cx, cy, R, now) {
    const tunnel = this.layers.tunnel;
    if (!tunnel || !tunnel.entry || !tunnel.exit) return;

    const progress = tunnel.progress == null ? 1 : Math.max(0, Math.min(1, tunnel.progress));
    const p1 = this._projectGlobeLonLat(tunnel.entry[0], tunnel.entry[1], cam, cx, cy, R);
    const p2 = this._projectGlobeLonLat(tunnel.exit[0], tunnel.exit[1], cam, cx, cy, R);

    const curX = p1.sx + (p2.sx - p1.sx) * progress;
    const curY = p1.sy + (p2.sy - p1.sy) * progress;

    ctx.save();

    // Full faint X-ray guide axis through Earth's center
    ctx.beginPath();
    ctx.moveTo(p1.sx, p1.sy);
    ctx.lineTo(p2.sx, p2.sy);
    ctx.strokeStyle = "rgba(255, 224, 102, 0.22)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Active molten laser beam
    if (progress > 0.005) {
      const grad = ctx.createLinearGradient(p1.sx, p1.sy, curX, curY);
      grad.addColorStop(0, "#F7931E");
      grad.addColorStop(0.5, "#FFE066");
      grad.addColorStop(1, "#38BDF8");

      // Wide outer plasma glow
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(curX, curY);
      ctx.shadowColor = "#F7931E";
      ctx.shadowBlur = 18;
      ctx.strokeStyle = grad;
      ctx.lineWidth = this.options.mini ? 3.2 : 5.0;
      ctx.lineCap = "round";
      ctx.stroke();

      // Hot white-gold center filament
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(curX, curY);
      ctx.shadowBlur = 6;
      ctx.shadowColor = "#FFE066";
      ctx.strokeStyle = "#FFF8E1";
      ctx.lineWidth = this.options.mini ? 1.2 : 1.8;
      ctx.stroke();

      // Animated energy pulses traveling through core
      ctx.shadowBlur = 0;
      const offset = -((now * 0.05) % 20);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(curX, curY);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 2.0;
      ctx.setLineDash([4, 16]);
      ctx.lineDashOffset = offset;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Entry portal reticle
    ctx.beginPath();
    ctx.arc(p1.sx, p1.sy, this.options.mini ? 4 : 6.5, 0, Math.PI * 2);
    ctx.fillStyle = "#F7931E";
    ctx.shadowColor = "#F7931E";
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.strokeStyle = "#FBF6EE";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Active drill tip burst during animation
    if (progress > 0.02 && progress < 0.99) {
      const sparkR = (this.options.mini ? 5 : 9) + Math.sin(now * 0.03) * 2;
      ctx.beginPath();
      ctx.arc(curX, curY, sparkR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 232, 130, 0.85)";
      ctx.shadowColor = "#FFE066";
      ctx.shadowBlur = 16;
      ctx.fill();
    }

    // Far-side X-ray Exit reticle (translucent dashed ring when on opposite hemisphere!)
    if (progress >= 0.9) {
      const pulse = (now * 0.002) % 1;
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#38BDF8";
      ctx.beginPath();
      ctx.arc(p2.sx, p2.sy, (this.options.mini ? 5 : 9) + pulse * 10, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(56, 189, 248, ${(1 - pulse) * 0.7})`;
      ctx.lineWidth = 1.6;
      if (p2.z < 0) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(p2.sx, p2.sy, this.options.mini ? 3.8 : 5.5, 0, Math.PI * 2);
      ctx.fillStyle = p2.z < 0 ? "rgba(56, 189, 248, 0.7)" : "#38BDF8";
      ctx.fill();
      ctx.strokeStyle = "#FBF6EE";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawPinsGlobe(ctx, cam, cx, cy, R, now) {
    const pins = this.layers.pins;
    if (!pins || !pins.length) return;

    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      if (!pin || pin.lon == null || pin.lat == null) continue;
      const proj = this._projectGlobeLonLat(pin.lon, pin.lat, cam, cx, cy, R);
      if (proj.z < -0.02) continue; // On far side of Earth

      const edgeFade = proj.z < 0.08 ? Math.max(0, (proj.z + 0.02) / 0.10) : 1;
      this._drawPinAt(ctx, proj.sx, proj.sy, pin, now, edgeFade);
    }
  }

  // ==================== 2D WEB MERCATOR RENDERER ====================

  _renderMercator(ctx, w, h, now) {
    this._framePillRects = [];
    const m = this._mercatorMetrics(w, h);
    const pulseWave = 0.5 + 0.5 * Math.sin(now * 0.0045);

    const topY = m.cy - (m.maxY - m.camY) * m.scale;
    const botY = m.cy - (-m.maxY - m.camY) * m.scale;

    ctx.save();
    // Clip vertically to valid Web Mercator band (+/-82 deg)
    ctx.beginPath();
    ctx.rect(0, Math.max(0, topY), w, Math.min(h, botY) - Math.max(0, topY));
    ctx.clip();

    // 1. Ocean gradient
    const oceanGrad = ctx.createLinearGradient(0, topY, 0, botY);
    oceanGrad.addColorStop(0, "#07162B");
    oceanGrad.addColorStop(0.5, "#0E2747");
    oceanGrad.addColorStop(1, "#07162B");
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, topY, w, botY - topY);

    // Determine visible longitudinal tile shifts (-360, 0, +360, etc.)
    const halfSpanLon = ((w * 0.5) / m.scale) * 180 + 200;
    const minTile = Math.floor((this.rotLon - halfSpanLon) / 360);
    const maxTile = Math.ceil((this.rotLon + halfSpanLon) / 360);

    // 2. Graticule
    this._drawGraticuleMercator(ctx, w, h, m, topY, botY, minTile, maxTile);

    // 3. Landmasses & Highlights
    const highlightMap = this._buildHighlightMap();
    for (let i = 0; i < this._compiledCountries.length; i++) {
      const item = this._compiledCountries[i];
      const cid = item.country.id;
      const hl = highlightMap.get(cid);
      const isHovered = this.options.interactive && this._hoveredCountryId === cid && !this.options.mini;
      const tone = LAND_TONES[item.toneIdx] || LAND_TONES[0];

      let fill = tone.fill;
      let stroke = tone.stroke;
      let lineWidth = 0.85;

      if (isHovered && !hl) {
        fill = PALETTE.landHover;
        stroke = PALETTE.landHoverStroke;
        lineWidth = 1.45;
      }
      if (hl) {
        fill = hl.fill || "rgba(255, 224, 102, 0.36)";
        stroke = hl.stroke || PALETTE.gold;
        lineWidth = 1.75;
      }

      this._drawCompiledRingsMercator(ctx, item.rings, m, w, minTile, maxTile, {
        fill,
        stroke,
        lineWidth,
        coastalHalo: !this.options.mini && !hl,
        glowColor: hl ? stroke : null,
        glowBlur: hl && hl.pulse ? 6 + pulseWave * 10 : (hl ? 7 : 0),
        pulseAlpha: hl && hl.pulse ? 0.8 + 0.2 * pulseWave : 1,
      });
    }

    // 4. Parallels & Meridians
    this._drawParallelsMercator(ctx, w, m);
    this._drawMeridiansMercator(ctx, m, topY, botY, minTile, maxTile);

    // 5. True-Size Overlays
    this._drawOverlaysMercator(ctx, w, m, minTile, maxTile, pulseWave);

    // 6. Geodesic Arcs
    this._drawArcsMercator(ctx, m, minTile, maxTile, now);

    // 7. Tunnel (2D fallback representation)
    if (this.layers.tunnel) {
      this._drawTunnelMercator(ctx, m, now);
    }

    // 8. Pins
    this._drawPinsMercator(ctx, w, m, minTile, maxTile, now);

    // Subtle Mercator +/-82 deg latitude boundary ticks
    ctx.strokeStyle = "rgba(220, 205, 186, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, topY + 0.5);
    ctx.lineTo(w, topY + 0.5);
    ctx.moveTo(0, botY - 0.5);
    ctx.lineTo(w, botY - 0.5);
    ctx.stroke();

    ctx.restore();
  }

  _drawGraticuleMercator(ctx, w, h, m, topY, botY, minTile, maxTile) {
    ctx.save();
    for (let lat = -75; lat <= 75; lat += 15) {
      const y = m.cy - (mercY(lat) - m.camY) * m.scale;
      if (y < topY || y > botY) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.strokeStyle = lat === 0 ? PALETTE.equator : PALETTE.graticule;
      ctx.lineWidth = lat === 0 ? 1.1 : 0.6;
      ctx.setLineDash(lat === 0 ? [6, 5] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (let tile = minTile; tile <= maxTile; tile++) {
      const base = tile * 360;
      for (let lon = -180; lon < 180; lon += 30) {
        const x = m.cx + (mercX(lon + base) - m.camX) * m.scale;
        if (x < -2 || x > w + 2) continue;
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, botY);
        ctx.strokeStyle = lon === 0 ? PALETTE.equator : PALETTE.graticule;
        ctx.lineWidth = lon === 0 ? 1.0 : 0.6;
        ctx.stroke();
      }
    }

    if (!this.options.mini && w >= 420) {
      const refLats = [60, 30, 0, -30, -60];
      ctx.font = '600 10px "JetBrains Mono", "Poppins", monospace';
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (let i = 0; i < refLats.length; i++) {
        const lat = refLats[i];
        const y = m.cy - (mercY(lat) - m.camY) * m.scale;
        if (y < Math.max(72, topY + 14) || y > Math.min(h - 70, botY - 14)) continue;
        const txt = lat === 0 ? "0° EQ" : `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}`;
        const tw = ctx.measureText(txt).width + 10;
        ctx.fillStyle = lat === 0 ? "rgba(247, 147, 30, 0.16)" : "rgba(7, 19, 36, 0.72)";
        ctx.strokeStyle = lat === 0 ? "rgba(247, 147, 30, 0.48)" : "rgba(140, 208, 255, 0.22)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.roundRect(12, Math.round(y - 8), Math.ceil(tw), 16, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = lat === 0 ? PALETTE.gold : "rgba(220, 205, 186, 0.82)";
        ctx.fillText(txt, 17, y + 0.5);
      }
    }
    ctx.restore();
  }

  _drawCompiledRingsMercator(ctx, rings, m, w, minTile, maxTile, style) {
    ctx.save();
    for (let tile = minTile; tile <= maxTile; tile++) {
      const shift = tile * 360;
      ctx.beginPath();
      let anyDrawn = false;

      for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        const { points, minLon, maxLon, spansPole } = ring.unwrapped;
        if (!points.length) continue;

        const leftX = m.cx + (mercX(minLon + shift) - m.camX) * m.scale;
        const rightX = m.cx + (mercX(maxLon + shift) - m.camX) * m.scale;
        if (rightX < -40 || leftX > w + 40) continue;

        anyDrawn = true;
        for (let i = 0; i < points.length; i++) {
          const sx = m.cx + (mercX(points[i][0] + shift) - m.camX) * m.scale;
          const sy = m.cy - (mercY(clampLat(points[i][1], MERC_MAX_LAT)) - m.camY) * m.scale;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }

        // Close polar caps (Antarctica) cleanly along bottom/top latitude clamp
        if (spansPole || ring.isPolar) {
          let latAvg = 0;
          for (let i = 0; i < points.length; i++) latAvg += points[i][1];
          const poleLat = latAvg < 0 ? -MERC_MAX_LAT : MERC_MAX_LAT;
          const py = m.cy - (mercY(poleLat) - m.camY) * m.scale;
          const lastX = m.cx + (mercX(points[points.length - 1][0] + shift) - m.camX) * m.scale;
          const firstX = m.cx + (mercX(points[0][0] + shift) - m.camX) * m.scale;
          ctx.lineTo(lastX, py);
          ctx.lineTo(firstX, py);
        }
        ctx.closePath();
      }

      if (!anyDrawn) continue;

      if (style.pulseAlpha != null && style.pulseAlpha !== 1) {
        ctx.globalAlpha = style.pulseAlpha;
      }
      if (style.fill) {
        ctx.fillStyle = style.fill;
        ctx.fill("evenodd");
      }
      if (style.stroke) {
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (style.coastalHalo) {
          ctx.strokeStyle = PALETTE.coastalHalo;
          ctx.lineWidth = 2.6;
          ctx.stroke();
        }
        if (style.glowColor && style.glowBlur > 0) {
          ctx.shadowColor = style.glowColor;
          ctx.shadowBlur = style.glowBlur;
        }
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.lineWidth || 1;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  _drawParallelsMercator(ctx, w, m) {
    const list = this.layers.parallels;
    if (!list || !list.length) return;
    ctx.save();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const color = p.color || PALETTE.gold;
      const y = m.cy - (mercY(clampLat(p.lat, MERC_MAX_LAT)) - m.camY) * m.scale;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.0;
      ctx.setLineDash([7, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      if (p.label && !this.options.mini) {
        this._drawLabelPill(ctx, p.label, w * 0.5, y - 14, color);
      }
    }
    ctx.restore();
  }

  _drawMeridiansMercator(ctx, m, topY, botY, minTile, maxTile) {
    const list = this.layers.meridians;
    if (!list || !list.length) return;
    ctx.save();
    for (let i = 0; i < list.length; i++) {
      const mer = list[i];
      const color = mer.color || PALETTE.gold;
      for (let tile = minTile; tile <= maxTile; tile++) {
        const x = m.cx + (mercX(mer.lon + tile * 360) - m.camX) * m.scale;
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, botY);
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.0;
        ctx.setLineDash([7, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        if (mer.label && tile === 0 && !this.options.mini) {
          this._drawLabelPill(ctx, mer.label, x + 12, m.cy, color);
        }
      }
    }
    ctx.restore();
  }

  _drawOverlaysMercator(ctx, w, m, minTile, maxTile, pulseWave) {
    const overlays = this.layers.overlays;
    if (!overlays || !overlays.length) return;

    for (let i = 0; i < overlays.length; i++) {
      const ov = overlays[i];
      const rings = this._getCompiledOverlayRings(ov);
      if (!rings.length) continue;

      const fill = ov.fill || "rgba(247, 147, 30, 0.34)";
      const stroke = ov.stroke || PALETTE.orange;
      this._drawCompiledRingsMercator(ctx, rings, m, w, minTile, maxTile, {
        fill,
        stroke,
        lineWidth: 2.1,
        glowColor: stroke,
        glowBlur: 8 + pulseWave * 4,
      });

      if (ov.centroid && !this.options.mini) {
        // Draw handle & label on the tile closest to viewport center
        let bestX = null;
        let bestY = null;
        let bestDist = Infinity;
        for (let tile = minTile; tile <= maxTile; tile++) {
          const p = this._projectMercLonLat(ov.centroid[0], ov.centroid[1], m, tile * 360);
          const d = Math.abs(p.sx - m.cx);
          if (d < bestDist) {
            bestDist = d;
            bestX = p.sx;
            bestY = p.sy;
          }
        }
        if (bestX !== null && bestX >= -60 && bestX <= w + 60) {
          if (ov.draggable) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(bestX, bestY, 5, 0, Math.PI * 2);
            ctx.fillStyle = PALETTE.parchment;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 2;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
          if (ov.name) {
            this._drawLabelPill(ctx, ov.name, bestX, bestY - 16, stroke);
          }
        }
      }
    }
  }

  _drawArcsMercator(ctx, m, minTile, maxTile, now) {
    const arcs = this.layers.arcs;
    if (!arcs || !arcs.length) return;

    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      if (!a || !a.from || !a.to) continue;
      const progress = a.progress == null ? 1 : Math.max(0, Math.min(1, a.progress));
      if (progress <= 0) continue;

      const color = a.color || PALETTE.orange;
      const pts = slerpGreatCircle(a.from[0], a.from[1], a.to[0], a.to[1], 64);
      const unwrapped = unwrapRing(pts).points;
      const maxIdx = Math.max(1, Math.floor((unwrapped.length - 1) * progress));
      const midIdx = Math.floor(maxIdx * 0.5);

      for (let tile = minTile; tile <= maxTile; tile++) {
        const shift = tile * 360;
        let prevProj = null;
        let tipProj = null;
        ctx.save();
        ctx.beginPath();
        for (let k = 0; k <= maxIdx; k++) {
          const p = this._projectMercLonLat(unwrapped[k][0], unwrapped[k][1], m, shift);
          if (k === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
          if (k === maxIdx - 1) prevProj = p;
          if (k === maxIdx) tipProj = p;
        }
        if (a.dashed) {
          ctx.setLineDash([8, 6]);
          ctx.lineDashOffset = -(now * 0.025);
        }
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255, 248, 232, 0.7)";
        ctx.lineWidth = 1.0;
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        if (!this.options.mini && progress > 0.14 && prevProj && tipProj) {
          this._drawArcArrowhead(ctx, prevProj, tipProj, color);
        }
        ctx.restore();

        if (a.label && !this.options.mini && progress > 0.55) {
          const mid = this._projectMercLonLat(unwrapped[midIdx][0], unwrapped[midIdx][1], m, shift);
          if (mid.sx > 0 && mid.sx < this.width) {
            this._drawLabelPill(ctx, a.label, mid.sx, mid.sy - 14, color);
          }
        }
      }
    }
  }

  _drawTunnelMercator(ctx, m, now) {
    const tunnel = this.layers.tunnel;
    if (!tunnel || !tunnel.entry || !tunnel.exit) return;
    const progress = tunnel.progress == null ? 1 : Math.max(0, Math.min(1, tunnel.progress));
    const p1 = this._projectMercLonLat(tunnel.entry[0], tunnel.entry[1], m, 0);
    const p2 = this._projectMercLonLat(tunnel.exit[0], tunnel.exit[1], m, 0);
    const curX = p1.sx + (p2.sx - p1.sx) * progress;
    const curY = p1.sy + (p2.sy - p1.sy) * progress;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p1.sx, p1.sy);
    ctx.lineTo(curX, curY);
    ctx.strokeStyle = PALETTE.orange;
    ctx.lineWidth = 2.6;
    ctx.setLineDash([8, 5]);
    ctx.shadowColor = PALETTE.orange;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    this._drawPinAt(ctx, p1.sx, p1.sy, { color: PALETTE.orange, pulse: true }, now, 1);
    if (progress >= 0.9) {
      this._drawPinAt(ctx, p2.sx, p2.sy, { color: "#38BDF8", pulse: true }, now, 1);
    }
  }

  _drawPinsMercator(ctx, w, m, minTile, maxTile, now) {
    const pins = this.layers.pins;
    if (!pins || !pins.length) return;
    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      if (!pin || pin.lon == null || pin.lat == null) continue;
      for (let tile = minTile; tile <= maxTile; tile++) {
        const p = this._projectMercLonLat(pin.lon, pin.lat, m, tile * 360);
        if (p.sx < -40 || p.sx > w + 40) continue;
        this._drawPinAt(ctx, p.sx, p.sy, pin, now, 1);
      }
    }
  }

  // ==================== Shared Pin & Label Primitives ====================

  _drawPinAt(ctx, x, y, pin, now, alpha = 1) {
    const color = pin.color || PALETTE.orange;
    const radius = this.options.mini ? 4.2 : 5.6;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Expanding radar pulse ring
    if (pin.pulse !== false) {
      const phase = ((now * 0.0014) + (pin.lon || 0) * 0.01) % 1;
      const pr = radius + phase * (this.options.mini ? 10 : 18);
      ctx.beginPath();
      ctx.arc(x, y, pr, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha * (1 - phase) * 0.72;
      ctx.lineWidth = this.options.mini ? 1.3 : 1.8;
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    // Soft radial halo
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.22;
    ctx.fill();
    ctx.globalAlpha = alpha;

    // Crisp observatory pin bead
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = PALETTE.parchment;
    ctx.lineWidth = this.options.mini ? 1.4 : 2.0;
    ctx.stroke();

    // Inner bright specular dot
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFDF8";
    ctx.fill();

    ctx.restore();

    if (pin.label && !this.options.mini) {
      this._drawLabelPill(ctx, pin.label, x, y - 16, color, alpha);
    }
  }

  _drawArcArrowhead(ctx, prevProj, tipProj, color) {
    const dx = tipProj.sx - prevProj.sx;
    const dy = tipProj.sy - prevProj.sy;
    if (Math.hypot(dx, dy) < 0.5) return;
    const angle = Math.atan2(dy, dx);
    const size = 8.5;

    ctx.save();
    ctx.translate(tipProj.sx, tipProj.sy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-size, -size * 0.58);
    ctx.lineTo(-size * 0.62, 0);
    ctx.lineTo(-size, size * 0.58);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }

  _drawLabelPill(ctx, text, x, y, accentColor = PALETTE.orange, alpha = 1) {
    if (!text) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '600 11.5px "Poppins", system-ui, -apple-system, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const metrics = ctx.measureText(text);
    const padX = 10;
    const pillW = Math.ceil(metrics.width) + padX * 2 + 5;
    const pillH = 24;
    let drawY = y;
    let rx = Math.round(x - pillW * 0.5);
    let ry = Math.round(drawY - pillH * 0.5);

    if (!this.options.mini && Array.isArray(this._framePillRects)) {
      const collides = (testRy) => this._framePillRects.some((b) =>
        rx < b.right + 6 &&
        rx + pillW + 6 > b.left &&
        testRy < b.bottom + 4 &&
        testRy + pillH + 4 > b.top
      );
      let tries = 0;
      while (collides(ry) && tries < 3) {
        drawY = drawY - (pillH + 7);
        ry = Math.round(drawY - pillH * 0.5);
        tries++;
      }
      if (ry < 16 || collides(ry)) {
        drawY = y + pillH + 20;
        ry = Math.round(drawY - pillH * 0.5);
      }
      this._framePillRects.push({
        left: rx,
        right: rx + pillW,
        top: ry,
        bottom: ry + pillH,
      });
    }

    const radius = 8;

    // Frosted V7.3 observatory glass pill backdrop
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(rx, ry, pillW, pillH, radius);
    } else {
      ctx.moveTo(rx + radius, ry);
      ctx.lineTo(rx + pillW - radius, ry);
      ctx.quadraticCurveTo(rx + pillW, ry, rx + pillW, ry + radius);
      ctx.lineTo(rx + pillW, ry + pillH - radius);
      ctx.quadraticCurveTo(rx + pillW, ry + pillH, rx + pillW - radius, ry + pillH);
      ctx.lineTo(rx + radius, ry + pillH);
      ctx.quadraticCurveTo(rx, ry + pillH, rx, ry + pillH - radius);
      ctx.lineTo(rx, ry + radius);
      ctx.quadraticCurveTo(rx, ry, rx + radius, ry);
      ctx.closePath();
    }

    ctx.fillStyle = "rgba(7, 19, 36, 0.90)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Left V7.3 specular accent bar
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(rx + 4, ry + 5, 3, pillH - 10, 1.5);
    } else {
      ctx.rect(rx + 4, ry + 5, 3, pillH - 10);
    }
    ctx.fillStyle = accentColor;
    ctx.fill();

    // Specular top rim highlight
    ctx.beginPath();
    ctx.moveTo(rx + radius, ry + 1);
    ctx.lineTo(rx + pillW - radius, ry + 1);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.fillStyle = PALETTE.parchment;
    ctx.fillText(text, x + 2.5, drawY + 0.5);
    ctx.restore();
  }
}
