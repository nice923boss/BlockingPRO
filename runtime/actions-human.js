// Humanoid action library. Each action returns an authored pose (degrees) for local time lt.
// ctx = { dist, speed, height, duration, type, body }: body = the actor's sliders (a05); dist is meters travelled along the actor path,
// so locomotion cycles lock to real movement and feet do not slide.
// mask "full" drives the whole body; "upper" actions only set upper-body joints and can be layered over locomotion.
// Entry: { label, mask, dur, loop, params, ui: { param: [label, min, max, step] }, pose(lt, p, ctx) }.
// Most poses are written as a spec: FK rotations plus IK goals in body-height fractions, resolved by solve().
//   hips: hips offset; lA/rA: ankle positions; lF/rF: foot rotations; kOut: knee yaw (root frame)
//   lW/rW: wrist positions; lP/rP: elbow pole directions; lH/rH: hand [finger dir, palm normal] (chest frame)
import { resolveBody } from "./rig-human.js";
import { GAIT_STYLES, AMP_RANGE, gaitStyle, withPosture } from "./gait-style.js";

const TAU = Math.PI * 2, D2R = Math.PI / 180, R2D = 180 / Math.PI;
const Z3 = [0, 0, 0];
const LEG = 0.245, UA = 0.17, FA = 0.155; // bone lengths of the rig layout
const pos = (x) => Math.max(0, x);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => { const t = clamp(x); return t * t * (3 - 2 * t); };
const easeIn = (x) => clamp(x) ** 2;
const easeOut = (x) => 1 - (1 - clamp(x)) ** 2;
const bump = (x) => Math.sin(Math.PI * clamp(x));
const osc = (lt, hz, ph = 0) => Math.sin((lt * hz + ph) * TAU);
const frac = (x) => x - Math.floor(x);

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const nrm = (a) => scl(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerpV = (a, b, w) => (typeof a === "number" ? a + (b - a) * w : a.map((v, i) => v + (b[i] - v) * w));
const addV = (a, b, k) => (typeof a === "number" ? a + b * k : a.map((v, i) => v + b[i] * k));

// Row-major 3x3 rotation from Euler degrees, three.js 'XYZ' order (M = Rx * Ry * Rz)
function mat(r) {
  const x = r[0] * D2R, y = r[1] * D2R, z = r[2] * D2R;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  return [c * e, -c * f, d, a * f + b * e * d, a * e - b * f * d, -b * c, b * f - a * e * d, b * e + a * f * d, a * c];
}
function mul(A, B) {
  const m = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return m;
}
const tr = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const app = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const cols = (x, y, z) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
function euler(m) {
  const y = Math.asin(clamp(m[2], -1, 1)) * R2D;
  if (Math.abs(m[2]) < 0.9999999) return [Math.atan2(-m[5], m[8]) * R2D, y, Math.atan2(-m[1], m[0]) * R2D];
  return [Math.atan2(m[7], m[4]) * R2D, y, 0];
}

// Ankle height that keeps the toe (pitch > 0) or heel (pitch < 0) corner of the foot box on the floor
const toeY = (p) => 0.04 * Math.cos(p * D2R) + (p > 0 ? 0.115 : 0.035) * Math.abs(Math.sin(p * D2R));

// Lowest point (fraction of height) of the feet and pelvis for an FK pose, used to keep falls on the floor
function groundLow(rot, hips, b) {
  const hp = add([0, 0.55, 0], hips), Mh = mat(rot.hips || Z3);
  const pr = [b.hw * 1.75, 0.06, 0.065 * b.bulk];
  let low = hp[1] + app(Mh, [0, 0.005, 0])[1] - Math.hypot(Mh[3] * pr[0], Mh[4] * pr[1], Mh[5] * pr[2]);
  for (const [s, sg] of [["l", 1], ["r", -1]]) {
    const Mt = mul(Mh, mat(rot[s + "Thigh"] || Z3)), Ms = mul(Mt, mat(rot[s + "Shin"] || Z3)), Mf = mul(Ms, mat(rot[s + "Foot"] || Z3));
    const ank = add(add(add(hp, app(Mh, [sg * b.hw, -0.02, 0])), app(Mt, [0, -LEG, 0])), app(Ms, [0, -LEG, 0]));
    for (const y of [0, -0.04]) for (const z of [-0.035, 0.115]) low = Math.min(low, ank[1] + app(Mf, [0, y, z])[1]);
  }
  return low;
}

// Proportions (fractions of height) of the body preset in ctx.type with the actor's ctx.body sliders
function bodyOf(ctx) {
  const B = resolveBody(ctx && ctx.type, ctx && ctx.body);
  return { s: B.shoulder, hw: B.hipW, hr: B.headR, bulk: B.bulk };
}

// ---------- IK ----------

// Two-bone leg: thigh [x, 0, z] (plus optional knee yaw) and shin bend reach the ankle goal A; F is the foot rotation in the root frame
function legIK(rot, side, hp, Mh, A, F, hw, out) {
  const sg = side === "l" ? 1 : -1;
  const top = add(hp, app(Mh, [sg * hw, -0.02, 0]));
  const My = mat([0, sg * out, 0]);
  const d = app(tr(mul(Mh, My)), sub(A, top));
  const L = clamp(len(d), 0.05, 2 * LEG * 0.9999), dn = scl(nrm(d), L);
  const cb = (L * L) / (2 * LEG * LEG) - 1, bend = Math.acos(clamp(cb, -1, 1));
  const Y = -LEG * (1 + cb), Zc = -LEG * Math.sin(bend);
  const z = Math.asin(clamp(dn[0] / -Y, -1, 1));
  const x = Math.atan2(dn[2], dn[1]) - Math.atan2(Zc, Y * Math.cos(z));
  const Mt = mul(My, mat([x * R2D, 0, z * R2D])), Mk = mul(Mh, Mt);
  rot[side + "Thigh"] = euler(Mt);
  rot[side + "Shin"] = [bend * R2D, 0, 0];
  rot[side + "Foot"] = euler(mul(tr(mul(Mk, mat([bend * R2D, 0, 0]))), mat(F || Z3)));
  return add(top, app(Mk, [0, -LEG, 0]));
}

// Two-bone arm in the chest frame: wrist goal T, elbow toward pole, optional hand [finger dir, palm normal]
function armIK(rot, side, s, T, pole, hand) {
  const S = [side === "l" ? s : -s, 0.115, 0];
  const v = sub(T, S), u = nrm(v);
  const D = clamp(len(v), 0.02, (UA + FA) * 0.9999);
  const ca = clamp((UA * UA + D * D - FA * FA) / (2 * UA * D), -1, 1);
  let pp = sub(pole, scl(u, dot(pole, u)));
  pp = nrm(len(pp) < 1e-6 ? cross(u, [1, 0, 0]) : pp);
  const E = add(S, add(scl(u, UA * ca), scl(pp, UA * Math.sqrt(1 - ca * ca))));
  const f = sub(add(S, scl(u, D)), E), yA = nrm(sub(S, E));
  let zA = sub(f, scl(yA, dot(f, yA)));
  if (len(zA) < 1e-6) zA = sub(scl(pp, -1), scl(yA, -dot(pp, yA)));
  zA = nrm(zA);
  const Mu = cols(cross(yA, zA), yA, zA);
  const bend = 180 - Math.acos(clamp(dot(yA, nrm(f)), -1, 1)) * R2D;
  rot[side + "UpperArm"] = euler(Mu);
  rot[side + "ForeArm"] = [-bend, 0, 0];
  if (hand) {
    // one hand mesh serves both sides, so the left hand's frame X is its back: flip the palm normal
    const yH = scl(nrm(hand.slice(0, 3)), -1), n = scl(hand.slice(3, 6), side === "l" ? -1 : 1);
    const xH = nrm(sub(n, scl(yH, dot(n, yH))));
    rot[side + "Hand"] = euler(mul(tr(mul(Mu, mat([-bend, 0, 0]))), cols(xH, yH, cross(xH, yH))));
  }
}

// Point given in the head frame, expressed in the chest frame
function headPt(rot, p) {
  return add([0, 0.135, 0], app(mat(rot.neck || Z3), add([0, 0.035, 0], app(mat(rot.head || Z3), p))));
}

// Root-frame point expressed in the chest frame of a spec
function toChest(sp, P) {
  const r = sp.rot, Mh = mat(r.hips || Z3), Ms = mul(Mh, mat(r.spine || Z3)), Mc = mul(Ms, mat(r.chest || Z3));
  const c = add(add(add([0, 0.55, 0], sp.hips || Z3), app(Mh, [0, 0.02, 0])), app(Ms, [0, 0.14, 0]));
  return app(tr(Mc), sub(P, c));
}

// Resolve a spec to an authored pose; knee positions land in knees when given
function solve(sp, b, knees = {}) {
  const rot = { ...sp.rot };
  if (sp.lA || sp.rA) {
    const hp = add([0, 0.55, 0], sp.hips || Z3), Mh = mat(rot.hips || Z3);
    for (const s of ["l", "r"]) if (sp[s + "A"]) knees[s] = legIK(rot, s, hp, Mh, sp[s + "A"], sp[s + "F"], b.hw, sp.kOut || 0);
  }
  for (const s of ["l", "r"]) {
    if (sp[s + "W"]) armIK(rot, s, b.s, sp[s + "W"], sp[s + "P"] || [s === "l" ? 0.3 : -0.3, -1, -0.3], sp[s + "H"]);
  }
  return { rot, hips: sp.hips || [0, 0, 0] };
}

// Spec blending: rotations missing on one side count as rest; other goals lerp when both sides have them
function mix(a, b, w) {
  const out = { rot: {} };
  for (const j of new Set([...Object.keys(a.rot), ...Object.keys(b.rot)])) out.rot[j] = lerpV(a.rot[j] || Z3, b.rot[j] || Z3, w);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k !== "rot") out[k] = a[k] !== undefined && b[k] !== undefined ? lerpV(a[k], b[k], w) : a[k] ?? b[k];
  }
  return out;
}
function nudge(a, d, k = 1) {
  const out = { ...a, rot: { ...a.rot } };
  for (const j in d.rot || {}) out.rot[j] = addV(out.rot[j] || Z3, d.rot[j], k);
  for (const key in d) if (key !== "rot") out[key] = out[key] !== undefined ? addV(out[key], d[key], k) : scl(d[key], k);
  return out;
}
// keys = [[u, spec], ...] sorted by u; ease is one function or one per segment
function track(keys, u, ease = smooth) {
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
  const [u0, a] = keys[i], [u1, b] = keys[i + 1];
  return mix(a, b, (typeof ease === "function" ? ease : ease[i])((u - u0) / (u1 - u0)));
}

