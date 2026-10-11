// Walkable ground (p03): built-in stairs, steps, ramps, stages and the elevator cab (p10) carry the actors that walk onto them.
// Shapes are in the prop's own space (meters, before scale) and give { root, foot } at local x, z, or null outside:
// root = smooth surface the body rides on (stairs: a line through the treads, so the body rises evenly);
// foot = the real surface a planted foot stands on (the tread itself).
// No three.js here: the validator (schema.js) and node tests use it too.
import { buildPath, samplePath, sampleYaw } from "./keys.js";

const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Sizes shared with the meshes in props.js
export const STAIRS = { n: 9, rise: 1.4 / 9, run: 0.28, width: 1.0 };
export const STEPS = { n: 4, rise: 0.15, run: 0.3, width: 1.2 };
export const RAMP = { width: 1.2, height: 0.5, depth: 3 };
export const STAGE = { width: 4, height: 0.6, depth: 3 };
export const ELEVATOR = { width: 2, depth: 1.6, height: 2.4, floor: 0.05, door: 1, doorHeight: 2.1 };

// treads climbing toward -Z, first step at +Z (the root starts rising half a tread in front of it)
function flight({ n, rise, run, width }) {
  const D = n * run;
  return (x, z) => {
    if (Math.abs(x) > width / 2 || z < -D / 2 || z > D / 2 + run / 2) return null;
    const root = clamp((rise * (D / 2 + run / 2 - z)) / run, 0, n * rise);
    const foot = z > D / 2 ? 0 : (clamp(Math.floor((D / 2 - z) / run), 0, n - 1) + 1) * rise;
    return { root, foot };
  };
}

const SHAPES = {
  stairs: flight(STAIRS),
  steps: flight(STEPS),
  ramp: (x, z) => {
    const { width, height, depth } = RAMP;
    if (Math.abs(x) > width / 2 || Math.abs(z) > depth / 2) return null;
    const y = (height * (depth / 2 - z)) / depth; // low end at +Z, rising toward -Z
    return { root: y, foot: y };
  },
  stage: (x, z) => (Math.abs(x) > STAGE.width / 2 || Math.abs(z) > STAGE.depth / 2 ? null : { root: STAGE.height, foot: STAGE.height }),
  // the cab floor; raise the elevator's path to lift whoever stands inside
  elevator: (x, z) => (Math.abs(x) > ELEVATOR.width / 2 || Math.abs(z) > ELEVATOR.depth / 2 ? null : { root: ELEVATOR.floor, foot: ELEVATOR.floor }),
};

export const isTerrain = (type) => Object.hasOwn(SHAPES, type);

/** Walkable props of a project: [{ spec, shape, path }]. pathOf reuses paths built elsewhere (the scene runtime). */
export function terrainOf(project, pathOf = (o) => buildPath(o.path.keys, o.path.curve)) {
  return project.props.filter((o) => isTerrain(o.type) && !o.attach).map((o) => ({ spec: o, shape: SHAPES[o.type], path: pathOf(o) }));
}

/** Where each walkable prop stands at time t (pass the result to groundAt when sampling many points at one time) */
export function terrainAt(terrain, t) {
  return terrain.map(({ spec: o, shape, path }) => {
    const s = Array.isArray(o.scale) ? o.scale : [o.scale, o.scale, o.scale];
    const yaw = -sampleYaw(path, t, o.yaw, o.facing) * D2R;
    return { spec: o, shape, pos: samplePath(path, t).pos, cos: Math.cos(yaw), sin: Math.sin(yaw), s };
  });
}

/** Highest walkable surface at world x, z: { y, spec } (y 0 and spec null on the floor). kind "root" or "foot". */
export function surfaceAt(placed, x, z, kind = "root") {
  let y = 0, spec = null;
  for (const p of placed) {
    const dx = x - p.pos[0], dz = z - p.pos[2];
    const h = p.shape((dx * p.cos + dz * p.sin) / p.s[0], (-dx * p.sin + dz * p.cos) / p.s[2]);
    if (h && p.pos[1] + h[kind] * p.s[1] > y) { y = p.pos[1] + h[kind] * p.s[1]; spec = p.spec; }
  }
  return { y, spec };
}

export const groundAt = (placed, x, z, kind = "root") => surfaceAt(placed, x, z, kind).y;

/**
 * Validator warnings: an actor whose path crosses a height change of more than `max` meters between two frames
 * (straight onto a stage edge, off the top of the stairs) pops up or drops in one frame.
 */
export function terrainWarnings(project, { max = 0.3, perActor = 3 } = {}) {
  const terrain = terrainOf(project);
  if (!terrain.length) return [];
  const S = project.settings, dt = 1 / S.fps, n = Math.ceil(S.duration / dt);
  const placed = Array.from({ length: n + 1 }, (_, i) => terrainAt(terrain, Math.min(S.duration, i * dt)));
  const out = [];
  for (const a of project.actors) {
    const path = buildPath(a.path.keys, a.path.curve);
    let prev = null, count = 0;
    for (let i = 0; i <= n && count < perActor; i++) {
      const t = Math.min(S.duration, i * dt), p = samplePath(path, t).pos, g = surfaceAt(placed[i], p[0], p[2]);
      const cur = { y: Math.max(p[1], g.y), g };
      if (prev && Math.abs(cur.g.y - prev.g.y) > max && Math.abs(cur.y - prev.y) > max) {
        const up = cur.y > prev.y, spec = up ? cur.g.spec : prev.g.spec, h = Math.round(Math.abs(cur.y - prev.y) * 100) / 100;
        out.push(`角色「${a.name}」在 ${Math.round(t * 100) / 100} 秒${up ? "直接跨上" : "直接掉下"} ${h} 公尺高的物品「${spec?.name ?? spec?.id}」，畫面會跳一格；請改走樓梯、台階或斜坡`);
        count++;
      }
      prev = cur;
    }
  }
  return out;
}
