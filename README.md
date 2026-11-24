# WhyMapped — Map Paradox

**Every Map Has a Why.**

- 🌍 **Live Observatory:** [kolsago.github.io/map-paradox](https://kolsago.github.io/map-paradox/)
- 📺 **YouTube Channel:** [@WhyMappedGeo](https://www.youtube.com/@WhyMappedGeo)

A standalone, zero-dependency, offline-capable interactive 3D cartographic observatory built with pure HTML5 Canvas, vanilla ES Modules, Web Audio synthesis, and self-hosted typography.

## Interactive Modes

1. **Daily Paradox (`#daily`)** — A deterministic 5-round daily geography challenge (plus unlimited Endless Arcade) spanning latitude/longitude intuition-breakers, 3D globe pinpointing, true-size scale traps, and verified geopolitical anomalies. Exports Wordle-style emoji grids and crisp 1080×1350 PNG share cards.
2. **True-Size Lab (`#truesize`)** — Compare real spherical areas by dragging and rotating up to 4 countries across latitudes in **2D Mercator** or **3D True Globe** view, complete with a live Mercator distortion multiplier readout and 10 curated comparison presets.
3. **Antipode Drill (`#antipode`)** — Click anywhere on Earth (or explore 22 verified presets and random land-to-land pairs) to drill a 12,742 km straight-chord X-ray tunnel through Earth's core with a synchronized twin exit mini-globe and nearest-landmass telemetry.
4. **Anomaly Atlas (`#explorer`)** — Search, filter, and fly across 25 mathematically verified cartographic anomalies with visual parallels, meridians, geodesic arcs, country highlights, and an Autopilot Tour mode.

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `1` – `4` | Switch between Daily Paradox, True-Size Lab, Antipode Drill, and Anomaly Atlas |
| `M` | Toggle Web Audio sound effects |
| `R` | Rotate active overlay (in True-Size Lab) or Reset globe view |
| `Space` | Next round / Confirm action / Toggle Autopilot Tour |
| `+` / `-` | Zoom globe in or out |
| `?` / `Esc` | Open or close the Shortcuts modal |

## Running Locally

Because the app uses native ES Modules (`<script type="module">`) and a Service Worker (`./sw.js`), serve the folder with any static local HTTP server:

```bash
cd map-paradox
python3 -m http.server 8799 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8799` in any modern browser. Once loaded, all assets—including Natural Earth country geometry and self-hosted Poppins fonts—are cached offline via `sw.js`.

## Architecture

- `index.html` — Full-viewport observatory shell, inline SVG WhyMapped monogram, mode navigation, HUD, and modal.
- `styles/main.css` — Locked WhyMapped Cartographic Observatory design system (`#071324`, `#0E2747`, `#F7931E`, `#FFE066`, `#FBF6EE`, `#DCCDBA`) and responsive desktop/mobile drawer layout.
- `src/main.js` — Application orchestrator, URL hash router, `ResizeObserver`, camera controls, toast system, keyboard router, and service worker registration.
- `src/engine/` — Pure-JS spherical geodesy (`geo.js`), dual-projection 3D orthographic & 2D Web Mercator canvas renderer (`globe.js`), and Web Audio synthesizer (`audio.js`).
- `src/data/` — Delta-decoded 177-country Natural Earth dataset (`world.js`), mathematically verified geographic challenges and anomalies (`paradoxes.js`), and seeded daily PRNG / persistence (`dailySeed.js`).
- `src/modes/` — Modular interactive experiences (`dailyMode.js`, `trueSizeMode.js`, `antipodeMode.js`, `explorerMode.js`) and 1080×1350 PNG share card renderer (`src/ui/shareCard.js`).