// ---------- shared specs ----------

const HANG_H = (sg) => [0, -1, 0.1, -sg, 0, 0];
const hangW = (b, sg) => [sg * (b.s + 0.034), -0.207, 0.022];
function upHang(b) {
  return {
    rot: { chest: [-1, 0, 0], head: [1, 0, 0] },
    lW: hangW(b, 1), rW: hangW(b, -1), lP: [0.3, 0, -1], rP: [-0.3, 0, -1], lH: HANG_H(1), rH: HANG_H(-1),
  };
}
function stand(b) {
  return { ...upHang(b), hips: [0, 0, 0], kOut: 0, lA: [b.hw + 0.017, 0.04, 0], rA: [-b.hw - 0.017, 0.04, 0], lF: [0, 6, 0], rF: [0, -6, 0] };
}
const BREATH = { rot: { chest: [1, 0, 0], head: [-0.5, 0, 0] } };
const breath = (lt) => Math.sin(lt * TAU * 0.25);

// Seated on a seat of height seat (m); hips end 0.24 H behind the root so the feet stay where they stood
function seated(b, seat, H) {
  const rT = 0.045 * b.bulk, hy = seat / H + 0.02 + rT, hz = -0.24, ky = hy - 0.02;
  const dangle = ky - LEG > 0.07; // seat too high for the shins: feet hang
  const ay = dangle ? ky - 0.235 : 0.04, az = hz + (dangle ? 0.31 : 0.25);
  const sp = {
    rot: { hips: [-4, 0, 0], spine: [5, 0, 0], chest: [2, 0, 0], head: [3, 0, 0] },
    hips: [0, hy - 0.55, hz], kOut: 0,
    lA: [b.hw + 0.025, ay, az], rA: [-b.hw - 0.025, ay, az], lF: [dangle ? 25 : 0, 6, 0], rF: [dangle ? 25 : 0, -6, 0],
    lP: [0.6, -0.2, -1], rP: [-0.6, -0.2, -1], lH: [0, -0.3, 1, 0, -1, 0], rH: [0, -0.3, 1, 0, -1, 0],
  };
  sp.lW = toChest(sp, [b.hw + 0.035, ky + rT + 0.03, hz + 0.12]);
  sp.rW = toChest(sp, [-b.hw - 0.035, ky + rT + 0.03, hz + 0.12]);
  return sp;
}
const SIT_LEAN = { rot: { hips: [22, 0, 0], spine: [10, 0, 0], neck: [-10, 0, 0], head: [-12, 0, 0] }, hips: [0, 0, -0.04], lW: [0, 0.06, 0.12], rW: [0, 0.06, 0.12] };
const RISE_LEAN = { rot: { hips: [30, 0, 0], spine: [12, 0, 0], neck: [-12, 0, 0], head: [-14, 0, 0] }, hips: [0, 0, 0.03], lW: [0, 0.08, 0.14], rW: [0, 0.08, 0.14] };

