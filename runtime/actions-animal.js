// Animal action library for rig-animal.js. Each action returns an authored pose (degrees) for local time lt.
// ctx = { dist, speed, height, duration, type, altitude }: dist is meters travelled along the path, so gait
// cycles lock to real movement and stance feet stay planted. Legs use planar 2-bone IK in the side (y, z) plane
// plus a foot segment held at a chosen world pitch, in rig-height units, so any trunk pitch keeps toes on target.
// Entry: { label, types, mask, dur, loop, params, ui: { param: [label, min, max, step] }, pose(lt, p, ctx) }.
// An action asked for a type outside its list falls back to that animal's idle.
import { animalLayout } from "./rig-animal.js";

const TAU = Math.PI * 2, D2R = Math.PI / 180, R2D = 180 / Math.PI;
const QUAD = ["dog", "cat", "horse", "rabbit", "cow", "sheep"], BIRDS = ["bird", "chicken", "duck"], ALL = [...QUAD, ...BIRDS];
const BIG = ["horse", "cow"]; // slower breathing, bigger head nod, tail hangs low
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => { const t = clamp(x); return t * t * (3 - 2 * t); };
const frac = (x) => x - Math.floor(x);
const lerp = (a, b, w) => a + (b - a) * w;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const osc = (lt, hz, ph = 0) => Math.sin((lt * hz + ph) * TAU);
const hash = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);
// Side-plane vectors are [y, z]; an angle is a rotation about X (+ swings a hanging bone back, pitches a nose down)
const rot2 = ([y, z], a) => [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const ang = ([y, z]) => Math.atan2(z, y);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mixRot = (a, b, w) => a.map((v, i) => v + (b[i] - v) * w);

// Bird wings folded along the flanks (the rest layout has them spread) and legs tucked for flight
const FOLD = { lWing: [64, 0, -82], lWingTip: [0, 15, -6], rWing: [64, 0, 82], rWingTip: [0, -15, 6] };
const TUCK = { lLeg: [20, 0, 0], lShank: [80, 0, 0], lFoot: [60, 0, 0], rLeg: [20, 0, 0], rShank: [80, 0, 0], rFoot: [60, 0, 0] };

// ---------- rig geometry and solvers ----------

const INFO = {};
function info(type) {
  if (INFO[type]) return INFO[type];
  const { joints, tips } = animalLayout(type), bird = BIRDS.includes(type);
  const o = (n) => [joints[n][1][1], joints[n][1][2]], tip = (n) => [tips[n][1], tips[n][2]];
  const I = { type, bird, o, legs: {} };
  const F = trunk(I, [0, 0, 0], 0);
  const defs = bird ? ["l", "r"].map((s) => [s, "body", s + "Leg", s + "Shank", s + "Foot"])
    : ["lFront", "rFront", "lBack", "rBack"].map((k) => [k, k.includes("Front") ? "chest" : "body", k + "Upper", k + "Lower", k + "Foot"]);
  for (const [key, frame, a, b, c] of defs) {
    const g = { key, frame, front: frame === "chest", j: [a, b, c], base: o(a), u: o(b), l: o(c), f: tip(c) };
    g.L1 = Math.hypot(...g.u);
    g.L2 = Math.hypot(...g.l);
    g.s = Math.sign(wrap(ang(g.u) - ang(add(g.u, g.l)))) || 1; // knee / elbow bend side of the rest pose
    g.toe = [g.base, g.u, g.l, g.f].reduce(add, F[frame].p);
    g.flat = Math.PI / 2 - ang(g.f); // foot pitch that lays the foot segment flat, toe forward
    I.legs[key] = g;
  }
  const n = { off: o("neck"), bone: o("head"), nose: tip("head") };
  n.L = Math.hypot(...n.bone);
  n.a = ang(n.bone);
  n.rest = [n.off, n.bone, n.nose].reduce(add, F[bird ? "body" : "chest"].p)[0]; // nose height at rest
  I.neck = n;
  return (INFO[type] = I);
}

// Trunk frames ({ p: [y, z] in rig heights, a: world pitch in rad }) for a hips offset and trunk pitches (rad)
function trunk(I, hips, pB, pS = 0, pC = 0) {
  const body = { p: add(I.o("body"), [hips[1], hips[2]]), a: pB };
  if (I.bird) return { body };
  const spine = { p: add(body.p, rot2(I.o("spine"), pB)), a: pB + pS };
  return { body, spine, chest: { p: add(spine.p, rot2(I.o("chest"), spine.a)), a: spine.a + pC } };
}

// Two-bone IK to toe target T with the foot segment at world pitch fd (rad); writes the three leg joints
function solveLeg(g, F, T, fd, rot) {
  const P = add(F.p, rot2(g.base, F.a)), W = sub(sub(T, rot2(g.f, fd)), P);
  const d = clamp(Math.hypot(...W), Math.abs(g.L1 - g.L2) + 1e-6, g.L1 + g.L2 - 1e-6);
  const aU = ang(W) + g.s * Math.acos(clamp((g.L1 * g.L1 + d * d - g.L2 * g.L2) / (2 * g.L1 * d), -1, 1));
  const aL = ang(sub(W, [g.L1 * Math.cos(aU), g.L1 * Math.sin(aU)]));
  const pU = aU - ang(g.u), pL = aL - ang(g.l);
  rot[g.j[0]] = [wrap(pU - F.a) * R2D, 0, 0];
  rot[g.j[1]] = [wrap(pL - pU) * R2D, 0, 0];
  rot[g.j[2]] = [wrap(fd - pL) * R2D, 0, 0];
}

const foot = (g, dy, dz, fd = 0) => [g.toe[0] + dy, g.toe[1] + dz, fd];

// Pose from a spec: hips [x, y, z] (rig heights), pB / pS / pC trunk pitches (deg),
// feet { leg: [y, z, fdDeg] } toe goals in root space (default: rest toe, foot level)
function build(I, s = {}) {
  const hips = s.hips || [0, 0, 0], pB = s.pB || 0, pS = s.pS || 0, pC = s.pC || 0;
  const F = trunk(I, hips, pB * D2R, pS * D2R, pC * D2R), rot = { body: [pB, 0, 0] };
  if (!I.bird) { rot.spine = [pS, 0, 0]; rot.chest = [pC, 0, 0]; }
  for (const k in I.legs) {
    const g = I.legs[k], ft = s.feet?.[k] || [...g.toe, 0];
    solveLeg(g, F[g.frame], ft, ft[2] * D2R, rot);
  }
  return { rot, hips, F };
}

// Neck and head pitches that put the nose tip at height yT with the head at world pitch phi (deg)
function reach(I, F, yT, phi) {
  const n = I.neck, N = add(F.p, rot2(n.off, F.a)), t = rot2(n.nose, phi * D2R);
  const aw = Math.acos(clamp((yT - N[0] - t[0]) / n.L, -1, 1)) - n.a;
  return { neck: [(aw - F.a) * R2D, 0, 0], head: [phi - aw * R2D, 0, 0] };
}

// Blend FK leg angles [upper, lower, foot] (local X, deg) over the solved ones
function mixLeg(rot, g, fk, w) {
  g.j.forEach((j, i) => { rot[j] = mixRot(rot[j], [fk[i], 0, 0], w); });
}
function setTail(rot, list, k = 1) {
  list.forEach((r, i) => { rot["tail" + (i + 1)] = r.map((v) => v * k); });
}

// ---------- gaits ----------

// off: phase offsets per leg (stance starts at 0), duty: stance fraction, stride: rig heights per cycle,
// lift: swing height, roll: foot pitch at touchdown / lift-off, fold: swing foot fold [front, back] (deg),
// hz: cadence when standing still (stepping in place), flex: spine flex amplitude for the run
const LAT = { lBack: 0, lFront: 0.25, rBack: 0.5, rFront: 0.75 };
const GAITS = {
  walk: {
    dog: { off: LAT, duty: 0.62, stride: 0.9, lift: 0.07, roll: 12, fold: [70, 25], hz: 1 },
    cat: { off: LAT, duty: 0.62, stride: 1.0, lift: 0.07, roll: 12, fold: [70, 25], hz: 1.1 },
    horse: { off: LAT, duty: 0.62, stride: 0.8, lift: 0.06, roll: 12, fold: [80, 30], hz: 0.8 },
    bird: { off: { l: 0, r: 0.5 }, duty: 0.6, stride: 0.36, lift: 0.06, roll: 0, fold: [40, 40], hz: 2 },
    rabbit: { off: LAT, duty: 0.6, stride: 0.5, lift: 0.05, roll: 10, fold: [60, 20], hz: 1.2 },
    cow: { off: LAT, duty: 0.65, stride: 0.75, lift: 0.05, roll: 12, fold: [75, 30], hz: 0.7 },
    sheep: { off: LAT, duty: 0.62, stride: 0.8, lift: 0.06, roll: 12, fold: [70, 25], hz: 1 },
    chicken: { off: { l: 0, r: 0.5 }, duty: 0.6, stride: 0.36, lift: 0.08, roll: 0, fold: [50, 50], hz: 2 },
    duck: { off: { l: 0, r: 0.5 }, duty: 0.65, stride: 0.3, lift: 0.04, roll: 0, fold: [30, 30], hz: 2.2 },
  },
  run: {
    dog: { off: { lBack: 0, rBack: 0.1, rFront: 0.42, lFront: 0.52 }, duty: 0.28, stride: 1.5, lift: 0.12, roll: 22, fold: [100, 40], hz: 2.2, flex: 14 },
    cat: { off: { lBack: 0, rBack: 0.04, lFront: 0.45, rFront: 0.5 }, duty: 0.32, stride: 1.4, lift: 0.12, roll: 22, fold: [100, 40], hz: 3, flex: 22 },
    horse: { off: { lBack: 0, rBack: 0.11, lFront: 0.32, rFront: 0.43 }, duty: 0.33, stride: 1.2, lift: 0.1, roll: 20, fold: [110, 40], hz: 1.6, flex: 6 },
    bird: { off: { l: 0, r: 0 }, duty: 0.3, stride: 0.7, lift: 0.1, roll: 0, fold: [40, 40], hz: 3 },
    rabbit: { off: { lBack: 0, rBack: 0.04, lFront: 0.5, rFront: 0.56 }, duty: 0.3, stride: 1.4, lift: 0.1, roll: 20, fold: [90, 40], hz: 2.5, flex: 18 },
    cow: { off: { lBack: 0, rBack: 0.11, lFront: 0.32, rFront: 0.43 }, duty: 0.35, stride: 1.0, lift: 0.09, roll: 18, fold: [100, 40], hz: 1.5, flex: 5 },
    sheep: { off: { lBack: 0, rBack: 0.1, lFront: 0.4, rFront: 0.5 }, duty: 0.33, stride: 1.2, lift: 0.1, roll: 20, fold: [100, 40], hz: 2, flex: 8 },
    chicken: { off: { l: 0, r: 0.5 }, duty: 0.35, stride: 0.8, lift: 0.12, roll: 0, fold: [60, 60], hz: 3.5 },
    duck: { off: { l: 0, r: 0.5 }, duty: 0.4, stride: 0.55, lift: 0.08, roll: 0, fold: [40, 40], hz: 3.5 },
  },
};

function gait(I, G, p, lt, ctx) {
  const stride = G.stride * (p.stride || 1), moving = ctx.speed > 0.05;
  const ph = moving ? ctx.dist / (stride * ctx.height) : lt * G.hz, step = moving ? G.duty * stride : 0;
  const feet = {};
  for (const k in I.legs) {
    const g = I.legs[k], q = frac(ph - G.off[k]), fold = G.fold[g.front || I.bird ? 0 : 1];
    if (q < G.duty) {
      const u = q / G.duty;
      feet[k] = foot(g, 0, step * (0.5 - u), G.roll * (2 * u - 1));
    } else {
      const u = (q - G.duty) / (1 - G.duty), b = Math.sin(Math.PI * u), e = (1 - Math.cos(Math.PI * u)) / 2;
      feet[k] = foot(g, G.lift * b, step * (e - 0.5), G.roll * Math.cos(Math.PI * u) + fold * b);
    }
  }
  return { ph, step, feet };
}

function tailIdle(I, lt, rot, amp = 1) {
  if (I.type === "dog") rot.tail1 = [0, 6 * amp * osc(lt, 0.5), 0];
  if (I.type === "cat") { rot.tail2 = [0, 8 * amp * osc(lt, 0.22), 0]; rot.tail3 = [0, 18 * amp * osc(lt, 0.22, -0.15), 0]; }
  if (BIG.includes(I.type)) { rot.tail1 = [0, 8 * amp * osc(lt, 0.2), 0]; rot.tail2 = [0, 8 * amp * osc(lt, 0.2, -0.12), 0]; }
  if (I.type === "sheep") rot.tail1 = [0, 10 * amp * osc(lt, 1.2), 0];
}

// ---------- actions ----------

function idle(lt, p, ctx, I) {
  const b = p.breathe ?? 1;
  if (I.bird) {
    // head turns in quick jerks between held looks
    const k = Math.floor(lt / 0.9), f = lt / 0.9 - k, look = (n) => (hash(n) - 0.5) * 80;
    const s = build(I, { hips: [0, 0.004 * b * osc(lt, 0.4), 0] });
    Object.assign(s.rot, FOLD, { neck: [3 * b * osc(lt, 0.4), 0, 0], head: [-3 * b * osc(lt, 0.4), lerp(look(k - 1), look(k), ease(f / 0.12)), 0], tail: [3 * osc(lt, 0.4), 0, 0] });
    return s;
  }
  const br = b * osc(lt, BIG.includes(I.type) ? 0.18 : 0.3);
  const s = build(I, { pS: 0.8 * br, pC: -0.8 * br });
  s.rot.neck = [2 * osc(lt, 0.09), 0, 0];
  s.rot.head = [2 * osc(lt, 0.07), 10 * osc(lt, 0.06), 0];
  tailIdle(I, lt, s.rot);
  return s;
}

function walk(lt, p, ctx, I) {
  const G = GAITS.walk[I.type], { ph, step, feet } = gait(I, G, p, lt, ctx), bob = Math.cos(2 * TAU * ph);
  if (I.bird) {
    // head bob: the head holds still in the world for 65% of each step, then thrusts forward (a duck does not bob)
    const ps = frac(2 * ph), R = I.type === "duck" ? 0 : step > 0 ? (0.65 * step) / G.duty / 2 : 0.02;
    const z = ps < 0.65 ? R / 2 - (R * ps) / 0.65 : -R / 2 + R * ease((ps - 0.65) / 0.35);
    const n = I.neck, aw = Math.asin(clamp((n.bone[1] + z) / n.L, -1, 1)) - n.a;
    const s = build(I, { hips: [0, -0.02 + 0.004 * bob, 0], feet });
    Object.assign(s.rot, FOLD, { neck: [aw * R2D, 0, 0], head: [-aw * R2D, 0, 0], tail: [2 * bob, 6 * Math.sin(TAU * ph), 0] });
    if (I.type === "duck") s.rot.body = [s.rot.body[0], 0, 5 * Math.sin(TAU * ph)]; // waddle
    return s;
  }
  const s = build(I, { hips: [0, -0.006 + 0.005 * bob, 0], feet });
  const nod = (BIG.includes(I.type) ? 4 : 1.5) * Math.sin(2 * TAU * ph);
  s.rot.neck = [nod, 0, 0];
  s.rot.head = [-0.5 * nod, 3 * Math.sin(TAU * ph), 0];
  tailIdle(I, lt, s.rot);
  s.rot.tail1 = [BIG.includes(I.type) ? 0 : 6, 7 * Math.sin(TAU * ph), 0];
  return s;
}

// tails trail behind in the run (the cat question-mark tail straightens out)
const RUN_TAIL = { dog: [[12, 0, 0], [-4, 0, 0], [0, 0, 0]], cat: [[-20, 0, 0], [-43, 0, 0], [-26, 0, 0]], horse: [[20, 0, 0], [-8, 0, 0], [-6, 0, 0]],
  rabbit: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], cow: [[25, 0, 0], [-10, 0, 0], [-8, 0, 0]], sheep: [[10, 0, 0], [0, 0, 0], [0, 0, 0]] };
