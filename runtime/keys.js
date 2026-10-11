// Keyframes, easing and paths. Pure math on plain arrays (no three.js) so it runs in node tests too.
// Key: { t: seconds, v: number | [x, y, z], e: easing of the segment that starts at this key }
// Path keys may also carry yaw (degrees) used while the actor stands still.

export const EASINGS = {
  linear: { label: "等速", f: (s) => s },
  in: { label: "漸快", f: (s) => s * s },
  out: { label: "漸慢", f: (s) => 1 - (1 - s) * (1 - s) },
  inOut: { label: "慢快慢", f: (s) => s * s * (3 - 2 * s) },
  hold: { label: "停格", f: (s) => (s < 1 ? 0 : 1) },
};

// Custom speed curve: e = [x1, y1, x2, y2], a CSS-style cubic bezier from (0,0) to (1,1)
export const isCurve = (e) => Array.isArray(e) && e.length === 4 && e.every((x) => typeof x === "number" && isFinite(x));
// Bezier control points that reproduce the named easings exactly (hold has none)
export const CURVE_OF = { linear: [1 / 3, 1 / 3, 2 / 3, 2 / 3], in: [1 / 3, 0, 2 / 3, 1 / 3], out: [1 / 3, 2 / 3, 2 / 3, 1], inOut: [1 / 3, 0, 2 / 3, 1] };

function bezier([x1, y1, x2, y2], s) {
  const B = (a, b, u) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
  let lo = 0, hi = 1, u = s;
  for (let i = 0; i < 40; i++) {
    const x = B(x1, x2, u);
    if (Math.abs(x - s) < 1e-6) break;
    if (x < s) lo = u; else hi = u;
    u = (lo + hi) / 2;
  }
  return B(y1, y2, u);
}

export const ease = (e, s) => {
  const c = Math.min(1, Math.max(0, s));
  return isCurve(e) ? bezier(e, c) : (EASINGS[e] || EASINGS.linear).f(c);
};
export const easeLabel = (e) => (isCurve(e) ? "自訂曲線" : EASINGS[e]?.label || "等速");
/** Keep a named easing or a clamped custom curve; anything else becomes linear */
export function normEase(e) {
  if (isCurve(e)) {
    const r = (x, lo, hi) => Math.round(Math.min(hi, Math.max(lo, x)) * 1000) / 1000;
    return [r(e[0], 0, 1), r(e[1], -1, 2), r(e[2], 0, 1), r(e[3], -1, 2)];
  }
  return EASINGS[e] ? e : "linear";
}
export const smoothstep = (a, b, x) => { const s = Math.min(1, Math.max(0, (x - a) / (b - a))); return s * s * (3 - 2 * s); };
export const sortKeys = (keys) => [...keys].sort((a, b) => a.t - b.t);

const lerp = (a, b, s) => a + (b - a) * s;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// Index of the segment containing t: keys[i].t <= t < keys[i+1].t, clamped to [-1, n-1]
function segIndex(keys, t) {
  let lo = 0, hi = keys.length - 1;
  if (t < keys[0].t) return -1;
  if (t >= keys[hi].t) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m].t <= t) lo = m; else hi = m; }
  return lo;
}

/** Sample a scalar or vector track. A bare number (or missing track) is a constant. */
export function sampleKeys(track, t, def = 0) {
  if (track == null) return def;
  if (!Array.isArray(track)) return track;
  if (!track.length) return def;
  const i = segIndex(track, t);
  if (i < 0) return track[0].v;
  if (i >= track.length - 1) return track[track.length - 1].v;
  const a = track[i], b = track[i + 1];
  const s = ease(a.e, (t - a.t) / (b.t - a.t));
  return Array.isArray(a.v) ? a.v.map((x, k) => lerp(x, b.v[k], s)) : lerp(a.v, b.v, s);
}

/** Shortest-way interpolation between two angles in degrees */
export function lerpAngle(a, b, s) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * s;
}

// Hermite basis on one segment; tangents scaled by neighbouring chord lengths so uneven spacing does not overshoot
function hermite(p0, p1, m0, m1, u) {
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return [0, 1, 2].map((k) => h00 * p0[k] + h10 * m0[k] + h01 * p1[k] + h11 * m1[k]);
}
function hermiteD(p0, p1, m0, m1, u) {
  const u2 = u * u;
  const d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u;
  return [0, 1, 2].map((k) => d00 * p0[k] + d10 * m0[k] + d01 * p1[k] + d11 * m1[k]);
}

const TABLE_N = 24;

