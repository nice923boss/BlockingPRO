// Applies actor.gaze (runtime/gaze.js) to the neck and head joints after every actor is posed.
import * as THREE from "three";
import { resolveBody } from "./rig-human.js";
import { gazeWeight, gazeAngles, mixGaze } from "./gaze.js";

const D2R = Math.PI / 180;
const NECK_SHARE = 0.4; // the neck takes 40% of the turn, the head the rest
const _q = new THREE.Quaternion(), _qn = new THREE.Quaternion(), _qh = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();

/** World point the actor looks from: the middle of a human's head, an animal's head joint */
export function eyePoint(ent, out = new THREE.Vector3()) {
  const j = ent.rig.joints;
  if (ent.spec.kind !== "human") return (j.head || j[ent.rig.jointNames[0]]).getWorldPosition(out);
  const up = resolveBody(ent.spec.preset, ent.spec.body).headR * ent.rig.height * 0.95;
  return j.head.localToWorld(out.set(0, up, 0));
}

/** Turn neck and head of every actor with gaze at time t. Needs world matrices of all actors updated first. */
export function applyGaze(scene, t) {
  for (const a of scene.project.actors) {
    if (!a.gaze?.length) continue;
    const ent = scene.entities.get(a.id), j = ent.rig.joints;
    if (!j.neck || !j.head) continue;
    const from = eyePoint(ent), toLocal = j.neck.parent.getWorldQuaternion(_q).invert();
    const entries = [];
    for (const g of a.gaze) {
      const w = gazeWeight(g, t);
      if (!(w > 0)) continue;
      const target = g.actor ? scene.entities.get(g.actor) : null;
      const at = target ? eyePoint(target, new THREE.Vector3()) : g.point ? new THREE.Vector3().fromArray(g.point) : null;
      if (!at) continue;
      const d = _v.subVectors(at, from).applyQuaternion(toLocal);
      entries.push({ w, ...gazeAngles(d.x, d.y, d.z) });
    }
    const m = mixGaze(entries);
    if (!m) continue;
    const full = new THREE.Quaternion().setFromEuler(_e.set(m.pitch * D2R, m.yaw * D2R, 0, "YXZ"));
    _qn.setFromEuler(_e.set(m.pitch * NECK_SHARE * D2R, m.yaw * NECK_SHARE * D2R, 0, "YXZ"));
    _qh.copy(_qn).invert().multiply(full); // neck * head = full turn
    j.neck.quaternion.slerp(_qn, m.w);
    j.head.quaternion.slerp(_qh, m.w);
  }
}
