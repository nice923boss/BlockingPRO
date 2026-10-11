// Background crowd (a10): walkers that wander inside a rectangle for the whole scene.
// Plain data, no three.js: the caller says where furniture stands (blocked) and where people already walk (others).
import { buildPath, samplePath } from "./keys.js";

// body types drawn for passers-by: mostly adults, some elders, few children and big builds
const MIX = ["man", "woman", "man", "woman", "elder", "child", "bulky"];
// muted colors so the crowd stays behind the main characters
export const CROWD_COLORS = ["#7d8590", "#8a7f74", "#6f7f8c", "#857a8a", "#7a8a78", "#8c8270", "#6e7380", "#907c7c"];

const r2 = (x) => Math.round(x * 100) / 100;

/** Seeded random numbers in [0, 1) (mulberry32): the same seed plans the same crowd */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** No blocked spot every 0.2 m along the straight line from a to b */
function lineClear(a, b, blocked) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2));
  for (let i = 1; i <= n; i++) if (blocked(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n)) return false;
  return true;
}

/**
 * Path keys for one walker, built leg by leg: walk 1.5 m or more to a random free spot, sometimes stop 0.5 to 2 s,
 * until the scene ends. clear(x, z, j) says nobody else is within reach at sample j (time j * step).
 * Returns null when the walker gets stuck between others.
 */
function route(rand, { area, duration, speed, step, blocked, clear }) {
  const last = Math.floor(duration / step + 1e-6);
  const from = (t) => Math.floor(t / step + 1e-6) + 1, to = (t) => Math.min(last, Math.floor(t / step + 1e-6));
  // standing at p, or walking p to q, during (t0, t1] without coming close to anyone
  const still = (p, t0, t1) => { for (let j = from(t0); j <= to(t1); j++) if (!clear(p[0], p[1], j)) return false; return true; };
  const walk = (p, q, t0, t1) => {
    for (let j = from(t0); j <= to(t1); j++) {
      const f = (j * step - t0) / (t1 - t0);
      if (!clear(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, j)) return false;
    }
    return true;
  };
  const pick = () => [area.x + (rand() - 0.5) * area.w, area.z + (rand() - 0.5) * area.d];
  let p = null;
  for (let k = 0; k < 30 && !p; k++) { const c = pick(); if (!blocked(c[0], c[1]) && clear(c[0], c[1], 0)) p = c; }
  if (!p) return null;
  const v = speed * (0.85 + rand() * 0.3);
  const keys = [{ t: 0, v: [r2(p[0]), 0, r2(p[1])] }];
  const stand = (t1) => keys.push({ t: r2(t1), v: [...keys[keys.length - 1].v] });
  let t = 0;
  while (duration - t > 0.05) {
    if (rand() < 0.3) {
      const t1 = Math.min(duration, t + 0.5 + rand() * 1.5);
      if (still(p, t, t1)) { stand(t1); t = t1; continue; }
    }
    let q = null, t1 = 0;
    for (let k = 0; k < 12 && !q; k++) {
      let c = pick();
      const dist = Math.hypot(c[0] - p[0], c[1] - p[1]);
      if (dist < 1.5 || !lineClear(p, c, blocked)) continue;
      let end = t + dist / v;
      if (end > duration) { // the scene ends halfway: stop where the walker is at that moment
        const f = (duration - t) / (end - t);
        c = [p[0] + (c[0] - p[0]) * f, p[1] + (c[1] - p[1]) * f];
        end = duration;
      }
      if (walk(p, c, t, end)) { q = c; t1 = end; }
    }
    if (q) { keys.push({ t: r2(t1), v: [r2(q[0]), 0, r2(q[1])] }); p = q; t = t1; continue; }
    const t2 = Math.min(duration, t + 0.5); // every way is taken: wait a moment and look again
    if (!still(p, t, t2)) return null;
    stand(t2);
    t = t2;
  }
  return keys;
}

/**
 * Plan count walkers. area: { x, z, w, d } center and size in meters; speed: average walking speed (m/s).
 * blocked(x, z): true where a walker must not stand (furniture, already widened by the body radius).
 * others(t): [[x, z], ...] people already in the scene at time t. Walkers keep gap meters from everyone at every step.
 * Returns { walkers: [{ preset, size, color, keys }], skipped }: size is a height factor around 1,
 * skipped counts walkers that found no free route in `tries` attempts (area too crowded).
 */
export function planCrowd({ count, area, duration, speed = 1.2, seed = 1, gap = 0.6, step = 0.1, blocked = () => false, others = () => [], tries = 40 }) {
  const rand = rng(seed);
  const n = Math.floor(duration / step + 1e-6) + 1;
  const busy = Array.from({ length: n }, (_, j) => others(j * step));
  const placed = []; // [x, z] of every placed walker at each sample
  const near = (x, z, j, g) => busy[j].some((o) => Math.hypot(o[0] - x, o[1] - z) < g) || placed.some((o) => Math.hypot(o[j][0] - x, o[j][1] - z) < g);
  // legs are planned with 2 cm to spare so rounding the keys to centimeters cannot break the gap
  const clear = (x, z, j) => !near(x, z, j, gap + 0.02);
  const walkers = [];
  let skipped = 0;
  for (let i = 0; i < count; i++) {
    let found = null;
    for (let k = 0; k < tries && !found; k++) {
      const keys = route(rand, { area, duration, speed, step, blocked, clear });
      if (!keys) continue;
      const path = buildPath(keys, "linear");
      const track = Array.from({ length: n }, (_, j) => { const q = samplePath(path, j * step).pos; return [q[0], q[2]]; });
      if (track.every((q, j) => !near(q[0], q[1], j, gap))) found = { keys, track };
    }
    if (!found) { skipped++; continue; }
    placed.push(found.track);
    walkers.push({
      preset: MIX[Math.floor(rand() * MIX.length)],
      size: r2(0.95 + rand() * 0.1),
      color: CROWD_COLORS[Math.floor(rand() * CROWD_COLORS.length)],
      keys: found.keys,
    });
  }
  return { walkers, skipped };
}