/**
 * Build a path from position keys. curve: "smooth" (Catmull-Rom style) or "linear".
 * Each segment is arc-length parameterised, so "linear" easing means constant speed on that segment.
 */
export function buildPath(keysIn, curve = "smooth") {
  const keys = sortKeys(keysIn || []);
  const P = keys.map((k) => k.v);
  const n = keys.length;
  const segs = [];
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const p0 = P[i], p1 = P[i + 1];
    const chord = len(sub(p1, p0));
    const seg = { i, t0: keys[i].t, t1: keys[i + 1].t, e: keys[i].e || "linear", p0, p1, d0: total, len: 0, still: chord < 1e-4, table: null };
    if (curve === "smooth" && !seg.still && n > 2) {
      const dPrev = i > 0 ? len(sub(p0, P[i - 1])) : 0, dNext = i < n - 2 ? len(sub(P[i + 2], p1)) : 0;
      seg.m0 = dPrev > 1e-4 ? sub(p1, P[i - 1]).map((x) => (x * chord) / (dPrev + chord)) : sub(p1, p0);
      seg.m1 = dNext > 1e-4 ? sub(P[i + 2], p0).map((x) => (x * chord) / (dNext + chord)) : sub(p1, p0);
      const table = [0];
      let prev = p0, acc = 0;
      for (let k = 1; k <= TABLE_N; k++) {
        const q = hermite(p0, p1, seg.m0, seg.m1, k / TABLE_N);
        acc += len(sub(q, prev));
        table.push(acc);
        prev = q;
      }
      seg.table = table;
      seg.len = acc;
    } else {
      seg.len = seg.still ? 0 : chord;
    }
    total += seg.len;
    segs.push(seg);
  }
  return { keys, curve, segs, total };
}

// Curve parameter u for an arc-length fraction f of a segment
function uAtFraction(seg, f) {
  if (!seg.table) return f;
  const target = f * seg.len, tb = seg.table;
  let lo = 0, hi = TABLE_N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tb[m] <= target) lo = m; else hi = m; }
  const span = tb[hi] - tb[lo];
  return (lo + (span > 0 ? (target - tb[lo]) / span : 0)) / TABLE_N;
}

function pointOnSeg(seg, u) {
  if (seg.table) return hermite(seg.p0, seg.p1, seg.m0, seg.m1, u);
  return [0, 1, 2].map((k) => lerp(seg.p0[k], seg.p1[k], u));
}
function dirOnSeg(seg, u) {
  const d = seg.table ? hermiteD(seg.p0, seg.p1, seg.m0, seg.m1, u) : sub(seg.p1, seg.p0);
  const l = len(d);
  return l > 1e-6 ? d.map((x) => x / l) : null;
}

/**
 * Position on the path at time t.
 * Returns { pos, dist, dir (unit tangent or null when standing still), seg (index, -1 before start) }
 */
export function samplePath(path, t) {
  const { keys, segs } = path;
  if (!keys.length) return { pos: [0, 0, 0], dist: 0, dir: null, seg: -1 };
  const i = segIndex(keys, t);
  if (i < 0) return { pos: keys[0].v.slice(), dist: 0, dir: null, seg: -1 };
  if (i >= segs.length) return { pos: keys[keys.length - 1].v.slice(), dist: path.total, dir: null, seg: segs.length };
  const seg = segs[i];
  if (seg.still) return { pos: seg.p0.slice(), dist: seg.d0, dir: null, seg: i };
  const f = ease(seg.e, (t - seg.t0) / (seg.t1 - seg.t0));
  const u = uAtFraction(seg, f);
  return { pos: pointOnSeg(seg, u), dist: seg.d0 + f * seg.len, dir: seg.e === "hold" ? null : dirOnSeg(seg, u), seg: i };
}

/** Points along the whole path for drawing (n per segment) */
export function pathPolyline(path, perSeg = 16) {
  const out = [];
  for (const seg of path.segs) {
    for (let k = 0; k < perSeg; k++) out.push(pointOnSeg(seg, k / perSeg));
  }
  if (path.keys.length) out.push(path.keys[path.keys.length - 1].v.slice());
  return out;
}

/** Average speed of each segment in m/s */
export function segmentSpeeds(path) {
  return path.segs.map((s) => (s.t1 > s.t0 ? s.len / (s.t1 - s.t0) : 0));
}

/**
 * Change the average speed of segment i by moving key i+1 in time; later keys shift with it.
 * Returns new keys (input untouched).
 */
