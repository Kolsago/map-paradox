/* WhyMapped — Map Paradox: Procedural Observatory Web Audio Engine
 * Zero external audio assets. Synthesizes tactile cartographic UI feedback
 * using Web Audio API with safe gesture unlocking and silent fallback.
 */

const STORAGE_KEY = "whymapped_paradox_muted";

class SoundEngine {
  constructor() {
    this._ctx = null;
    this._muted = false;
    this._unlocked = false;

    try {
      if (typeof localStorage !== "undefined") {
        this._muted = localStorage.getItem(STORAGE_KEY) === "1";
      }
    } catch {
      this._muted = false;
    }

    this._bindUnlockListeners();
  }

  _bindUnlockListeners() {
    if (typeof window === "undefined") return;
    const unlock = () => {
      if (this._unlocked) return;
      this._unlocked = true;
      const ctx = this._ensureContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
    window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    window.addEventListener("keydown", unlock, { capture: true, passive: true });
  }

  _ensureContext() {
    if (this._muted) return null;
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this._ctx) {
      try {
        this._ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this._ctx.state === "suspended") {
      this._ctx.resume().catch(() => {});
    }
    return this._ctx;
  }

  setMuted(muted) {
    this._muted = Boolean(muted);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, this._muted ? "1" : "0");
      }
    } catch {
      // Ignore storage restrictions
    }
  }

  isMuted() {
    return this._muted;
  }

  /**
   * Subtle mechanical compass-detent click.
   */
  playClick() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.045);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  /**
   * Crisp radar/brass pin drop ping.
   */
  playPin() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Tactile transient + harmonic shimmer
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.09); // G5

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(1046.5, now);
    osc2.frequency.exponentialRampToValueAtTime(1567.98, now + 0.11);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.04, now);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc1.connect(gain);
    osc2.connect(g2);
    g2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.24);
    osc2.stop(now + 0.24);
  }

  /**
   * Answer reveal cue: warm upward resolution for good, soft muted minor drop for miss.
   */
  playReveal(isGood = true) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const notes = isGood ? [440, 554.37, 659.25] : [329.63, 277.18];
    const spacing = isGood ? 0.065 : 0.09;

    notes.forEach((freq, idx) => {
      const t = now + idx * spacing;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isGood ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(isGood ? 0.1 : 0.075, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (isGood ? 0.34 : 0.28));

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  /**
   * Celebratory observatory arpeggio for high score / land-to-land hit / completion.
   */
  playSuccess() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Warm Cmaj9 upward bloom
    const chord = [523.25, 659.25, 783.99, 987.77, 1174.66];
    chord.forEach((freq, idx) => {
      const t = now + idx * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx < 3 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.095 - idx * 0.01, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  }

  /**
   * Dramatic Earth-core X-ray drill sweep (descending planetary rumble + core resonance).
   */
  playDrill() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.78;

    // Sub-bass seismic descent into core then ascent out antipode
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = "sawtooth";
    sub.frequency.setValueAtTime(160, now);
    sub.frequency.exponentialRampToValueAtTime(52, now + dur * 0.5);
    sub.frequency.exponentialRampToValueAtTime(190, now + dur);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(1100, now + dur * 0.55);
    filter.frequency.exponentialRampToValueAtTime(300, now + dur);
    filter.Q.setValueAtTime(4.5, now);

    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.09, now + 0.07);
    subGain.gain.setValueAtTime(0.08, now + dur * 0.65);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    sub.connect(filter);
    filter.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + dur + 0.02);

    // Core-breach shimmer chime at midpoint
    const ping = ctx.createOscillator();
    const pingGain = ctx.createGain();
    const mid = now + dur * 0.45;
    ping.type = "sine";
    ping.frequency.setValueAtTime(620, mid);
    ping.frequency.exponentialRampToValueAtTime(930, mid + 0.25);

    pingGain.gain.setValueAtTime(0.0001, mid);
    pingGain.gain.linearRampToValueAtTime(0.07, mid + 0.02);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, mid + 0.34);

    ping.connect(pingGain);
    pingGain.connect(ctx.destination);
    ping.start(mid);
    ping.stop(mid + 0.36);
  }
}

export const soundEngine = new SoundEngine();
