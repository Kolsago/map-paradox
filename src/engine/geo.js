/* WhyMapped — Map Paradox: Spherical & Cartographic Math Engine
 * Zero-dependency ES module providing exact WGS84/spherical geodesy,
 * point-in-polygon with antimeridian & polar support, coastline distance,
 * Mercator distortion factor, and exact SO(3) True-Size spherical reprojection.
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const EARTH_RADIUS_KM = 6371.0088;
export const EARTH_DIAMETER_KM = 12742;

const FOUR_PI = 4 * Math.PI;
const MAX_MERCATOR_LAT = 85.051129;

export function normalizeLon(lon) {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  if (l === -180 && lon > 0) l = 180;
  return l === 0 ? 0 : l;
}

export function clampLat(lat, limit = 90) {
  if (lat > limit) return limit;
  if (lat < -limit) return -limit;
  return lat === 0 ? 0 : lat;
}

export function lonLatToVec3(lon, lat) {
  const la = lat * DEG2RAD;
  const lo = lon * DEG2RAD;
  const cl = Math.cos(la);
  return [cl * Math.cos(lo), cl * Math.sin(lo), Math.sin(la)];
}

export function vec3ToLonLat(v) {
  const z = Math.max(-1, Math.min(1, v[2]));
  const lat = Math.asin(z) * RAD2DEG;
  const lon = Math.atan2(v[1], v[0]) * RAD2DEG;
  return [lon === 0 ? 0 : lon, lat === 0 ? 0 : lat];
}

/**
 * Great-circle Haversine distance in kilometers.
 */
export function haversineKm(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const rLat1 = lat1 * DEG2RAD;
  const rLat2 = lat2 * DEG2RAD;
  const sLat = Math.sin(dLat * 0.5);
  const sLon = Math.sin(dLon * 0.5);
  const a = sLat * sLat + Math.cos(rLat1) * Math.cos(rLat2) * sLon * sLon;
  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * c;
}

/**
 * Exact antipodal point on Earth, normalized cleanly to lon in [-180, 180].
 */
export function antipode(lon, lat) {
  const aLat = lat === 0 ? 0 : -clampLat(lat, 90);
  const aLon = normalizeLon(lon + 180);
  return { lon: aLon, lat: aLat };
}

/**
 * Spherical linear interpolation along the shortest great-circle path.
 * Returns steps + 1 points as Array<[lon, lat]>.
 */
export function slerpGreatCircle(lon1, lat1, lon2, lat2, steps = 48) {
  const nSteps = Math.max(1, Math.floor(steps));
  const a = lonLatToVec3(lon1, lat1);
  const b = lonLatToVec3(lon2, lat2);
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  dot = Math.max(-1, Math.min(1, dot));

  const out = [];
  if (dot > 0.9999999) {
    const pt = [normalizeLon(lon1), clampLat(lat1)];
    for (let i = 0; i <= nSteps; i++) out.push(pt);
    return out;
  }

  // Handle nearly antipodal endpoints via deterministic perpendicular meridian axis
  if (dot < -0.999999) {
    const up = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    // axis = normalize(a x up)
    let ax = a[1] * up[2] - a[2] * up[1];
    let ay = a[2] * up[0] - a[0] * up[2];
    let az = a[0] * up[1] - a[1] * up[0];
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    // ortho = axis x a
    const ox = ay * a[2] - az * a[1];
    const oy = az * a[0] - ax * a[2];
    const oz = ax * a[1] - ay * a[0];
    for (let i = 0; i <= nSteps; i++) {
      const ang = (Math.PI * i) / nSteps;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      out.push(vec3ToLonLat([
        a[0] * c + ox * s,
        a[1] * c + oy * s,
        a[2] * c + oz * s,
      ]));
    }
    return out;
  }

  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);
  for (let i = 0; i <= nSteps; i++) {
    const t = i / nSteps;
    const w1 = Math.sin((1 - t) * omega) / sinOmega;
    const w2 = Math.sin(t * omega) / sinOmega;
    out.push(vec3ToLonLat([
      a[0] * w1 + b[0] * w2,
      a[1] * w1 + b[1] * w2,
      a[2] * w1 + b[2] * w2,
    ]));
  }
  return out;
}

