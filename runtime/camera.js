// Virtual camera evaluation and camera move presets.
// Lens is a focal length in mm on a 36 mm full-frame sensor (long side of the frame = 36 mm).
import * as THREE from "three";
import { buildPath, samplePath, sampleKeys } from "./keys.js";

const D2R = Math.PI / 180;

export function lensToFov(mm, aspect) {
  const half = Math.atan(18 / Math.max(1, mm));
  // three.js wants the vertical fov: derive it from the long side
  return (aspect >= 1 ? 2 * Math.atan(Math.tan(half) / aspect) : 2 * half) / D2R;
}

/** Inverse of lensToFov: focal length (mm) that gives this vertical fov (degrees) */
export function fovToLens(vfov, aspect) {
  const tv = Math.tan((vfov * D2R) / 2);
  return 18 / (aspect >= 1 ? tv * aspect : tv);
}

// deterministic handheld wobble: sum of sines with unrelated frequencies
function wobble(t, seed) {
  return Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 3.1 + seed * 2.3) * 0.3 + Math.sin(t * 7.3 + seed * 4.1) * 0.2;
}
// same idea at vibration speed
const buzz = (t, seed, f = 1) => Math.sin(t * 23 * f + seed) * 0.5 + Math.sin(t * 41 * f + seed * 2.1) * 0.3 + Math.sin(t * 67 * f + seed * 3.3) * 0.2;
const TAU = Math.PI * 2;

// Shake patterns (labels in schema SHAKE_STYLES). Per unit of cam.shake they return
// [pitch, yaw, roll] in degrees followed by a world position offset [x, y, z] in metres.
const SHAKE = {
  handheld: (t) => [wobble(t, 1.3) * 1.1, wobble(t, 4.7) * 1.4, wobble(t, 9.1) * 0.8, wobble(t, 2.2) * 0.015, wobble(t, 5.5) * 0.015, wobble(t, 7.7) * 0.015],
  // about 1.8 steps per second: a bob on every step, sway and roll on every stride
  walk: (t) => {
    const w = t * TAU * 0.9;
    return [Math.sin(w * 2) * 0.45 + wobble(t, 1.3) * 0.3, Math.sin(w) * 0.5 + wobble(t, 4.7) * 0.4, Math.sin(w) * 1.1, Math.sin(w) * 0.012, (Math.abs(Math.sin(w)) - 0.64) * 0.035, 0];
  },
  breathe: (t) => {
    const b = Math.sin(t * TAU * 0.25);
    return [b * 0.35 + wobble(t * 0.4, 1.3) * 0.15, wobble(t * 0.35, 4.7) * 0.3, wobble(t * 0.3, 9.1) * 0.15, 0, b * 0.006, 0];
  },
  vehicle: (t) => [buzz(t, 1) * 0.35 + wobble(t * 0.6, 1.3) * 0.4, buzz(t, 2) * 0.2 + wobble(t * 0.5, 4.7) * 0.5, buzz(t, 3) * 0.3, buzz(t, 4) * 0.002, buzz(t, 5) * 0.006, 0],
  // strong fast shaking whose strength surges and fades irregularly
  impact: (t) => {
    const env = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * wobble(t * 0.8, 3.3), 3);
    return [buzz(t, 1, 0.8) * 3 * env, buzz(t, 2, 0.8) * 3 * env, buzz(t, 3, 0.8) * 2 * env, buzz(t, 4, 0.8) * 0.03 * env, buzz(t, 5, 0.8) * 0.04 * env, buzz(t, 6, 0.8) * 0.02 * env];
  },
};

/**
 * Evaluate a camera at time t.
 * getActor(id) returns { pos: Vector3, yaw: degrees, aimPoint: Vector3 } of an evaluated actor, or null.
 * cache: a per-camera object that keeps the built paths between calls (keyed by their JSON, so in-place edits are seen).
 * Returns { position, target, lens, roll, fov, shake, shakeStyle, dof } (THREE.Vector3 values).
 */
