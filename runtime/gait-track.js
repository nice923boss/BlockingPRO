// Auto-gait step clock (a12). Pure math on a built path (keys.js), so it runs in node tests too.
// Idle, walk and run share one phase that advances by distance over a stride that grows with speed, so
// speeding up, slowing down and the walk-run blend keep the legs in step instead of mixing two cycles.
// Turning on the spot also advances it, so a standing actor shuffles round instead of sliding.
import { samplePath, sampleSpeed, sampleYaw, smoothstep } from "./keys.js";

export const TRACK_DT = 1 / 60;
const TURN_STEP = 120; // degrees of turning on the spot per step cycle (two steps)
const TURN_SMOOTH = 9; // samples each side when smoothing the turn rate (0.15 s)

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mix = (a, b, w) => a + (b - a) * w;
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Stride factors on the default walk / run cycle: shorter, quicker steps when slow, longer when fast.
 * Reference speeds scale with the square root of body height (1.3 m/s walk, 4 m/s run at 1.7 m).
 */
export function strideFactors(speed, height) {
  const k = Math.sqrt(height / 1.7);
  return {
    walk: clamp(Math.sqrt(speed / (1.3 * k)), 0.6, 1.25),
    run: clamp(Math.pow(speed / (4 * k), 0.7), 0.75, 1.4),
  };
}

/**
 * Sample the clock along a path from 0 to `end` seconds.
 * o: { end, height, walkLen, runLen (cycle length in meters at stride factor 1), band: { walk: [a, b], run: [a, b] },
 *      yaw, facing (as sampleYaw takes them) }
 */
export function buildGaitTrack(path, o) {
  const n = Math.max(2, Math.ceil(o.end / TRACK_DT) + 1);
  const cycle = new Float64Array(n), rawTurn = new Float64Array(n);
  let c = 0, d0 = samplePath(path, 0).dist, y0 = sampleYaw(path, 0, o.yaw, o.facing);
  for (let i = 0; i < n; i++) {
    const t = i * TRACK_DT, v = Math.abs(sampleSpeed(path, t)), d = samplePath(path, t).dist, y = sampleYaw(path, t, o.yaw, o.facing);
    const f = strideFactors(v, o.height), len = mix(o.walkLen * f.walk, o.runLen * f.run, smoothstep(o.band.run[0], o.band.run[1], v));
    const dy = i ? wrap(y - y0) : 0, still = 1 - smoothstep(o.band.walk[0], o.band.walk[1], v);
    c += Math.abs(d - d0) / len + (still * Math.abs(dy)) / TURN_STEP;
    cycle[i] = c;
    rawTurn[i] = dy / TRACK_DT;
    d0 = d;
    y0 = y;
  }
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, m = 0;
    for (let k = Math.max(0, i - TURN_SMOOTH); k <= Math.min(n - 1, i + TURN_SMOOTH); k++, m++) s += rawTurn[k];
    turn[i] = s / m;
  }
  return { n, cycle, turn };
}

/** { cycle: step phase in cycles, turn: heading change in degrees per second (+ = turning left) } at time t */
export function sampleGaitTrack(track, t) {
  const x = clamp(t / TRACK_DT, 0, track.n - 1), i = Math.min(Math.floor(x), track.n - 2), f = x - i;
  return { cycle: mix(track.cycle[i], track.cycle[i + 1], f), turn: mix(track.turn[i], track.turn[i + 1], f) };
}

/**
 * Body lean into a turn (degrees, + = toward the actor's left) and how far the head leads the turn (degrees of yaw).
 * Lean follows the sideways pull v * turn rate, at 60 % of the balance angle, up to 12 degrees.
 */
export function turnBody(speed, turnRate) {
  const w = turnRate * (Math.PI / 180);
  return {
    lean: clamp(0.6 * Math.atan((speed * w) / 9.8) * (180 / Math.PI), -12, 12),
    look: clamp(turnRate * 0.25, -30, 30),
  };
}