function run(lt, p, ctx, I) {
  const G = GAITS.run[I.type], { ph, feet } = gait(I, G, p, lt, ctx), q = frac(ph);
  if (I.bird) {
    // pigeon: two-footed hop, the body arcs up while both feet are off the ground, then sinks on landing;
    // chicken / duck: alternate feet with a short flight between steps
    const hop = G.off.l === G.off.r, d = hop ? G.duty : 2 * G.duty, qa = hop ? q : frac(2 * ph);
    const air = qa < d ? 0 : Math.sin((Math.PI * (qa - d)) / (1 - d));
    const land = qa < d ? Math.sin((Math.PI * qa) / d) : 0;
    const s = build(I, { hips: [0, (hop ? 0.06 : 0.025) * air - 0.03 - 0.02 * land, 0], pB: 6, feet });
    Object.assign(s.rot, FOLD, { neck: [8 - 6 * air, 0, 0], head: [-14 + 6 * air, 0, 0], tail: [6 * air, 0, 0] });
    return s;
  }
  // spine flexes (arched) in the gathered phase and extends while the legs stretch out
  const F = G.flex * Math.cos(TAU * (q - 0.95)), bounce = Math.cos(TAU * (q - 0.9));
  const s = build(I, { hips: [0, -0.03 + 0.02 * bounce, 0], pB: -F / 2, pS: F, feet });
  const pump = (I.type === "horse" ? 8 : 4) * Math.cos(TAU * (q - 0.3));
  s.rot.neck = [12 + pump, 0, 0];
  s.rot.head = [-10 - pump - F / 2, 0, 0];
  setTail(s.rot, RUN_TAIL[I.type].map((r, i) => (i ? r : [r[0] + 7 * bounce, 0, 0])));
  return s;
}

