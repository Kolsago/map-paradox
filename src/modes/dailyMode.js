/**
 * WhyMapped — Map Paradox
 * Mode 1: Daily Paradox & Endless Arcade (5-Round Interactive Cartography Game)
 */

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E'];

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

function getPipTierClass(score, maxScore = 1000) {
  const r = maxScore > 0 ? score / maxScore : 0;
  if (r >= 0.8) return 'perfect';
  if (r >= 0.5) return 'good';
  if (r >= 0.2) return 'ok';
  return 'miss';
}

function getRoundTypeMeta(type) {
  switch (type) {
    case 'further':
      return { label: 'Compass Trap', badge: 'badge-orange' };
    case 'pinpoint':
      return { label: '3D Pinpoint', badge: 'badge-cyan' };
    case 'truesize':
      return { label: 'True-Size Trap', badge: 'badge-gold' };
    case 'trivia':
      return { label: 'Map Paradox', badge: 'badge-green' };
    default:
      return { label: 'Paradox', badge: 'badge-gold' };
  }
}

/**
 * Compute spherical centroid of [lon, lat] points cleanly across the antimeridian.
 */
function sphericalMidpoint(points) {
  if (!points || points.length === 0) return [0, 20];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lon, lat] of points) {
    const la = (lat * Math.PI) / 180;
    const lo = (lon * Math.PI) / 180;
    const cl = Math.cos(la);
    x += cl * Math.cos(lo);
    y += cl * Math.sin(lo);
    z += Math.sin(la);
  }
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) return [points[0][0], points[0][1]];
  const lat = (Math.asin(Math.max(-1, Math.min(1, z / len))) * 180) / Math.PI;
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  return [lon, lat];
}

