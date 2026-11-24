/**
 * WhyMapped — Map Paradox
 * Deterministic Daily Puzzle Seeding, Persistence, Ranking & Share Formatting.
 * Zero external dependencies. Local-time date keys, UTC-safe day arithmetic.
 */

export const EPOCH_DATE = '2026-11-01';
export const STORAGE_KEY = 'whymapped_paradox_v1';

/**
 * Parse a 'YYYY-MM-DD' key into UTC epoch day number (immune to DST shifts).
 * @param {string} dateKey
 * @returns {number}
 */
function dateKeyToUtcDay(dateKey) {
  if (typeof dateKey !== 'string') return 0;
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 0;
  const [y, m, d] = parts;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * Returns today's date key as 'YYYY-MM-DD' in the user's local timezone.
 * @returns {string}
 */
export function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns positive 1-based puzzle number relative to EPOCH_DATE.
 * Example: EPOCH_DATE ('2026-11-01') -> 1; '2026-11-20' -> 20.
 * @param {string} [dateKey]
 * @returns {number}
 */
export function getPuzzleNumber(dateKey = getTodayKey()) {
  const diff = dateKeyToUtcDay(dateKey) - dateKeyToUtcDay(EPOCH_DATE);
  return Math.max(1, diff + 1);
}

/**
 * Fast 32-bit FNV-1a string hash for deterministic PRNG seeding.
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mulberry32 deterministic 32-bit PRNG returning floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher-Yates shuffle returning a new array.
 * @template T
 * @param {T[]} items
 * @param {() => number} rng
 * @returns {T[]}
 */
function shuffleWithRng(items, rng) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick `k` items from a bucket deterministically for dayIndex using
 * non-repeating cycle shuffles so consecutive days avoid repeats.
 * @template T
 * @param {T[]} bucket
 * @param {number} dayIndex 0-based puzzle index
 * @param {number} k number of items to pick
 * @param {string} salt bucket identifier
 * @returns {T[]}
 */
function pickFromCycle(bucket, dayIndex, k, salt) {
  if (!bucket.length || k <= 0) return [];
  const chosen = [];
  const chosenIds = new Set();
  for (let slot = 0; slot < k; slot++) {
    const seqIndex = dayIndex * k + slot;
    const cycle = Math.floor(seqIndex / bucket.length);
    const pos = seqIndex % bucket.length;
    const rng = mulberry32(hashString(`whymapped:${salt}:cycle:${cycle}`));
    const perm = shuffleWithRng(bucket, rng);
    let candidate = perm[pos];
    // Guard against duplicate inside the same day across cycle boundaries
    if (candidate && chosenIds.has(candidate.id)) {
      candidate = perm.find((item) => !chosenIds.has(item.id)) || candidate;
    }
    if (candidate && !chosenIds.has(candidate.id)) {
      chosen.push(candidate);
      chosenIds.add(candidate.id);
    }
  }
  return chosen;
}

/**
 * Deterministically picks 5 balanced rounds for a given dateKey:
 *   Round 1: further   (latitude / longitude / distance intuition breaker)
 *   Round 2: pinpoint  (3D globe anomaly hunt)
 *   Round 3: truesize  (Mercator distortion reveal)
 *   Round 4: trivia    (geopolitical & cartographic paradox)
 *   Round 5: pinpoint  (climactic 3D globe pinpoint)
 * Every user worldwide gets the exact same 5 rounds on a given dateKey.
 * @param {string} dateKey
 * @param {Array<object>} pool
 * @returns {Array<object>}
 */
export function getDailyRounds(dateKey, pool) {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  const dayIndex = Math.max(0, getPuzzleNumber(dateKey) - 1);

  const byType = {
    further: pool.filter((q) => q.type === 'further'),
    pinpoint: pool.filter((q) => q.type === 'pinpoint'),
    truesize: pool.filter((q) => q.type === 'truesize'),
    trivia: pool.filter((q) => q.type === 'trivia'),
  };

  const furtherPick = pickFromCycle(byType.further, dayIndex, 1, 'further');
  const pinpointPicks = pickFromCycle(byType.pinpoint, dayIndex, 2, 'pinpoint');
  const truesizePick = pickFromCycle(byType.truesize, dayIndex, 1, 'truesize');
  const triviaPick = pickFromCycle(byType.trivia, dayIndex, 1, 'trivia');

  const ordered = [
    furtherPick[0],
    pinpointPicks[0],
    truesizePick[0],
    triviaPick[0],
    pinpointPicks[1],
  ].filter(Boolean);

  // Fallback fill if any custom test pool lacked a type
  if (ordered.length < Math.min(5, pool.length)) {
    const used = new Set(ordered.map((r) => r.id));
    const fallbackRng = mulberry32(hashString(`whymapped:fallback:${dateKey}`));
    const extras = shuffleWithRng(pool.filter((r) => !used.has(r.id)), fallbackRng);
    while (ordered.length < Math.min(5, pool.length) && extras.length > 0) {
      ordered.push(extras.shift());
    }
  }

  return ordered;
}

/**
 * Returns a fresh shuffled, non-repeating mix of rounds for Endless Arcade.
 * Balances all 4 challenge types when count === 5.
 * @param {Array<object>} pool
 * @param {number} [count=5]
 * @param {Array<string>} [excludeIds=[]]
 * @returns {Array<object>}
 */
export function getEndlessRounds(pool, count = 5, excludeIds = []) {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  const excludeSet = new Set(excludeIds);
  const freshPool = pool.filter((q) => !excludeSet.has(q.id));
  const source = freshPool.length >= count ? freshPool : pool;

  const rng = Math.random;

  if (count === 5) {
    const pickRandom = (type, n) => {
      const bucket = shuffleWithRng(source.filter((q) => q.type === type), rng);
      return bucket.slice(0, n);
    };
    const f = pickRandom('further', 1);
    const p = pickRandom('pinpoint', 2);
    const ts = pickRandom('truesize', 1);
    const tr = pickRandom('trivia', 1);
    const picked = [f[0], p[0], ts[0], tr[0], p[1]].filter(Boolean);
    const used = new Set(picked.map((r) => r.id));

    if (picked.length < Math.min(count, pool.length)) {
      const rest = shuffleWithRng(pool.filter((r) => !used.has(r.id)), rng);
      while (picked.length < Math.min(count, pool.length) && rest.length > 0) {
        picked.push(rest.shift());
      }
    }
    return picked;
  }

  return shuffleWithRng(source, rng).slice(0, Math.min(count, source.length));
}

/**
 * Default clean stats structure.
 */
function createEmptyStats() {
  return {
    playedDays: {},
    gamesPlayed: 0,
    bestScore: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: null,
    totalScore: 0,
  };
}

/**
 * Loads persisted daily stats from localStorage under 'whymapped_paradox_v1'.
 * Safely degrades when localStorage is unavailable.
 * @returns {object}
 */
export function loadStats() {
  try {
    if (typeof localStorage === 'undefined') return createEmptyStats();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyStats();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return createEmptyStats();
    return {
      playedDays: parsed.playedDays && typeof parsed.playedDays === 'object' ? parsed.playedDays : {},
      gamesPlayed: Number(parsed.gamesPlayed) || 0,
      bestScore: Number(parsed.bestScore) || 0,
      currentStreak: Number(parsed.currentStreak) || 0,
      maxStreak: Number(parsed.maxStreak) || 0,
      lastPlayedDate: typeof parsed.lastPlayedDate === 'string' ? parsed.lastPlayedDate : null,
      totalScore: Number(parsed.totalScore) || 0,
    };
  } catch {
    return createEmptyStats();
  }
}

/**
 * Returns the saved result for a specific dateKey, or null if not yet played.
 * @param {string} [dateKey]
 * @returns {object|null}
 */
export function getDailyResult(dateKey = getTodayKey()) {
  const stats = loadStats();
  return stats.playedDays[dateKey] || null;
}

/**
 * Persists a completed Daily Paradox result, updates streak & best score,
 * and returns the updated stats object.
 * @param {string} dateKey
 * @param {object} result
 * @returns {object}
 */
export function saveDailyResult(dateKey, result) {
  const stats = loadStats();
  const score = Math.max(0, Math.round(Number(result?.score ?? result?.totalScore ?? 0)));
  const maxScore = Math.max(1, Math.round(Number(result?.maxScore ?? 5000)));
  const rank = result?.rank || getCartographerRank(score, maxScore);

  const alreadyPlayed = Boolean(stats.playedDays[dateKey]);

  const entry = {
    dateKey,
    puzzleNum: getPuzzleNumber(dateKey),
    score,
    maxScore,
    rounds: Array.isArray(result?.rounds) ? result.rounds : [],
    rankTitle: result?.rankTitle || rank.title,
    completedAt: new Date().toISOString(),
  };

  if (!alreadyPlayed) {
    const prevDate = stats.lastPlayedDate;
    if (prevDate) {
      const dayDiff = dateKeyToUtcDay(dateKey) - dateKeyToUtcDay(prevDate);
      if (dayDiff === 1) {
        stats.currentStreak += 1;
      } else if (dayDiff > 1) {
        stats.currentStreak = 1;
      } else if (dayDiff === 0) {
        stats.currentStreak = Math.max(1, stats.currentStreak);
      }
    } else {
      stats.currentStreak = 1;
    }

    if (!prevDate || dateKeyToUtcDay(dateKey) >= dateKeyToUtcDay(prevDate)) {
      stats.lastPlayedDate = dateKey;
    }
    stats.gamesPlayed += 1;
    stats.totalScore += score;
    stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
  } else {
    const prevScore = Number(stats.playedDays[dateKey]?.score) || 0;
    if (score > prevScore) {
      stats.totalScore += score - prevScore;
    }
  }

  stats.bestScore = Math.max(stats.bestScore, score);
  stats.playedDays[dateKey] = entry;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    }
  } catch {
    // Ignore quota / privacy mode errors gracefully
  }

  return stats;
}

