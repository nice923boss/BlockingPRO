// Straight walls with door and window openings, built from the built-in wall, door and window props.
// Used by the scene templates (p01) and the wall tool in the 3D view (p02); plain data, no three.js.

const LEN = 4, H = 2.8; // the built-in wall is 4 m long and 2.8 m high, origin at the bottom center
// opening width, top of the opening and (windows) the sill height, matching the door and window props
export const OPENINGS = { door: { w: 1.02, top: 2.16, sill: 0 }, window: { w: 1.32, top: 2.1, sill: 0.9 } };

const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Props for one straight wall from a to b ([x, z] in meters). Seen from above (X right, Z down) the wall's front
 * faces the right-hand side of a → b, so walking round a room clockwise puts every front inside.
 * openings: [{ type: "door" | "window", at }], at = distance from a to the opening center.
 * Returns [{ type, v, yaw, scale? }]: scaled wall pieces between the openings, the doors and windows,
 * and the pieces that fill above a door or above and below a window.
 */
export function wallRun(a, b, openings = []) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const yaw = r3((Math.atan2(-uz, ux) * 180) / Math.PI) + 0; // turns the wall's own +X onto a → b (+0 drops -0)
  const at = (s, y = 0) => [r3(a[0] + ux * s), r3(y), r3(a[1] + uz * s)];
  const piece = (s0, s1, y0 = 0, y1 = H) => ({ type: "wall", v: at((s0 + s1) / 2, y0), yaw, scale: [r3((s1 - s0) / LEN), r3((y1 - y0) / H), 1] });
  const out = [];
  let s = 0;
  for (const o of [...openings].sort((p, q) => p.at - q.at)) {
    const { w, top, sill } = OPENINGS[o.type], s0 = o.at - w / 2, s1 = o.at + w / 2;
    if (s0 > s + 0.01) out.push(piece(s, s0));
    if (sill) out.push(piece(s0, s1, 0, sill));
    out.push(piece(s0, s1, top, H));
    out.push({ type: o.type, v: at(o.at), yaw });
    s = s1;
  }
  if (len > s + 0.01) out.push(piece(s, len));
  return out;
}

// ---------- p02 wall tool ----------

const T = 0.17; // wall thickness at the base trim
const sx = (scale) => (Array.isArray(scale) ? scale[0] : scale);

/** Full-height wall piece standing on the floor (not the filler above a door or below a window) */
export const isFullPiece = (v, scale) => Math.abs(v[1]) < 0.01 && Math.abs((Array.isArray(scale) ? scale[1] : scale) - 1) < 0.01;

/** The straight run [a, b] ([x, z]) a wall piece covers: center v, its own +X turned by yaw, 4 m × scale x long */
export function pieceRun(v, yaw, scale) {
  const r = (yaw * Math.PI) / 180, half = (sx(scale) * LEN) / 2;
  const ux = Math.cos(r), uz = -Math.sin(r);
  return [[r3(v[0] - ux * half), r3(v[2] - uz * half)], [r3(v[0] + ux * half), r3(v[2] + uz * half)]];
}

/**
 * A full-height piece split round a door or window centered `at` meters from its start (moved inward so it fits,
 * a wall thickness away from the ends where a corner may be). Keeps the piece's yaw and thickness.
 * null when the piece is shorter than the opening.
 */
export function cutOpening(v, yaw, scale, type, at) {
  const [a, b] = pieceRun(v, yaw, scale), len = sx(scale) * LEN, w = OPENINGS[type].w;
  if (len < w + 0.02) return null;
  const sz = Array.isArray(scale) ? scale[2] : scale, m = w / 2 + Math.min(T, (len - w) / 2);
  const s = r3(Math.min(len - m, Math.max(m, at)));
  return wallRun(a, b, [{ type, at: s }]).map((o) => (o.scale ? { ...o, yaw, scale: [o.scale[0], o.scale[1], sz] } : { ...o, yaw }));
}

/**
 * Walls along clicked points [[x, z], ...]; closed adds the wall back to the first point.
 * Ends that meet another wall reach half a thickness further so the corners close.
 * A closed room is walked clockwise (seen from above) so every wall's front faces inside, like the templates.
 */
export function roomWalls(points, closed = false) {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.05);
  if (closed && pts.length > 2 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) <= 0.05) pts.pop();
  if (pts.length < 2 || (closed && pts.length < 3)) return [];
  let area = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; });
  const ring = closed && area < 0 ? [...pts].reverse() : pts;
  const n = closed ? ring.length : ring.length - 1;
  return Array.from({ length: n }, (_, i) => {
    const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = ((b[0] - a[0]) / len) * (T / 2), uz = ((b[1] - a[1]) / len) * (T / 2);
    const ea = closed || i > 0 ? 1 : 0, eb = closed || i < n - 1 ? 1 : 0;
    return wallRun([a[0] - ux * ea, a[1] - uz * ea], [b[0] + ux * eb, b[1] + uz * eb]);
  }).flat();
}
