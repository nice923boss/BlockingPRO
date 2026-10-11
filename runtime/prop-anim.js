// Prop animation (p10): wheels roll with the distance travelled, the bike crank turns with a rider's pedals, and a
// prop's `state` track (0 to 1 over time) opens a door, runs a fan or slides the elevator doors.
// The meshes mark their moving parts in userData (runtime/props.js). No three.js here: node tests use stub objects.
import { sampleKeys } from "./keys.js";

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));

/** Built-in types driven by `state`, with what 0 and 1 mean (inspector, validator, catalog) */
export const STATE_TYPES = {
  door: { label: "開門", zero: "關", one: "開 90 度" },
  fan: { label: "轉速", zero: "停", one: "全速" },
  elevator: { label: "電梯門", zero: "關", one: "全開" },
};

export const FAN_RPS = 1.5; // turns per second at state 1, slower than a real fan so the blades read at 30 fps
export const PEDAL_RUN = 5; // meters ridden per pedal turn, as in the ride action (runtime/actions-daily.js)

/** The state at time t, clamped to 0 to 1 (0 when the prop has no state) */
export const stateAt = (spec, t) => clamp01(sampleKeys(spec.state, t, 0));

/** Turns a fan has made by time t: the state integrated over [0, t] (trapezoids of at most `step` seconds) */
export function fanTurns(spec, t, step = 1 / 60) {
  const T = Math.max(0, t);
  if (!Array.isArray(spec.state)) return stateAt(spec, 0) * FAN_RPS * T;
  const n = Math.ceil(T / step);
  let sum = 0, prev = stateAt(spec, 0);
  for (let i = 1; i <= n; i++) {
    const cur = stateAt(spec, (T * i) / n);
    sum += ((prev + cur) * T) / n / 2;
    prev = cur;
  }
  return sum * FAN_RPS;
}

/**
 * Pose the moving parts of a built prop mesh at time t. ride() returns { dist, ridden }: meters travelled along
 * the prop's own path, or along the rider's path while an actor rides it (attach joint "root").
 */
export function animateProp(mesh, spec, t, ride) {
  const u = mesh?.userData;
  if (!u) return;
  if (u.spin || u.crank) {
    const { dist, ridden } = ride();
    // a wheel rolling toward +Z turns about +X; the radius grows with the prop's scale
    for (const w of u.spin || []) w.obj.rotation.x = dist / (w.r * (mesh.scale?.y || 1));
    if (u.crank) {
      const a = ridden ? (dist / PEDAL_RUN) * TAU - u.crank.a0 : 0; // left alone, the crank stays as built
      u.crank.obj.rotation.x = a;
      for (const p of u.crank.pedals) p.rotation.x = -a;
    }
  }
  if (u.leaf) u.leaf.rotation.y = (stateAt(spec, t) * Math.PI) / 2;
  if (u.fan) u.fan.rotation.z = -fanTurns(spec, t) * TAU;
  for (const s of u.slide || []) s.obj.position.x = s.x0 + s.dx * stateAt(spec, t);
}
