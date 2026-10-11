// Camera pilot (v06): look through a scene camera in the 3D view and fly it with WASD / QE; every move is stored on that camera.
// Recording (c09): fly while the scene plays; when playback stops the flight becomes sparse path keys.
import * as THREE from "three";
import { findEntity } from "./state.js";
import { saveCameraView } from "./ops-view.js";
import { commitPilotTake } from "./ops-camera.js";
import { toast, isTyping } from "./ui.js";

const SPEED = 2; // meters per second, Shift x4
// e.code, so the keys also work while a Chinese input method is on
const MOVES = { KeyW: [0, 0, 1], KeyS: [0, 0, -1], KeyA: [-1, 0, 0], KeyD: [1, 0, 0], KeyQ: [0, -1, 0], KeyE: [0, 1, 0] };
const UP = new THREE.Vector3(0, 1, 0);
let seq = 0;

function refusal(vp, ent) {
  if (ent?.list !== "cameras") return "只有攝影機可以駕駛";
  if (vp.store.posing) return "擺姿勢時不能駕駛攝影機";
  if (ent.spec.mount) return "跟著角色移動的攝影機不能駕駛";
  if (ent.spec.locked) return `「${ent.spec.name}」已鎖定，先解除鎖定才能駕駛`;
  return null;
}

export function startPilot(vp, camId) {
  const s = vp.store, ent = findEntity(s.project, camId), why = refusal(vp, ent);
  if (why) { toast(why, "warn"); return false; }
  if (vp.pilot) stopPilot(vp);
  const cam = vp.camera, orbit = vp.orbit;
  const p = {
    id: camId, keys: new Set(), shift: false, dirty: false, burst: null, lastSave: 0, lastFrame: performance.now(),
    prev: { pos: cam.position.clone(), target: orbit.target.clone(), fov: cam.fov },
  };
  p.onKey = (e) => onKey(vp, e);
  p.onBlur = () => { p.keys.clear(); flush(vp); };
  p.onStart = () => { p.burst = `pilot${++seq}`; };
  p.onChange = () => { if (p.burst) p.dirty = true; }; // leftover damping before any input is not a move
  vp.pilot = p;
  addEventListener("keydown", p.onKey, true);
  addEventListener("keyup", p.onKey, true);
  addEventListener("blur", p.onBlur);
  orbit.addEventListener("start", p.onStart);
  orbit.addEventListener("change", p.onChange);
  orbit.enablePan = false;
  syncFromSpec(vp);
  if (!vp.pilot) return false;
  s.setPreview(camId);
  vp.updateGizmo();
  vp.onToolChange?.();
  toast(p.actor ? "這台攝影機對準角色：WASD 只移動機位，滑鼠繞著角色轉｜Esc 結束" : "駕駛中：WASD 移動、QE 升降、Shift 加速、左鍵拖曳轉向｜Esc 結束");
  return true;
}

export function stopPilot(vp) {
  const p = vp.pilot;
  if (!p) return;
  if (p.rec) { vp.store.setPlaying(false); finishRecord(vp); }
  flush(vp);
  removeEventListener("keydown", p.onKey, true);
  removeEventListener("keyup", p.onKey, true);
  removeEventListener("blur", p.onBlur);
  const cam = vp.camera, orbit = vp.orbit;
  orbit.removeEventListener("start", p.onStart);
  orbit.removeEventListener("change", p.onChange);
  vp.pilot = null;
  orbit.enablePan = orbit.enableZoom = true;
  cam.position.copy(p.prev.pos);
  orbit.target.copy(p.prev.target);
  cam.fov = p.prev.fov;
  cam.updateProjectionMatrix();
  orbit.update();
  if (vp.store.preview === p.id) vp.store.setPreview(null);
  vp.updateGizmo();
  vp.onToolChange?.();
}

/** Put the editor view where the camera is at the playhead (start, undo, scrubbing, playback) */
function syncFromSpec(vp) {
  const p = vp.pilot, s = vp.store, spec = findEntity(s.project, p.id)?.spec;
  if (!spec || spec.mount || spec.locked) { p.dirty = false; stopPilot(vp); return; }
  const S = s.project.settings, st = vp.rt.cameraState(p.id, s.time, S.width / S.height);
  if (!st) { p.dirty = false; stopPilot(vp); return; }
  Object.assign(p, { time: s.time, project: s.project, dirty: false, burst: null, actor: spec.aim.mode === "actor" });
  const cam = vp.camera, orbit = vp.orbit;
  orbit.enableZoom = p.actor;
  cam.fov = st.fov;
  cam.updateProjectionMatrix();
  if (p.actor) {
    // orbit around the actor; the aim stays on the actor
    orbit.target.copy(st.target);
    cam.position.copy(st.position);
  } else {
    // look around from the camera position: the orbit pivot sits on the camera, the view 1 cm behind it
    const fwd = st.target.clone().sub(st.position);
    p.aimDist = Math.max(0.5, fwd.length());
    orbit.target.copy(st.position);
    cam.position.copy(st.position).addScaledVector(fwd.normalize(), -0.01);
  }
  orbit.update();
  p.last = current(vp);
}

function current(vp) {
  const p = vp.pilot, cam = vp.camera, orbit = vp.orbit;
  if (p.actor) return { pos: cam.position.clone(), aim: orbit.target.clone() };
  const fwd = orbit.target.clone().sub(cam.position).normalize();
  return { pos: orbit.target.clone(), aim: orbit.target.clone().addScaledVector(fwd, p.aimDist) };
}