/**
 * Maps a run score to one of 5 memorable cartographer ranks.
 * @param {number} score
 * @param {number} [maxScore=5000]
 * @returns {{ title: string, badge: string, color: string, tagline: string }}
 */
export function getCartographerRank(score, maxScore = 5000) {
  const ratio = maxScore > 0 ? Math.max(0, Math.min(1, score / maxScore)) : 0;

  if (ratio >= 0.9) {
    return {
      title: 'Grand Cartographer',
      badge: '🏆',
      color: '#FFE066',
      tagline: 'You read Earth as a true sphere — no flat projection can fool you.',
    };
  }
  if (ratio >= 0.75) {
    return {
      title: 'Master Geodesist',
      badge: '🌐',
      color: '#4ADE80',
      tagline: 'Razor-sharp intuition across parallels, meridians, and hidden borders.',
    };
  }
  if (ratio >= 0.6) {
    return {
      title: 'Meridian Navigator',
      badge: '📐',
      color: '#60A5FA',
      tagline: 'Solid planetary bearings — only Earth’s slyest anomalies threw you off.',
    };
  }
  if (ratio >= 0.4) {
    return {
      title: 'Coastline Scout',
      badge: '🗺️',
      color: '#F7931E',
      tagline: 'Your compass is calibrating — Mercator still stole a round or two.',
    };
  }
  return {
    title: 'Mercator Victim',
    badge: '🧭',
    color: '#F87171',
    tagline: 'Classroom wall maps lied to you. Spin the globe and reclaim reality.',
  };
}