// sit: trunk pitched up about the hips, front paws stay put, hocks and hind feet go flat on the ground
const SIT = {
  dog: { pitch: -45, back: 0.05, neck: 18, head: 27, tail: [[48, 0, 0], [-6, 12, 0], [-4, 14, 0]] },
  cat: { pitch: -50, back: 0.05, neck: 26, head: 24, tail: [[0, 0, 0], [-20, 0, -60], [0, 0, -60]] },
};
function sit(lt, p, ctx, I) {
  const c = SIT[I.type], k = ease(lt / Math.min(1, 0.6 * ctx.duration)), gF = I.legs.lFront;
  const pB = c.pitch * k, F0 = trunk(I, [0, 0, 0], pB * D2R);
  // hips offset that keeps the shoulders just above and behind the planted front paws
  const B0 = add(F0.chest.p, rot2(gF.base, F0.chest.a)), Br = add(trunk(I, [0, 0, 0], 0).chest.p, gF.base);
  const want = [Br[0] - 0.02 * k, lerp(Br[1], gF.toe[1] - gF.f[1] - 0.065, k)];
  const hips = [0, want[0] - B0[0], want[1] - B0[1]], F = trunk(I, hips, pB * D2R), feet = {};
  for (const sd of ["l", "r"]) {
    const g = I.legs[sd + "Back"], hip = add(F.body.p, rot2(g.base, F.body.a));
    feet[sd + "Back"] = [g.toe[0] + 0.03 * Math.sin(Math.PI * k), lerp(g.toe[1], hip[1] + c.back, k), (g.flat + 0.12) * R2D * k];
  }
  const s = build(I, { hips, pB, feet });
  Object.assign(s.rot, { neck: [c.neck * k, 0, 0], head: [c.head * k, 0, 0] });
  setTail(s.rot, c.tail, k);
  return s;
}