function crouchSpec(b) {
  const sp = {
    ...upHang(b),
    rot: { hips: [18, 0, 0], spine: [14, 0, 0], chest: [8, 0, 0], neck: [-12, 0, 0], head: [-14, 0, 0] },
    hips: [0, -0.29, -0.08], kOut: 12,
    lA: [b.hw + 0.04, 0.04, 0], rA: [-b.hw - 0.04, 0.04, 0], lF: [0, 14, 0], rF: [0, -14, 0],
    lP: [0.5, -0.5, -0.5], rP: [-0.5, -0.5, -0.5], lH: [0, -1, 0.4, -1, 0, 0], rH: [0, -1, 0.4, 1, 0, 0],
  };
  const k = {};
  solve(sp, b, k);
  sp.lW = toChest(sp, add(k.l, [0, 0.03, 0.1]));
  sp.rW = toChest(sp, add(k.r, [0, 0.03, 0.1]));
  return sp;
}

function kneelSpec(b) {
  const ky = 0.036 * b.bulk + 0.006, hz = -0.235, a = 20 * D2R;
  const sp = {
    ...upHang(b),
    rot: { spine: [4, 0, 0], chest: [2, 0, 0], head: [6, 0, 0] },
    hips: [0, ky + LEG + 0.02 - 0.55, hz], kOut: 0,
    lA: [b.hw + 0.03, 0.04, 0], rA: [-b.hw - 0.01, ky + LEG * Math.sin(a), hz - LEG * Math.cos(a)],
    lF: [0, 6, 0], rF: [85, 0, 0], lP: [1, -0.2, -0.6], lH: [0, -0.8, 1, 0, -1, 0],
  };
  const k = {};
  solve(sp, b, k);
  sp.lW = toChest(sp, add(k.l, [0.01, 0.06, 0.02]));
  return sp;
}

// Lying on the back, head toward -Z, pelvis and ribcage resting on the floor (FK)
function lieSpec(b, br = 0) {
  const h0 = 0.068 * b.bulk + 0.002;
  const neck = Math.asin(clamp((b.hr - h0) / 0.096, -1, 1)) * R2D;
  return {
    rot: {
      hips: [-90, 0, 0], chest: [1.5 * br, 0, 0], neck: [neck, 0, 0], head: [-0.5 * br, 0, 0],
      lUpperArm: [9, 0, 12], rUpperArm: [9, 0, -12], lForeArm: [-6, 0, 0], rForeArm: [-6, 0, 0],
      lThigh: [3, 0, 4], rThigh: [3, 0, -4], lFoot: [20, 0, -8], rFoot: [20, 0, 8],
    },
    hips: [0, h0 - 0.55, 0],
  };
}

function jumpDip(b) {
  return {
    ...stand(b), rot: { hips: [16, 0, 0], spine: [10, 0, 0], chest: [4, 0, 0], neck: [-8, 0, 0], head: [-10, 0, 0] }, hips: [0, -0.11, -0.04],
    lW: [b.s + 0.03, -0.16, -0.12], rW: [-b.s - 0.03, -0.16, -0.12],
  };
}
function jumpExt(b) {
  return {
    ...stand(b), rot: { hips: [-2, 0, 0], chest: [-3, 0, 0], neck: [-4, 0, 0], head: [-6, 0, 0] }, hips: [0, 0.06, 0],
    lA: [b.hw + 0.017, 0.115, 0], rA: [-b.hw - 0.017, 0.115, 0], lF: [45, 6, 0], rF: [45, -6, 0],
    lW: [b.s + 0.04, 0.33, 0.17], rW: [-b.s - 0.04, 0.33, 0.17], lP: [0.6, -1, 0], rP: [-0.6, -1, 0],
  };
}
function jumpTuck(b) {
  const e = jumpExt(b);
  return {
    ...e, rot: { ...e.rot, hips: [6, 0, 0], spine: [4, 0, 0] },
    lA: add(e.lA, [0, 0.09, -0.05]), rA: add(e.rA, [0, 0.09, -0.05]), lF: [30, 6, 0], rF: [30, -6, 0],
    lW: [b.s + 0.08, 0.37, 0.12], rW: [-b.s - 0.08, 0.37, 0.12],
  };
}

// Phase in cycles: follows distance when moving, otherwise steps in place at a fixed cadence
function gaitPhase(lt, ctx, stride, cadence) {
  return ctx.speed > 0.05 ? ctx.dist / (stride * ctx.height) : lt * cadence;
}

function legCycle(w, thighAmp, kneeAmp, kneeBase) {
  const rot = {};
  for (const [s, off] of [["l", 0], ["r", Math.PI]]) {
    const a = w + off;
    const thigh = -thighAmp * Math.sin(a);
    const knee = kneeBase + kneeAmp * Math.pow(pos(Math.cos(a)), 1.4);
    rot[s + "Thigh"] = [thigh, 0, 0];
    rot[s + "Shin"] = [knee, 0, 0];
    rot[s + "Foot"] = [-(thigh + knee) * 0.75, 0, 0];
  }
  return rot;
}
// Vertical reach of the lower leg of a legCycle pose (fraction of height): a restyled gait shifts the hips by the
// change against the default cycle, so it touches the floor the way the default walk / run does
const legReach = (rot) => Math.max(...["l", "r"].map((s) => {
  const t = rot[s + "Thigh"][0] * D2R;
  return LEG * (Math.cos(t) + Math.cos(t + rot[s + "Shin"][0] * D2R));
}));

// Upper-body one-shot that raises from the hang pose to target over the first part of the clip
function raise(lt, ctx, b, target, cap = 0.45, arc = null) {
  const u = smooth(lt / Math.min(cap, 0.4 * ctx.duration));
  const sp = mix(upHang(b), target, u);
  return arc ? nudge(sp, arc, bump(u)) : sp;
}

