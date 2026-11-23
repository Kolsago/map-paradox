/**
 * WhyMapped — Map Paradox
 * Viral Museum-Grade 1080x1350 PNG Share Card Generator
 * Zero external dependencies — pure Canvas 2D API.
 */

const CARD_W = 1080;
const CARD_H = 1350;

const PALETTE = {
  bgDeep: '#061122',
  bgNavy: '#0E2747',
  bgMid: '#0A1C36',
  orange: '#F7931E',
  gold: '#FFE066',
  parchment: '#FBF6EE',
  muted: '#DCCDBA',
  slate: '#1B3A5C',
  green: '#34D399',
  coral: '#F87171',
  cyan: '#38BDF8',
};

const FONT_STACK = "'Poppins', 'Inter', system-ui, -apple-system, sans-serif";

/**
 * Determine color & tier label for a round score (0..1000).
 */
export function getScoreTier(score, maxScore = 1000) {
  const ratio = maxScore > 0 ? Math.max(0, Math.min(1, score / maxScore)) : 0;
  if (ratio >= 0.8) return { tier: 'perfect', color: PALETTE.green, bg: 'rgba(52, 211, 153, 0.16)', emoji: '🟩' };
  if (ratio >= 0.5) return { tier: 'great', color: PALETTE.gold, bg: 'rgba(255, 224, 102, 0.16)', emoji: '🟨' };
  if (ratio >= 0.2) return { tier: 'close', color: PALETTE.orange, bg: 'rgba(247, 147, 30, 0.18)', emoji: '🟧' };
  return { tier: 'miss', color: PALETTE.coral, bg: 'rgba(248, 113, 113, 0.16)', emoji: '🟥' };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawTopographicBackdrop(ctx) {
  // Deep observatory radial gradient
  const bg = ctx.createRadialGradient(CARD_W * 0.5, 470, 60, CARD_W * 0.5, 580, 960);
  bg.addColorStop(0, '#143661');
  bg.addColorStop(0.45, PALETTE.bgNavy);
  bg.addColorStop(1, PALETTE.bgDeep);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Subtle ambient starfield speckles
  ctx.save();
  let seed = 42197;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 95; i++) {
    const x = rand() * CARD_W;
    const y = rand() * CARD_H;
    const r = 0.6 + rand() * 1.4;
    const a = 0.08 + rand() * 0.22;
    ctx.fillStyle = i % 7 === 0 ? `rgba(255, 224, 102, ${a})` : `rgba(251, 246, 238, ${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Concentric topographic contour rings centered on globe
  ctx.save();
  const cx = CARD_W / 2;
  const cy = 485;
  for (let i = 0; i < 9; i++) {
    const baseR = 265 + i * 74;
    ctx.beginPath();
    const steps = 120;
    for (let s = 0; s <= steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      const wobble =
        Math.sin(a * 3 + i * 0.8) * (10 + i * 2.2) +
        Math.cos(a * 5 - i * 0.5) * (6 + i * 1.1);
      const r = baseR + wobble;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r * 0.96;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(220, 205, 186, 0.085)' : 'rgba(220, 205, 186, 0.045)';
    ctx.lineWidth = i % 3 === 0 ? 1.5 : 1;
    ctx.stroke();
  }
  ctx.restore();

  // Subtle corner meridian crosshairs
  ctx.save();
  ctx.strokeStyle = 'rgba(220, 205, 186, 0.14)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, 36, 36, CARD_W - 72, CARD_H - 72, 28);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(247, 147, 30, 0.24)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, 48, 48, CARD_W - 96, CARD_H - 96, 22);
  ctx.stroke();

  // Registration ticks at card midpoints
  const tickColor = 'rgba(255, 224, 102, 0.35)';
  ctx.strokeStyle = tickColor;
  ctx.lineWidth = 2;
  // Top / Bottom ticks
  ctx.beginPath();
  ctx.moveTo(CARD_W / 2, 24); ctx.lineTo(CARD_W / 2, 48);
  ctx.moveTo(CARD_W / 2, CARD_H - 48); ctx.lineTo(CARD_W / 2, CARD_H - 24);
  ctx.moveTo(24, CARD_H / 2); ctx.lineTo(48, CARD_H / 2);
  ctx.moveTo(CARD_W - 48, CARD_H / 2); ctx.lineTo(CARD_W - 24, CARD_H / 2);
  ctx.stroke();
  ctx.restore();
}

function drawMonogram(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  const s = size / 64;
  ctx.scale(s, s);

  // Outer badge circle
  roundRectPath(ctx, 0, 0, 64, 64, 16);
  ctx.fillStyle = 'rgba(14, 39, 71, 0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(247, 147, 30, 0.7)';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // Dashed cartographic route curve
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.moveTo(12, 46);
  ctx.quadraticCurveTo(32, 54, 50, 22);
  ctx.strokeStyle = PALETTE.gold;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.setLineDash([]);

  // Bold geometric "W"
  ctx.beginPath();
  ctx.moveTo(11, 20);
  ctx.lineTo(18, 44);
  ctx.lineTo(25, 27);
  ctx.lineTo(32, 44);
  ctx.lineTo(39, 20);
  ctx.strokeStyle = PALETTE.parchment;
  ctx.lineWidth = 4.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Orange locator pin dot
  ctx.beginPath();
  ctx.arc(49, 20, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.orange;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(49, 20, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.bgDeep;
  ctx.fill();

  ctx.restore();
}

function drawHeader(ctx, { puzzleNum, modeLabel }) {
  drawMonogram(ctx, 84, 82, 68);

  ctx.save();
  ctx.fillStyle = PALETTE.parchment;
  ctx.font = `800 34px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('WHYMAPPED', 170, 84);

  ctx.fillStyle = PALETTE.muted;
  ctx.font = `600 18px ${FONT_STACK}`;
  ctx.fillText('MAP PARADOX  •  CARTOGRAPHIC OBSERVATORY', 171, 125);

  // Right-side puzzle badge pill
  const labelText = modeLabel
    ? String(modeLabel).toUpperCase()
    : puzzleNum
      ? `DAILY PARADOX #${puzzleNum}`
      : 'MAP PARADOX';

  ctx.font = `700 20px ${FONT_STACK}`;
  const textW = ctx.measureText(labelText).width;
  const pillW = Math.max(210, textW + 46);
  const pillH = 48;
  const pillX = CARD_W - 84 - pillW;
  const pillY = 92;

  roundRectPath(ctx, pillX, pillY, pillW, pillH, 24);
  ctx.fillStyle = 'rgba(247, 147, 30, 0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(247, 147, 30, 0.65)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = PALETTE.gold;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, pillX + pillW / 2, pillY + pillH / 2 + 1);
  ctx.restore();
}

function drawFallbackGlobe(ctx, cx, cy, r) {
  const ocean = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.28, r * 0.1, cx, cy, r);
  ocean.addColorStop(0, '#194375');
  ocean.addColorStop(0.6, '#0E2747');
  ocean.addColorStop(1, '#061122');
  ctx.fillStyle = ocean;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Graticule arcs
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(220, 205, 186, 0.14)';
  ctx.lineWidth = 1.5;
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = cy - (lat / 90) * r;
    const halfW = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
    ctx.beginPath();
    ctx.moveTo(cx - halfW, y);
    ctx.lineTo(cx + halfW, y);
    ctx.stroke();
  }
  for (let k = -2; k <= 2; k++) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(k) * r * 0.34 + 2, r, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Glowing orange great-circle arc
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.55, cy + r * 0.25);
  ctx.quadraticCurveTo(cx, cy - r * 0.55, cx + r * 0.52, cy - r * 0.1);
  ctx.strokeStyle = PALETTE.orange;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function drawGlobeCenterpiece(ctx, globeSnapshot) {
  const cx = CARD_W / 2;
  const cy = 485;
  const radius = 248;

  // Outer atmospheric glow halo
  ctx.save();
  const halo = ctx.createRadialGradient(cx, cy, radius * 0.78, cx, cy, radius + 68);
  halo.addColorStop(0, 'rgba(247, 147, 30, 0.24)');
  halo.addColorStop(0.5, 'rgba(56, 189, 248, 0.14)');
  halo.addColorStop(1, 'rgba(6, 17, 34, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 68, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Outer brass compass ring + degree ticks
  ctx.save();
  ctx.strokeStyle = 'rgba(220, 205, 186, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 24, 0, Math.PI * 2);
  ctx.stroke();

  for (let deg = 0; deg < 360; deg += 10) {
    const rad = (deg * Math.PI) / 180;
    const isMajor = deg % 30 === 0;
    const inner = radius + (isMajor ? 15 : 20);
    const outer = radius + (isMajor ? 32 : 27);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
    ctx.lineTo(cx + Math.cos(rad) * outer, cy + Math.sin(rad) * outer);
    ctx.strokeStyle = isMajor ? 'rgba(255, 224, 102, 0.5)' : 'rgba(220, 205, 186, 0.22)';
    ctx.lineWidth = isMajor ? 2 : 1;
    ctx.stroke();
  }
  ctx.restore();

  // Clipped circular globe snapshot
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  // Base navy fill behind snapshot
  ctx.fillStyle = PALETTE.bgDeep;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  if (globeSnapshot && globeSnapshot.width > 0 && globeSnapshot.height > 0) {
    // Cover-fit centered
    const srcW = globeSnapshot.width;
    const srcH = globeSnapshot.height;
    const side = Math.min(srcW, srcH);
    const sx = (srcW - side) / 2;
    const sy = (srcH - side) / 2;
    ctx.drawImage(
      globeSnapshot,
      sx, sy, side, side,
      cx - radius, cy - radius, radius * 2, radius * 2
    );
  } else {
    drawFallbackGlobe(ctx, cx, cy, radius);
  }

  // Subtle top-left glass specular highlight
  const sheen = ctx.createRadialGradient(
    cx - radius * 0.35, cy - radius * 0.35, radius * 0.05,
    cx, cy, radius
  );
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
  sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0.02)');
  sheen.addColorStop(0.85, 'rgba(6, 17, 34, 0)');
  sheen.addColorStop(1, 'rgba(6, 17, 34, 0.45)');
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();

  // Crisp glowing rim stroke
  ctx.save();
  const rimGrad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  rimGrad.addColorStop(0, PALETTE.gold);
  rimGrad.addColorStop(0.5, PALETTE.orange);
  rimGrad.addColorStop(1, 'rgba(56, 189, 248, 0.7)');
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawScoreAndRank(ctx, { totalScore, maxScore, rank, streak }) {
  const scoreNum = Number.isFinite(totalScore) ? Math.round(totalScore) : 0;
  const maxNum = Number.isFinite(maxScore) && maxScore > 0 ? Math.round(maxScore) : 5000;
  const scoreStr = scoreNum.toLocaleString('en-US');
  const maxStr = `/ ${maxNum.toLocaleString('en-US')}`;

  ctx.save();
  // Small kicker above score
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `600 18px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('FINAL CARTOGRAPHY SCORE', CARD_W / 2, 782);

  // Giant score + max side-by-side centered
  ctx.font = `800 108px ${FONT_STACK}`;
  const scoreW = ctx.measureText(scoreStr).width;
  ctx.font = `600 40px ${FONT_STACK}`;
  const maxW = ctx.measureText(maxStr).width;
  const gap = 16;
  const startX = (CARD_W - (scoreW + gap + maxW)) / 2;

  // Score text with subtle warm glow
  ctx.shadowColor = 'rgba(255, 224, 102, 0.28)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = PALETTE.gold;
  ctx.font = `800 108px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(scoreStr, startX, 906);

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(220, 205, 186, 0.72)';
  ctx.font = `600 40px ${FONT_STACK}`;
  ctx.fillText(maxStr, startX + scoreW + gap, 898);

  // Rank & Streak pills row
  const rankTitle = typeof rank === 'string' ? rank : (rank?.title || 'Field Navigator');
  const rankBadge = typeof rank === 'object' && rank?.badge ? `${rank.badge} ` : '🧭 ';
  const rankColor = (typeof rank === 'object' && rank?.color) ? rank.color : PALETTE.gold;
  const rankLabel = `${rankBadge}${rankTitle.toUpperCase()}`;

  const hasStreak = Number.isFinite(streak) && streak > 0;
  const streakLabel = `🔥 ${streak}-DAY STREAK`;

  ctx.font = `700 22px ${FONT_STACK}`;
  const rankPillW = ctx.measureText(rankLabel).width + 52;
  const streakPillW = hasStreak ? ctx.measureText(streakLabel).width + 46 : 0;
  const pillGap = hasStreak ? 18 : 0;
  const totalPillsW = rankPillW + pillGap + streakPillW;
  const pillsStartX = (CARD_W - totalPillsW) / 2;
  const pillY = 936;
  const pillH = 52;

  // Rank pill
  roundRectPath(ctx, pillsStartX, pillY, rankPillW, pillH, 26);
  ctx.fillStyle = 'rgba(14, 39, 71, 0.9)';
  ctx.fill();
  ctx.strokeStyle = rankColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = PALETTE.parchment;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(rankLabel, pillsStartX + rankPillW / 2, pillY + pillH / 2 + 1);

  // Streak pill
  if (hasStreak) {
    const sx = pillsStartX + rankPillW + pillGap;
    roundRectPath(ctx, sx, pillY, streakPillW, pillH, 26);
    ctx.fillStyle = 'rgba(247, 147, 30, 0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(247, 147, 30, 0.72)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = PALETTE.gold;
    ctx.fillText(streakLabel, sx + streakPillW / 2, pillY + pillH / 2 + 1);
  }
  ctx.restore();
}

function formatTypeTag(type) {
  switch (type) {
    case 'further': return 'COMPASS';
    case 'pinpoint': return 'PINPOINT';
    case 'truesize': return 'SCALE';
    case 'trivia': return 'PARADOX';
    default: return 'ROUND';
  }
}

function drawRoundTiles(ctx, roundResults) {
  const items = Array.isArray(roundResults) && roundResults.length > 0
    ? roundResults.slice(0, 5)
    : Array.from({ length: 5 }, (_, i) => ({ score: 0, maxScore: 1000, type: `R${i + 1}` }));

  const count = items.length;
  const marginX = 84;
  const gap = 18;
  const availW = CARD_W - marginX * 2;
  const tileW = (availW - gap * (count - 1)) / count;
  const tileH = 152;
  const tileY = 1024;

  ctx.save();
  items.forEach((item, idx) => {
    const x = marginX + idx * (tileW + gap);
    const sc = Number.isFinite(item?.score) ? Math.round(item.score) : 0;
    const mx = Number.isFinite(item?.maxScore) && item.maxScore > 0 ? item.maxScore : 1000;
    const { color, bg } = getScoreTier(sc, mx);

    // Tile card
    roundRectPath(ctx, x, tileY, tileW, tileH, 18);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Top color accent strip
    roundRectPath(ctx, x + 16, tileY + 14, tileW - 32, 7, 4);
    ctx.fillStyle = color;
    ctx.fill();

    // Round index & type
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `600 16px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`R${idx + 1} • ${formatTypeTag(item?.type)}`, x + tileW / 2, tileY + 34);

    // Score value
    ctx.fillStyle = PALETTE.parchment;
    ctx.font = `800 38px ${FONT_STACK}`;
    ctx.fillText(`${sc}`, x + tileW / 2, tileY + 66);

    // Detail sub-caption (e.g., distance or hit/miss)
    const sub = item?.shortStat
      ? String(item.shortStat)
      : sc >= 850 ? 'SPOT ON' : sc >= 600 ? 'SHARP' : sc >= 300 ? 'CLOSE' : 'TRICKED';
    ctx.fillStyle = color;
    ctx.font = `700 14px ${FONT_STACK}`;
    ctx.fillText(sub.slice(0, 14).toUpperCase(), x + tileW / 2, tileY + 118);
  });
  ctx.restore();
}

function drawFooter(ctx) {
  ctx.save();
  // Divider line
  const y = 1226;
  const lineGrad = ctx.createLinearGradient(84, y, CARD_W - 84, y);
  lineGrad.addColorStop(0, 'rgba(220, 205, 186, 0)');
  lineGrad.addColorStop(0.2, 'rgba(220, 205, 186, 0.25)');
  lineGrad.addColorStop(0.8, 'rgba(220, 205, 186, 0.25)');
  lineGrad.addColorStop(1, 'rgba(220, 205, 186, 0)');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(84, y);
  ctx.lineTo(CARD_W - 84, y);
  ctx.stroke();

  // Footer text
  ctx.fillStyle = PALETTE.parchment;
  ctx.font = `700 23px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WhyMapped  •  Every Map Has a Why.', CARD_W / 2, 1254);

  ctx.fillStyle = PALETTE.orange;
  ctx.font = `700 18px ${FONT_STACK}`;
  ctx.fillText('youtube.com/@WhyMappedGeo', CARD_W / 2, 1287);
  ctx.restore();
}

/**
 * Render a 1080x1350 museum-grade PNG Share Card canvas.
 * @param {object} opts
 * @returns {HTMLCanvasElement}
 */
export function renderShareCard({
  puzzleNum = 1,
  modeLabel = '',
  totalScore = 0,
  maxScore = 5000,
  rank = null,
  streak = 0,
  roundResults = [],
  globeSnapshot = null,
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  drawTopographicBackdrop(ctx);
  drawHeader(ctx, { puzzleNum, modeLabel });
  drawGlobeCenterpiece(ctx, globeSnapshot);
  drawScoreAndRank(ctx, { totalScore, maxScore, rank, streak });
  drawRoundTiles(ctx, roundResults);
  drawFooter(ctx);

  return canvas;
}

/**
 * Trigger a clean browser PNG download from a rendered share card canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {string} [filename]
 */
export function downloadShareCard(canvas, filename = 'whymapped-paradox.png') {
  if (!canvas) return;
  const safeName = filename.endsWith('.png') ? filename : `${filename}.png`;

  const trigger = (href, revokeAfter = false) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (revokeAfter) {
      setTimeout(() => URL.revokeObjectURL(href), 2500);
    }
  };

  if (typeof canvas.toBlob === 'function') {
    canvas.toBlob((blob) => {
      if (blob) {
        trigger(URL.createObjectURL(blob), true);
      } else {
        trigger(canvas.toDataURL('image/png'), false);
      }
    }, 'image/png');
  } else {
    trigger(canvas.toDataURL('image/png'), false);
  }
}