// lie: belly down; dog / cat in a sphinx with forearms forward, horse with the front cannons folded under
const LIE = {
  dog: { drop: -0.42, pitch: -4, back: -0.05, neck: 6, head: 2, tail: [[20, 25, 0], [-10, 20, 0], [-5, 15, 0]] },
  cat: { drop: -0.46, pitch: -3, back: -0.05, neck: 8, head: 4, tail: [[-42, 0, 0], [-43, 0, -30], [-18, 0, -50]] },
  horse: { drop: -0.37, r: 0.07, pitch: -3, back: -0.04, fold: 100, neck: 4, head: 0, tail: [[45, 0, 0], [-10, 0, 0], [-10, 0, 0]] },
  rabbit: { drop: -0.2, pitch: -3, back: -0.05, neck: 8, head: 4, tail: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] },
  cow: { drop: -0.37, r: 0.1, pitch: -3, back: -0.04, fold: 100, neck: 4, head: 0, tail: [[35, 0, 0], [-10, 0, 0], [-10, 0, 0]] },
  sheep: { drop: -0.34, r: 0.068, pitch: -3, back: -0.04, fold: 100, neck: 4, head: 0, tail: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] },
};
function lie(lt, p, ctx, I) {
  const c = LIE[I.type], k = ease(lt / Math.min(1.2, 0.6 * ctx.duration)), r = c.r ?? 0.035; // r: hock / elbow height, clears hooves
  const hips = [0, c.drop, 0], F = trunk(I, hips, c.pitch * D2R), feet = {};
  for (const key in I.legs) {
    const g = I.legs[key], P = add(F[g.frame].p, rot2(g.base, F[g.frame].a));
    let T, fd;
    if (g.front) {
      // elbow on the ground under / behind the shoulder, forearm along the ground
      const ez = P[1] - Math.sqrt(Math.max(0, g.L1 * g.L1 - (P[0] - r) ** 2));
      fd = c.fold ?? (g.flat + 0.05) * R2D;
      T = add([r, ez + g.L2], rot2(g.f, fd * D2R));
    } else {
      // hock on the ground behind the hip, foot forward
      fd = (g.flat + 0.05) * R2D;
      T = add([r, P[1] + c.back], rot2(g.f, fd * D2R));
    }
    feet[key] = [lerp(g.toe[0], T[0], k) + 0.04 * Math.sin(Math.PI * k), lerp(g.toe[1], T[1], k), fd * k];
  }
  const s = build(I, { hips: hips.map((v) => v * k), pB: c.pitch * k, feet });
  Object.assign(s.rot, { neck: [c.neck * k, 0, 0], head: [c.head * k, 0, 0] });
  setTail(s.rot, c.tail, k);
  return s;
}