/**
 * Unwrap a lon/lat ring so adjacent vertices never jump by more than 180 deg.
 * Returns { points, minLon, maxLon, spansPole }.
 */
export function unwrapRing(ring) {
  const n = ring.length;
  if (n === 0) return { points: [], minLon: 0, maxLon: 0, spansPole: false };
  const pts = new Array(n);
  let prevLon = ring[0][0];
  let minLon = prevLon;
  let maxLon = prevLon;
  pts[0] = [prevLon, ring[0][1]];

  for (let i = 1; i < n; i++) {
    let lon = ring[i][0];
    let diff = lon - prevLon;
    while (diff > 180) { lon -= 360; diff -= 360; }
    while (diff < -180) { lon += 360; diff += 360; }
    pts[i] = [lon, ring[i][1]];
    prevLon = lon;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  // Detect polar rings (e.g., Antarctica) whose total winding advances ~360 deg in longitude
  const netLonDelta = Math.abs(pts[n - 1][0] - pts[0][0]);
  const spansPole = netLonDelta > 180;
  return { points: pts, minLon, maxLon, spansPole };
}

function rayCastPlanar(x, y, pts) {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Robust point-in-ring test handling antimeridian crossings and polar caps (Antarctica).
 */
export function pointInRing(lon, lat, ring) {
  if (!ring || ring.length < 3) return false;
  const { points, minLon, maxLon, spansPole } = unwrapRing(ring);
  const nLon = normalizeLon(lon);

  if (spansPole) {
    // Determine whether the cap covers the South Pole or North Pole
    let latSum = 0;
    for (let i = 0; i < points.length; i++) latSum += points[i][1];
    const poleLat = latSum < 0 ? -90.001 : 90.001;
    const closed = points.slice();
    closed.push([points[points.length - 1][0], poleLat]);
    closed.push([points[0][0], poleLat]);
    // Shift nLon into [minLon, maxLon]
    let testLon = nLon;
    while (testLon < minLon) testLon += 360;
    while (testLon > maxLon) testLon -= 360;
    if (testLon >= minLon && testLon <= maxLon && rayCastPlanar(testLon, lat, closed)) {
      return true;
    }
    return rayCastPlanar(testLon - 360, lat, closed) || rayCastPlanar(testLon + 360, lat, closed);
  }

  // Test the unwrapped ring against lon shifted by -360, 0, +360 to cover antimeridian wraps
  for (let shift = -360; shift <= 360; shift += 360) {
    const tx = nLon + shift;
    if (tx < minLon - 1e-6 || tx > maxLon + 1e-6) continue;
    if (rayCastPlanar(tx, lat, points)) return true;
  }
  return false;
}

/**
 * Returns the country object containing (lon, lat), or null if over ocean.
 * Uses odd-even ring parity (properly excludes enclaves like Lesotho from South Africa)
 * and prefers the smallest matching area if coarse borders overlap.
 */
export function findCountryAtPoint(lon, lat, countries) {
  if (!countries || !countries.length) return null;
  const nLon = normalizeLon(lon);
  let best = null;

  for (let i = 0; i < countries.length; i++) {
    const c = countries[i];
    const bb = c.bbox;
    if (bb) {
      if (lat < bb[1] - 0.01 || lat > bb[3] + 0.01) continue;
      const wraps = bb[0] <= -179.5 && bb[2] >= 179.5;
      if (!wraps && !c.isPolar) {
        if (nLon < bb[0] - 0.01 || nLon > bb[2] + 0.01) continue;
      }
    }

    let hits = 0;
    const polys = c.polygons;
    for (let p = 0; p < polys.length; p++) {
      if (pointInRing(nLon, lat, polys[p])) hits++;
    }

    if ((hits & 1) === 1) {
      if (!best || c.areaKm2 < best.areaKm2) {
        best = c;
      }
    }
  }
  return best;
}

/**
 * Finds the nearest country to (lon, lat) using true coastline distance (km).
 * If (lon, lat) is already inside a country, returns { country, distanceKm: 0 }.
 */
export function nearestCountry(lon, lat, countries) {
  if (!countries || !countries.length) return { country: null, distanceKm: Infinity };

  const inside = findCountryAtPoint(lon, lat, countries);
  if (inside) return { country: inside, distanceKm: 0 };

  const target = lonLatToVec3(lon, lat);
  const tx = target[0], ty = target[1], tz = target[2];

  let bestCountry = null;
  let bestDot = -2;

  for (let i = 0; i < countries.length; i++) {
    const c = countries[i];
    const polys = c.polygons;
    for (let p = 0; p < polys.length; p++) {
      const ring = polys[p];
      const n = ring.length;
      for (let k = 0; k < n; k++) {
        const pt = ring[k];
        const la = pt[1] * DEG2RAD;
        const lo = pt[0] * DEG2RAD;
        const cl = Math.cos(la);
        const dot = cl * Math.cos(lo) * tx + cl * Math.sin(lo) * ty + Math.sin(la) * tz;
        if (dot > bestDot) {
          bestDot = dot;
          bestCountry = c;
        }
      }
    }
  }

  // Refine along coastline edges of the closest few candidates for higher precision
  if (bestCountry) {
    const searchThreshold = Math.max(-1, bestDot - 0.02);
    for (let i = 0; i < countries.length; i++) {
      const c = countries[i];
      const polys = c.polygons;
      for (let p = 0; p < polys.length; p++) {
        const ring = polys[p];
        const n = ring.length;
        for (let k = 0; k < n; k++) {
          const p1 = ring[k];
          const p2 = ring[(k + 1) % n];
          const v1 = lonLatToVec3(p1[0], p1[1]);
          const d1 = v1[0] * tx + v1[1] * ty + v1[2] * tz;
          if (d1 < searchThreshold) continue;
          const v2 = lonLatToVec3(p2[0], p2[1]);
          // Closest point on chord v1 -> v2 projected onto unit sphere
          const ex = v2[0] - v1[0], ey = v2[1] - v1[1], ez = v2[2] - v1[2];
          const eLen2 = ex * ex + ey * ey + ez * ez;
          if (eLen2 < 1e-10) continue;
          const t = Math.max(0, Math.min(1, ((tx - v1[0]) * ex + (ty - v1[1]) * ey + (tz - v1[2]) * ez) / eLen2));
          let mx = v1[0] + ex * t;
          let my = v1[1] + ey * t;
          let mz = v1[2] + ez * t;
          const ml = Math.hypot(mx, my, mz) || 1;
          const dot = (mx * tx + my * ty + mz * tz) / ml;
          if (dot > bestDot) {
            bestDot = dot;
            bestCountry = c;
          }
        }
      }
    }
  }

  const clampedDot = Math.max(-1, Math.min(1, bestDot));
  const distanceKm = Math.round(Math.acos(clampedDot) * EARTH_RADIUS_KM * 10) / 10;
  return { country: bestCountry, distanceKm };
}

/**
 * Web Mercator area distortion factor relative to the equator: 1 / cos^2(lat).
 * Clamped safely at +/-85.051129 deg so high latitudes never return Infinity.
 */
export function mercatorDistortionFactor(lat) {
  const clamped = clampLat(Math.abs(lat), MAX_MERCATOR_LAT);
  const c = Math.cos(clamped * DEG2RAD);
  return 1 / (c * c);
}

/**
 * Exact spherical area of an array of rings in km² (using solid-angle excess).
 */
export function sphericalPolygonsAreaKm2(polygons, holeIndices = []) {
  const holeSet = new Set(holeIndices);
  let totalSr = 0;
  for (let p = 0; p < polygons.length; p++) {
    const ring = polygons[p];
    const n = ring.length;
    if (n < 3) continue;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % n];
      if (p1[0] === p2[0] && p1[1] === p2[1]) continue;
      const lat1 = p1[1] * DEG2RAD;
      const lat2 = p2[1] * DEG2RAD;
      const dLon = (p2[0] - p1[0]) * DEG2RAD;
      const c1 = Math.cos(lat1), s1 = Math.sin(lat1);
      const c2 = Math.cos(lat2), s2 = Math.sin(lat2);
      const num = c1 * c2 * Math.sin(dLon);
      const den = 1 + s1 + s2 + c1 * c2 * Math.cos(dLon) + s1 * s2;
      sum += 2 * Math.atan2(num, den);
    }
    sum = ((sum % FOUR_PI) + FOUR_PI) % FOUR_PI;
    if (sum > 2 * Math.PI) sum -= FOUR_PI;
    const areaSr = Math.abs(sum);
    totalSr += holeSet.has(p) ? -areaSr : areaSr;
  }
  return Math.max(0, totalSr) * EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

/**
 * Builds an orthonormal East-North-Up (ENU) basis on the unit sphere at (lon, lat).
 */
function enuBasis(lon, lat) {
  const lo = lon * DEG2RAD;
  const la = lat * DEG2RAD;
  const sLo = Math.sin(lo), cLo = Math.cos(lo);
  const sLa = Math.sin(la), cLa = Math.cos(la);
  const e = [-sLo, cLo, 0];
  const n = [-sLa * cLo, -sLa * sLo, cLa];
  const u = [cLa * cLo, cLa * sLo, sLa];
  return { e, n, u };
}

/**
 * Exact 3D SO(3) spherical rotation of every polygon vertex around the unit sphere,
 * moving fromCentroid -> [toLon, toLat] with local clockwise tangent rotation rotationDeg.
 *
 * Preserves EXACT real-world spherical area and geodesic shape on both 3D Globe
 * and 2D Web Mercator views. Output rings are cleanly unwrapped around toLon so
 * Mercator rendering never streaks horizontally across the antimeridian.
 */
export function reprojectPolygonsTrueSize(polygons, fromCentroid, toLon, toLat, rotationDeg = 0) {
  if (!polygons || !polygons.length) return [];

  const srcLon = fromCentroid ? fromCentroid[0] : 0;
  const srcLat = clampLat(fromCentroid ? fromCentroid[1] : 0, 89.999);
  const dstLon = normalizeLon(toLon);
  const dstLat = clampLat(toLat, 89.999);

  const src = enuBasis(srcLon, srcLat);
  const dst = enuBasis(dstLon, dstLat);

  // Rotate destination tangent plane clockwise by rotationDeg around dst.u
  const rot = rotationDeg * DEG2RAD;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);

  const e1x = cr * dst.e[0] - sr * dst.n[0];
  const e1y = cr * dst.e[1] - sr * dst.n[1];
  const e1z = cr * dst.e[2] - sr * dst.n[2];

  const n1x = sr * dst.e[0] + cr * dst.n[0];
  const n1y = sr * dst.e[1] + cr * dst.n[1];
  const n1z = sr * dst.e[2] + cr * dst.n[2];

  const u1x = dst.u[0], u1y = dst.u[1], u1z = dst.u[2];

  const e0x = src.e[0], e0y = src.e[1], e0z = src.e[2];
  const n0x = src.n[0], n0y = src.n[1], n0z = src.n[2];
  const u0x = src.u[0], u0y = src.u[1], u0z = src.u[2];

  // Combined 3x3 orthogonal rotation matrix R = F1 * F0^T
  const r00 = e1x * e0x + n1x * n0x + u1x * u0x;
  const r01 = e1x * e0y + n1x * n0y + u1x * u0y;
  const r02 = e1x * e0z + n1x * n0z + u1x * u0z;

  const r10 = e1y * e0x + n1y * n0x + u1y * u0x;
  const r11 = e1y * e0y + n1y * n0y + u1y * u0y;
  const r12 = e1y * e0z + n1y * n0z + u1y * u0z;

  const r20 = e1z * e0x + n1z * n0x + u1z * u0x;
  const r21 = e1z * e0y + n1z * n0y + u1z * u0y;
  const r22 = e1z * e0z + n1z * n0z + u1z * u0z;

  const transformVec = (vx, vy, vz) => {
    const x = r00 * vx + r01 * vy + r02 * vz;
    const y = r10 * vx + r11 * vy + r12 * vz;
    const z = Math.max(-1, Math.min(1, r20 * vx + r21 * vy + r22 * vz));
    return [Math.atan2(y, x) * RAD2DEG, Math.asin(z) * RAD2DEG];
  };

  // Subdivide edges longer than ~4 deg on sphere so Mercator curves smoothly at high latitudes
  const MAX_EDGE_RAD = 4.5 * DEG2RAD;
  const outPolys = new Array(polygons.length);

  for (let p = 0; p < polygons.length; p++) {
    const ring = polygons[p];
    const len = ring.length;
    if (len < 3) {
      outPolys[p] = [];
      continue;
    }

    // Transform vertices (with gentle geodesic subdivision only on very long segments)
    const raw = [];
    let prevVec = lonLatToVec3(ring[0][0], ring[0][1]);
    raw.push(transformVec(prevVec[0], prevVec[1], prevVec[2]));

    for (let i = 1; i <= len; i++) {
      const nextPt = ring[i % len];
      const nextVec = lonLatToVec3(nextPt[0], nextPt[1]);
      const dot = Math.max(-1, Math.min(1, prevVec[0] * nextVec[0] + prevVec[1] * nextVec[1] + prevVec[2] * nextVec[2]));
      const ang = Math.acos(dot);

      if (ang > MAX_EDGE_RAD && ang < Math.PI - 1e-4) {
        const segs = Math.min(8, Math.ceil(ang / MAX_EDGE_RAD));
        const sinA = Math.sin(ang);
        for (let s = 1; s < segs; s++) {
          const t = s / segs;
          const w1 = Math.sin((1 - t) * ang) / sinA;
          const w2 = Math.sin(t * ang) / sinA;
          raw.push(transformVec(
            prevVec[0] * w1 + nextVec[0] * w2,
            prevVec[1] * w1 + nextVec[1] * w2,
            prevVec[2] * w1 + nextVec[2] * w2
          ));
        }
      }

      if (i < len) {
        raw.push(transformVec(nextVec[0], nextVec[1], nextVec[2]));
      }
      prevVec = nextVec;
    }

    // Unwrap longitudes continuously so Mercator never streaks across +/-180
    const unwrapped = new Array(raw.length);
    let prevLon = raw[0][0];
    // Anchor first vertex near dstLon
    while (prevLon - dstLon > 180) prevLon -= 360;
    while (prevLon - dstLon < -180) prevLon += 360;
    unwrapped[0] = [prevLon, raw[0][1]];

    let lonSum = prevLon;
    for (let i = 1; i < raw.length; i++) {
      let lon = raw[i][0];
      let diff = lon - prevLon;
      while (diff > 180) { lon -= 360; diff -= 360; }
      while (diff < -180) { lon += 360; diff += 360; }
      unwrapped[i] = [lon, raw[i][1]];
      prevLon = lon;
      lonSum += lon;
    }

    // Recenter unwrapped ring's mean longitude within 180 deg of dstLon
    const meanLon = lonSum / unwrapped.length;
    const shiftCycles = Math.round((dstLon - meanLon) / 360);
    if (shiftCycles !== 0) {
      const shift = shiftCycles * 360;
      for (let i = 0; i < unwrapped.length; i++) {
        unwrapped[i][0] += shift;
      }
    }

    outPolys[p] = unwrapped;
  }

  return outPolys;
}
