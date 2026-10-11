// Props held by actors. attach is one segment or a list of them:
//   { actor, joint, from, to, pos, rot, upright, blend, throw, arc }
// blend: seconds to slide from where the prop was (its path, or the hand of the segment that ends at `from`) into this hand.
// throw: seconds of flight after `to`, along a parabola `arc` meters above the straight line (default 0.5),
//        landing where the prop's path is at to + throw.
// A built-in hold { pos, rot, at } puts the prop's grip point at `at` in the hand frame of a 1.78 m body; on other
// bodies the hand point scales with the body and the prop keeps its size (p07). upright (the segment's, else the
// hold's): the prop stays vertical and only turns with the holder (umbrella p08, things being handed over).
// joint "root": the prop rides with the whole person, pos / rot in the person's frame (scooter, bike: action ride).
import * as THREE from "three";
import { HUMAN_BODIES } from "./rig-human.js";
import { attachList } from "./schema.js";

const D2R = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

const live = (s, t) => t >= (s.from ?? -Infinity) && t < (s.to ?? Infinity);

function pathPose(rt, ent, t) {
  const { pos, yaw } = rt.placement(ent, t);
  return { pos, quat: new THREE.Quaternion().setFromAxisAngle(UP, yaw * D2R) };
}

// World transform of the prop in segment s, from the holder's rig as it is posed now
function heldPose(rt, ent, s) {
  const host = rt.entities.get(s.actor);
  if (!host || host.kind !== "actor") return null;
  if (s.joint === "root") { // ridden vehicles: the prop follows the whole person, turn lean included
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    host.object.matrixWorld.decompose(p, q, new THREE.Vector3());
    const R = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rot || [0, 0, 0]).map((x) => x * D2R)));
    return { pos: p.add(new THREE.Vector3(...(s.pos || [0, 0, 0])).applyQuaternion(q)), quat: q.multiply(R) };
  }
  const rig = host.rig;
  const jointName = s.joint || (rig.joints.rHand && ent.def?.hold ? "rHand" : rig.jointNames[0]);
  const joint = rig.joints[jointName] || rig.joints[rig.jointNames[0]];
  const jp = new THREE.Vector3(), jq = new THREE.Quaternion();
  joint.matrixWorld.decompose(jp, jq, new THREE.Vector3());
  const custom = s.pos || s.rot;
  let hold = custom ? { pos: s.pos || [0, 0, 0], rot: s.rot || [0, 0, 0] } : /Hand$/.test(jointName) ? ent.def?.hold : null;
  const m = jointName === "lHand" && !custom ? -1 : 1; // the left hand mirrors across the YZ plane
  const k = host.spec.kind === "human" ? host.height / HUMAN_BODIES.man.height : host.spec.scale;
  const base = new THREE.Vector3(...(hold?.pos || [0, 0, 0]));
  base.x *= m;
  const R = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(hold?.rot || [0, 0, 0]).map((x, i) => x * D2R * (i ? m : 1))));
  const at = hold?.at ? new THREE.Vector3(hold.at[0] * m, hold.at[1], hold.at[2]) : null;
  // offsets written by hand scale with the body; a built-in grip moves with the hand and the prop keeps its size
  const pos = at ? base.clone().addScaledVector(at, k - 1) : base.clone().multiplyScalar(k);
  if (!(s.upright ?? hold?.upright)) return { pos: jp.clone().add(pos.applyQuaternion(jq)), quat: jq.clone().multiply(R) };
  // upright: the grip point (the prop origin for offsets written by hand) stays in the fist, the prop turns only
  // about the vertical, with the holder
  const grip = at || base;
  const local = grip.clone().sub(base).applyQuaternion(R.clone().invert());
  const gripW = jp.clone().add(grip.clone().multiplyScalar(k).applyQuaternion(jq));
  const yawQ = new THREE.Quaternion();
  host.object.getWorldQuaternion(yawQ);
  return { pos: gripW.sub(local.applyQuaternion(yawQ)), quat: yawQ };
}

// heldPose with the holder posed at time `at`, then put back as it was at the evaluated time
function heldPoseAt(rt, ent, s, at) {
  const host = rt.entities.get(s.actor);
  if (!host || host.kind !== "actor") return null;
  if (Math.abs(at - rt.time) < 1e-6) return heldPose(rt, ent, s);
  const state = rt.actorState.get(s.actor);
  rt._evalActor(host, at);
  host.object.updateMatrixWorld(true);
  const out = heldPose(rt, ent, s);
  rt._evalActor(host, rt.time);
  host.object.updateMatrixWorld(true);
  rt.actorState.set(s.actor, state);
  return out;
}

const mixPose = (a, b, u) => ({ pos: a.pos.clone().lerp(b.pos, u), quat: a.quat.clone().slerp(b.quat, u) });

/** World { pos, quat } of prop ent at time t (the actors must already be posed at t) */
export function propPose(rt, ent, t) {
  const segs = attachList(ent.spec);
  const s = segs.find((x) => live(x, t));
  if (s) {
    const held = heldPose(rt, ent, s);
    if (!held) return pathPose(rt, ent, t);
    const u = s.blend > 0 && s.from != null ? (t - s.from) / s.blend : 1;
    if (u >= 1) return held;
    // slide in from the previous holder's hand (hand-over) or from where the prop lies
    const prev = segs.find((x) => x !== s && x.to != null && Math.abs(x.to - s.from) < 1e-3);
    return mixPose((prev && heldPose(rt, ent, prev)) || pathPose(rt, ent, s.from), held, smooth(u));
  }
  const thrown = segs.find((x) => x.throw > 0 && x.to != null && t >= x.to && t < x.to + x.throw);
  if (thrown) {
    const a = heldPoseAt(rt, ent, thrown, thrown.to), b = pathPose(rt, ent, thrown.to + thrown.throw);
    if (!a) return pathPose(rt, ent, t);
    const u = (t - thrown.to) / thrown.throw, out = mixPose(a, b, u);
    out.pos.y += 4 * (thrown.arc ?? 0.5) * u * (1 - u);
    return out;
  }
  return pathPose(rt, ent, t);
}