// eat: front end lowered, nose to the bowl / grass with small nibbling nods; the bird pecks
const EAT = { dog: { pB: 14, phi: 70, yT: 0.06 }, cat: { pB: 14, phi: 70, yT: 0.04 }, horse: { pB: 6, phi: 25, yT: 0.03 }, bird: { pB: 30, phi: 60, hips: -0.05 },
  rabbit: { pB: 8, phi: 55, yT: 0.04 }, cow: { pB: 6, phi: 25, yT: 0.03 }, sheep: { pB: 16, phi: 30, yT: 0.05 }, chicken: { pB: 30, phi: 60, hips: -0.04 }, duck: { pB: 20, phi: 60, hips: -0.03 } };
function eat(lt, p, ctx, I) {
  const c = EAT[I.type], k = ease(lt / 0.8), rate = p.rate || 1;
  if (I.bird) {
    const q = frac(lt * 1.5 * rate), dip = q < 0.3 ? Math.sin((Math.PI * q) / 0.3) * k : 0;
    const s = build(I, { pB: c.pB * k, hips: [0, c.hips * k, 0] });
    Object.assign(s.rot, FOLD, reach(I, s.F.body, lerp(I.neck.rest, 0.12 * (1 - dip), k), (c.phi + 20 * dip) * k), { tail: [10 * k, 0, 0] });
    return s;
  }
  const nib = Math.sin(TAU * lt * 2.2 * rate) * k;
  const s = build(I, { pB: c.pB * k });
  const R = reach(I, s.F.chest, lerp(I.neck.rest, c.yT + 0.01 * nib, k), (c.phi + 5 * nib) * k);
  R.head[1] = 6 * Math.sin(TAU * lt * 0.3) * k;
  Object.assign(s.rot, R);
  tailIdle(I, lt, s.rot);
  return s;
}