export function setSegmentSpeed(keysIn, i, speed, curve = "smooth") {
  const keys = sortKeys(keysIn);
  const seg = buildPath(keys, curve).segs[i];
  if (!seg || seg.len < 1e-4 || speed <= 0) return keys;
  const shift = seg.len / speed - (seg.t1 - seg.t0);
  return keys.map((k, j) => (j > i ? { ...k, t: Math.round((k.t + shift) * 1000) / 1000 } : k));
}

const yawOf = (dir) => (Math.atan2(dir[0], dir[2]) * 180) / Math.PI;

/**
 * Raw facing (degrees, 0 = +Z) at time t: travel direction while moving;
 * when standing still, the yaw written on the keys, else the last travel direction.
 */
function rawYaw(path, t, baseYaw, facing) {
  const { keys, segs } = path;
  if (facing === "fixed" || !segs.length) {
    const yk = keys.filter((k) => k.yaw != null).map((k) => ({ t: k.t, v: k.yaw, e: k.e }));
    return yk.length ? sampleAngleKeys(yk, t) : baseYaw;
  }
  const s = samplePath(path, t);
  if (s.dir && Math.hypot(s.dir[0], s.dir[2]) > 0.2) return yawOf(s.dir);
  // standing: carry the heading of the nearest moving segment before (else after) this one
  const flat = (seg, u) => { const d = dirOnSeg(seg, u); return d && Math.hypot(d[0], d[2]) > 0.2 ? yawOf(d) : null; };
  const before = (j) => { for (let k = j; k >= 0; k--) { const y = segs[k].still ? null : flat(segs[k], 1); if (y != null) return y; } return null; };
  const after = (j) => { for (let k = j; k < segs.length; k++) { const y = segs[k].still ? null : flat(segs[k], 0); if (y != null) return y; } return null; };
  const i = s.seg;
  const carried = before(Math.min(i, segs.length) - 1) ?? after(Math.max(i + 1, 0)) ?? baseYaw;
  if (i < 0) return keys[0].yaw ?? carried;
  if (i >= segs.length) return keys[keys.length - 1].yaw ?? carried;
  const a = keys[i].yaw ?? carried, b = keys[i + 1].yaw ?? a;
  return lerpAngle(a, b, ease(segs[i].e, (t - segs[i].t0) / (segs[i].t1 - segs[i].t0)));
}

export function sampleAngleKeys(track, t) {
  const i = segIndex(track, t);
  if (i < 0) return track[0].v;
  if (i >= track.length - 1) return track[track.length - 1].v;
  const a = track[i], b = track[i + 1];
  return lerpAngle(a.v, b.v, ease(a.e, (t - a.t) / (b.t - a.t)));
}

/** Facing in degrees, smoothed over a short window so corners and starts turn instead of snapping */
export function sampleYaw(path, t, baseYaw = 0, facing = "path", window = 0.3) {
  let x = 0, z = 0;
  for (let k = -3; k <= 3; k++) {
    const w = 4 - Math.abs(k);
    const y = (rawYaw(path, t + (k * window) / 3, baseYaw, facing) * Math.PI) / 180;
    x += Math.sin(y) * w;
    z += Math.cos(y) * w;
  }
  return (Math.atan2(x, z) * 180) / Math.PI;
}

/** Speed in m/s averaged over a short window (used to blend idle / walk / run) */
export function sampleSpeed(path, t, window = 0.25) {
  const a = samplePath(path, t - window).dist, b = samplePath(path, t + window).dist;
  return (b - a) / (2 * window);
}

/**
 * Sparse keys for a recorded track (c09). samples: [{ t, v: [x, y, z] }] in time order.
 * Starts from the two ends and keeps adding the sample that replays worst through buildPath(curve)
 * until every sample is within tol meters. Keys use linear easing (constant speed per segment).
 */
export function simplifyTrack(samples, tol = 0.03, curve = "smooth") {
  if (samples.length < 3) return samples.map((s) => ({ t: s.t, v: s.v.slice(), e: "linear" }));
  const used = new Set([0, samples.length - 1]);
  const keysOf = () => [...used].sort((a, b) => a - b).map((i) => ({ t: samples[i].t, v: samples[i].v.slice(), e: "linear" }));
  for (;;) {
    const path = buildPath(keysOf(), curve);
    let worst = -1, err = tol;
    samples.forEach((s, i) => {
      if (used.has(i)) return;
      const e = len(sub(samplePath(path, s.t).pos, s.v));
      if (e > err) { err = e; worst = i; }
    });
    if (worst < 0) return keysOf();
    used.add(worst);
  }
}