function zoomForSpreadKm(distKm) {
  if (!Number.isFinite(distKm)) return 1.35;
  if (distKm < 450) return 2.7;
  if (distKm < 1300) return 2.15;
  if (distKm < 3200) return 1.65;
  if (distKm < 6500) return 1.28;
  return 1.05;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function createDailyMode() {
  let panelEl = null;
  let ctx = null;
  let mounted = false;

  let subMode = 'daily'; // 'daily' | 'endless'
  let isPracticeReplay = false;
  let todayKey = '';
  let puzzleNum = 1;
  let stats = null;

  let rounds = [];
  let roundIndex = 0;
  let roundResults = []; // { id, type, prompt, score, maxScore, shortStat, correct }
  let totalScore = 0;
  let displayedScore = 0;
  let phase = 'playing'; // 'playing' | 'revealed' | 'results'

  // Per-round transient state
  let selectedOptionId = null;
  let pinpointGuess = null; // { lon, lat }
  let hintVisible = false;
  let lastRoundFeedback = null;

  // Endless non-repeat tracking
  let recentEndlessIds = [];

  // Animations & subscriptions
  let arcRaf = null;
  let scoreRaf = null;
  let unsubClick = null;

  function findCountry(queryOrId) {
    if (!queryOrId || !Array.isArray(ctx?.countries)) return null;
    const raw = String(queryOrId).trim();
    const low = raw.toLowerCase();
    return (
      ctx.countries.find((c) => c.id === raw) ||
      ctx.countries.find((c) => c.iso && c.iso.toLowerCase() === low) ||
      ctx.countries.find((c) => c.name && c.name.toLowerCase() === low) ||
      null
    );
  }

  function cancelAnimations() {
    if (arcRaf !== null) {
      cancelAnimationFrame(arcRaf);
      arcRaf = null;
    }
    if (scoreRaf !== null) {
      cancelAnimationFrame(scoreRaf);
      scoreRaf = null;
    }
  }

  function animateScoreTo(targetScore) {
    if (scoreRaf !== null) {
      cancelAnimationFrame(scoreRaf);
      scoreRaf = null;
    }
    const startVal = displayedScore;
    const delta = targetScore - startVal;
    if (delta === 0) {
      updateScoreDOM(targetScore);
      return;
    }
    const duration = 520;
    const start = performance.now();
    const tick = (now) => {
      if (!mounted) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      displayedScore = Math.round(startVal + delta * eased);
      updateScoreDOM(displayedScore);
      if (t < 1) {
        scoreRaf = requestAnimationFrame(tick);
      } else {
        displayedScore = targetScore;
        updateScoreDOM(displayedScore);
        scoreRaf = null;
      }
    };
    scoreRaf = requestAnimationFrame(tick);
  }

  function updateScoreDOM(val) {
    const el = panelEl?.querySelector('[data-slot="score-val"]');
    if (el) {
      el.textContent = Math.round(val).toLocaleString('en-US');
    }
  }

  function animateArcLayers(buildLayersFn, durationMs = 680) {
    if (arcRaf !== null) {
      cancelAnimationFrame(arcRaf);
      arcRaf = null;
    }
    const start = performance.now();
    const tick = (now) => {
      if (!mounted) return;
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      ctx?.globe?.setLayers?.(buildLayersFn(eased));
      if (t < 1) {
        arcRaf = requestAnimationFrame(tick);
      } else {
        arcRaf = null;
      }
    };
    arcRaf = requestAnimationFrame(tick);
  }

  function getCurrentRound() {
    return rounds[roundIndex] || null;
  }

  function startDailyMode({ forceReplay = false } = {}) {
    subMode = 'daily';
    isPracticeReplay = Boolean(forceReplay);
    todayKey = ctx.dailySeed.getTodayKey();
    puzzleNum = ctx.dailySeed.getPuzzleNumber(todayKey);
    stats = ctx.dailySeed.loadStats();

    const saved = !forceReplay ? ctx.dailySeed.getDailyResult?.(todayKey) || stats.playedDays?.[todayKey] : null;
    rounds = ctx.dailySeed.getDailyRounds(todayKey, ctx.data.DAILY_POOL);

    if (saved && Array.isArray(saved.rounds) && saved.rounds.length > 0) {
      roundResults = saved.rounds;
      totalScore = Number(saved.score ?? saved.totalScore ?? 0);
      displayedScore = totalScore;
      roundIndex = rounds.length;
      phase = 'results';
      setupResultsGlobe();
      render();
      return;
    }

    roundIndex = 0;
    roundResults = [];
    totalScore = 0;
    displayedScore = 0;
    phase = 'playing';
    prepareCurrentRound();
    render();
  }

  function startEndlessMode() {
    subMode = 'endless';
    isPracticeReplay = false;
    stats = ctx.dailySeed.loadStats();
    rounds = ctx.dailySeed.getEndlessRounds(ctx.data.DAILY_POOL, 5, recentEndlessIds);
    recentEndlessIds = [...recentEndlessIds, ...rounds.map((r) => r.id)].slice(-20);

    roundIndex = 0;
    roundResults = [];
    totalScore = 0;
    displayedScore = 0;
    phase = 'playing';
    prepareCurrentRound();
    render();
  }

  function prepareCurrentRound() {
    cancelAnimations();
    selectedOptionId = null;
    pinpointGuess = null;
    hintVisible = false;
    lastRoundFeedback = null;
    phase = 'playing';

    const round = getCurrentRound();
    if (!round || !ctx?.globe) return;

    ctx.globe.clearLayers?.();

    if (round.type === 'truesize') {
      ctx.globe.setProjection?.('mercator');
      ctx.globe.setAutoSpin?.(false);

      const cA = findCountry(round.countryAId);
      const cB = findCountry(round.countryBId);
      const highlights = [];
      if (cA) {
        highlights.push({ id: cA.id, fill: 'rgba(247, 147, 30, 0.34)', stroke: '#F7931E', pulse: true });
      }
      if (cB) {
        highlights.push({ id: cB.id, fill: 'rgba(56, 189, 248, 0.28)', stroke: '#38BDF8', pulse: false });
      }
      ctx.globe.setLayers?.({ highlights });
      if (cA?.centroid && cB?.centroid) {
        const [midLon, midLat] = sphericalMidpoint([cA.centroid, cB.centroid]);
        ctx.globe.flyTo?.(midLon, Math.max(-45, Math.min(45, midLat)), 1.0, 750);
      } else {
        ctx.globe.flyTo?.(10, 20, 1.0, 700);
      }
      ctx.setGlobeHint?.('Mercator stretches high latitudes — pick the TRUE spherical comparison!');
    } else if (round.type === 'pinpoint') {
      ctx.globe.setProjection?.('globe');
      ctx.globe.setAutoSpin?.(false);
      ctx.globe.flyTo?.(10, 20, 1.08, 700);
      ctx.setGlobeHint?.('Spin the 3D globe and click to drop your pin • Space to lock guess');
    } else if (round.type === 'further') {
      ctx.globe.setProjection?.('globe');
      ctx.globe.setAutoSpin?.(true);
      ctx.setGlobeHint?.('Choose the option that breaks flat-map intuition!');
    } else {
      ctx.globe.setProjection?.('globe');
      ctx.globe.setAutoSpin?.(true);
      ctx.setGlobeHint?.('Pick the verified cartographic answer to reveal the globe view');
    }
  }

  function setupResultsGlobe() {
    cancelAnimations();
    ctx?.globe?.setProjection?.('globe');
    ctx?.globe?.clearLayers?.();
    ctx?.globe?.setAutoSpin?.(true);
    ctx?.setGlobeHint?.('Share your score card or jump into Endless Arcade for fresh paradoxes!');
  }

  function handleOptionAnswer(optionId) {
    if (phase !== 'playing') return;
    const round = getCurrentRound();
    if (!round || round.type === 'pinpoint') return;

    selectedOptionId = optionId;
    phase = 'revealed';

    const isCorrect = optionId === round.answerId;
    const points = isCorrect ? 1000 : 0;
    totalScore += points;

    ctx?.sound?.playReveal?.(isCorrect);

    const answerOpt = (round.options || []).find((o) => o.id === round.answerId);
    const shortStat = isCorrect ? 'CORRECT' : 'TRICKED';

    roundResults.push({
      id: round.id,
      type: round.type,
      prompt: round.prompt,
      score: points,
      maxScore: 1000,
      correct: isCorrect,
      shortStat,
      answerLabel: answerOpt?.label || '',
    });

    lastRoundFeedback = {
      isCorrect,
      points,
      headline: isCorrect
        ? `+${points.toLocaleString('en-US')} pts — Intuition Verified!`
        : `0 pts — Map Illusion Tricked You!`,
      detail: round.comparisonStat || (answerOpt?.detail ? `${answerOpt.label}: ${answerOpt.detail}` : ''),
    };

    choreographReveal(round);
    render();
    animateScoreTo(totalScore);
  }

  function handlePinpointSubmit() {
    if (phase !== 'playing') return;
    const round = getCurrentRound();
    if (!round || round.type !== 'pinpoint' || !pinpointGuess) return;

    phase = 'revealed';
    const target = round.target;
    const distKm = Math.round(
      ctx.geo.haversineKm(pinpointGuess.lon, pinpointGuess.lat, target.lon, target.lat)
    );
    const tolerance = Number(round.toleranceKm) || 700;
    const points = distKm <= 25
      ? 1000
      : Math.max(0, Math.min(1000, Math.round(1000 * Math.exp(-distKm / tolerance))));

    totalScore += points;
    const isGood = points >= 550;
    ctx?.sound?.playReveal?.(isGood);

    const shortStat = distKm < 1000 ? `${distKm} km` : `${(distKm / 1000).toFixed(1)}k km`;
    roundResults.push({
      id: round.id,
      type: round.type,
      prompt: round.prompt,
      score: points,
      maxScore: 1000,
      correct: isGood,
      distKm,
      shortStat,
      answerLabel: target.name,
    });

    lastRoundFeedback = {
      isCorrect: isGood,
      points,
      distKm,
      headline:
        points >= 850
          ? `🎯 Bullseye! Only ${distKm.toLocaleString('en-US')} km off (+${points})`
          : points >= 500
            ? `📍 Close! ${distKm.toLocaleString('en-US')} km away (+${points})`
            : `🧭 ${distKm.toLocaleString('en-US')} km off target (+${points})`,
      detail: `Exact location: ${target.name} (${formatCoord(target.lon, target.lat)})`,
    };

    // Fly cleanly to midpoint between guess & target and animate error geodesic arc
    const [midLon, midLat] = sphericalMidpoint([
      [pinpointGuess.lon, pinpointGuess.lat],
      [target.lon, target.lat],
    ]);
    const zoom = zoomForSpreadKm(distKm);
    ctx.globe.setAutoSpin?.(false);
    ctx.globe.flyTo?.(midLon, midLat, zoom, 850);

    const guessPoint = { ...pinpointGuess };
    const distLabel = `${distKm.toLocaleString('en-US')} km`;

    animateArcLayers((progress) => ({
      pins: [
        { lon: guessPoint.lon, lat: guessPoint.lat, label: 'Your Pin', color: '#F7931E', pulse: false },
        { lon: target.lon, lat: target.lat, label: target.name, color: '#34D399', pulse: true },
      ],
      arcs: [
        {
          from: [guessPoint.lon, guessPoint.lat],
          to: [target.lon, target.lat],
          color: points >= 550 ? '#34D399' : '#F7931E',
          dashed: true,
          label: distLabel,
          progress,
        },
      ],
    }));

    render();
    animateScoreTo(totalScore);
  }

  function choreographReveal(round) {
    if (!ctx?.globe) return;
    ctx.globe.setAutoSpin?.(false);

    if (round.type === 'further') {
      const opts = (round.options || []).filter(
        (o) => Number.isFinite(o.lon) && Number.isFinite(o.lat)
      );
      const cl = round.compareLine;
      const pts = opts.map((o) => [o.lon, o.lat]);
      if (cl?.kind === 'arc' && Array.isArray(cl.from) && Array.isArray(cl.to)) {
        pts.push(cl.from, cl.to);
      }

      let maxSpreadKm = 1500;
      if (pts.length >= 2 && ctx.geo?.haversineKm) {
        maxSpreadKm = 0;
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            maxSpreadKm = Math.max(
              maxSpreadKm,
              ctx.geo.haversineKm(pts[i][0], pts[i][1], pts[j][0], pts[j][1])
            );
          }
        }
      }

      const [midLon, midLat] = sphericalMidpoint(pts);
      ctx.globe.flyTo?.(midLon, midLat, zoomForSpreadKm(maxSpreadKm), 880);

      const pins = opts.map((o) => {
        const isAns = o.id === round.answerId;
        return {
          lon: o.lon,
          lat: o.lat,
          label: o.detail ? `${o.label} (${o.detail})` : o.label,
          color: isAns ? '#34D399' : '#F7931E',
          pulse: isAns,
        };
      });

      const parallels = [];
      const meridians = [];

      if (cl?.kind === 'parallel' && Number.isFinite(cl.value)) {
        const dir = cl.value >= 0 ? 'N' : 'S';
        parallels.push({
          lat: cl.value,
          color: '#FFE066',
          label: cl.label || `${Math.abs(cl.value).toFixed(2)}°${dir}`,
        });
      } else if (cl?.kind === 'meridian' && Number.isFinite(cl.value)) {
        const dir = cl.value >= 0 ? 'E' : 'W';
        meridians.push({
          lon: cl.value,
          color: '#FFE066',
          label: cl.label || `${Math.abs(cl.value).toFixed(2)}°${dir}`,
        });
      } else if (cl?.kind === 'arc' && Array.isArray(cl.from) && Array.isArray(cl.to)) {
        // Add reference anchor pin if one end of the arc isn't already listed in options
        const isNearExisting = (coord) =>
          opts.some((o) => Math.hypot(o.lon - coord[0], o.lat - coord[1]) < 0.5);
        if (!isNearExisting(cl.from)) {
          pins.push({ lon: cl.from[0], lat: cl.from[1], label: 'Reference', color: '#FFE066', pulse: false });
        }
        if (!isNearExisting(cl.to)) {
          pins.push({ lon: cl.to[0], lat: cl.to[1], label: 'Reference', color: '#FFE066', pulse: false });
        }
        animateArcLayers((progress) => ({
          pins,
          parallels,
          meridians,
          arcs: [
            {
              from: cl.from,
              to: cl.to,
              color: '#FFE066',
              dashed: false,
              label: cl.label || '',
              progress,
            },
          ],
        }));
        return;
      } else if (round.metric === 'north' || round.metric === 'south') {
        const ans = opts.find((o) => o.id === round.answerId);
        if (ans) {
          parallels.push({
            lat: ans.lat,
            color: '#FFE066',
            label: `${Math.abs(ans.lat).toFixed(1)}°${ans.lat >= 0 ? 'N' : 'S'}`,
          });
        }
      } else if (round.metric === 'east' || round.metric === 'west') {
        const ans = opts.find((o) => o.id === round.answerId);
        if (ans) {
          meridians.push({
            lon: ans.lon,
            color: '#FFE066',
            label: `${Math.abs(ans.lon).toFixed(1)}°${ans.lon >= 0 ? 'E' : 'W'}`,
          });
        }
      }

      ctx.globe.setLayers?.({ pins, parallels, meridians });
      return;
    }

    if (round.type === 'truesize') {
      const cA = findCountry(round.countryAId);
      const cB = findCountry(round.countryBId);
      if (cA && cB && ctx.geo?.reprojectPolygonsTrueSize) {
        const [bLon, bLat] = cB.centroid;
        const reprojected = ctx.geo.reprojectPolygonsTrueSize(
          cA.polygons,
          cA.centroid,
          bLon,
          bLat,
          Number(round.overlayRotationDeg) || 0
        );
        ctx.globe.setProjection?.('mercator');
        ctx.globe.setLayers?.({
          highlights: [
            { id: cB.id, fill: 'rgba(56, 189, 248, 0.30)', stroke: '#38BDF8', pulse: false },
          ],
          overlays: [
            {
              id: `daily_ts_${cA.id}`,
              name: `${cA.name} (True Scale)`,
              polygons: reprojected,
              fill: 'rgba(247, 147, 30, 0.48)',
              stroke: '#FFE066',
              centroid: [bLon, bLat],
              draggable: false,
            },
          ],
        });
        ctx.globe.flyTo?.(bLon, Math.max(-65, Math.min(65, bLat)), 1.75, 850);
      }
      return;
    }

    if (round.type === 'trivia') {
      ctx.globe.setProjection?.('globe');
      const focus = round.focus;
      const pins = [];
      const highlights = [];
      const parallels = [];
      const meridians = [];

      if (focus && Number.isFinite(focus.lon) && Number.isFinite(focus.lat)) {
        ctx.globe.flyTo?.(focus.lon, focus.lat, Number(focus.zoom) || 2.1, 850);
        pins.push({
          lon: focus.lon,
          lat: focus.lat,
          label: focus.label || '',
          color: '#34D399',
          pulse: true,
        });
      }
      if (Array.isArray(round.highlightIds)) {
        for (const hid of round.highlightIds) {
          highlights.push({
            id: hid,
            fill: 'rgba(247, 147, 30, 0.32)',
            stroke: '#FFE066',
            pulse: true,
          });
        }
      }
      if (typeof round.parallel === 'number') {
        parallels.push({
          lat: round.parallel,
          color: '#FFE066',
          label: `${Math.abs(round.parallel).toFixed(1)}°${round.parallel >= 0 ? 'N' : 'S'}`,
        });
      }
      if (typeof round.meridian === 'number') {
        meridians.push({
          lon: round.meridian,
          color: '#FFE066',
          label: `${Math.abs(round.meridian).toFixed(1)}°${round.meridian >= 0 ? 'E' : 'W'}`,
        });
      }

      if (round.arc && Array.isArray(round.arc.from) && Array.isArray(round.arc.to)) {
        animateArcLayers((progress) => ({
          pins,
          highlights,
          parallels,
          meridians,
          arcs: [
            {
              from: round.arc.from,
              to: round.arc.to,
              color: '#F7931E',
              dashed: false,
              label: round.arc.label || '',
              progress,
            },
          ],
        }));
      } else {
        ctx.globe.setLayers?.({ pins, highlights, parallels, meridians });
      }
    }
  }

  function advanceRound() {
    if (phase !== 'revealed') return;
    ctx?.sound?.playClick?.();

    if (roundIndex + 1 < rounds.length) {
      roundIndex += 1;
      prepareCurrentRound();
      render();
      return;
    }

    // Complete run!
    phase = 'results';
    const maxScore = rounds.length * 1000;
    const rank = ctx.dailySeed.getCartographerRank(totalScore, maxScore);

    if (subMode === 'daily' && !isPracticeReplay) {
      stats = ctx.dailySeed.saveDailyResult(todayKey, {
        totalScore,
        score: totalScore,
        maxScore,
        rounds: roundResults,
        rank,
      });
    } else {
      stats = ctx.dailySeed.loadStats();
    }

    ctx?.sound?.playSuccess?.();
    setupResultsGlobe();
    render();
    animateScoreTo(totalScore);
  }

  async function handleCopyEmoji() {
    const maxScore = Math.max(1000, roundResults.length * 1000);
    const modeLabel = subMode === 'daily' ? `Daily Paradox #${puzzleNum}` : 'Endless Arcade';
    const text = ctx.dailySeed.buildEmojiShareText({
      puzzleNum: subMode === 'daily' ? puzzleNum : null,
      modeLabel,
      rounds: roundResults,
      totalScore,
      maxScore,
      streak: stats?.currentStreak || 0,
    });

    const ok = await copyTextToClipboard(text);
    ctx?.sound?.playClick?.();
    if (ok) {
      ctx?.notify?.('Emoji scorecard copied to clipboard!', 'success');
    } else {
      ctx?.notify?.('Clipboard blocked — copy from the card preview.', 'warn');
    }
  }

  function handleDownloadShareCard() {
    if (!ctx?.shareCard?.renderShareCard) return;
    ctx?.sound?.playClick?.();
    const maxScore = Math.max(1000, roundResults.length * 1000);
    const rank = ctx.dailySeed.getCartographerRank(totalScore, maxScore);
    const modeLabel = subMode === 'daily' ? `Daily Paradox #${puzzleNum}` : 'Endless Arcade';
    const globeSnapshot = ctx.globe?.exportSnapshot?.(720) || null;

    const canvas = ctx.shareCard.renderShareCard({
      puzzleNum,
      modeLabel,
      totalScore,
      maxScore,
      rank,
      streak: subMode === 'daily' ? (stats?.currentStreak || 0) : 0,
      roundResults,
      globeSnapshot,
    });

    const filename = subMode === 'daily'
      ? `whymapped-paradox-${puzzleNum}.png`
      : `whymapped-endless-${totalScore}.png`;
    ctx.shareCard.downloadShareCard(canvas, filename);
    ctx?.notify?.('PNG Share Card downloaded!', 'success');
  }

  function renderPipsHTML() {
    const count = Math.max(5, rounds.length);
    return Array.from({ length: count }, (_, idx) => {
      const res = roundResults[idx];
      let cls = 'pip';
      if (res) {
        cls += ` ${getPipTierClass(res.score, res.maxScore || 1000)}`;
      } else if (phase !== 'results' && idx === roundIndex) {
        cls += ' current';
      }
      return `<div class="${cls}" title="Round ${idx + 1}${res ? `: ${res.score} pts` : ''}"></div>`;
    }).join('');
  }

  function renderHeaderHTML() {
    const completedToday = Boolean(stats?.playedDays?.[todayKey]);
    const streak = stats?.currentStreak || 0;
    const maxScore = Math.max(5000, rounds.length * 1000);

    return `
      <div class="panel-header stack-sm">
        <div class="row-between">
          <div>
            <h2 class="panel-title">Daily Paradox</h2>
            <p class="panel-subtitle">5 daily geography traps that break flat-map intuition</p>
          </div>
          ${streak > 0
            ? `<span class="badge badge-orange mono">🔥 ${streak} Streak</span>`
            : `<span class="badge badge-gold mono">#${puzzleNum}</span>`}
        </div>

        <div class="segmented" role="tablist" aria-label="Game Mode">
          <button type="button" class="seg-btn${subMode === 'daily' ? ' active' : ''}" data-submode="daily">
            Today #${puzzleNum}${completedToday ? ' ✓' : ''}
          </button>
          <button type="button" class="seg-btn${subMode === 'endless' ? ' active' : ''}" data-submode="endless">
            ♾️ Endless Arcade
          </button>
        </div>

        <div class="row-between" style="gap: 10px;">
          <div class="pip-row" style="flex: 1;">
            ${renderPipsHTML()}
          </div>
          <div class="mono" style="font-size: 0.88rem; font-weight: 700; white-space: nowrap;">
            <span style="color: #FFE066;" data-slot="score-val">${Math.round(displayedScore).toLocaleString('en-US')}</span>
            <span class="muted"> / ${maxScore.toLocaleString('en-US')}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderRoundBodyHTML() {
    const round = getCurrentRound();
    if (!round) {
      return `<div class="empty-state">No challenges available in pool.</div>`;
    }

    const typeMeta = getRoundTypeMeta(round.type);
    const isRevealed = phase === 'revealed';
    const isLast = roundIndex + 1 >= rounds.length;

    let interactionHTML = '';

    if (round.type === 'pinpoint') {
      if (!isRevealed) {
        interactionHTML = `
          <div class="panel-card stack-sm">
            <div class="row-between">
              <span class="section-label" style="margin: 0;">Your Globe Pin</span>
              ${round.hint ? `
                <button type="button" class="btn-ghost btn-sm" data-action="toggle-hint">
                  ${hintVisible ? 'Hide Hint' : '💡 Hint'}
                </button>
              ` : ''}
            </div>

            ${hintVisible && round.hint ? `
              <div class="why-box" style="padding: 8px 10px;">
                <div class="why-text" style="font-size: 0.8rem;">💡 ${esc(round.hint)}</div>
              </div>
            ` : ''}

            <div class="stat-box ${pinpointGuess ? 'accent-orange' : ''}">
              <div class="stat-label">${pinpointGuess ? 'Pin Placed — Click globe to adjust' : 'Awaiting Pin Drop'}</div>
              <div class="stat-value mono" style="font-size: 0.94rem;">
                ${pinpointGuess ? esc(formatCoord(pinpointGuess.lon, pinpointGuess.lat)) : 'Click anywhere on the 3D globe'}
              </div>
            </div>

            <button
              type="button"
              class="btn-primary btn-full"
              data-action="lock-pin"
              ${pinpointGuess ? '' : 'disabled'}
            >
              📍 Lock Guess ${pinpointGuess ? '(Space)' : ''}
            </button>
          </div>
        `;
      } else {
        const dist = lastRoundFeedback?.distKm ?? 0;
        const pts = lastRoundFeedback?.points ?? 0;
        interactionHTML = `
          <div class="stat-grid">
            <div class="stat-box ${pts >= 550 ? 'accent-green' : 'accent-orange'}">
              <div class="stat-label">Distance Off</div>
              <div class="stat-value mono">${dist.toLocaleString('en-US')} km</div>
              <div class="stat-sub">Target: ${esc(round.target?.name)}</div>
            </div>
            <div class="stat-box accent-gold">
              <div class="stat-label">Round Score</div>
              <div class="stat-value mono">+${pts.toLocaleString('en-US')}</div>
              <div class="stat-sub">out of 1,000 pts</div>
            </div>
          </div>
        `;
      }
    } else {
      const options = Array.isArray(round.options) ? round.options : [];
      interactionHTML = `
        <div class="option-list">
          ${options.map((opt, idx) => {
            let cls = 'option-btn';
            if (isRevealed) {
              if (opt.id === round.answerId) cls += ' correct';
              else if (opt.id === selectedOptionId) cls += ' wrong';
              else cls += ' dimmed';
            }
            return `
              <button
                type="button"
                class="${cls}"
                data-option-id="${esc(opt.id)}"
                ${isRevealed ? 'disabled' : ''}
              >
                <span class="option-key">${OPTION_KEYS[idx] || idx + 1}</span>
                <span style="flex: 1; text-align: left;">${esc(opt.label)}</span>
                ${isRevealed && opt.detail ? `<span class="option-detail">${esc(opt.detail)}</span>` : ''}
              </button>
            `;
          }).join('')}
        </div>
      `;
    }

    const revealHTML = isRevealed ? `
      <div class="stack-sm">
        ${lastRoundFeedback ? `
          <div class="verdict-banner ${lastRoundFeedback.isCorrect ? 'verdict-land' : 'verdict-ocean'}">
            <div><strong>${esc(lastRoundFeedback.headline)}</strong></div>
            ${lastRoundFeedback.detail ? `<div style="font-size: 0.78rem; opacity: 0.9; margin-top: 2px;">${esc(lastRoundFeedback.detail)}</div>` : ''}
          </div>
        ` : ''}

        <div class="why-box">
          <div class="why-title">The Why</div>
          <div class="why-text">${esc(round.why)}</div>
          ${round.source ? `<div class="why-source">Source: ${esc(round.source)}</div>` : ''}
        </div>

        <button type="button" class="btn-primary btn-full" data-action="next-round">
          ${isLast ? 'See Final Results → (Space)' : 'Next Paradox → (Space)'}
        </button>
      </div>
    ` : '';

    return `
      <div class="panel-card stack-sm">
        <div class="row-between">
          <div class="row" style="gap: 6px;">
            <span class="badge ${typeMeta.badge}">${esc(typeMeta.label)}</span>
            ${round.category ? `<span class="badge badge-muted">${esc(round.category)}</span>` : ''}
          </div>
          <span class="mono muted" style="font-size: 0.78rem;">Round ${roundIndex + 1} / ${rounds.length}</span>
        </div>

        <h3 style="margin: 2px 0 4px; font-size: 1.02rem; line-height: 1.4;">${esc(round.prompt)}</h3>

        ${interactionHTML}
      </div>

      ${revealHTML}
    `;
  }

  function renderResultsBodyHTML() {
    const maxScore = Math.max(5000, roundResults.length * 1000);
    const rank = ctx.dailySeed.getCartographerRank(totalScore, maxScore);
    const streak = stats?.currentStreak || 0;
    const best = Math.max(stats?.bestScore || 0, totalScore);

    const breakdownHTML = roundResults.map((r, idx) => {
      const tier = getPipTierClass(r.score, r.maxScore || 1000);
      const badgeCls =
        tier === 'perfect' ? 'badge-green' :
        tier === 'good' ? 'badge-gold' :
        tier === 'ok' ? 'badge-orange' : 'badge-red';
      const typeMeta = getRoundTypeMeta(r.type);

      return `
        <div class="breakdown-row">
          <div class="row" style="gap: 8px; min-width: 0; flex: 1;">
            <span class="mono muted" style="font-size: 0.76rem; flex-shrink: 0;">R${idx + 1}</span>
            <div style="min-width: 0; flex: 1;">
              <div style="font-size: 0.8rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${esc(r.answerLabel || typeMeta.label)}
              </div>
              <div class="muted" style="font-size: 0.72rem;">${esc(typeMeta.label)}${r.shortStat ? ` • ${esc(r.shortStat)}` : ''}</div>
            </div>
          </div>
          <span class="badge ${badgeCls} mono">${Math.round(r.score || 0)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="stack">
        <div class="verdict-banner verdict-rank stack-sm" style="border-color: ${esc(rank.color)};">
          <div class="row-between">
            <span class="badge badge-gold">${esc(rank.badge)} ${esc(rank.title)}</span>
            <span class="mono" style="font-size: 0.78rem; color: #DCCDBA;">
              ${subMode === 'daily' ? `Daily #${puzzleNum}` : 'Endless Run'}
            </span>
          </div>
          <div class="mono" style="font-size: 2rem; font-weight: 800; color: #FFE066; line-height: 1.1;">
            ${Math.round(totalScore).toLocaleString('en-US')}
            <span style="font-size: 0.95rem; font-weight: 600; color: #DCCDBA;">/ ${maxScore.toLocaleString('en-US')}</span>
          </div>
          <p style="margin: 0; font-size: 0.82rem; line-height: 1.45; color: #FBF6EE;">${esc(rank.tagline)}</p>
        </div>

        <div class="stat-grid">
          <div class="stat-box accent-orange">
            <div class="stat-label">Daily Streak</div>
            <div class="stat-value mono">🔥 ${streak}</div>
            <div class="stat-sub">Best: ${stats?.maxStreak || streak} ${(stats?.maxStreak || streak) === 1 ? 'day' : 'days'}</div>
          </div>
          <div class="stat-box accent-gold">
            <div class="stat-label">Personal Best</div>
            <div class="stat-value mono">${best.toLocaleString('en-US')}</div>
            <div class="stat-sub">${stats?.gamesPlayed || 1} daily ${(stats?.gamesPlayed || 1) === 1 ? 'run' : 'runs'}</div>
          </div>
        </div>

        <div class="panel-card stack-sm">
          <div class="section-label" style="margin: 0;">5-Round Breakdown</div>
          <div class="round-breakdown">
            ${breakdownHTML}
          </div>
        </div>

        <div class="stack-sm">
          <button type="button" class="btn-primary btn-full" data-action="copy-emoji">
            📋 Copy Emoji Grid
          </button>
          <button type="button" class="btn-secondary btn-full" data-action="download-card">
            🖼️ Download PNG Share Card (1080×1350)
          </button>
          <button type="button" class="btn-ghost btn-full" data-action="play-endless">
            ♾️ Play Fresh Endless Round
          </button>
          ${subMode === 'daily' ? `
            <button type="button" class="btn-ghost btn-sm btn-full" data-action="replay-daily">
              ↻ Replay Today's 5 Rounds (Practice)
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  function render() {
    if (!panelEl) return;
    panelEl.innerHTML = `
      <div class="stack">
        ${renderHeaderHTML()}
        ${phase === 'results' ? renderResultsBodyHTML() : renderRoundBodyHTML()}
      </div>
    `;
  }

  function handlePanelClick(e) {
    const subBtn = e.target.closest('[data-submode]');
    if (subBtn) {
      const next = subBtn.getAttribute('data-submode');
      ctx?.sound?.playClick?.();
      if (next === 'daily') {
        startDailyMode({ forceReplay: false });
      } else if (next === 'endless') {
        startEndlessMode();
      }
      return;
    }

    const optBtn = e.target.closest('[data-option-id]');
    if (optBtn && !optBtn.disabled) {
      handleOptionAnswer(optBtn.getAttribute('data-option-id'));
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn || actionBtn.disabled) return;
    const action = actionBtn.getAttribute('data-action');

    if (action === 'toggle-hint') {
      hintVisible = !hintVisible;
      ctx?.sound?.playClick?.();
      render();
    } else if (action === 'lock-pin') {
      handlePinpointSubmit();
    } else if (action === 'next-round') {
      advanceRound();
    } else if (action === 'copy-emoji') {
      handleCopyEmoji();
    } else if (action === 'download-card') {
      handleDownloadShareCard();
    } else if (action === 'play-endless') {
      ctx?.sound?.playClick?.();
      startEndlessMode();
    } else if (action === 'replay-daily') {
      ctx?.sound?.playClick?.();
      startDailyMode({ forceReplay: true });
    }
  }

  function handleGlobeClick(point) {
    if (!mounted || phase !== 'playing') return;
    const round = getCurrentRound();
    if (!round || round.type !== 'pinpoint') return;
    if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return;

    pinpointGuess = { lon: point.lon, lat: point.lat };
    ctx?.sound?.playPin?.();
    ctx?.globe?.setLayers?.({
      pins: [
        {
          lon: point.lon,
          lat: point.lat,
          label: 'Your Pin',
          color: '#F7931E',
          pulse: true,
        },
      ],
    });
    render();
  }

  return {
    mount(el, context) {
      panelEl = el;
      ctx = context;
      mounted = true;

      panelEl.addEventListener('click', handlePanelClick);
      const maybeUnsub = ctx.globe?.onClick?.(handleGlobeClick);
      unsubClick = typeof maybeUnsub === 'function' ? maybeUnsub : null;

      startDailyMode({ forceReplay: false });
    },

    unmount() {
      mounted = false;
      cancelAnimations();
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
      ctx?.globe?.setProjection?.('globe');
      ctx?.globe?.setAutoSpin?.(false);
      panelEl = null;
      ctx = null;
    },

    onKeyDown(e) {
      if (!mounted) return false;
      if (e.code === 'Space' || e.key === ' ') {
        const round = getCurrentRound();
        if (phase === 'playing' && round?.type === 'pinpoint' && pinpointGuess) {
          e.preventDefault();
          handlePinpointSubmit();
          return true;
        }
        if (phase === 'revealed') {
          e.preventDefault();
          advanceRound();
          return true;
        }
      }
      return false;
    },
  };
}