// jump: crouch, take off front first, tuck in the air, land front first, recover. Vertical, in place.
const JF = { tuck: [10, -80, 80], reach: [-40, 15, -10] }, JB = { ext: [40, -20, 35], tuck: [-40, 50, -60] };
function jump(lt, p, ctx, I) {
  const u = clamp(lt / ctx.duration), seg = (a, b) => clamp((u - a) / (b - a));
  const apex = ({ cat: 0.7, rabbit: 0.8 }[I.type] || 0.45) * (p.height || 1);
  const c = ease(seg(0, 0.25)), t = ease(seg(0.25, 0.38)), a = seg(0.38, 0.7), l = ease(seg(0.7, 0.82)), r = ease(seg(0.82, 1));
  const hy = -0.1 * c + 0.16 * t + apex * 4 * a * (1 - a) - 0.02 * a - 0.12 * l + 0.08 * r;
  const pB = 5 * c - 27 * t + 36 * ease(a) - 12 * l - 2 * r;
  const s = build(I, { hips: [0, hy, 0], pB });
  const wF = t * (1 - l), wB = ease(seg(0.34, 0.42)) * (1 - l);
  const fF = mixRot(JF.tuck, JF.reach, ease(seg(0.5, 0.68))), fB = mixRot(JB.ext, JB.tuck, ease(seg(0.4, 0.55)));
  for (const k in I.legs) mixLeg(s.rot, I.legs[k], I.legs[k].front ? fF : fB, I.legs[k].front ? wF : wB);
  Object.assign(s.rot, { neck: [-0.4 * pB, 0, 0], head: [-0.4 * pB, 0, 0] });
  setTail(s.rot, [[25, 0, 0], [-5, 0, 0], [-5, 0, 0]], Math.sin(Math.PI * seg(0.25, 0.85)));
  return s;
}