function save(vp) {
  const p = vp.pilot;
  p.dirty = false;
  p.lastSave = performance.now();
  const c = current(vp);
  if (p.last && c.pos.distanceTo(p.last.pos) < 1e-3 && c.aim.distanceTo(p.last.aim) < 1e-3) return;
  p.last = c;
  saveCameraView(p.id, c.pos.toArray(), c.aim.toArray(), { autoKey: vp.autoKey, coalesce: p.burst });
  p.project = vp.store.project; // our own edit: no need to sync back
}

function flush(vp) { if (vp.pilot?.dirty) save(vp); }

/** Per frame, before the view renders */
export function pilotFrame(vp) {
  const p = vp.pilot, s = vp.store, now = performance.now();
  const dt = Math.min(0.1, (now - p.lastFrame) / 1000);
  p.lastFrame = now;
  if (p.rec) { recordFrame(vp, dt); return; }
  if (s.time !== p.time || s.project !== p.project) {
    syncFromSpec(vp);
    if (!vp.pilot) return;
  }
  if (!s.playing && fly(vp, dt)) p.dirty = true;
  if (p.dirty && now - p.lastSave >= 100) save(vp);
}

// WASD / QE step for this frame; true when the view moved
function fly(vp, dt) {
  const p = vp.pilot;
  if (!p.keys.size) return false;
  const cam = vp.camera, orbit = vp.orbit;
  const f = orbit.target.clone().sub(cam.position).setY(0);
  if (f.lengthSq() < 1e-8) f.set(0, 0, -1); else f.normalize();
  const right = f.clone().cross(UP), mv = new THREE.Vector3();
  for (const code of p.keys) {
    const [x, y, z] = MOVES[code];
    mv.addScaledVector(right, x).addScaledVector(f, z);
    mv.y += y;
  }
  if (mv.lengthSq() === 0) return false;
  mv.normalize().multiplyScalar(SPEED * (p.shift ? 4 : 1) * dt);
  cam.position.add(mv);
  if (!p.actor) orbit.target.add(mv);
  return true;
}

/** c09: play from the playhead and record the flight every frame; stopping playback writes the take as keys */
export function toggleRecord(vp) {
  const p = vp.pilot, s = vp.store;
  if (!p) return;
  if (p.rec) { s.setPlaying(false); finishRecord(vp); return; }
  const r = s.range, end = r ? r.b : s.project.settings.duration;
  if (s.time >= end - 0.05 || (r && s.time < r.a)) s.setTime(r ? r.a : 0);
  flush(vp);
  syncFromSpec(vp);
  if (!vp.pilot) return;
  p.rec = { t0: s.time, last: s.time, pos: [], aim: [] };
  sample(vp);
  s.setPlaying(true);
  vp.onToolChange?.();
  toast(p.actor ? "錄製運鏡中：WASD 移動、QE 升降，畫面一直對著角色｜空白鍵結束" : "錄製運鏡中：WASD 移動、QE 升降、左鍵拖曳轉向｜空白鍵結束");
}

function recordFrame(vp, dt) {
  const p = vp.pilot, s = vp.store, r = p.rec;
  // the loop wrapped or the playhead was moved: the take ends where it got to
  if (s.time < r.last - 1e-6 || s.time > r.last + 0.5) { s.setPlaying(false); finishRecord(vp); return; }
  if (p.actor) {
    const S = s.project.settings, st = vp.rt.cameraState(p.id, s.time, S.width / S.height);
    if (st) vp.orbit.target.copy(st.target); // keep looking at the moving actor; the camera stays where it is
  }
  fly(vp, dt);
  p.dirty = false; // the take is written once at the end, not as single keys
  sample(vp);
  if (!s.playing) finishRecord(vp);
}

function sample(vp) {
  const r = vp.pilot.rec, t = vp.store.time, c = current(vp);
  if (r.pos.length && t <= r.pos[r.pos.length - 1].t + 1e-4) return;
  r.pos.push({ t, v: c.pos.toArray() });
  r.aim.push({ t, v: c.aim.toArray() });
  r.last = t;
}

function finishRecord(vp) {
  const p = vp.pilot, r = p?.rec;
  if (!r) return;
  Object.assign(p, { rec: null, dirty: false, burst: null });
  commitPilotTake(p.id, r.t0, r.last, r.pos, p.actor ? null : r.aim);
  p.project = null; // put the view back on the written keys next frame
  vp.onToolChange?.();
}

function onKey(vp, e) {
  const p = vp.pilot;
  if (!p || isTyping(e) || document.querySelector(".modal-back, .menu")) return;
  p.shift = e.shiftKey;
  const down = e.type === "keydown";
  if (down && e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    stopPilot(vp);
    return;
  }
  if (!MOVES[e.code]) return;
  if (down && (e.ctrlKey || e.metaKey || e.altKey)) return; // Ctrl+S and friends stay shortcuts
  e.preventDefault();
  e.stopPropagation();
  if (down) {
    if (!p.keys.size) p.burst = `pilot${++seq}`; // one undo step per key press
    p.keys.add(e.code);
  } else {
    p.keys.delete(e.code);
    if (!p.keys.size) flush(vp);
  }
}