// Both hands on the sides of a box held at the waist (carry; liftBox / putDown in actions-daily.js).
// Palms 0.49 m apart on a 1.78 m body, so the built-in box (0.45 m) sits between them.
const carryTarget = () => ({
  rot: { spine: [-2, 0, 0], chest: [-3, 0, 0], head: [4, 0, 0] },
  lW: [0.138, -0.03, 0.19], rW: [-0.138, -0.03, 0.19], lP: [0.4, -1, -0.5], rP: [-0.4, -1, -0.5],
  lH: [0, 0, 1, -1, 0, 0], rH: [0, 0, 1, 1, 0, 0],
});

export const HUMAN_ACTIONS = {
  // ---------- locomotion ----------
  idle: {
    label: "待機", mask: "full", dur: 4, loop: true, params: { breathe: 1, style: "normal" },
    ui: { breathe: ["呼吸幅度", 0, 3, 0.1], style: ["風格", "choice", GAIT_STYLES] },
    pose(lt, p) {
      const b = Math.sin(lt * TAU * 0.25) * p.breathe;
      return {
        rot: withPosture({
          chest: [-1 + b, 0, 0], head: [1 - b * 0.5, 0, 0],
          lUpperArm: [2, 0, 6 + b * 0.6], rUpperArm: [2, 0, -6 - b * 0.6],
          lForeArm: [-8, 0, 0], rForeArm: [-8, 0, 0],
          lThigh: [0, 0, 2], rThigh: [0, 0, -2], lFoot: [0, 0, -2], rFoot: [0, 0, 2],
        }, gaitStyle(p)),
        hips: [0, b * 0.0017, 0],
      };
    },
  },
  walk: {
    label: "走路", mask: "full", dur: 4, loop: true, params: { stride: 0.8, swing: 1, style: "normal", amp: 1 },
    ui: { stride: ["步幅", 0.4, 1.2, 0.05], swing: ["擺臂", 0, 2, 0.1], style: ["風格", "choice", GAIT_STYLES], amp: ["動作幅度", ...AMP_RANGE, 0.05] },
    // ctx.gait (auto gait, a12): shared step clock and stride factor, smaller and quicker steps when slow
    pose(lt, p, ctx) {
      const s = gaitStyle(p), g = ctx.gait, k = g ? g.walk : 1;
      const w = (g ? g.cycle : gaitPhase(lt, ctx, p.stride * s.stride, 0.9)) * TAU;
      const rot = legCycle(w, 24 * s.stride * k, 52 * s.knee * Math.sqrt(k), 6);
      const arm = 22 * p.swing * s.arm * k;
      rot.lUpperArm = [arm * Math.sin(w), 0, 6];
      rot.rUpperArm = [-arm * Math.sin(w), 0, -6];
      rot.lForeArm = [-14 + s.elbow - 12 * s.arm * pos(-Math.sin(w)), 0, 0];
      rot.rForeArm = [-14 + s.elbow - 12 * s.arm * pos(Math.sin(w)), 0, 0];
      rot.hips = [0, 6 * s.twist * k * Math.sin(w), 2 * s.sway * Math.cos(2 * w)];
      rot.chest = [2, -9 * s.twist * k * Math.sin(w), 0];
      rot.head = [0, 3 * s.twist * k * Math.sin(w), 0];
      // hips follow style changes and longer strides; shorter auto-gait steps keep their straighter reach
      const kr = Math.min(k, 1), dy = legReach(rot) - legReach(legCycle(w, 24 * kr, 52 * Math.sqrt(kr), 6));
      return { rot: withPosture(rot, s), hips: [0, -0.012 * k * (1 - Math.abs(Math.cos(w))) + dy, 0] };
    },
  },
  run: {
    label: "跑步", mask: "full", dur: 3, loop: true, params: { stride: 1.5, lean: 12, style: "normal", amp: 1 },
    ui: { stride: ["步幅", 0.8, 2.2, 0.05], lean: ["前傾角度", 0, 30, 1], style: ["風格", "choice", GAIT_STYLES], amp: ["動作幅度", ...AMP_RANGE, 0.05] },
    pose(lt, p, ctx) {
      const s = gaitStyle(p), g = ctx.gait, k = g ? g.run : 1, ka = Math.sqrt(k);
      const w = (g ? g.cycle : gaitPhase(lt, ctx, p.stride * s.stride, 1.4)) * TAU;
      const rot = legCycle(w, 42 * s.stride * k, 95 * s.knee * ka, 14);
      rot.lUpperArm = [48 * s.arm * ka * Math.sin(w), 0, 8];
      rot.rUpperArm = [-48 * s.arm * ka * Math.sin(w), 0, -8];
      rot.lForeArm = [-85 + s.elbow * 0.5, 0, 0];
      rot.rForeArm = [-85 + s.elbow * 0.5, 0, 0];
      rot.hips = [0, 9 * s.twist * Math.sin(w), 0];
      rot.spine = [p.lean, 0, 0];
      rot.chest = [0, -14 * s.twist * Math.sin(w), 0];
      rot.head = [-p.lean * 0.6, 0, 0];
      const kr = Math.min(k, 1), dy = legReach(rot) - legReach(legCycle(w, 42 * kr, 95 * Math.sqrt(kr), 14));
      return { rot: withPosture(rot, s), hips: [0, 0.017 * Math.abs(Math.sin(w)) - 0.022 + dy, 0] };
    },
  },
  sneak: {
    label: "潛行", mask: "full", dur: 4, loop: true, params: { stride: 0.55 }, ui: { stride: ["步幅", 0.3, 0.9, 0.05] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), c = gaitPhase(lt, ctx, p.stride, 0.6), w = c * TAU;
      const S = ctx.speed > 0.05 ? p.stride : 0, duty = 0.65;
      const sp = {
        rot: { hips: [14, 5 * Math.sin(w), 0], spine: [12, 0, 0], chest: [6, -6 * Math.sin(w), 0], neck: [-10, 0, 0], head: [-16, 0, 0] },
        hips: [0, -0.1 + 0.008 * Math.cos(2 * w), 0],
        lW: [0.09, -0.02, 0.17], rW: [-0.09, -0.02, 0.17], lP: [1, -0.5, -0.5], rP: [-1, -0.5, -0.5],
        lH: [0, 0.2, 1, -1, 0, 0], rH: [0, 0.2, 1, 1, 0, 0],
      };
      for (const [s, sg, off] of [["l", 1, 0], ["r", -1, 0.5]]) {
        const f = frac(c + off);
        let z, y = 0.04, pitch = 0;
        if (f < duty) z = S * duty * (0.5 - f / duty);
        else {
          const v = (f - duty) / (1 - duty);
          z = S * duty * (smooth(v) - 0.5);
          y += 0.05 * bump(v);
          pitch = 15 * bump(v);
        }
        sp[s + "A"] = [sg * (b.hw + 0.02), y, z];
        sp[s + "F"] = [pitch, sg * 6, 0];
      }
      return solve(sp, b);
    },
  },

  // ---------- seated / ground ----------
  sit: {
    label: "坐下", mask: "full", dur: 1.5, loop: false, params: { seat: 0.45 }, ui: { seat: ["座高（公尺）", 0.25, 0.75, 0.01] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / Math.min(0.8, 0.45 * ctx.duration));
      return solve(nudge(mix(stand(b), seated(b, p.seat, ctx.height), smooth(u)), SIT_LEAN, bump(u)), b);
    },
  },
  sitting: {
    label: "坐著", mask: "full", dur: 4, loop: true, params: { seat: 0.45, breathe: 1 },
    ui: { seat: ["座高（公尺）", 0.25, 0.75, 0.01], breathe: ["呼吸幅度", 0, 3, 0.1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx);
      const sp = nudge(seated(b, p.seat, ctx.height), BREATH, breath(lt) * p.breathe);
      sp.rot.head = add(sp.rot.head, [0, 4 * osc(lt, 0.11), 0]);
      return solve(sp, b);
    },
  },
  standUp: {
    label: "起身", mask: "full", dur: 1.6, loop: false, params: { seat: 0.45 }, ui: { seat: ["座高（公尺）", 0.25, 0.75, 0.01] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / Math.min(0.9, 0.5 * ctx.duration));
      return solve(nudge(mix(seated(b, p.seat, ctx.height), stand(b), smooth(u)), RISE_LEAN, bump(u ** 0.7)), b);
    },
  },
  crouch: {
    label: "蹲下", mask: "full", dur: 1.5, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = lt / Math.min(0.7, 0.45 * ctx.duration);
      return solve(mix(stand(b), crouchSpec(b), smooth(u)), b);
    },
  },
  kneel: {
    label: "跪下", mask: "full", dur: 1.8, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / Math.min(1, 0.55 * ctx.duration));
      const lunge = { ...stand(b), rot: { hips: [8, 0, 0], spine: [4, 0, 0], chest: [2, 0, 0], head: [4, 0, 0] }, hips: [0, -0.12, -0.14], lA: [b.hw + 0.03, 0.04, 0], rA: [-b.hw - 0.01, toeY(30), -0.32], rF: [30, 0, 0] };
      let sp = track([[0, stand(b)], [0.5, lunge], [1, kneelSpec(b)]], u);
      sp = nudge(sp, { rA: [0, u < 0.5 ? 0.04 : 0.025, 0] }, bump(u < 0.5 ? u / 0.5 : (u - 0.5) / 0.5));
      return solve(sp, b);
    },
  },
  lie: {
    label: "躺著", mask: "full", dur: 4, loop: true, params: { breathe: 1 }, ui: { breathe: ["呼吸幅度", 0, 3, 0.1] },
    pose(lt, p, ctx) {
      return lieSpec(bodyOf(ctx), breath(lt) * p.breathe);
    },
  },
  fall: {
    label: "跌倒", mask: "full", dur: 2, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / Math.min(1.2, 0.75 * ctx.duration));
      const keys = [
        [0, { rot: { chest: [-1, 0, 0], head: [1, 0, 0], lUpperArm: [2, 0, 6], rUpperArm: [2, 0, -6], lForeArm: [-8, 0, 0], rForeArm: [-8, 0, 0] }, hips: [0, 0, 0] }],
        [0.3, {
          rot: {
            hips: [-25, 0, 0], spine: [-5, 0, 0], chest: [5, 0, 0], neck: [15, 0, 0], head: [10, 0, 0],
            lThigh: [-45, 0, 4], rThigh: [-20, 0, -4], lShin: [15, 0, 0], rShin: [35, 0, 0], lFoot: [10, 0, 0], rFoot: [-10, 0, 0],
            lUpperArm: [-110, 0, 35], rUpperArm: [-110, 0, -35], lForeArm: [-30, 0, 0], rForeArm: [-30, 0, 0],
          },
          hips: [0, -0.08, -0.03],
        }],
        [0.6, {
          rot: {
            hips: [-50, 0, 0], spine: [10, 0, 0], chest: [10, 0, 0], neck: [20, 0, 0], head: [5, 0, 0],
            lThigh: [-55, 0, 6], rThigh: [-55, 0, -6], lShin: [10, 0, 0], rShin: [10, 0, 0], lFoot: [10, 0, 0], rFoot: [10, 0, 0],
            lUpperArm: [25, 0, 45], rUpperArm: [25, 0, -45], lForeArm: [-20, 0, 0], rForeArm: [-20, 0, 0],
          },
          hips: [0, -0.47, 0],
        }],
        [0.8, {
          rot: {
            hips: [-80, 0, 0], spine: [5, 0, 0], chest: [5, 0, 0], neck: [15, 0, 0],
            lThigh: [-30, 0, 5], rThigh: [-30, 0, -5], lShin: [20, 0, 0], rShin: [20, 0, 0], lFoot: [20, 0, 0], rFoot: [20, 0, 0],
            lUpperArm: [0, 0, 55], rUpperArm: [0, 0, -55], lForeArm: [-10, 0, 0], rForeArm: [-10, 0, 0],
          },
          hips: [0, -0.48, 0],
        }],
        [1, lieSpec(b)],
      ];
      const lin = (x) => clamp(x);
      const sp = track(keys, u, [easeIn, lin, lin, easeOut]);
      // feet then pelvis stay on the floor; the lying key carries its own contact
      const dy = -groundLow(sp.rot, sp.hips, b) * (1 - smooth((u - 0.8) / 0.2));
      return { rot: sp.rot, hips: add(sp.hips, [0, dy, 0]) };
    },
  },

  // ---------- full-body one-shots and loops ----------
  jump: {
    label: "跳躍", mask: "full", dur: 1.6, loop: false, params: { height: 0.4 }, ui: { height: ["跳躍高度（公尺）", 0.1, 1, 0.05] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), D = ctx.duration;
      const air = Math.min(2 * Math.sqrt((2 * p.height) / 9.81), 0.5 * D), R = D - air;
      const t1 = 0.3 * R, t2 = 0.42 * R, t3 = t2 + air, t4 = t3 + 0.13 * R, t5 = t4 + 0.3 * R;
      const st = stand(b), dip = jumpDip(b), ext = jumpExt(b);
      let sp;
      if (lt < t1) sp = mix(st, dip, smooth(lt / t1));
      else if (lt < t2) sp = mix(dip, ext, easeIn((lt - t1) / (t2 - t1)));
      else if (lt < t3) {
        const u = (lt - t2) / air, h = ((4 * p.height) / ctx.height) * u * (1 - u);
        sp = nudge(mix(ext, jumpTuck(b), bump(u)), { hips: [0, h, 0], lA: [0, h, 0], rA: [0, h, 0] });
      } else if (lt < t4) sp = mix(ext, dip, easeOut((lt - t3) / (t4 - t3)));
      else sp = mix(dip, st, smooth((lt - t4) / (t5 - t4)));
      return solve(sp, b);
    },
  },
  bow: {
    label: "鞠躬", mask: "full", dur: 2.5, loop: false, params: { angle: 45 }, ui: { angle: ["鞠躬角度", 10, 80, 1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), D = ctx.duration, a = p.angle;
      const w = smooth(lt / (0.32 * D)) - smooth((lt - 0.6 * D) / (0.32 * D));
      const d = { rot: { hips: [0.55 * a, 0, 0], spine: [0.25 * a, 0, 0], chest: [0.2 * a, 0, 0] }, hips: [0, -0.01 * a / 45, -0.06 * a / 45], lW: [0, 0, 0.04], rW: [0, 0, 0.04] };
      return solve(nudge(stand(b), d, w), b);
    },
  },
  punch: {
    label: "出拳", mask: "full", dur: 1, loop: true, params: { rate: 1 }, ui: { rate: ["每秒出拳次數", 0.5, 3, 0.1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), ph = frac(lt * p.rate);
      const e = smooth((ph - 0.12) / 0.14) - smooth((ph - 0.42) / 0.22);
      const yaw = -32 + 36 * e;
      return solve({
        rot: { hips: [4, -22 + 6 * e, 0], spine: [4, -4 + 10 * e, 0], chest: [4, -6 + 20 * e, 0], neck: [-2, -0.45 * yaw, 0], head: [-4, -0.55 * yaw, 0] },
        hips: [0, -0.03, 0], kOut: 0,
        lA: [b.hw + 0.035, 0.04, 0.11], rA: [-b.hw - 0.04, 0.04, -0.12], lF: [0, -12, 0], rF: [0, -40, 0],
        lW: [0.55 * b.s, 0.13, 0.14], rW: lerpV([-0.5 * b.s, 0.14, 0.12], [-0.02, 0.135, 0.31], e),
        lP: [0.3, -1, 0], rP: [-0.3, -1, -0.2],
        lH: [0, 0.7, 1, -1, 0, 0], rH: lerpV([0, 0.7, 1, 1, 0, 0], [0, 0.05, 1, 0, 1, 0], e),
      }, b);
    },
  },
  kick: {
    label: "踢", mask: "full", dur: 1.4, loop: false, params: { height: 0.9 }, ui: { height: ["踢腿高度（公尺）", 0.3, 1.4, 0.05] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / ctx.duration), ky = clamp(p.height / ctx.height, 0.15, 0.62);
      const st = stand(b);
      const guard = {
        ...st, rot: { hips: [-4, 0, 0], spine: [4, 0, 0], chest: [2, 0, 0], head: [2, 0, 0] }, hips: [0, -0.025, 0],
        lW: [0.55 * b.s, 0.12, 0.15], rW: [-0.55 * b.s, 0.12, 0.13], lP: [0.4, -1, 0], rP: [-0.4, -1, 0],
        lH: [0, 0.6, 1, -1, 0, 0], rH: [0, 0.6, 1, 1, 0, 0],
      };
      const chamber = { ...guard, rot: { ...guard.rot, hips: [-8, 0, 0] }, rA: [-b.hw, 0.6 * ky, 0.17], rF: [35, 0, 0] };
      const ext = { ...guard, rot: { hips: [-16, 0, 0], spine: [6, 0, 0], chest: [4, 0, 0], head: [4, 0, 0] }, hips: [0, -0.03, -0.035], rA: [-b.hw, ky, 0.45], rF: [-30, 0, 0] };
      const down = { ...guard, rA: [-b.hw - 0.017, 0.07, 0.04], rF: [10, -6, 0] };
      return solve(track([[0, st], [0.22, chamber], [0.38, ext], [0.5, ext], [0.64, chamber], [0.82, down], [1, st]], u), b);
    },
  },
  pickUp: {
    label: "撿起", mask: "full", dur: 2.4, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / ctx.duration), st = stand(b);
      const low = {
        ...st, rot: { hips: [40, 0, 0], spine: [22, 0, 0], chest: [12, 0, 0], neck: [-8, 0, 0], head: [-16, 0, 0] },
        hips: [0, -0.26, -0.13], kOut: 6, lA: [b.hw + 0.03, 0.04, 0], rA: [-b.hw - 0.03, 0.04, 0],
        lP: [0.6, 0, -1], rP: [-0.6, 0, -1], lH: [0, -1, 0.3, -1, 0, 0], rH: [0, -1, 0.3, 1, 0, 0],
      };
      low.lW = toChest(low, [0.07, 0.09, 0.2]);
      low.rW = toChest(low, [-0.07, 0.09, 0.2]);
      const hold = { ...st, lW: [0.11, -0.14, 0.2], rW: [-0.11, -0.14, 0.2], lP: [1, -0.6, -0.4], rP: [-1, -0.6, -0.4], lH: [0, -0.2, 1, -1, 0, 0], rH: [0, -0.2, 1, 1, 0, 0] };
      return solve(track([[0, st], [0.38, low], [0.55, low], [0.92, hold], [1, hold]], u), b);
    },
  },
  push: {
    label: "推", mask: "full", dur: 2, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), u = clamp(lt / ctx.duration), st = stand(b);
      const palm = (sg) => [0, 1, 0.15, sg * 0.2, 0, 1];
      const prep = {
        ...st, rot: { hips: [4, 0, 0], spine: [2, 0, 0], chest: [0, 0, 0], head: [1, 0, 0] }, hips: [0, -0.02, -0.03],
        rA: [-b.hw - 0.02, 0.04, -0.2], lW: [0.1, 0.06, 0.16], rW: [-0.1, 0.06, 0.16], lP: [0.8, -1, -0.3], rP: [-0.8, -1, -0.3], lH: palm(1), rH: palm(-1),
      };
      const shove = {
        ...prep, rot: { hips: [8, 0, 0], spine: [8, 0, 0], chest: [4, 0, 0], neck: [-4, 0, 0], head: [-6, 0, 0] }, hips: [0, -0.035, 0.04],
        rA: [-b.hw - 0.02, toeY(30), -0.3], rF: [30, 0, 0], lW: [0.1, 0.06, 0.31], rW: [-0.1, 0.06, 0.31],
      };
      let sp = track([[0, st], [0.25, prep], [0.5, shove], [1, shove]], u);
      if (u < 0.25) sp = nudge(sp, { rA: [0, 0.035, 0] }, bump(u / 0.25));
      return solve(sp, b);
    },
  },
  dance: {
    label: "跳舞", mask: "full", dur: 4.4, loop: true, params: { bpm: 110 }, ui: { bpm: ["節拍（BPM）", 60, 160, 1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), beat = (lt * p.bpm) / 60;
      const sw = Math.sin(Math.PI * beat), dip = 0.5 + 0.5 * Math.cos(TAU * beat);
      const a = smooth(0.5 + 1.5 * Math.sin((Math.PI * beat) / 2)); // 1: right arm up-right, 0: down-left
      return solve({
        rot: { hips: [4, 8 * (a - 0.5), 6 * sw], spine: [2, 0, -3 * sw], chest: [0, 6 * (a - 0.5), -3 * sw], neck: [0, 0, 1.5 * sw], head: [6 * dip - 3, -10 * (a - 0.5), 2 * sw] },
        hips: [0.035 * sw, -0.035 - 0.025 * dip, 0], kOut: 8,
        lA: [b.hw + 0.06, 0.04, 0], rA: [-b.hw - 0.06, 0.04, 0], lF: [0, 15, 0], rF: [0, -15, 0],
        lW: [b.s + 0.015, -0.13, 0.0], lP: [1, 0.3, -0.4], lH: [0.2, -0.7, 0.6, -1, 0, 0],
        rW: lerpV([0.1, -0.2, 0.2], [-0.3, 0.42, 0.1], a), rP: [-0.5, -1, -0.5], rH: lerpV([0.4, -1, 0.3, 0, 0, 1], [-0.5, 0.8, 0.2, 0, 0, 1], a),
      }, b);
    },
  },
  cheer: {
    label: "歡呼", mask: "full", dur: 2, loop: true, params: { rate: 2 }, ui: { rate: ["彈跳頻率", 1, 3, 0.1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), k = 0.5 - 0.5 * Math.cos(lt * p.rate * TAU);
      return solve({
        ...stand(b), rot: { hips: [-2, 0, 0], chest: [-5, 0, 0], neck: [-4, 0, 0], head: [-10, 0, 0] }, hips: [0, -0.03 * k, 0],
        lW: [b.s + 0.13, 0.36 - 0.1 * k, 0.05], rW: [-b.s - 0.13, 0.36 - 0.1 * k, 0.05], lP: [1, 0, -0.3], rP: [-1, 0, -0.3],
        lH: [0.2, 1, 0, 0, 0, 1], rH: [-0.2, 1, 0, 0, 0, 1],
      }, b);
    },
  },

  // ---------- upper body (layerable) ----------
  wave: {
    label: "揮手", mask: "upper", dur: 2, loop: true, params: { rate: 2 }, ui: { rate: ["揮動頻率", 0.5, 4, 0.1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), w = Math.sin(lt * p.rate * TAU);
      return solve({
        ...upHang(b), rot: { chest: [-1, 0, 2], neck: [0, 0, -2], head: [0, -4, -3] },
        rW: [-b.s - 0.14 - 0.06 * w, 0.36, 0.06], rP: [-1, -0.6, -0.3], rH: [-0.25 * w, 1, 0.1, 0, 0, 1],
      }, b);
    },
  },
  point: {
    label: "指向", mask: "upper", dur: 2, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx);
      const aim = { rot: { chest: [-1, -8, 0], neck: [0, -4, 0], head: [-2, -6, 0] }, rW: [-0.06, 0.17, 0.32], rP: [-0.4, -1, -0.2], rH: [0, 0.1, 1, 1, 0, 0] };
      return solve(raise(lt, ctx, b, aim, 0.5), b);
    },
  },
  talk: {
    label: "說話手勢", mask: "upper", dur: 4, loop: true, params: { energy: 1 }, ui: { energy: ["手勢幅度", 0, 2, 0.1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), e = p.energy;
      const a1 = 0.6 * osc(lt, 0.9) + 0.4 * osc(lt, 1.7, 0.3), a2 = 0.6 * osc(lt, 0.7, 0.5) + 0.4 * osc(lt, 1.3, 0.1);
      return solve({
        rot: { chest: [-1, 4 * e * osc(lt, 0.35), 0], neck: [2 * osc(lt, 1.1), 0, 0], head: [3 * e * osc(lt, 1.6), 6 * osc(lt, 0.3), 2 * osc(lt, 0.45)] },
        lW: [0.08 + 0.03 * e * a2, -0.09 + 0.05 * e * a1, 0.2 + 0.03 * e * a2], rW: [-0.17 - 0.04 * e * a1, 0.06 * e * a2, 0.2 + 0.04 * e * a1],
        lP: [0.4, -1, -0.5], rP: [-0.6, -1, -0.4], lH: [0.3, 0.1, 1, -0.3, 1, 0], rH: [-0.5, 0.2, 1, 0.3, 1, 0],
      }, b);
    },
  },
  phone: {
    label: "講電話", mask: "upper", dur: 3, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), rot = { chest: [-1, 0, 0], neck: [0, 0, 6], head: [1 + 2 * osc(lt, 0.6), 0, 8] };
      const ear = headPt(rot, [-0.85 * b.hr, 0.95 * b.hr, 0]);
      const tgt = { rot, rW: add(ear, [-0.025, -0.075, 0.03]), rP: [-0.4, -1, 0.3], rH: [0, 1, 0.15, 1, 0, 0] };
      return solve(raise(lt, ctx, b, tgt, 0.5, { rW: [-0.06, 0, 0.1] }), b);
    },
  },
  clap: {
    label: "拍手", mask: "upper", dur: 2, loop: true, params: { rate: 2.5 }, ui: { rate: ["每秒拍手次數", 1, 5, 0.1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), gap = 0.06 * Math.pow(Math.sin(Math.PI * frac(lt * p.rate)), 0.8);
      return solve({
        rot: { chest: [-1, 0, 0], head: [2, 0, 0] },
        lW: [0.02 + gap, 0.05, 0.24], rW: [-0.02 - gap, 0.05, 0.24], lP: [1, -1, -0.3], rP: [-1, -1, -0.3],
        lH: [0, 0.6, 1, -1, 0, 0], rH: [0, 0.6, 1, 1, 0, 0],
      }, b);
    },
  },
  lookAround: {
    label: "張望", mask: "upper", dur: 4, loop: true, params: { period: 4 }, ui: { period: ["來回秒數", 2, 8, 0.5] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), s = Math.tanh(2.5 * Math.sin((lt / p.period) * TAU)) / Math.tanh(2.5);
      return solve({ ...upHang(b), rot: { chest: [-1, 20 * s, 0], neck: [0, 15 * s, 0], head: [1 + 4 * osc(lt, 0.5), 25 * s, 0] } }, b);
    },
  },
  armsCrossed: {
    label: "雙手抱胸", mask: "upper", dur: 3, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), br = breath(lt);
      const tgt = {
        rot: { chest: [-2 + br, 0, 0], head: [0 - 0.5 * br, 0, 0] },
        lW: [-0.11, -0.01, 0.12], rW: [0.11, 0.02, 0.15], lP: [1, -0.6, 0.4], rP: [-1, -0.6, 0.4],
        lH: [-0.5, 0.2, -1, 1, 0, 0], rH: [0.5, 0.2, -1, -1, 0, 0],
      };
      return solve(raise(lt, ctx, b, tgt, 0.6, { lW: [0, 0, 0.1], rW: [0, 0, 0.12] }), b);
    },
  },
  handsUp: {
    label: "舉手投降", mask: "upper", dur: 3, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), jit = 0.004 * osc(lt, 5);
      const tgt = {
        rot: { chest: [-3, 0, 0], head: [-2, 0, 0] },
        lW: [b.s + 0.12, 0.27 + jit, 0.03], rW: [-b.s - 0.12, 0.27 - jit, 0.03], lP: [1, -0.4, -0.2], rP: [-1, -0.4, -0.2],
        lH: [0, 1, 0, 0, 0, 1], rH: [0, 1, 0, 0, 0, 1],
      };
      return solve(raise(lt, ctx, b, tgt), b);
    },
  },
  drink: {
    label: "喝東西", mask: "upper", dur: 4, loop: true, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), c = lt % 4;
      const k = smooth((c - 1) / 0.7) - smooth((c - 2.7) / 0.7);
      const rot = { chest: [-1 - 2 * k, 0, 0], neck: [-4 * k, 0, 0], head: [1 - 10 * k, 0, 0] };
      const mouth = headPt(rot, [0, 0.5 * b.hr, 0.85 * b.hr]);
      return solve({
        ...upHang(b), rot,
        rW: lerpV([-0.11, -0.07, 0.14], add(mouth, [-0.02, -0.075, 0.05]), k), rP: [-0.2, -1, -0.5],
        rH: lerpV([0.4, 0, 1, 0, 1, 0], [0.5, 0.6, 0.6, 0.3, 1, -0.4], k),
      }, b);
    },
  },
  carry: {
    label: "抱物", mask: "upper", dur: 3, loop: false, params: { ready: 0 }, ui: { ready: ["一開始就抱著（1）", 0, 1, 1] },
    pose(lt, p, ctx) {
      const b = bodyOf(ctx);
      if (p.ready >= 0.5) return solve(carryTarget(), b);
      return solve(raise(lt, ctx, b, carryTarget(), 0.5, { lW: [0.04, 0, 0.06], rW: [-0.04, 0, 0.06] }), b);
    },
  },
  think: {
    label: "思考", mask: "upper", dur: 3, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), rot = { chest: [2, 0, 0], neck: [4, 0, 3], head: [8 + osc(lt, 0.3), -5, 6] };
      const chin = headPt(rot, [0, 0.05 * b.hr, 0.6 * b.hr]);
      const tgt = {
        rot, rW: add(chin, [-0.005, -0.07, 0.03]), rP: [-0.1, -1, 0.9], rH: [0, 1, 0.3, 1, 0, 0],
        lW: [-0.06, -0.08, 0.15], lP: [1, -1, 0], lH: [-0.6, 0.6, 0.3, 0, 0, 1],
      };
      return solve(raise(lt, ctx, b, tgt, 0.6, { rW: [-0.03, 0, 0.08], lW: [0, 0, 0.08] }), b);
    },
  },
  shrug: {
    label: "聳肩", mask: "upper", dur: 1.2, loop: false, params: {}, ui: {},
    pose(lt, p, ctx) {
      const b = bodyOf(ctx), D = ctx.duration;
      const w = smooth(lt / (0.3 * D)) - smooth((lt - 0.6 * D) / (0.35 * D));
      const tgt = {
        rot: { chest: [-4, 0, 0], neck: [6, 0, 0], head: [-2, 0, 10] },
        lW: [b.s + 0.16, -0.04, 0.09], rW: [-b.s - 0.16, -0.04, 0.09], lP: [0.2, -1, -0.6], rP: [-0.2, -1, -0.6],
        lH: [0.6, 0.1, 1, 0, 1, 0], rH: [-0.6, 0.1, 1, 0, 1, 0],
      };
      return solve(mix(upHang(b), tgt, w), b);
    },
  },
};

// Building blocks for the add-on action files (actions-daily.js, actions-pair.js); merged in actions.js
export {
  TAU, D2R, R2D, Z3, LEG, UA, FA, clamp, smooth, easeIn, easeOut, bump, osc, frac, add, sub, scl, dot, len, nrm, cross, lerpV,
  mat, mul, tr, app, euler, toeY, bodyOf, solve, toChest, headPt, mix, nudge, track, upHang, stand, seated, crouchSpec,
  BREATH, breath, gaitPhase, legCycle, raise, HANG_H, hangW, SIT_LEAN, RISE_LEAN, carryTarget,
};