function wagTail(lt, p, ctx, I) {
  const s = idle(lt, { breathe: 1 }, ctx, I), w = TAU * (p.rate || 3) * lt;
  setTail(s.rot, [[35, 35 * Math.sin(w), 0], [-5, 25 * Math.sin(w - 0.6), 0], [-5, 20 * Math.sin(w - 1.2), 0]]);
  s.rot.body = [s.rot.body[0], -3 * Math.sin(w), 0]; // hips swing against the tail
  s.rot.spine = [s.rot.spine[0], 3 * Math.sin(w), 0];
  return s;
}

// rear: trunk pitches up over planted hind feet, front legs fold and paw the air, then come down
function rear(lt, p, ctx, I) {
  const u = clamp(lt / ctx.duration), up = ease(u / 0.3) * (1 - ease((u - 0.7) / 0.3));
  const s = build(I, { hips: [0, -0.05 * up, 0], pB: -(p.angle ?? 50) * up });
  const w = ease((u - 0.1) / 0.2) * (1 - ease((u - 0.72) / 0.2));
  for (const sd of ["l", "r"]) {
    const paw = 18 * Math.sin(TAU * 1.3 * lt + (sd === "l" ? 0 : Math.PI));
    mixLeg(s.rot, I.legs[sd + "Front"], [-20 + paw, -20 - 0.5 * paw, 100], w);
  }
  Object.assign(s.rot, { neck: [30 * up, 0, 0], head: [20 * up, 0, 0] });
  setTail(s.rot, [[45, 0, 0], [10, 0, 0], [5, 0, 0]], up); // counter the trunk pitch so the tail hangs behind
  return s;
}

