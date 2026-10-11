// Camera and cut edits that need more than a field change: live-cut takes, recorded camera moves, auto framing, shot-size labels.
import * as THREE from "three";
import { liveCameraId } from "../runtime/camera.js";
import { shotSizeAt, axisCheck, frameLimit, SHOT_SIZES } from "../runtime/shotcheck.js";
import { simplifyTrack } from "../runtime/keys.js";
import { putKey } from "./ops.js";
import { round, toast, fmt } from "./ui.js";

let S, RT;
export function initCameraOps(store, rt) { S = store; RT = rt; }

const r3 = (t) => round(t, 3);
const D2R = Math.PI / 180;

/**
 * Replace the cuts in [t0, t1) with a live-cut take. events: [{ t, camera }] in time order, the first at t0.
 * After t1 the old edit carries on: when the take ends on another camera, a cut back to it is added at t1.
 */
export function commitLiveCut(t0, t1, events) {
  if (t1 - t0 < 0.05) { toast("錄製時間太短，剪接沒有改動", "warn"); return; }
  const before = S.project, restore = liveCameraId(before, t1);
  let added = 0;
  S.edit("導播錄製", (p) => {
    const eps = 0.5 / p.settings.fps;
    const kept = p.cuts.filter((c) => c.t < t0 - 1e-6 || c.t >= t1 - 1e-6);
    // two presses on the same frame: the later one wins
    const take = [];
    for (const e of events) {
      if (e.t >= t1) break;
      if (take.length && e.t - take[take.length - 1].t < eps) take.pop();
      take.push({ t: r3(e.t), camera: e.camera });
    }
    const lastCam = take[take.length - 1]?.camera;
    if (restore && lastCam !== restore && t1 < p.settings.duration - eps && !kept.some((c) => Math.abs(c.t - t1) < eps)) take.push({ t: r3(t1), camera: restore });
    const all = [...kept, ...take].sort((a, b) => a.t - b.t);
    p.cuts = all.filter((c, k) => k === 0 || all[k - 1].camera !== c.camera || c.note);
    if (p.cuts.length) p.cuts[0] = { ...p.cuts[0], t: 0 };
    added = p.cuts.filter((c) => c.t >= t0 - 1e-6 && c.t <= t1 + 1e-6).length;
  });
  toast(`導播錄製完成：${fmt(t0)} 到 ${fmt(t1)} 秒，寫入 ${added} 個剪接點（Ctrl+Z 可復原）`);
}

// shot size -> body level at the bottom edge of the frame (0 feet, 1 head top) and headroom as a share of the frame height
export const FRAME_SIZES = {
  全景: { b: -0.08, head: 0.1 },
  中遠景: { b: 0.3, head: 0.08 },
  中景: { b: 0.5, head: 0.07 },
  中近景: { b: 0.68, head: 0.06 },
  特寫: { b: 0.8, head: 0.05 },
  大特寫: { b: 0.88, head: -0.02 },
};

/**
 * Auto framing (c03 / c04): keep the camera's direction to the subject and lens, move it level to the distance and height
 * that give the shot size at time t (path key at t). One actor: aim follows the actor. Several: aim at the group centre.
 */
export function frameShot(camId, actorIds, size, t = S.time) {
  const P = S.project, cam = P.cameras.find((c) => c.id === camId), F = FRAME_SIZES[size];
  RT.sync(P);
  RT.evaluate(t);
  const ents = actorIds.map((id) => RT.entities.get(id)).filter((e) => e?.rig);
  if (!cam || !F || !ents.length) { RT.evaluate(S.time); toast("先選攝影機和至少一個角色", "warn"); return; }
  const set = P.settings, aspect = set.width / set.height;
  const st = RT.cameraState(camId, t, aspect);
  const feet = ents.map((e) => RT.actorState.get(e.id).pos.clone());
  RT.evaluate(S.time);
  const H = Math.max(...ents.map((e) => e.height)), floor = Math.min(...feet.map((f) => f.y));
  const centre = feet.reduce((acc, f) => acc.add(f), new THREE.Vector3()).multiplyScalar(1 / feet.length);
  const dir = new THREE.Vector3(st.position.x - centre.x, 0, st.position.z - centre.z);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  // spread across the view, measured on the axis perpendicular to the camera direction
  const side = new THREE.Vector3(dir.z, 0, -dir.x), xs = feet.map((f) => f.clone().sub(centre).dot(side));
  const W = Math.max(...xs) - Math.min(...xs);
  centre.addScaledVector(side, (Math.max(...xs) + Math.min(...xs)) / 2);
  const tv = Math.tan((st.fov * D2R) / 2) * frameLimit(set), th = Math.tan((st.fov * D2R) / 2) * aspect;
  const V = ((1 - F.b) * H) / (1 - F.head);
  let D = V / (2 * tv);
  if (ents.length > 1) D = Math.max(D, (W + 0.6) / (2 * th * 0.9));
  D = Math.max(0.3, D);
  const y = floor + F.b * H + V / 2;
  const pos = centre.clone().addScaledVector(dir, D).setY(y).toArray().map(r3);
  S.edit("自動構圖", (p) => {
    const c = p.cameras.find((x) => x.id === camId), eps = 0.5 / p.settings.fps;
    const keys = c.path.keys.map((k) => ({ ...k }));
    putKey(keys, t, pos, eps);
    c.path = { ...c.path, keys };
    if (ents.length === 1) c.aim = { mode: "actor", actor: ents[0].id, offset: [0, r3(y - feet[0].y), 0] };
    else {
      const v = [r3(centre.x), r3(y), r3(centre.z)];
      const ak = c.aim.mode === "point" ? c.aim.keys.map((k) => ({ ...k })) : [];
      putKey(ak, t, v, eps);
      c.aim = { mode: "point", curve: c.aim.curve || "smooth", keys: ak };
    }
    c.mount = null;
  });
  toast(`自動構圖：${size}，距離 ${fmt(D)} 公尺、高度 ${fmt(y)} 公尺，在 ${fmt(t)} 秒加關鍵影格`);
}