/**
 * Converts a round result (number or object) into a single Wordle-style emoji tile.
 * @param {number|object} round
 * @returns {string}
 */
function roundToEmoji(round) {
  let score = 0;
  let max = 1000;
  if (typeof round === 'number') {
    score = round;
  } else if (round && typeof round === 'object') {
    max = Number(round.maxScore) || 1000;
    if (typeof round.score === 'number') {
      score = round.score;
    } else if (typeof round.correct === 'boolean') {
      score = round.correct ? max : 0;
    }
  }
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 0.8) return '🟩';
  if (ratio >= 0.5) return '🟨';
  if (ratio >= 0.2) return '🟧';
  return '🟥';
}

/**
 * Builds crisp Wordle-style copyable share text (standalone, zero external links).
 * @param {object} params
 * @param {number|null} [params.puzzleNum]
 * @param {string} [params.modeLabel]
 * @param {Array<number|object>} [params.rounds]
 * @param {number} params.totalScore
 * @param {number} [params.maxScore=5000]
 * @param {number} [params.streak=0]
 * @returns {string}
 */
export function buildEmojiShareText({
  puzzleNum = null,
  modeLabel = 'Daily Paradox',
  rounds = [],
  totalScore = 0,
  maxScore = 5000,
  streak = 0,
} = {}) {
  const rank = getCartographerRank(totalScore, maxScore);
  const tiles = (Array.isArray(rounds) && rounds.length > 0
    ? rounds.map(roundToEmoji).join('')
    : '⬜⬜⬜⬜⬜');

  const isDaily = puzzleNum != null && (!modeLabel || /daily|paradox/i.test(modeLabel));
  const header = isDaily
    ? `🗺️ WhyMapped Paradox #${puzzleNum}`
    : `🗺️ WhyMapped — ${modeLabel || 'Endless Arcade'}`;

  const fmtScore = Math.round(totalScore).toLocaleString('en-US');
  const fmtMax = Math.round(maxScore).toLocaleString('en-US');

  const statusLine = streak > 0 && isDaily
    ? `🔥 Streak: ${streak} • ${rank.title}`
    : `${rank.badge} ${rank.title}`;

  return [
    header,
    `${tiles} ${fmtScore}/${fmtMax}`,
    statusLine,
    'Every Map Has a Why.',
    '🌍 Play: https://kolsago.github.io/map-paradox/',
    '📺 youtube.com/@WhyMappedGeo',
  ].join('\n');
}