function fly(lt, p) {
  const w = TAU * (p.freq || 5) * lt, s = Math.sin(w), c = Math.cos(w), tip = 18 * Math.sin(w - 1.1);
  return {
    rot: { body: [24, 0, 0], neck: [6, 0, 0], head: [-30, 0, 0], tail: [-4 + 3 * c, 0, 0], ...TUCK,
      lWing: [5 * c, 0, 12 + 48 * s], rWing: [5 * c, 0, -12 - 48 * s], lWingTip: [0, 8 * c, tip], rWingTip: [0, -8 * c, -tip] },
    hips: [0, -0.01 * s, 0],
  };
}

function glide(lt, p) {
  const bank = (p.bank ?? 4) * Math.sin(TAU * 0.2 * lt);
  return {
    rot: { body: [22, 0, bank], neck: [6, 0, 0], head: [-28, 0, -0.6 * bank], tail: [-6, 0, 0], ...TUCK,
      lWing: [2, 0, 8], rWing: [2, 0, -8], lWingTip: [0, 0, -4], rWingTip: [0, 0, 4] },
    hips: [0, 0.004 * Math.sin(TAU * 0.2 * lt), 0],
  };
}

function act(label, types, dur, loop, params, ui, fn) {
  return {
    label, types, mask: "full", dur, loop, params, ui,
    pose(lt, p = {}, ctx = {}) {
      const type = ALL.includes(ctx.type) ? ctx.type : types[0];
      const c = { ...ctx, dist: ctx.dist || 0, speed: ctx.speed || 0, height: ctx.height || 1, duration: ctx.duration || dur };
      const r = types.includes(type) ? fn(lt, { ...params, ...p }, c, info(type)) : idle(lt, { breathe: 1 }, c, info(type));
      return { rot: r.rot, hips: r.hips };
    },
  };
}

const STRIDE = { stride: ["步幅倍率", 0.6, 1.4, 0.05] };
export const ANIMAL_ACTIONS = {
  idle: act("待機", ALL, 4, true, { breathe: 1 }, { breathe: ["呼吸幅度", 0, 3, 0.1] }, idle),
  walk: act("走路", ALL, 4, true, { stride: 1 }, STRIDE, walk),
  run: act("奔跑", ALL, 3, true, { stride: 1 }, STRIDE, run),
  sit: act("坐下", ["dog", "cat"], 1.5, false, {}, {}, sit),
  lie: act("趴下", QUAD, 2, false, {}, {}, lie),
  eat: act("低頭吃", ALL, 4, true, { rate: 1 }, { rate: ["進食頻率", 0.5, 2, 0.1] }, eat),
  jump: act("跳躍", ["dog", "cat", "rabbit"], 1.2, false, { height: 1 }, { height: ["跳躍高度倍率", 0.3, 2, 0.1] }, jump),
  fly: act("飛行", BIRDS, 4, true, { freq: 5 }, { freq: ["拍翅頻率（次/秒）", 2, 10, 0.5] }, fly),
  glide: act("滑翔", ["bird", "duck"], 4, true, { bank: 4 }, { bank: ["側傾幅度（度）", 0, 20, 1] }, glide),
  wagTail: act("搖尾巴", ["dog"], 3, true, { rate: 3 }, { rate: ["搖動頻率（次/秒）", 1, 6, 0.5] }, wagTail),
  rear: act("抬前腿", ["horse"], 3, false, { angle: 50 }, { angle: ["抬身角度", 25, 65, 1] }, rear),
};