export function evalCamera(cam, t, aspect, getActor, cache = {}) {
  const pk = JSON.stringify(cam.path);
  if (cache.pk !== pk) { cache.path = buildPath(cam.path.keys, cam.path.curve); cache.pk = pk; }
  const position = new THREE.Vector3();
  const host = cam.mount && getActor(cam.mount.actor);
  if (host) {
    const off = new THREE.Vector3(...cam.mount.offset);
    if (cam.mount.rotate) off.applyAxisAngle(new THREE.Vector3(0, 1, 0), host.yaw * D2R);
    position.copy(host.pos).add(off);
  } else {
    position.fromArray(samplePath(cache.path, t).pos);
  }
  let target;
  if (cam.aim.mode === "actor") {
    const a = getActor(cam.aim.actor);
    target = a ? (cam.aim.offset ? a.pos.clone().add(new THREE.Vector3(...cam.aim.offset)) : a.aimPoint.clone()) : new THREE.Vector3(0, 1, 0);
  } else {
    const ak = JSON.stringify(cam.aim);
    if (cache.ak !== ak) { cache.aim = buildPath(cam.aim.keys, cam.aim.curve); cache.ak = ak; }
    target = new THREE.Vector3().fromArray(samplePath(cache.aim, t).pos);
  }
  if (target.distanceToSquared(position) < 1e-6) target.z -= 1;
  const lens = sampleKeys(cam.lens, t, 35);
  const roll = sampleKeys(cam.roll, t, 0);
  return { position, target, lens, roll, fov: lensToFov(lens, aspect), shake: cam.shake || 0, shakeStyle: cam.shakeStyle || "handheld", dof: cam.dof || null };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Apply an evaluated state to a THREE.PerspectiveCamera */
export function applyCameraState(camera, st, t = 0) {
  camera.position.copy(st.position);
  _m.lookAt(st.position, st.target, camera.up.set(0, 1, 0));
  camera.quaternion.setFromRotationMatrix(_m);
  const s = st.shake, k = s ? (SHAKE[st.shakeStyle] || SHAKE.handheld)(t) : null;
  _e.set(s ? k[0] * s * D2R : 0, s ? k[1] * s * D2R : 0, (st.roll + (s ? k[2] * s : 0)) * D2R);
  camera.quaternion.multiply(_q.setFromEuler(_e));
  if (s) camera.position.add(new THREE.Vector3(k[3], k[4], k[5]).multiplyScalar(s));
  camera.fov = st.fov;
  camera.updateProjectionMatrix();
}

/** Which camera is live at time t according to the cut list */
/** The cut in effect at time t (the last one at or before t), or null. */
export function cutAt(project, t) {
  let cut = null;
  for (const c of project.cuts) if (c.t <= t + 1e-9) cut = c;
  return cut;
}

export function liveCameraId(project, t) {
  let id = project.cuts.length ? project.cuts[0].camera : project.cameras[0]?.id;
  for (const c of project.cuts) if (c.t <= t + 1e-9) id = c.camera;
  return project.cameras.some((c) => c.id === id) ? id : project.cameras[0]?.id;
}

// ---------- move presets ----------
// Each returns the camera fields to merge: { path, aim, lens, roll, shake, mount }, plus an optional warn message.
// ctx: { subject: [x,y,z] point to look at, actor: id or null, start, dur, from: [x,y,z] current camera position,
//        lens: current focal length, props: [[x,y,z], ...] prop positions at start (foreground candidates) }
const r3 = (v) => v.map((x) => Math.round(x * 100) / 100);
function rel(ctx) {
  const s = new THREE.Vector3(...ctx.subject), f = new THREE.Vector3(...ctx.from);
  const flat = f.clone().sub(s).setY(0);
  if (flat.lengthSq() < 0.01) flat.set(0, 0, 1);
  const dist = Math.max(1.5, flat.length());
  const dir = flat.normalize(), side = new THREE.Vector3(dir.z, 0, -dir.x);
  return { s, f, dir, side, dist, h: f.y };
}
const keys2 = (ctx, a, b, e = "inOut") => [{ t: ctx.start, v: r3(a), e }, { t: ctx.start + ctx.dur, v: r3(b), e: "linear" }];
const tk = (t) => Math.round(t * 1000) / 1000;
const UP = new THREE.Vector3(0, 1, 0);
const aimOf = (ctx, pts) => (ctx.actor ? { mode: "actor", actor: ctx.actor, offset: null } : { mode: "point", curve: "smooth", keys: pts || [{ t: ctx.start, v: r3(ctx.subject) }] });

export const CAMERA_MOVES = {
  static: { label: "固定機位", build: (c) => { const { f } = rel(c); return { path: { curve: "smooth", keys: [{ t: c.start, v: r3(f.toArray()) }] }, aim: aimOf(c), mount: null }; } },
  dollyIn: { label: "推軌（推近）", build: (c) => { const { s, f, dir, dist } = rel(c); const end = s.clone().addScaledVector(dir, dist * 0.45).setY(f.y); return { path: { curve: "smooth", keys: keys2(c, f.toArray(), end.toArray()) }, aim: aimOf(c), mount: null }; } },
  dollyOut: { label: "拉軌（拉遠）", build: (c) => { const { s, f, dir, dist } = rel(c); const end = s.clone().addScaledVector(dir, dist * 1.9).setY(f.y + 0.4); return { path: { curve: "smooth", keys: keys2(c, f.toArray(), end.toArray()) }, aim: aimOf(c), mount: null }; } },
  truck: {
    label: "橫移", build: (c) => {
      const { s, f, side } = rel(c); const w = 2.5;
      const a = f.clone().addScaledVector(side, -w), b = f.clone().addScaledVector(side, w);
      return { path: { curve: "smooth", keys: keys2(c, a.toArray(), b.toArray(), "linear") }, aim: c.actor ? aimOf(c) : { mode: "point", curve: "smooth", keys: keys2(c, s.clone().addScaledVector(side, -w).toArray(), s.clone().addScaledVector(side, w).toArray(), "linear") }, mount: null };
    },
  },
  pan: {
    label: "搖鏡（水平）", build: (c) => {
      const { s, f } = rel(c); const v = s.clone().sub(f); const ang = 35 * D2R;
      const a = f.clone().add(v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang)), b = f.clone().add(v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -ang));
      return { path: { curve: "smooth", keys: [{ t: c.start, v: r3(f.toArray()) }] }, aim: { mode: "point", curve: "smooth", keys: keys2(c, a.toArray(), b.toArray()) }, mount: null };
    },
  },
  tilt: {
    label: "搖鏡（仰俯）", build: (c) => {
      const { s, f } = rel(c);
      return { path: { curve: "smooth", keys: [{ t: c.start, v: r3(f.toArray()) }] }, aim: { mode: "point", curve: "smooth", keys: keys2(c, [s.x, 0.1, s.z], [s.x, Math.max(2.5, s.y + 1.6), s.z]) }, mount: null };
    },
  },
  orbit: {
    label: "環繞", build: (c) => {
      const { s, dir, dist, h } = rel(c); const n = 6, sweep = 180 * D2R, keys = [];
      for (let i = 0; i <= n; i++) {
        const p = s.clone().add(dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (sweep * i) / n).multiplyScalar(dist)).setY(h);
        keys.push({ t: Math.round((c.start + (c.dur * i) / n) * 1000) / 1000, v: r3(p.toArray()), e: i === 0 ? "in" : i === n - 1 ? "out" : "linear" });
      }
      return { path: { curve: "smooth", keys }, aim: aimOf(c), mount: null };
    },
  },
  crane: {
    label: "升降（升起）", build: (c) => {
      const { f } = rel(c);
      return { path: { curve: "smooth", keys: keys2(c, [f.x, 0.6, f.z], [f.x, 4.5, f.z]) }, aim: aimOf(c), mount: null };
    },
  },
  follow: {
    label: "跟拍（背後）", needsActor: true, build: (c) => ({ mount: { actor: c.actor, offset: [0, 1.7, -3.2], rotate: true }, aim: { mode: "actor", actor: c.actor, offset: null } }),
  },
  sideTrack: {
    label: "跟拍（側面）", needsActor: true, build: (c) => ({ mount: { actor: c.actor, offset: [3.5, 1.4, 0], rotate: true }, aim: { mode: "actor", actor: c.actor, offset: null } }),
  },
  handheld: { label: "手持晃動", build: (c) => ({ ...CAMERA_MOVES.static.build(c), shake: 0.6 }) },
  dollyZoom: {
    label: "希區考克變焦", build: (c) => {
      // keeping lens / distance constant keeps the subject size while the background stretches
      const { s, f, dir, dist } = rel(c); const f0 = 24, f1 = 70;
      const a = s.clone().addScaledVector(dir, dist).setY(f.y), b = s.clone().addScaledVector(dir, (dist * f1) / f0).setY(f.y);
      return { path: { curve: "linear", keys: keys2(c, a.toArray(), b.toArray(), "linear") }, aim: aimOf(c), lens: [{ t: c.start, v: f0, e: "linear" }, { t: c.start + c.dur, v: f1, e: "linear" }], mount: null };
    },
  },
  topDown: { label: "鳥瞰", build: (c) => { const { s, dir } = rel(c); return { path: { curve: "smooth", keys: [{ t: c.start, v: r3(s.clone().addScaledVector(dir, 0.5).setY(9).toArray()) }] }, aim: aimOf(c), mount: null }; } },
  lowAngle: { label: "低角度仰拍", build: (c) => { const { s, dir, dist } = rel(c); return { path: { curve: "smooth", keys: [{ t: c.start, v: r3(s.clone().addScaledVector(dir, Math.min(dist, 3)).setY(0.35).toArray()) }] }, aim: aimOf(c), mount: null }; } },
  whipPan: {
    label: "甩鏡", build: (c) => {
      // hold on the subject, then swing 90 degrees in the last 0.35 s (or 30% of a short move)
      const { s, f } = rel(c), v = s.clone().sub(f), w = Math.min(0.35, c.dur * 0.3), t1 = c.start + c.dur;
      const at = (deg) => r3(f.clone().add(v.clone().applyAxisAngle(UP, -deg * D2R)).toArray());
      return {
        path: { curve: "smooth", keys: [{ t: c.start, v: r3(f.toArray()) }] }, mount: null,
        aim: { mode: "point", curve: "smooth", keys: [{ t: c.start, v: at(0), e: "linear" }, { t: tk(t1 - w), v: at(0), e: "in" }, { t: tk(t1 - w / 2), v: at(45), e: "out" }, { t: tk(t1), v: at(90), e: "linear" }] },
      };
    },
  },
  dutch: { label: "荷蘭角（傾斜）", build: (c) => ({ ...CAMERA_MOVES.static.build(c), roll: 18 }) },
  spiralUp: {
    label: "螺旋上升", build: (c) => {
      const { s, dir, dist, h } = rel(c); const n = 8, sweep = 270 * D2R, rise = 3.2, keys = [];
      for (let i = 0; i <= n; i++) {
        const p = s.clone().add(dir.clone().applyAxisAngle(UP, (sweep * i) / n).multiplyScalar(dist)).setY(h + (rise * i) / n);
        keys.push({ t: tk(c.start + (c.dur * i) / n), v: r3(p.toArray()), e: i === 0 ? "in" : i === n - 1 ? "out" : "linear" });
      }
      return { path: { curve: "smooth", keys }, aim: aimOf(c), mount: null };
    },
  },
  foregroundPass: {
    label: "穿越前景", build: (c) => {
      // slide sideways just behind the prop nearest the camera-to-subject line, so it wipes across the frame
      const { s, f, dir, side, dist } = rel(c);
      let best = null, bestOff = Infinity;
      for (const q of c.props || []) {
        const d = new THREE.Vector3(q[0] - s.x, 0, q[2] - s.z), along = d.dot(dir), off = d.dot(side);
        if (along < 1 || along > dist + 2 || Math.abs(off) >= Math.abs(bestOff)) continue;
        bestOff = off; best = along;
      }
      const w = 1.6;
      const slide = (base) => keys2(c, base.clone().addScaledVector(side, -w).toArray(), base.clone().addScaledVector(side, w).toArray(), "linear");
      if (best == null || Math.abs(bestOff) > 3) {
        const base = s.clone().addScaledVector(dir, Math.min(dist, 3.5)).setY(0.6);
        return { path: { curve: "smooth", keys: slide(base) }, aim: aimOf(c), mount: null, warn: "鏡頭和主體之間找不到物品當前景，改成低角度橫移" };
      }
      const base = s.clone().addScaledVector(dir, best + 0.9).addScaledVector(side, bestOff).setY(Math.min(f.y, 1.3));
      return { path: { curve: "smooth", keys: slide(base) }, aim: aimOf(c), mount: null };
    },
  },
  pushZoom: {
    label: "推軌加變焦", build: (c) => {
      const { s, f, dir, dist } = rel(c), l0 = Math.round(c.lens || 35), l1 = Math.round(Math.min(300, l0 * 1.6));
      const end = s.clone().addScaledVector(dir, dist * 0.7).setY(f.y);
      return { path: { curve: "smooth", keys: keys2(c, f.toArray(), end.toArray()) }, aim: aimOf(c), lens: [{ t: c.start, v: l0, e: "inOut" }, { t: tk(c.start + c.dur), v: l1, e: "linear" }], mount: null };
    },
  },
};

export const LENS_PRESETS = [14, 18, 24, 35, 50, 85, 135];