const LABEL_RE = new RegExp(`^【(${SHOT_SIZES.join("|")})】`);

/** c05: judge each shot's size at its midpoint and write it at the start of the cut note, e.g. 【中景】 */
export function labelShots() {
  const P = S.project, cuts = P.cuts;
  if (!cuts.length) { toast("還沒有剪接點", "warn"); return; }
  RT.sync(P);
  const sizes = cuts.map((c, i) => {
    const tm = (c.t + (cuts[i + 1]?.t ?? P.settings.duration)) / 2;
    RT.evaluate(tm);
    return shotSizeAt(RT, c.camera, tm).size;
  });
  RT.evaluate(S.time);
  S.edit("自動標示景別", (p) => {
    p.cuts = p.cuts.map((c, i) => ({ ...c, note: `【${sizes[i]}】${(c.note || "").replace(LABEL_RE, "")}`.slice(0, 300) }));
  });
  toast(`已標示 ${cuts.length} 鏡的景別（以每鏡中間那一格判斷：攝影機對準角色時看那個角色，否則看畫面中最大的角色）`);
  return sizes;
}

/** c06: left/right swaps of actor pairs across cuts. Returns [{ cut, t, actors, text }] */
export function checkAxis() {
  RT.sync(S.project);
  const list = axisCheck(RT, (t) => RT.evaluate(t));
  RT.evaluate(S.time);
  return list;
}

const TAKE_TOL = 0.03; // meters: recorded moves replay within 3 cm; the aim point within 0.3 degrees seen from the camera

/**
 * c09: replace the camera's path keys (and aim point keys) inside [t0, t1] with a recorded pilot take.
 * pos / aim: [{ t, v }] samples, simplified to sparse keys. aim is ignored when the camera aims at an actor.
 */
export function commitPilotTake(camId, t0, t1, pos, aim) {
  if (t1 - t0 < 0.1 || pos.length < 2) { toast("錄製時間太短，運鏡沒有改動", "warn"); return; }
  let n = 0;
  S.edit("錄製運鏡", (p) => {
    const c = p.cameras.find((x) => x.id === camId), eps = 0.5 / p.settings.fps;
    if (!c || c.mount) return;
    const splice = (holder, samples, tol) => {
      const take = simplifyTrack(samples, tol, holder.curve || "smooth").map((k) => ({ t: r3(k.t), v: k.v.map(r3), e: k.e }));
      n += take.length;
      const kept = holder.keys.filter((k) => k.t < t0 - eps || k.t > t1 + eps);
      return { ...holder, keys: [...kept, ...take].sort((a, b) => a.t - b.t) };
    };
    c.path = splice(c.path, pos, TAKE_TOL);
    const far = aim ? Math.hypot(...aim[0].v.map((x, k) => x - pos[0].v[k])) : 0;
    if (aim && c.aim.mode === "point") c.aim = splice(c.aim, aim, Math.max(TAKE_TOL, far * 0.005));
  });
  toast(`錄製運鏡完成：${fmt(t0)} 到 ${fmt(t1)} 秒，寫入 ${n} 個關鍵影格（機位與錄製軌跡相差 3 公分內，Ctrl+Z 可復原）`);
}
